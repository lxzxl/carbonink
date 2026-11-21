package readiness

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

const testTS = "2025-01-15T00:00:00Z"

func testDB(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "readiness.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedBase(t *testing.T, db *store.Store, withBaseYear bool) {
	t.Helper()
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.DB().ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO organization (id, singleton_key, name_zh, country_code, boundary_kind,
			created_at, updated_at) VALUES ('org', 1, '测试组织', 'CN',
			'operational_control', ?, ?)`, testTS, testTS)
	exec(`INSERT INTO site (id, organization_id, name_zh, country_code, created_at, updated_at)
		VALUES ('site', 'org', '上海工厂', 'CN', ?, ?)`, testTS, testTS)
	exec(`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at,
			ends_at, created_at) VALUES ('period', 'org', 2025, 'annual',
			'2025-01-01', '2025-12-31', ?)`, testTS)
	if withBaseYear {
		exec(`UPDATE organization SET base_year_period_id = 'period' WHERE id = 'org'`)
	}
	exec(`INSERT INTO emission_source (id, site_id, name, scope, category)
		VALUES ('src', 'site', '外购电力', 2, 'electricity.grid')`)
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
			dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis,
			pinned_at, pinned_from) VALUES ('ef', 2024, 'MEE', 'CN', '2024', 2,
			'kWh', 0.5, 'AR6', ?, 'seed')`, testTS)
}

func insertActivity(t *testing.T, db *store.Store, id, sourceID, start, end string,
	amount float64, unit, factor string, efYear int, efSource string) {
	t.Helper()
	ctx := context.Background()
	_, err := db.DB().ExecContext(ctx, `INSERT INTO activity_data (id, site_id,
			emission_source_id, reporting_period_id, occurred_at_start, occurred_at_end,
			amount, unit, ef_factor_code, ef_year, ef_source, ef_geography,
			ef_dataset_version, computed_co2e_kg, computed_at, created_at, updated_at)
		VALUES (?, 'site', ?, 'period', ?, ?, ?, ?, ?, ?, ?, 'CN', '2024', 50, ?, ?, ?)`,
		id, sourceID, start, end, amount, unit, factor, efYear, efSource, testTS, testTS, testTS)
	if err != nil {
		t.Fatal(err)
	}
}

func auditCreated(t *testing.T, db *store.Store, id string) {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"activity_id": id})
	if _, err := db.DB().ExecContext(context.Background(),
		`INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
		"audit-"+id, "activity_data.created", string(payload), testTS); err != nil {
		t.Fatal(err)
	}
}

func testOptions() Options {
	return Options{
		Now:                time.Date(2026, 11, 21, 12, 0, 0, 0, time.Local),
		ImportOutlierRatio: 10,
	}
}

func checkIDs(report Report) map[string]bool {
	out := make(map[string]bool, len(report.Findings))
	for _, finding := range report.Findings {
		out[finding.CheckID] = true
	}
	return out
}

func TestRunBaselineAndDismissal(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	seedBase(t, db, false)
	insertActivity(t, db, "act", "src", "2025-03-01", "2025-03-31", 100, "kWh", "ef", 2024, "MEE")
	auditCreated(t, db, "act")

	report, err := Run(ctx, db, "period", testOptions())
	if err != nil {
		t.Fatal(err)
	}
	ids := checkIDs(report)
	if !ids["D1"] || !ids["T1"] || len(report.Findings) != 2 {
		t.Fatalf("baseline findings = %+v", report.Findings)
	}
	if report.Counts.Warning != 1 || report.Counts.Info != 1 {
		t.Fatalf("counts = %+v", report.Counts)
	}
	if report.DismissedCount != 0 || report.CheckedAt == "" {
		t.Fatalf("report = %+v", report)
	}

	key := "T1:period:period"
	if err := Dismiss(ctx, db, key); err != nil {
		t.Fatal(err)
	}
	again, err := Run(ctx, db, "period", testOptions())
	if err != nil {
		t.Fatal(err)
	}
	if checkIDs(again)["T1"] || again.DismissedCount != 1 {
		t.Fatalf("after dismissal = %+v", again)
	}
	if err := Undismiss(ctx, db, key); err != nil {
		t.Fatal(err)
	}
	restored, err := Run(ctx, db, "period", testOptions())
	if err != nil {
		t.Fatal(err)
	}
	if !checkIDs(restored)["T1"] || restored.DismissedCount != 0 {
		t.Fatalf("after undismiss = %+v", restored)
	}

	var payload string
	if err := db.DB().QueryRowContext(ctx, `SELECT payload FROM audit_event
		WHERE event_kind = 'readiness.reviewed' ORDER BY occurred_at DESC LIMIT 1`).
		Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var event map[string]any
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		t.Fatal(err)
	}
	if event["check_count"].(float64) != CheckCount || event["year"].(float64) != 2025 {
		t.Fatalf("audit payload = %v", event)
	}
	if _, ok := event["findings"]; ok {
		t.Fatalf("audit payload carries row-level findings: %v", event)
	}
}

func TestRunCoversEveryDeterministicRule(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	seedBase(t, db, true)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.DB().ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	// C1: an active source with nothing recorded.
	exec(`INSERT INTO emission_source (id, site_id, name, scope, category)
		VALUES ('src-empty', 'site', '柴油叉车', 1, 'fuel.diesel')`)

	// Baseline row, normal on every rule except D2 (see below).
	insertActivity(t, db, "act", "src", "2025-03-01", "2025-03-31", 100, "kWh", "ef", 2024, "MEE")
	auditCreated(t, db, "act")

	// C3: dated outside the period.
	insertActivity(t, db, "act-out", "src", "2026-01-05", "2026-01-06", 5, "kWh", "ef", 2024, "MEE")
	auditCreated(t, db, "act-out")

	// N1: litres against an energy factor, no fuel binding.
	insertActivity(t, db, "act-n1", "src", "2025-04-01", "2025-04-01", 30, "L", "ef", 2024, "MEE")
	auditCreated(t, db, "act-n1")

	// N2/N3 group: five rows sharing source and unit; one outlier, no
	// duplicate dates.
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
			dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis,
			pinned_at, pinned_from) VALUES ('ef-kg', 2024, 'MEE', 'CN', '2024', 1,
			'kg', 2.0, 'AR6', ?, 'seed')`, testTS)
	for i, amount := range []float64{100, 100, 100, 100, 5000} {
		id := "act-mass-" + string(rune('a'+i))
		start := "2025-05-0" + string(rune('1'+i))
		insertActivity(t, db, id, "src", start, start, amount, "kg", "ef-kg", 2024, "MEE")
		auditCreated(t, db, id)
	}

	// N3: exact duplicate of the baseline row.
	insertActivity(t, db, "act-dupe", "src", "2025-03-01", "2025-03-31", 100, "kWh", "ef", 2024, "MEE")
	auditCreated(t, db, "act-dupe")

	// N5: a second GWP basis in the same period.
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
			dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis,
			pinned_at, pinned_from) VALUES ('ef-ar5', 2024, 'MEE', 'CN', '2024', 2,
			'kWh', 0.6, 'AR5', ?, 'seed')`, testTS)
	insertActivity(t, db, "act-ar5", "src", "2025-06-01", "2025-06-01", 10, "kWh", "ef-ar5", 2024, "MEE")
	auditCreated(t, db, "act-ar5")

	// T2: no created event for this row.
	insertActivity(t, db, "act-t2", "src", "2025-06-02", "2025-06-02", 10, "kWh", "ef", 2024, "MEE")

	// T3: 2019 factor used for 2025.
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
			dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis,
			pinned_at, pinned_from) VALUES ('ef-old', 2019, 'MEE', 'CN', '2024', 2,
			'kWh', 0.7, 'AR6', ?, 'seed')`, testTS)
	insertActivity(t, db, "act-t3", "src", "2025-06-03", "2025-06-03", 10, "kWh", "ef-old", 2019, "MEE")
	auditCreated(t, db, "act-t3")

	// T4: pinned to a deleted user library.
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
			dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis,
			pinned_at, pinned_from) VALUES ('ef-user', 2024, 'user:gone', 'CN', '2024', 2,
			'kWh', 0.8, 'AR6', ?, 'seed')`, testTS)
	insertActivity(t, db, "act-t4", "src", "2025-06-04", "2025-06-04", 10, "kWh", "ef-user", 2024, "user:gone")
	auditCreated(t, db, "act-t4")

	// C5: outbound question with no answer.
	exec(`INSERT INTO customer (id, name) VALUES ('cust', '客户甲')`)
	exec(`INSERT INTO questionnaire (id, customer_id, reporting_year, status, direction,
			created_at) VALUES ('q-out', 'cust', 2025, 'exported', 'outbound', ?)`, testTS)
	exec(`INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
			normalized_text, raw_text, question_kind, position)
		VALUES ('question', 'q-out', 'sig', 'v1', '用电量', '用电量', 'numerical', '1')`)

	// D2: snapshot says 999 kg, ledger says 50.
	exec(`INSERT INTO calculation_snapshot (id, reporting_period_id, frozen_at,
			ef_dataset_versions, total_co2e_kg, scope1_kg, scope2_kg_location,
			scope3_kg_by_cat) VALUES ('snap', 'period', ?, '{}', 999, 0, 999, '{}')`, testTS)
	exec(`INSERT INTO calculation_snapshot_line (id, calculation_snapshot_id,
			original_activity_data_id, site_id_at_freeze, site_name_at_freeze,
			emission_source_id_at_freeze, emission_source_name_at_freeze,
			reporting_period_id_at_freeze, occurred_at_start, occurred_at_end,
			amount, unit, ef_input_unit, converted_amount, ef_factor_code, ef_year,
			ef_source, ef_geography, ef_dataset_version, ef_co2e_kg_per_unit,
			ef_gwp_basis, computed_co2e_kg, scope)
		VALUES ('line', 'snap', 'act', 'site', '上海工厂', 'src', '外购电力', 'period',
			'2025-03-01', '2025-03-31', 100, 'kWh', 'kWh', 100, 'ef', 2024, 'MEE',
			'CN', '2024', 0.5, 'AR6', 999, 2)`)

	// D3: inbound disclosure marked sent and past due.
	exec(`INSERT INTO questionnaire (id, customer_id, reporting_year, status, direction,
			due_date, created_at) VALUES ('q-in', 'cust', 2025, 'sent', 'inbound', ?, ?)`,
		"2026-11-20", testTS)

	report, err := Run(ctx, db, "period", testOptions())
	if err != nil {
		t.Fatal(err)
	}
	ids := checkIDs(report)
	for _, want := range []string{"C1", "C3", "C5", "N1", "N2", "N3", "N5",
		"T1", "T2", "T3", "T4", "D2", "D3"} {
		if !ids[want] {
			t.Errorf("missing finding %s; got %v", want, sortedKeys(ids))
		}
	}
	if ids["D1"] {
		t.Error("D1 fired although a base year is set")
	}
}

func sortedKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	return out
}

type fakeAgent struct {
	output string
	ctx    context.Context
	tools  []llm.AgentTool
}

func (f *fakeAgent) RunAgent(ctx context.Context, system, user string,
	tools []llm.AgentTool, finish llm.Tool, maxTurns int) (*llm.AgentRun, error) {
	f.ctx, f.tools = ctx, tools
	return &llm.AgentRun{
		Output: json.RawMessage(f.output), Turns: 2,
		ToolCalls: []string{"list_emission_sources"},
	}, nil
}

func TestAgentReviewSanitizesFindings(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	seedBase(t, db, true)
	runner := &fakeAgent{output: `{"findings":[
		{"check_id":"N6","emission_source_id":"src",
		 "observation":"A grid electricity source filed under Scope 2 is plausible, but check the category."},
		{"check_id":"N6","emission_source_id":"invented",
		 "observation":"This id does not exist and must be dropped."},
		{"check_id":"C6","observation":"A business-travel source is normally reported and is absent."},
		{"check_id":"C1","observation":"Unknown checks are dropped."}
	]}`}
	findings, err := Review(ctx, db, "period", runner)
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 2 {
		t.Fatalf("agent findings = %+v", findings)
	}
	if findings[0].CheckID != "N6" || findings[0].Entity.ID != "src" ||
		findings[0].Severity != SeverityInfo {
		t.Fatalf("N6 = %+v", findings[0])
	}
	if findings[1].CheckID != "C6" || findings[1].Entity.ID != "period" {
		t.Fatalf("C6 = %+v", findings[1])
	}

	// The tool context carries the inventory, and the tool schema is read-only.
	if len(runner.tools) != 3 {
		t.Fatalf("agent tools = %d", len(runner.tools))
	}
	value, err := runner.tools[0].Run(runner.ctx, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(value)
	if !strings.Contains(string(encoded), `"src"`) {
		t.Fatalf("list_emission_sources = %s", encoded)
	}

	var payload string
	if err := db.DB().QueryRowContext(ctx, `SELECT payload FROM audit_event
		WHERE event_kind = 'readiness.agent_trace'`).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(payload, "business-travel") || strings.Contains(payload, "observation") {
		t.Fatalf("agent trace carries model text: %s", payload)
	}
	var trace map[string]any
	if err := json.Unmarshal([]byte(payload), &trace); err != nil {
		t.Fatal(err)
	}
	if trace["turn_count"].(float64) != 2 || trace["stop_reason"] != "completed" {
		t.Fatalf("trace = %v", trace)
	}
}
