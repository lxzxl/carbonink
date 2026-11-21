package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"app.carbonink.desktop/internal/agentbridge"
	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestAgentBridgeWritesRefreshUI proves an external agent's write lands in the
// ledger through the same store path the UI uses, and the open screen reloads.
func TestAgentBridgeWritesRefreshUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	address := agentbridge.Address(t.TempDir())
	t.Setenv(agentbridge.EnvAddress, address)

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var out []byte
	var err error
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		out, err = agentbridge.Call(ctx, address, "activity:create", map[string]any{
			"emission_source_id": "src", "reporting_period_id": "period",
			"occurred_at_start": "2025-06-01", "occurred_at_end": "2025-06-30",
			"amount": 200, "unit": "kWh", "ef_factor_code": "ef", "ef_year": 2024,
			"ef_source": "MEE", "ef_geography": "CN", "ef_dataset_version": "2024",
		})
		if err == nil || !errors.Is(err, agentbridge.ErrNotRunning) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("bridge create: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("bridge returned no value")
	}
	ui.WaitFor("text:100.00", 5*time.Second)

	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var activities int
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM activity_data`).Scan(&activities); err != nil {
		t.Fatal(err)
	}
	if activities != 2 {
		t.Fatalf("activities = %d", activities)
	}
}
