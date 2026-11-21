package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestMain(m *testing.M) {
	os.Setenv("CARBONINK_NO_LEGACY_IMPORT", "1")
	nsgotest.Main(m)
}

// TestActivitiesFromWorkspace opens a fixture workspace and proves the table
// renders its row, not placeholder data.
func TestActivitiesFromWorkspace(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("text:上海工厂", 2*time.Second)
	ui.WaitFor("text:外购电力", 2*time.Second)
	ui.WaitFor("text:240.00", 2*time.Second)
	ui.WaitFor("text:120.00", 2*time.Second)
}

func fixtureDB(t *testing.T) string {
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
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO organization (id, singleton_key, name_zh, country_code, boundary_kind, created_at, updated_at)
		VALUES ('org', 1, '测试组织', 'CN', 'operational_control', ?, ?)`, ts, ts)
	exec(`INSERT INTO site (id, organization_id, name_zh, country_code, created_at, updated_at)
		VALUES ('site', 'org', '上海工厂', 'CN', ?, ?)`, ts, ts)
	exec(`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
		VALUES ('period', 'org', 2025, 'annual', '2025-01-01', '2025-12-31', ?)`, ts)
	exec(`INSERT INTO emission_source (id, site_id, name, scope) VALUES ('src', 'site', '外购电力', 2)`)
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
		scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
		VALUES ('ef', 2024, 'MEE', 'CN', '2024', 2, 'kWh', 0.5, 'AR6', ?, 'seed')`, ts)
	exec(`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
		occurred_at_start, occurred_at_end, amount, unit,
		ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
		computed_co2e_kg, computed_at, created_at, updated_at)
		VALUES ('act', 'site', 'src', 'period', ?, ?, 240.0, 'kWh',
		'ef', 2024, 'MEE', 'CN', '2024', 120.0, ?, ?, ?)`, ts, ts, ts, ts, ts)
	return path
}
