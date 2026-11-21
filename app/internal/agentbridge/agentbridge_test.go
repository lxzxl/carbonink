package agentbridge

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"
)

func TestBridgeCallRejectsUnlistedChannel(t *testing.T) {
	dir := t.TempDir()
	address := Address(dir)
	server, err := Listen(address, func(context.Context, string, []json.RawMessage) (any, error) {
		return map[string]any{"ok": true}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := Call(ctx, address, "source:create", map[string]any{"name": "x"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"ok":true`) && !strings.Contains(string(out), `"ok": true`) {
		t.Fatalf("value = %s", out)
	}

	_, err = Call(ctx, address, "data:reset", nil)
	var remote *RemoteError
	if !asRemote(err, &remote) || remote.Code != ErrorNotAllowed {
		t.Fatalf("err = %v", err)
	}

	// The server refuses a raw frame too, so a client that skips Call's
	// check still cannot reach a handler.
	conn, err := net.Dial("unix", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	fmt.Fprintf(conn, `{"id":"1","channel":"data:reset","args":[]}`+"\n")
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var response Response
	if err := json.Unmarshal([]byte(line), &response); err != nil {
		t.Fatal(err)
	}
	if response.Error == nil || response.Error.Code != ErrorNotAllowed {
		t.Fatalf("response = %+v", response)
	}
}

func TestBridgeCallWithoutApp(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := Call(ctx, filepath.Join(t.TempDir(), "missing.sock"), "source:create", nil)
	if err != ErrNotRunning {
		t.Fatalf("err = %v", err)
	}
}

func TestHandlersWriteThroughStore(t *testing.T) {
	s := fixtureStore(t)
	var writes int
	handlers := &Handlers{Store: s, OnWrite: func() { writes++ }}
	ctx := context.Background()

	sourceValue, err := handlers.Dispatch(ctx, "source:create",
		[]json.RawMessage{json.RawMessage(`{"site_id":"site","name":"Diesel fleet","scope":1,"category":null,"ghg_protocol_path":null}`)})
	if err != nil {
		t.Fatal(err)
	}
	source := sourceValue.(map[string]any)
	sourceID, _ := source["id"].(string)
	if sourceID == "" || source["name"] != "Diesel fleet" {
		t.Fatalf("source = %+v", source)
	}

	activityArgs := fmt.Sprintf(`{"emission_source_id":%q,
		"reporting_period_id":"period","occurred_at_start":"2025-03-01",
		"occurred_at_end":"2025-03-31","amount":240,"unit":"kWh",
		"ef_factor_code":"ef","ef_year":2024,"ef_source":"MEE","ef_geography":"CN",
		"ef_dataset_version":"2024","fuel_code":null,"notes":"agent"}`,
		"src")
	activityValue, err := handlers.Dispatch(ctx, "activity:create",
		[]json.RawMessage{json.RawMessage(activityArgs)})
	if err != nil {
		t.Fatal(err)
	}
	activity := activityValue.(map[string]any)
	if activity["computed_co2e_kg"] != 120.0 {
		t.Fatalf("activity = %+v", activity)
	}

	answerValue, err := handlers.Dispatch(ctx, "answer:save",
		[]json.RawMessage{json.RawMessage(`{"question_id":"question","value":"42","unit":"t","finalize":true,"source_kind":"ai_suggested"}`)})
	if err != nil {
		t.Fatal(err)
	}
	answer := answerValue.(map[string]any)
	if answer["source_kind"] != "ai_suggested" || answer["finalized_at"] == "" {
		t.Fatalf("answer = %+v", answer)
	}

	if writes != 3 {
		t.Fatalf("writes = %d, want 3", writes)
	}
	var audits int
	if err := s.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM audit_event WHERE event_kind = 'activity_data.created'`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Fatalf("activity audits = %d", audits)
	}
}

func asRemote(err error, target **RemoteError) bool {
	remote, ok := err.(*RemoteError)
	if ok {
		*target = remote
	}
	return ok
}

func fixtureStore(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "fixture.sqlite")
	s, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
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
	exec(`INSERT INTO customer (id, name, role)
		VALUES ('customer', 'Acme', 'customer')`)
	exec(`INSERT INTO questionnaire (id, customer_id, reporting_year, status, direction, created_at)
		VALUES ('questionnaire', 'customer', 2025, 'answering', 'outbound', ?)`, ts)
	exec(`INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
		normalized_text, raw_text, question_kind, position, required)
		VALUES ('question', 'questionnaire', 'sig', 'v1', 'Total emissions?', 'Total emissions?', 'numerical', '1', 1)`)
	return s
}
