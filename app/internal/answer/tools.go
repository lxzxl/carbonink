package answer

import (
	"context"
	"encoding/json"
	"sort"

	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

const (
	listActivitiesMax     = 200
	listActivitiesDefault = 50
)

var (
	listActivitiesSchema = json.RawMessage(`{"type":"object","additionalProperties":false,
		"properties":{"year":{"type":"integer"},"scope":{"type":"integer","enum":[1,2,3]},
		"emission_source_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200}}}`)
	sumCO2eSchema = json.RawMessage(`{"type":"object","additionalProperties":false,
		"properties":{"year":{"type":"integer"},"scope":{"type":"integer","enum":[1,2,3]},
		"emission_source_id":{"type":"string"}}}`)
	listSourcesSchema = json.RawMessage(`{"type":"object","additionalProperties":false,
		"properties":{"scope":{"type":"integer","enum":[1,2,3]}}}`)
	getFactorSchema = json.RawMessage(`{"type":"object","required":["activity_id"],
		"additionalProperties":false,"properties":{"activity_id":{"type":"string","minLength":1}}}`)
	readContextSchema = json.RawMessage(`{"type":"object","required":["questionnaire_id"],
		"additionalProperties":false,"properties":{"questionnaire_id":{"type":"string","minLength":1}}}`)
)

type activityArgs struct {
	Year             *int    `json:"year"`
	Scope            *int    `json:"scope"`
	EmissionSourceID *string `json:"emission_source_id"`
	Limit            *int    `json:"limit"`
}

// BuildTools returns the five read-only inventory tools the answer agent has.
func BuildTools(db *store.Store, organizationID, questionnaireID string,
	defaultYear int) []llm.AgentTool {
	filtered := func(ctx context.Context, args activityArgs) ([]store.Activity, error) {
		year := defaultYear
		if args.Year != nil {
			year = *args.Year
		}
		rows, err := db.ActivitiesForYear(ctx, year)
		if err != nil {
			return nil, err
		}
		out := make([]store.Activity, 0, len(rows))
		for _, row := range rows {
			if args.Scope != nil && row.Scope != *args.Scope {
				continue
			}
			if args.EmissionSourceID != nil && row.EmissionSourceID != *args.EmissionSourceID {
				continue
			}
			out = append(out, row)
		}
		return out, nil
	}

	return []llm.AgentTool{
		{
			Name: "list_activities",
			Description: "List activity rows filtered by reporting year, scope (1|2|3), or " +
				"emission_source_id. Returns id, source_name, scope, period_id, occurred_at_*, " +
				"amount, unit, co2e_kg. Defaults to 50 rows; limit caps at 200.",
			Schema: listActivitiesSchema,
			Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
				var args activityArgs
				if len(raw) > 0 {
					if err := json.Unmarshal(raw, &args); err != nil {
						return nil, err
					}
				}
				limit := listActivitiesDefault
				if args.Limit != nil {
					limit = *args.Limit
				}
				if limit > listActivitiesMax {
					limit = listActivitiesMax
				}
				rows, err := filtered(ctx, args)
				if err != nil {
					return nil, err
				}
				if len(rows) > limit {
					rows = rows[:limit]
				}
				activities := make([]map[string]any, len(rows))
				for i, row := range rows {
					activities[i] = activityJSON(row)
				}
				return map[string]any{"count": len(activities), "activities": activities}, nil
			},
		},
		{
			Name: "sum_co2e",
			Description: "Aggregate co2e_kg across activities. Filter by year, scope, or " +
				"emission_source_id. Returns {total_kg, count}.",
			Schema: sumCO2eSchema,
			Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
				var args activityArgs
				if len(raw) > 0 {
					if err := json.Unmarshal(raw, &args); err != nil {
						return nil, err
					}
				}
				rows, err := filtered(ctx, args)
				if err != nil {
					return nil, err
				}
				total := 0.0
				for _, row := range rows {
					total += row.CO2eKg
				}
				return map[string]any{"total_kg": total, "count": len(rows)}, nil
			},
		},
		{
			Name: "list_emission_sources",
			Description: "List emission sources for the organization, optionally filtered by scope. " +
				"Returns id, name, scope, category, site_id, is_active.",
			Schema: listSourcesSchema,
			Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
				var args struct {
					Scope *int `json:"scope"`
				}
				if len(raw) > 0 {
					if err := json.Unmarshal(raw, &args); err != nil {
						return nil, err
					}
				}
				sources := []store.EmissionSource{}
				if organizationID != "" {
					var err error
					sources, err = db.ListSources(ctx, organizationID)
					if err != nil {
						return nil, err
					}
				}
				sort.SliceStable(sources, func(i, j int) bool {
					if sources[i].Scope != sources[j].Scope {
						return sources[i].Scope < sources[j].Scope
					}
					return sources[i].Name < sources[j].Name
				})
				out := make([]map[string]any, 0, len(sources))
				for _, source := range sources {
					if args.Scope != nil && source.Scope != *args.Scope {
						continue
					}
					out = append(out, map[string]any{
						"id": source.ID, "name": source.Name, "scope": source.Scope,
						"category": source.Category, "site_id": source.SiteID,
						"is_active": source.IsActive,
					})
				}
				return map[string]any{"count": len(out), "emission_sources": out}, nil
			},
		},
		{
			Name: "get_emission_factor",
			Description: "Look up the emission factor pinned to a specific activity. Returns the EF " +
				"composite key, names, and per-unit CO2e.",
			Schema: getFactorSchema,
			Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
				var args struct {
					ActivityID string `json:"activity_id"`
				}
				if err := json.Unmarshal(raw, &args); err != nil {
					return nil, err
				}
				row, err := db.ActivityByID(ctx, args.ActivityID)
				if err != nil {
					return nil, err
				}
				if row == nil {
					return map[string]any{"error": "activity_not_found",
						"activity_id": args.ActivityID}, nil
				}
				out := map[string]any{
					"activity_id": row.ID, "factor_code": row.EFFactorCode,
					"year": row.EFYear, "source": row.EFSource,
					"geography": row.EFGeography, "dataset_version": row.EFDatasetVersion,
					"co2e_kg_per_unit": efPerUnit(row),
				}
				ef, err := db.EmissionFactorByKey(ctx, store.EmissionFactorKey{
					FactorCode: row.EFFactorCode, Year: row.EFYear, Source: row.EFSource,
					Geography: row.EFGeography, DatasetVersion: row.EFDatasetVersion,
				})
				if err == nil && ef != nil {
					out["name_zh"] = ef.NameZH
					out["name_en"] = ef.NameEN
					out["input_unit"] = ef.InputUnit
					out["co2e_kg_per_unit"] = ef.CO2eKgPerUnit
				}
				return out, nil
			},
		},
		{
			Name: "read_questionnaire_context",
			Description: "Read the questionnaire's customer name, reporting year, and question " +
				"count.",
			Schema: readContextSchema,
			Run: func(ctx context.Context, raw json.RawMessage) (any, error) {
				var args struct {
					QuestionnaireID string `json:"questionnaire_id"`
				}
				if err := json.Unmarshal(raw, &args); err != nil {
					return nil, err
				}
				q, err := db.QuestionnaireByID(ctx, args.QuestionnaireID)
				if err != nil {
					return nil, err
				}
				if q == nil {
					return map[string]any{"error": "questionnaire_not_found",
						"questionnaire_id": args.QuestionnaireID}, nil
				}
				return map[string]any{"customer_name": q.CustomerName,
					"reporting_year": q.ReportingYear, "question_count": q.QuestionCount}, nil
			},
		},
	}
}

func activityJSON(row store.Activity) map[string]any {
	return map[string]any{
		"id": row.ID, "source_name": row.Source, "scope": row.Scope,
		"period_id": row.ReportingPeriodID, "occurred_at_start": row.OccurredAt,
		"occurred_at_end": row.OccurredAtEnd, "amount": row.Amount, "unit": row.Unit,
		"co2e_kg": row.CO2eKg,
	}
}

func efPerUnit(row *store.Activity) float64 {
	if row.Amount == 0 {
		return 0
	}
	return row.CO2eKg / row.Amount
}
