package app

import (
	"context"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestRebindDrawerMatchesOldForm covers the 1.x rebind drawer: a right-side
// panel with the current snapshot, a factor list, the cross-family override,
// and a preview before the commit.
func TestRebindDrawerMatchesOldForm(t *testing.T) {
	dbPath := fixtureDB(t)
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	// The unrelated scope and category prove the drawer browses the whole
	// library, as 1.x's EfPicker did, instead of hiding factors outside the
	// source's own category.
	if _, err := s.DB().ExecContext(ctx, `INSERT INTO emission_factor
		(factor_code, year, source, geography, dataset_version, scope, category,
		 input_unit, co2e_kg_per_unit, gwp_basis, name_en)
		VALUES ('kg-factor', 2024, 'TEST', 'CN', '2024', 3, 'waste.landfill',
		        'kg', 2, 'AR6', 'Kilogram factor')`); err != nil {
		_ = s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("text:外购电力")
	ui.Press("id:activity-rebind")
	ui.WaitFor("id:rebind-drawer", 3*time.Second)
	view := ui.Find("id:rebind-drawer")
	if view == nil || view.Frame.Size.Width < 400 || view.Frame.Origin.X < 700 {
		t.Fatalf("rebind panel is not a right-side drawer: %+v", view)
	}
	ui.WaitFor("text:Rebind emission factor", 2*time.Second)
	ui.WaitFor("text:Pick a new emission factor", 2*time.Second)
	ui.WaitFor("text:Current emissions", 2*time.Second)
	if ui.Enabled("id:rebind-confirm") {
		t.Fatal("confirm is enabled before a factor is picked")
	}

	ui.Type("id:rebind-ef-search", "kg-factor")
	ui.WaitFor("id:rebind-ef-0", 2*time.Second)
	ui.Press("id:rebind-ef-0")
	ui.WaitFor("id:rebind-override", 2*time.Second)
	ui.WaitFor("text:Cross-unit-family change", 2*time.Second)
	if ui.Enabled("id:rebind-confirm") {
		t.Fatal("confirm is enabled before the new amount is entered")
	}
	ui.Type("id:rebind-override", "10")
	ui.WaitFor("text:New emissions: 20.00 kg CO2e", 2*time.Second)
	ui.WaitUntil(2*time.Second, func() bool { return ui.Enabled("id:rebind-confirm") })
	ui.Press("id:rebind-confirm")
	ui.WaitForGone("id:rebind-drawer", 3*time.Second)
	ui.WaitFor("text:20.00 kg CO2e", 3*time.Second)
}
