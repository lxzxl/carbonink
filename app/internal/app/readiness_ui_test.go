package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/readiness"
	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestReadinessReviewRunsAndDismisses drives the report page's checklist:
// the fixture row has no audit event and no evidence, and the organization
// has no base year.
func TestReadinessReviewRunsAndDismisses(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 900),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-period-period", 5*time.Second)
	ui.Press("id:reports-period-period")
	ui.WaitFor("id:readiness-run", 5*time.Second)
	ui.Press("id:readiness-run")
	ui.WaitFor("text:Row has no audit trail", 5*time.Second)
	ui.WaitFor("text:No base year set", 3*time.Second)
	ui.WaitFor("text:1 blockers · 1 warnings · 1 notes", 3*time.Second)

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	events, err := check.QueryAuditEvents(ctx, store.AuditQuery{
		Kind: "readiness.reviewed", Limit: 10,
	})
	if err != nil || len(events) != 1 {
		t.Fatalf("audit events = %d, %v", len(events), err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(events[0].Payload), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["check_count"].(float64) != readiness.CheckCount {
		t.Fatalf("audit payload = %v", payload)
	}
	if _, ok := payload["activity_id"]; ok {
		t.Fatalf("audit payload carries row ids: %v", payload)
	}

	ui.Press("id:readiness-dismiss-T2:activity_data:act")
	ui.WaitForGone("text:Row has no audit trail", 5*time.Second)
	ui.WaitFor("text:1 dismissed", 5*time.Second)
	ui.WaitUntil(3*time.Second, func() bool {
		keys, err := readiness.DismissedKeys(ctx, check)
		_, ok := keys["T2:activity_data:act"]
		return err == nil && ok
	})

	var stored string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT value FROM setting WHERE key = ?`, readiness.DismissedSetting).
		Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored, "T2:activity_data:act") {
		t.Fatalf("dismissed setting = %q", stored)
	}
}

// TestReadinessAgentReviewAppendsFindings proves the AI layer is additive:
// the deterministic rows stay, and a hallucinated source id is dropped in
// favor of the real one.
func TestReadinessAgentReviewAppendsFindings(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		arguments, _ := json.Marshal(map[string]any{"findings": []map[string]any{
			{"check_id": "N6", "emission_source_id": "src",
				"observation": "Grid electricity filed under Scope 2 should be checked against the category."},
			{"check_id": "N6", "emission_source_id": "invented",
				"observation": "This must be dropped."},
			{"check_id": "C6",
				"observation": "A business-travel source is normally reported and is absent."},
		}})
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
			"message": map[string]any{"role": "assistant", "content": nil,
				"tool_calls": []any{map[string]any{
					"id": "call_1", "type": "function",
					"function": map[string]any{
						"name": "save_readiness_review", "arguments": string(arguments),
					},
				}}},
		}}})
	}))
	defer server.Close()

	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 900),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	configureLLMEndpoint(t, ui, server.URL)
	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-period-period", 5*time.Second)
	ui.Press("id:reports-period-period")
	ui.WaitFor("id:readiness-run", 5*time.Second)
	ui.Press("id:readiness-run")
	ui.WaitFor("text:Row has no audit trail", 5*time.Second)
	if !ui.Enabled("id:readiness-review-agent") {
		t.Fatal("agent review is disabled after a deterministic run")
	}
	ui.Press("id:readiness-review-agent")
	ui.WaitFor("text:Grid electricity filed under Scope 2", 5*time.Second)
	ui.WaitFor("text:A business-travel source is normally reported", 5*time.Second)
	ui.WaitFor("text:Row has no audit trail", 3*time.Second)
	if ui.Exists("text:This must be dropped.") {
		t.Fatal("a hallucinated emission source id reached the checklist")
	}
	if calls != 1 {
		t.Fatalf("agent calls = %d, want 1", calls)
	}

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	events, err := check.QueryAuditEvents(ctx, store.AuditQuery{
		Kind: "readiness.agent_trace", Limit: 5,
	})
	if err != nil || len(events) != 1 {
		t.Fatalf("agent trace events = %d, %v", len(events), err)
	}
	if strings.Contains(events[0].Payload, "Grid electricity") {
		t.Fatalf("agent trace kept model text: %s", events[0].Payload)
	}
}
