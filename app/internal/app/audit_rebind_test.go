package app

import (
	"context"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestAuditRebindCardStructuresPayload proves an activity_rebind_ef event
// renders factor names and the CO2e delta instead of raw JSON, and that its
// activity button lands on the activities table with the row selected.
func TestAuditRebindCardStructuresPayload(t *testing.T) {
	dbPath := fixtureDB(t)
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().ExecContext(ctx, `INSERT INTO pinned_emission_factor
		(factor_code, year, source, geography, dataset_version, scope, input_unit,
		 co2e_kg_per_unit, gwp_basis, name_zh, pinned_at, pinned_from)
		VALUES ('ef2', 2024, 'MEE', 'CN', '2024', 2, 'kWh', 0.42, 'AR6', '新电网因子',
		        '2025-01-15T00:00:00Z', 'seed')`); err != nil {
		s.Close()
		t.Fatal(err)
	}
	const payload = `{"activity_id":"act",` +
		`"old_ef":{"factor_code":"ef","year":2024,"source":"MEE","geography":"CN","dataset_version":"2024"},` +
		`"new_ef":{"factor_code":"ef2","year":2024,"source":"MEE","geography":"CN","dataset_version":"2024"},` +
		`"old_amount":240,"old_unit":"kWh","old_computed_co2e_kg":120,` +
		`"new_amount":240,"new_unit":"kWh","new_computed_co2e_kg":100.8,` +
		`"emission_source_id":"src","reporting_period_id":"period","fuel_code":null}`
	if _, err := s.DB().ExecContext(ctx, `INSERT INTO audit_event
		(id, event_kind, payload, occurred_at) VALUES ('evt', 'activity_rebind_ef', ?, ?)`,
		payload, "2025-02-01T10:00:00Z"); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))

	ui.Press("id:nav:audit")
	ui.WaitFor("id:audit-rebind-evt", 3*time.Second)
	ui.WaitFor("text:ef (2024) → 新电网因子 (2024)", 3*time.Second)
	ui.WaitFor("text:100.8 kg (-19.2 kg, -16%)", 3*time.Second)
	ui.WaitFor("text:Show raw payload", 3*time.Second)
	if ui.Exists("text:Hide raw payload") {
		t.Fatal("raw payload shown before the toggle")
	}

	ui.Press("id:audit-raw-evt")
	ui.WaitFor("text:Hide raw payload", 3*time.Second)
	ui.WaitFor("text:new_computed_co2e_kg", 3*time.Second)
	ui.Press("id:audit-raw-evt")
	ui.WaitFor("text:Show raw payload", 3*time.Second)

	ui.Press("id:audit-rebind-activity-evt")
	ui.WaitFor("id:activities-table", 3*time.Second)
	ui.WaitUntil(3*time.Second, func() bool { return ui.Enabled("id:activity-edit") })
}
