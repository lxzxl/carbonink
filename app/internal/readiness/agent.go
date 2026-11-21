package readiness

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

const (
	agentMaxTurns          = 4
	agentObservationLimit  = 240
	agentTraceEvent        = "readiness.agent_trace"
	agentPromptMaxFindings = 20
)

const agentSystemPrompt = `You review the STRUCTURE of a greenhouse-gas inventory for an ESG consultant.
You are not checking arithmetic — deterministic rules already do that.

Raise only two kinds of observation:
- N6: an emission source whose scope or category contradicts what its name
  describes (e.g. a diesel generator filed under Scope 2, which is for
  purchased energy). Always cite the emission_source_id.
- C6: an emission source this organization's industry would normally report
  and which is absent entirely. Omit emission_source_id; nothing exists yet.

Say nothing when the inventory looks structurally sound. An empty findings
array is a good answer and is expected often. Do not restate what the data
says, do not speculate about causes, and never invent an id: cite only ids
returned by the tools.
Keep each observation to one sentence.`

var agentTools = []llm.AgentTool{
	{
		Name: "list_emission_sources",
		Description: "List the active emission sources: id, name, scope (1|2|3), category. " +
			"Cite these ids and no others.",
		Schema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{}}`),
		Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
			db, _ := ctx.Value(agentStoreKey{}).(*store.Store)
			org, _ := ctx.Value(agentOrgKey{}).(string)
			if db == nil {
				return nil, errors.New("inventory is unavailable")
			}
			return map[string]any{"emission_sources": agentSources(ctx, db, org)}, nil
		},
	},
	{
		Name: "summarize_activity",
		Description: "Per-source totals for the period: row count and total co2e_kg. " +
			"Use to tell a material source from a token one.",
		Schema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{}}`),
		Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
			db, _ := ctx.Value(agentStoreKey{}).(*store.Store)
			periodID, _ := ctx.Value(agentPeriodKey{}).(string)
			org, _ := ctx.Value(agentOrgKey{}).(string)
			if db == nil {
				return nil, errors.New("inventory is unavailable")
			}
			return map[string]any{"sources": agentActivitySummary(ctx, db, periodID, org)}, nil
		},
	},
	{
		Name: "get_organization_profile",
		Description: "The organization: industry, country, boundary and site count. Industry " +
			"is what makes a missing source (C6) judgeable.",
		Schema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{}}`),
		Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
			db, _ := ctx.Value(agentStoreKey{}).(*store.Store)
			org, _ := ctx.Value(agentOrgKey{}).(string)
			if db == nil {
				return nil, errors.New("inventory is unavailable")
			}
			return agentProfile(ctx, db, org), nil
		},
	},
}

var agentFinish = llm.Tool{
	Name:        "save_readiness_review",
	Description: "Return the structural observations. An empty array is a valid answer.",
	Schema: json.RawMessage(`{"type":"object","required":["findings"],
		"additionalProperties":false,"properties":{"findings":{"type":"array","maxItems":20,
		"items":{"type":"object","required":["check_id","observation"],
		"additionalProperties":false,"properties":{
		"check_id":{"type":"string","enum":["C6","N6"]},
		"emission_source_id":{"type":"string"},
		"observation":{"type":"string","maxLength":240}}}}}}`),
}

type agentStoreKey struct{}
type agentOrgKey struct{}
type agentPeriodKey struct{}

type agentSource struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Scope    int    `json:"scope"`
	Category string `json:"category"`
}

// Review runs the two structural checks a rule cannot express: a missing
// expected source (C6) and a source whose classification contradicts its name
// (N6). Every failure degrades to "the agent added nothing"; the deterministic
// checklist above remains the product.
func Review(ctx context.Context, db *store.Store, periodID string,
	runner llm.AgentRunner) ([]Finding, error) {
	if runner == nil {
		return nil, nil
	}
	current, err := loadPeriod(ctx, db.DB(), periodID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, nil
	}
	sources, err := agentSourcesChecked(ctx, db, current.OrganizationID)
	if err != nil {
		return nil, err
	}
	if len(sources) == 0 {
		return nil, nil
	}
	known := make(map[string]struct{}, len(sources))
	for _, source := range sources {
		known[source.ID] = struct{}{}
	}

	started := time.Now()
	ctx = context.WithValue(ctx, agentStoreKey{}, db)
	ctx = context.WithValue(ctx, agentOrgKey{}, current.OrganizationID)
	ctx = context.WithValue(ctx, agentPeriodKey{}, current.ID)
	run, runErr := runner.RunAgent(ctx, agentSystemPrompt,
		"Review the "+itoa(current.Year)+" inventory. Start by listing the emission "+
			"sources and the organization profile.", agentTools, agentFinish, agentMaxTurns)
	if runErr != nil {
		_ = writeAgentTrace(ctx, db, current.ID, "failed", 0, nil, 0)
		return nil, nil
	}
	_ = writeAgentTrace(ctx, db, current.ID, "completed", run.Turns, run.ToolCalls,
		time.Since(started).Milliseconds())

	var output struct {
		Findings []struct {
			CheckID          string `json:"check_id"`
			EmissionSourceID string `json:"emission_source_id"`
			Observation      string `json:"observation"`
		} `json:"findings"`
	}
	if err := json.Unmarshal(run.Output, &output); err != nil {
		return nil, nil
	}
	findings := make([]Finding, 0, len(output.Findings))
	for _, item := range output.Findings {
		observation := strings.TrimSpace(item.Observation)
		if observation == "" {
			continue
		}
		observation = truncateRunes(observation, agentObservationLimit)
		if item.CheckID == "N6" {
			if _, ok := known[item.EmissionSourceID]; !ok {
				continue
			}
			findings = append(findings, Finding{
				CheckID: "N6", Severity: SeverityInfo,
				Entity: Entity{Type: "emission_source", ID: item.EmissionSourceID},
				Facts:  map[string]any{"observation": observation},
			})
			continue
		}
		if item.CheckID != "C6" {
			continue
		}
		findings = append(findings, Finding{
			CheckID: "C6", Severity: SeverityInfo,
			Entity: Entity{Type: "period", ID: current.ID},
			Facts:  map[string]any{"observation": observation},
		})
	}
	return findings, nil
}

func agentSources(ctx context.Context, db *store.Store, orgID string) []agentSource {
	out, _ := agentSourcesChecked(ctx, db, orgID)
	return out
}

func agentSourcesChecked(ctx context.Context, db *store.Store, orgID string) ([]agentSource, error) {
	rows, err := db.DB().QueryContext(ctx, `SELECT es.id, es.name, es.scope,
			COALESCE(es.category, '')
		FROM emission_source es
		JOIN site s ON s.id = es.site_id
		WHERE s.organization_id = ? AND es.is_active = 1
		ORDER BY es.scope, es.name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []agentSource
	for rows.Next() {
		var source agentSource
		if err := rows.Scan(&source.ID, &source.Name, &source.Scope, &source.Category); err != nil {
			return nil, err
		}
		out = append(out, source)
	}
	return out, rows.Err()
}

func agentActivitySummary(ctx context.Context, db *store.Store, periodID, orgID string) []map[string]any {
	rows, err := db.DB().QueryContext(ctx, `SELECT es.id, es.name, COUNT(ad.id),
			COALESCE(SUM(ad.computed_co2e_kg), 0)
		FROM emission_source es
		JOIN site s ON s.id = es.site_id
		LEFT JOIN activity_data ad
		  ON ad.emission_source_id = es.id AND ad.reporting_period_id = ?
		WHERE s.organization_id = ?
		GROUP BY es.id
		ORDER BY 4 DESC`, periodID, orgID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, name string
		var count int
		var co2e float64
		if err := rows.Scan(&id, &name, &count, &co2e); err != nil {
			return nil
		}
		out = append(out, map[string]any{
			"emission_source_id": id, "name": name, "row_count": count, "co2e_kg": co2e,
		})
	}
	return out
}

func agentProfile(ctx context.Context, db *store.Store, orgID string) map[string]any {
	var industry, country, boundary string
	var sites int
	err := db.DB().QueryRowContext(ctx, `SELECT COALESCE(industry, ''),
			country_code, boundary_kind,
			(SELECT COUNT(*) FROM site WHERE organization_id = organization.id)
		FROM organization WHERE id = ?`, orgID).
		Scan(&industry, &country, &boundary, &sites)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{"error": "organization_not_found"}
	}
	if err != nil {
		return map[string]any{"error": "organization_unavailable"}
	}
	return map[string]any{
		"industry": industry, "country_code": country, "boundary_kind": boundary,
		"site_count": sites,
	}
}

// writeAgentTrace keeps model observations out of the append-only table:
// tool names, counts and timings only.
func writeAgentTrace(ctx context.Context, db *store.Store, periodID, stop string,
	turns int, tools []string, durationMS int64) error {
	return db.RecordAuditEvent(ctx, agentTraceEvent, map[string]any{
		"reporting_period_id": periodID,
		"stop_reason":         stop,
		"turn_count":          turns,
		"tool_calls":          tools,
		"duration_ms":         durationMS,
	})
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	pos := len(digits)
	for value > 0 {
		pos--
		digits[pos] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[pos:])
}
