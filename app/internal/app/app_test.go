package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/xuri/excelize/v2"
)

func TestMain(m *testing.M) {
	os.Setenv("CARBONINK_NO_LEGACY_IMPORT", "1")
	nsgotest.Main(m)
}

// TestActivitiesFromWorkspace opens a fixture workspace and proves the table
// renders its row, not placeholder data.
func TestActivitiesFromWorkspace(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("text:上海工厂", 2*time.Second)
	ui.WaitFor("text:外购电力", 2*time.Second)
	ui.WaitFor("text:240.00", 2*time.Second)
	ui.WaitFor("text:120.00", 2*time.Second)
}

// TestSettingsSwitchThemeAndLanguage proves the settings screen persists a
// choice and that labels, including the sidebar, follow the new locale.
func TestSettingsSwitchThemeAndLanguage(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("text:Appearance", 2*time.Second)
	ui.Press("text:Dark")
	ui.WaitFor("text:Current: Dark", 2*time.Second)
	ui.Press("text:中文")
	ui.WaitFor("text:外观", 2*time.Second)
	ui.WaitFor("text:活动数据", 2*time.Second)
}

// TestCommandPalette opens the palette, searches, and runs a screen command.
func TestCommandPalette(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:open-command-palette")
	ui.WaitFor("id:command-palette", 2*time.Second)
	ui.Type("id:command-palette >> role:textbox", "settings")
	ui.Key("enter")
	ui.WaitFor("text:Appearance", 2*time.Second)
}

// TestCreateActivityThroughUI proves the add-activity dialog pins an EF and
// writes a row the ledger immediately renders.
func TestCreateActivityThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)
	ui.Type("id:activity-amount", "100")
	ui.Type("id:activity-unit", "kWh")
	ui.Press("id:activity-save")
	ui.WaitFor("text:100.00", 3*time.Second)
}

// TestEditActivityThroughUI selects a ledger row, edits its amount and
// rebinds its emission factor, then proves the audit log records the change.
func TestEditActivityThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:data-table-hit")
	ui.Key("down")
	ui.Press("id:activity-edit")
	ui.WaitFor("id:activity-edit-dialog", 2*time.Second)
	ui.Clear("id:activity-edit-amount")
	ui.Type("id:activity-edit-amount", "480")
	ui.Press("id:activity-edit-ef")
	ui.Press("id:activity-edit-ef-0")
	ui.Press("id:activity-edit-save")
	ui.WaitFor("text:268.13", 3*time.Second)
	ui.Press("id:nav:audit")
	ui.WaitFor("text:Rebind emission factor", 3*time.Second)
}

// TestImportActivitiesThroughUI picks a CSV ledger, auto-maps it, confirms one
// EF for the group, and proves both rows land in the ledger.
func TestImportActivitiesThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	csvPath := filepath.Join(t.TempDir(), "ledger.csv")
	const ledger = "Source,Description,Amount,Unit,Date\n" +
		"外购电力,Office power,10,kWh,2025-03-01\n" +
		"外购电力,Office power,20,kWh,2025-03-01\n"
	if err := os.WriteFile(csvPath, []byte(ledger), 0o644); err != nil {
		t.Fatal(err)
	}
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "ledger.csv", Path: csvPath}}
	}
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-import")
	ui.WaitFor("id:activity-import-dialog", 2*time.Second)
	ui.Press("id:activity-import-pick")
	ui.WaitFor("text:2 data rows", 3*time.Second)
	ui.Press("id:activity-import-next")
	ui.WaitFor("text:Confirm emission factors by group", 3*time.Second)
	ui.Press("id:activity-import-ef-0")
	ui.Press("id:activity-import-ef-0-0")
	ui.Press("id:activity-import-run")
	ui.WaitFor("text:2 rows imported", 3*time.Second)
	ui.Press("id:activity-import-done")
	ui.WaitFor("text:5.59", 3*time.Second)
	ui.WaitFor("text:11.17", 3*time.Second)
}

// TestImportEFLibraryThroughUI downloads the template, imports a factor
// library from CSV, and proves the new factor reaches the activity picker.
func TestImportEFLibraryThroughUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	dir := t.TempDir()
	csvPath := filepath.Join(dir, "factors.csv")
	const library = "name_en,scope,year,input_unit,co2e_kg_per_unit,category,geography,gwp_basis\n" +
		"Test factor,2,2024,kWh,0.42,electricity.grid,CN,AR6\n"
	if err := os.WriteFile(csvPath, []byte(library), 0o644); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(dir, "template.xlsx")
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "factors.csv", Path: csvPath}}
	}
	ui.SaveFile = func(core.SaveRequest) string { return templatePath }

	ui.Press("id:nav:sources")
	ui.WaitFor("id:ef-library-import", 3*time.Second)
	ui.Press("id:ef-library-import")
	ui.WaitFor("id:ef-import-dialog", 2*time.Second)
	ui.Press("id:ef-template")
	ui.WaitFor("text:Template saved", 3*time.Second)
	workbook, err := excelize.OpenFile(templatePath)
	if err != nil {
		t.Fatalf("template: %v", err)
	}
	headers, err := workbook.GetRows(workbook.GetSheetName(0))
	if err != nil {
		t.Fatalf("template rows: %v", err)
	}
	if index, err := workbook.GetSheetIndex("说明 notes"); err != nil || index < 0 {
		t.Errorf("template is missing the notes sheet")
	}
	workbook.Close()
	if len(headers) == 0 || !strings.Contains(strings.Join(headers[0], ","), "co2e_kg_per_unit") {
		t.Fatalf("template headers = %v", headers)
	}

	ui.Press("id:ef-import-pick")
	ui.WaitFor("text:1 rows", 3*time.Second)
	ui.Type("id:ef-import-name", "Test library")
	ui.Press("id:ef-import-run")
	ui.WaitFor("text:Imported 1 factors", 3*time.Second)
	ui.Press("id:ef-import-cancel")
	ui.WaitFor("text:Test library", 3*time.Second)

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var count int
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM emission_factor WHERE source = 'user:Test library'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("imported factors = %d, want 1", count)
	}

	ui.Press("id:nav:activities")
	ui.WaitFor("id:activities-table", 3*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)
	ui.Press("id:activity-ef")
	ui.WaitFor("id:activity-ef >> text:EF-00001", 3*time.Second)
	ui.Press("id:activity-ef-0")
	ui.Press("id:activity-cancel")

	ui.Press("id:nav:sources")
	ui.WaitFor("text:Delete library", 3*time.Second)
	ui.Press("text:Delete library")
	ui.WaitFor("id:ef-library-delete-dialog", 2*time.Second)
	ui.Press("id:ef-library-delete-confirm")
	ui.WaitForGone("text:Test library", 3*time.Second)
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM emission_factor WHERE source = 'user:Test library'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("factors after delete = %d, want 0", count)
	}
}

// TestAuditExportThroughUI writes the filtered audit log to CSV through the
// real save path.
func TestAuditExportThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	savePath := filepath.Join(t.TempDir(), "audit.csv")
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.SaveFile = func(core.SaveRequest) string { return savePath }
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)
	ui.Type("id:activity-amount", "100")
	ui.Type("id:activity-unit", "kWh")
	ui.Press("id:activity-save")
	ui.WaitFor("text:100.00", 3*time.Second)
	ui.Press("id:nav:audit")
	ui.WaitFor("text:Activity data created", 3*time.Second)
	ui.Press("id:audit-export")
	ui.WaitFor("text:Exported 1 rows", 3*time.Second)
	data, err := os.ReadFile(savePath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "occurred_at,event_kind,payload") ||
		!strings.Contains(text, "activity_data.created") {
		t.Errorf("csv = %s", text)
	}
}

// TestCreateSourceThroughUI proves the Sources page can create a source and
// then show it in the list.
func TestCreateSourceThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:sources")
	ui.WaitFor("id:source-add", 2*time.Second)
	ui.Press("id:source-add")
	ui.WaitFor("id:source-add-dialog", 2*time.Second)
	ui.Type("id:source-add-name", "Diesel fleet")
	ui.Type("id:source-add-category", "fuel.mobile")
	ui.Press("id:source-add-save")
	ui.WaitFor("text:Diesel fleet", 3*time.Second)
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
	return path
}
