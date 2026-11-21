package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/agentbridge"
	"app.carbonink.desktop/internal/store"
)

func TestReadSurface(t *testing.T) {
	path := fixtureDB(t)
	server := &Server{DBPath: func() (string, error) { return path, nil }}

	init := request(t, server, "initialize", map[string]any{
		"protocolVersion": "2025-06-18", "capabilities": map[string]any{},
		"clientInfo": map[string]any{"name": "test"},
	})
	if init["protocolVersion"] != "2025-06-18" {
		t.Fatalf("initialize = %+v", init)
	}

	listed := request(t, server, "tools/list", nil)
	toolList, _ := listed["tools"].([]any)
	if len(toolList) != 9 {
		t.Fatalf("tools = %d", len(toolList))
	}
	first, _ := toolList[0].(map[string]any)
	if first["name"] != "list_questionnaires" {
		t.Fatalf("first tool = %+v", first)
	}

	questionnaires := toolCall(t, server, "list_questionnaires", nil)
	rows, _ := questionnaires.([]any)
	if len(rows) != 1 {
		t.Fatalf("questionnaires = %v", questionnaires)
	}
	row, _ := rows[0].(map[string]any)
	if row["customer_name"] != "Acme" || row["question_count"] != float64(1) {
		t.Fatalf("questionnaire = %+v", row)
	}

	detail := toolCall(t, server, "get_questionnaire", map[string]any{"id": "questionnaire"})
	detailMap, _ := detail.(map[string]any)
	if detailMap["customer"] == nil || detailMap["document"] != nil {
		t.Fatalf("detail = %+v", detailMap)
	}

	activities := toolCall(t, server, "list_activities", map[string]any{"year": 2025})
	activityRows, _ := activities.([]any)
	if len(activityRows) != 1 {
		t.Fatalf("activities = %v", activities)
	}
	activity, _ := activityRows[0].(map[string]any)
	if activity["computed_co2e_kg"] != 120.0 {
		t.Fatalf("activity = %+v", activity)
	}

	answer := toolCall(t, server, "get_answer", map[string]any{"question_id": "question"})
	answerMap, _ := answer.(map[string]any)
	if answerMap["value"] != "42" || answerMap["source_kind"] != "ai_suggested" {
		t.Fatalf("answer = %+v", answer)
	}

	resources := request(t, server, "resources/list", nil)["resources"].([]any)
	uris := make([]string, 0, len(resources))
	for _, resource := range resources {
		entry, _ := resource.(map[string]any)
		uris = append(uris, fmt.Sprint(entry["uri"]))
	}
	if !contains(uris, "inventory://2025") || !contains(uris, "questionnaire://questionnaire") {
		t.Fatalf("resources = %v", uris)
	}

	contents := request(t, server, "resources/read", map[string]any{"uri": "inventory://2025"})
	list, _ := contents["contents"].([]any)
	content, _ := list[0].(map[string]any)
	if !strings.Contains(fmt.Sprint(content["text"]), `"total_co2e_kg": 120`) {
		t.Fatalf("inventory text = %v", content["text"])
	}
}

func TestWriteToolsForwardThroughBridge(t *testing.T) {
	var channels []string
	var args []map[string]any
	server := &Server{
		DBPath: func() (string, error) { return filepath.Join(t.TempDir(), "unused.sqlite"), nil },
		Bridge: func(_ context.Context, channel string, raw []json.RawMessage) (any, error) {
			var value map[string]any
			if err := json.Unmarshal(raw[0], &value); err != nil {
				return nil, err
			}
			channels = append(channels, channel)
			args = append(args, value)
			return map[string]any{"ok": true}, nil
		},
	}

	toolCall(t, server, "set_answer", map[string]any{
		"question_id": "q", "value": "10", "unit": nil, "finalize": true,
	})
	toolCall(t, server, "create_activity", map[string]any{
		"emission_source_id": "s", "reporting_period_id": "p",
		"occurred_at_start": "2025-01-01", "occurred_at_end": "2025-01-31",
		"amount": 1, "unit": "kWh", "ef_factor_code": "ef", "ef_year": 2024,
		"ef_source": "MEE", "ef_geography": "CN", "ef_dataset_version": "2024",
	})
	toolCall(t, server, "create_emission_source", map[string]any{
		"site_id": "site", "name": "Fleet", "scope": 1,
	})
	if fmt.Sprint(channels) != "[answer:save activity:create source:create]" {
		t.Fatalf("channels = %v", channels)
	}
	if args[0]["source_kind"] != "ai_suggested" {
		t.Fatalf("answer args = %+v", args[0])
	}
}

func TestWriteToolReachesStoreThroughBridge(t *testing.T) {
	path := fixtureDB(t)
	dir := t.TempDir()
	opened, err := store.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Close()
	bridge, err := agentbridge.Listen(agentbridge.Address(dir),
		(&agentbridge.Handlers{Store: opened}).Dispatch)
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.Close()

	server := &Server{
		DBPath: func() (string, error) { return path, nil },
		Bridge: func(ctx context.Context, channel string, raw []json.RawMessage) (any, error) {
			out, err := agentbridge.Call(ctx, agentbridge.Address(dir), channel, raw[0])
			if err != nil {
				return nil, err
			}
			var value any
			if err := json.Unmarshal(out, &value); err != nil {
				return nil, err
			}
			return value, nil
		},
	}
	created := toolCall(t, server, "create_activity", map[string]any{
		"emission_source_id": "src", "reporting_period_id": "period",
		"occurred_at_start": "2025-04-01", "occurred_at_end": "2025-04-30",
		"amount": 240, "unit": "kWh", "ef_factor_code": "ef", "ef_year": 2024,
		"ef_source": "MEE", "ef_geography": "CN", "ef_dataset_version": "2024",
	})
	createdMap, _ := created.(map[string]any)
	if createdMap["computed_co2e_kg"] != 120.0 {
		t.Fatalf("created = %+v", createdMap)
	}
	var count int
	if err := opened.DB().QueryRow(`SELECT COUNT(*) FROM activity_data`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("activities = %d", count)
	}
}

func request(t *testing.T, server *Server, method string, params any) map[string]any {
	t.Helper()
	payload := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		payload["params"] = params
	}
	line, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := server.Serve(context.Background(), strings.NewReader(string(line)+"\n"), &out); err != nil {
		t.Fatal(err)
	}
	var response struct {
		Result map[string]any `json:"result"`
		Error  *rpcError      `json:"error"`
	}
	if err := json.Unmarshal(out.Bytes(), &response); err != nil {
		t.Fatalf("response %q: %v", out.String(), err)
	}
	if response.Error != nil {
		t.Fatalf("%s: %+v", method, response.Error)
	}
	return response.Result
}

func toolCall(t *testing.T, server *Server, name string, args any) any {
	t.Helper()
	result := request(t, server, "tools/call", map[string]any{"name": name, "arguments": args})
	if result["isError"] == true {
		t.Fatalf("%s returned: %v", name, result["content"])
	}
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		t.Fatalf("%s returned no content", name)
	}
	first, _ := content[0].(map[string]any)
	text, _ := first["text"].(string)
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatalf("%s text %q: %v", name, text, err)
	}
	return value
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func fixtureDB(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "fixture.sqlite")
	s, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	conn, err := s.DB().Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	const ts = "2025-01-15T00:00:00Z"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO organization (id, singleton_key, name_zh, country_code, boundary_kind, created_at, updated_at)
		VALUES ('org', 1, '测试组织', 'CN', 'operational_control', ?, ?)`, ts, ts)
	exec(`INSERT INTO site (id, organization_id, name_zh, country_code, created_at, updated_at)
		VALUES ('site', 'org', '上海工厂', 'CN', ?, ?)`, ts, ts)
	exec(`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
		VALUES ('period', 'org', 2025, 'annual', '2025-01-01', '2025-12-31', ?)`, ts)
	exec(`INSERT INTO emission_source (id, site_id, name, scope, category)
		VALUES ('src', 'site', '外购电力', 2, 'electricity.grid')`)
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
		scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
		VALUES ('ef', 2024, 'MEE', 'CN', '2024', 2, 'kWh', 0.5, 'AR6', ?, 'seed')`, ts)
	exec(`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
		occurred_at_start, occurred_at_end, amount, unit,
		ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
		computed_co2e_kg, computed_at, created_at, updated_at)
		VALUES ('act', 'site', 'src', 'period', ?, ?, 240.0, 'kWh',
		'ef', 2024, 'MEE', 'CN', '2024', 120.0, ?, ?, ?)`, ts, ts, ts, ts, ts)
	exec(`INSERT INTO customer (id, name, role) VALUES ('customer', 'Acme', 'customer')`)
	exec(`INSERT INTO questionnaire (id, customer_id, reporting_year, status, direction, created_at)
		VALUES ('questionnaire', 'customer', 2025, 'answering', 'outbound', ?)`, ts)
	exec(`INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
		normalized_text, raw_text, question_kind, position, required)
		VALUES ('question', 'questionnaire', 'sig', 'v1', 'Total emissions?', 'Total emissions?', 'numerical', '1', 1)`)
	exec(`INSERT INTO answer (id, question_id, value, unit, source_kind, finalized_at)
		VALUES ('answer', 'question', '42', 't', 'ai_suggested', ?)`, ts)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}
