package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// seedSecondActivity adds a Scope 1 diesel row so the list has two sources,
// two scopes, two dates, and two CO2e magnitudes to filter and sort.
func seedSecondActivity(t *testing.T, dbPath string) {
	t.Helper()
	s, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	const ts = "2025-01-15T00:00:00Z"
	statements := []string{
		`INSERT INTO emission_source (id, site_id, name, scope, category)
		 VALUES ('src-diesel', 'site', '柴油', 1, 'fuel.diesel')`,
		`INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
		 scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
		 VALUES ('ef-diesel', 2024, 'MEE', 'CN', '2024', 1, 'L', 2.68, 'AR6', '` + ts + `', 'seed')`,
		`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
		 occurred_at_start, occurred_at_end, amount, unit,
		 ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
		 computed_co2e_kg, computed_at, created_at, updated_at)
		 VALUES ('act-diesel', 'site', 'src-diesel', 'period', '2025-02-01', '2025-02-01',
		 100.0, 'L', 'ef-diesel', 2024, 'MEE', 'CN', '2024', 268.0, '` + ts + `', '` + ts + `', '` + ts + `')`,
	}
	for _, statement := range statements {
		if _, err := s.DB().ExecContext(context.Background(), statement); err != nil {
			t.Fatal(err)
		}
	}
}

func seedNextPeriodActivity(t *testing.T, dbPath string) {
	t.Helper()
	s, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	const ts = "2025-01-15T00:00:00Z"
	statements := []string{
		`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
		 VALUES ('period-2026', 'org', 2026, 'annual', '2026-01-01', '2026-12-31', '` + ts + `')`,
		`INSERT INTO emission_source (id, site_id, name, scope, category)
		 VALUES ('src-steam', 'site', '蒸汽', 2, 'heat.steam')`,
		`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
		 occurred_at_start, occurred_at_end, amount, unit,
		 ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
		 computed_co2e_kg, computed_at, created_at, updated_at)
		 VALUES ('act-steam', 'site', 'src-steam', 'period-2026', '2026-01-10', '2026-01-10',
		 5.0, 't', 'ef', 2024, 'MEE', 'CN', '2024', 10.0, '` + ts + `', '` + ts + `', '` + ts + `')`,
	}
	for _, statement := range statements {
		if _, err := s.DB().ExecContext(context.Background(), statement); err != nil {
			t.Fatal(err)
		}
	}
}

func TestActivityListSearchScopeAndSort(t *testing.T) {
	dbPath := fixtureDB(t)
	seedSecondActivity(t, dbPath)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("text:外购电力", 3*time.Second)
	ui.WaitFor("text:柴油", 3*time.Second)

	ui.Type("id:activities-search", "柴油")
	ui.WaitForGone("id:activities-table >> text:外购电力", 2*time.Second)
	ui.WaitFor("id:activities-table >> text:柴油", 2*time.Second)
	ui.Clear("id:activities-search")
	ui.WaitFor("id:activities-table >> text:外购电力", 2*time.Second)

	ui.Press("id:activities-scope-1")
	ui.WaitForGone("id:activities-table >> text:外购电力", 2*time.Second)
	ui.WaitFor("id:activities-table >> text:柴油", 2*time.Second)
	ui.Press("id:activities-scope-2")
	ui.WaitForGone("id:activities-table >> text:柴油", 2*time.Second)
	ui.WaitFor("id:activities-table >> text:外购电力", 2*time.Second)
	ui.Press("id:activities-scope-0")
	ui.WaitFor("id:activities-table >> text:柴油", 2*time.Second)

	ui.Press("id:activities-sort")
	ui.Press("id:activities-sort-2")
	ui.WaitUntil(2*time.Second, func() bool {
		diesel, power, ok := optionRows(ui)
		return ok && rowCell(diesel).Frame.Origin.Y < rowCell(power).Frame.Origin.Y
	})

	ui.Press("id:activities-sort")
	ui.Press("id:activities-sort-3")
	ui.WaitUntil(2*time.Second, func() bool {
		diesel, power, ok := optionRows(ui)
		return ok && rowCell(power).Frame.Origin.Y < rowCell(diesel).Frame.Origin.Y
	})
}

func rowCell(view *nsgotest.View) *nsgotest.View {
	for current := view; current != nil; current = current.Parent {
		if current.Frame.Origin.Y != 0 {
			return current
		}
	}
	return view
}

func optionRows(ui *nsgotest.App) (diesel, power *nsgotest.View, ok bool) {
	rows := ui.Query("id:activities-table >> role:option")
	if len(rows) != 2 {
		return nil, nil, false
	}
	for _, row := range rows {
		switch {
		case viewContainsText(row, "柴油"):
			diesel = row
		case viewContainsText(row, "外购电力"):
			power = row
		}
	}
	return diesel, power, diesel != nil && power != nil
}

func viewContainsText(view *nsgotest.View, text string) bool {
	if view.Text == text {
		return true
	}
	for _, child := range view.Children {
		if viewContainsText(child, text) {
			return true
		}
	}
	return false
}

func TestActivityListEmptyStates(t *testing.T) {
	t.Run("without sources", func(t *testing.T) {
		dbPath := fixtureDB(t)
		s, err := store.Open(context.Background(), dbPath)
		if err != nil {
			t.Fatal(err)
		}
		for _, statement := range []string{
			`DELETE FROM activity_data`,
			`DELETE FROM emission_source`,
		} {
			if _, err := s.DB().ExecContext(context.Background(), statement); err != nil {
				s.Close()
				t.Fatal(err)
			}
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}

		t.Setenv("CARBONINK_TEST_DB", dbPath)
		ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
			nsgotest.Environment(core.Environment{Locale: "en-US"}))
		ui.WaitFor("id:activities-empty-sources", 5*time.Second)
		ui.Press("id:activities-empty-sources")
		ui.WaitFor("id:source-catalog-dialog", 3*time.Second)
	})

	t.Run("with sources", func(t *testing.T) {
		dbPath := fixtureDB(t)
		s, err := store.Open(context.Background(), dbPath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.DB().ExecContext(context.Background(), `DELETE FROM activity_data`); err != nil {
			s.Close()
			t.Fatal(err)
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}

		t.Setenv("CARBONINK_TEST_DB", dbPath)
		ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
			nsgotest.Environment(core.Environment{Locale: "en-US"}))
		ui.WaitFor("id:activities-empty-add", 5*time.Second)
		ui.WaitFor("id:activities-empty-import", 2*time.Second)
		if ui.Exists("id:activity-add") || ui.Exists("id:activity-import") {
			t.Fatal("toolbar add/import duplicated the empty-state actions")
		}
		ui.Press("id:activities-empty-add")
		ui.WaitFor("id:activity-dialog", 3*time.Second)
		ui.Press("id:activity-cancel")
		ui.Press("id:activities-empty-import")
		ui.WaitFor("id:activity-import-next", 3*time.Second)
	})
}

func TestActivityListPeriodFilter(t *testing.T) {
	dbPath := fixtureDB(t)
	seedNextPeriodActivity(t, dbPath)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("id:activities-table >> text:蒸汽", 3*time.Second)
	ui.WaitForGone("id:activities-table >> text:外购电力", 2*time.Second)

	ui.Press("id:activities-period")
	ui.Press("role:option All periods")
	ui.WaitFor("id:activities-table >> text:外购电力", 2*time.Second)
	ui.WaitFor("id:activities-table >> text:蒸汽", 2*time.Second)

	ui.Press("id:activities-period")
	ui.Press("id:activities-period-2")
	ui.WaitFor("id:activities-table >> text:外购电力", 2*time.Second)
	ui.WaitForGone("id:activities-table >> text:蒸汽", 2*time.Second)
}

func TestActivityListEmptyPeriodOffersAllPeriods(t *testing.T) {
	dbPath := fixtureDB(t)
	seedNextPeriodActivity(t, dbPath)
	s, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().ExecContext(context.Background(),
		`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
		 VALUES ('period-2027', 'org', 2027, 'annual', '2027-01-01', '2027-12-31', '2025-01-15T00:00:00Z')`); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-filter-clear", 5*time.Second)
	ui.WaitForGone("id:activities-table >> role:option", 2*time.Second)
	ui.Press("id:activities-filter-clear")
	ui.WaitFor("id:activities-table >> text:蒸汽", 2*time.Second)
	ui.WaitFor("id:activities-table >> text:外购电力", 2*time.Second)
}

func TestActivityDocumentProvenanceIsLink(t *testing.T) {
	dbPath := fixtureDB(t)
	s, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	const ts = "2025-01-15T00:00:00Z"
	statements := []string{
		`INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
		 VALUES ('doc-1', '` + strings.Repeat("a", 64) + `', 'power-bill.pdf', 'application/pdf', 9,
		         'documents/power-bill.pdf', '` + ts + `')`,
		`INSERT INTO extraction (id, document_id, llm_provider, llm_model, prompt_version,
		 raw_response, parsed_json, status, created_at)
		 VALUES ('ext-1', 'doc-1', 'deepseek', 'deepseek-chat', 'v1', '{}', '{}', 'parsed', '` + ts + `')`,
		`UPDATE activity_data SET extraction_id = 'ext-1' WHERE id = 'act'`,
	}
	for _, statement := range statements {
		if _, err := s.DB().ExecContext(context.Background(), statement); err != nil {
			s.Close()
			t.Fatal(err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("id:activity-document-act", 3*time.Second)
	ui.WaitFor("id:activity-document-act >> text:From power-bill.pdf", 2*time.Second)
	if text := ui.Find("id:activity-document-act >> text:From power-bill.pdf"); text.MaxLines != 1 {
		t.Fatalf("provenance text MaxLines = %d, want 1", text.MaxLines)
	}
}

func TestActivityListRowHoverAndSelection(t *testing.T) {
	dbPath := fixtureDB(t)
	seedSecondActivity(t, dbPath)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("id:activities-table >> text:柴油", 3*time.Second)
	ui.WaitFor("id:activities-table >> text:外购电力", 3*time.Second)

	rows := ui.Query("id:activities-table >> role:option")
	if len(rows) != 2 {
		t.Fatalf("expected 2 activity rows, got %d", len(rows))
	}
	for i, cell := range rows {
		if len(cell.Children) == 0 {
			t.Fatalf("row %d has no child view", i)
		}
		inner := cell.Children[0]
		if inner.Frame.Origin.X != 0 || inner.Frame.Origin.Y != 0 {
			t.Fatalf("row %d inner origin = %v, want (0, 0) flush with option cell", i, inner.Frame.Origin)
		}
		if inner.Frame.Size != cell.Frame.Size {
			t.Fatalf("row %d inner size = %v, want %v matching option cell", i, inner.Frame.Size, cell.Frame.Size)
		}
		if inner.Style.Background != 0 {
			t.Fatalf("row %d should have transparent resting background, got %v", i, inner.Style.Background)
		}
	}

	// Hover the first row (柴油): hover tint applies and outline stays off.
	ui.Hover("id:activities-table >> role:option >> text:柴油")
	dieselRow, powerRow, ok := optionRows(ui)
	if !ok {
		t.Fatal("failed to locate diesel and power rows")
	}
	hoverBg := dieselRow.Children[0].Style.Background
	if hoverBg == 0 {
		t.Fatal("expected hovered row to apply background tint")
	}
	if powerRow.Children[0].Style.Background != 0 {
		t.Fatalf("unhovered row should stay transparent, got %v", powerRow.Children[0].Style.Background)
	}

	// Click to select the first row: selected fill applies without mouse-focus ring.
	ui.HoverOut()
	ui.Press("id:activities-table >> role:option >> text:柴油")
	dieselRow, powerRow, ok = optionRows(ui)
	if !ok {
		t.Fatal("failed to locate rows after selecting diesel")
	}
	if !dieselRow.Props.Selected {
		t.Fatal("expected diesel row to be selected after press")
	}
	if dieselRow.Style.Outline.Width != 0 {
		t.Fatalf("mouse click should not show focus outline, got width %v", dieselRow.Style.Outline.Width)
	}
	selectedBg := dieselRow.Children[0].Style.Background
	if selectedBg == 0 {
		t.Fatal("expected selected row to apply selection fill")
	}
	if selectedBg == hoverBg {
		t.Fatalf("selected fill (%v) must be stronger/distinct from hover tint (%v)", selectedBg, hoverBg)
	}
	if powerRow.Children[0].Style.Background != 0 {
		t.Fatalf("unselected row should stay transparent, got %v", powerRow.Children[0].Style.Background)
	}

	// Select the second row (外购电力): selection cleanly transfers.
	ui.Press("id:activities-table >> role:option >> text:外购电力")
	dieselRow, powerRow, ok = optionRows(ui)
	if !ok {
		t.Fatal("failed to locate rows after selecting power")
	}
	if dieselRow.Props.Selected || dieselRow.Children[0].Style.Background != 0 {
		t.Fatalf("previous row should clear selection and fill (selected=%v bg=%v)",
			dieselRow.Props.Selected, dieselRow.Children[0].Style.Background)
	}
	if !powerRow.Props.Selected || powerRow.Children[0].Style.Background != selectedBg {
		t.Fatalf("second row should become selected with fill %v (selected=%v bg=%v)",
			selectedBg, powerRow.Props.Selected, powerRow.Children[0].Style.Background)
	}
}
