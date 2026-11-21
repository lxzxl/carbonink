package app

import (
	"context"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestSettingsOrganizationProfile edits both halves of the ISO profile and
// checks each save keeps the other half intact.
func TestSettingsOrganizationProfile(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:org-profile-zh", 5*time.Second)

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	org, err := check.CurrentOrganization(ctx)
	if err != nil || org == nil {
		t.Fatalf("organization = %+v, %v", org, err)
	}

	// Basic identity save.
	ui.Clear("id:org-profile-industry")
	ui.Type("id:org-profile-industry", "technology")
	ui.Press("id:org-profile-save-basic")
	ui.WaitFor("text:Organization profile updated.", 3*time.Second)
	got, err := check.CurrentOrganization(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Industry != "technology" || got.NameEN != org.NameEN ||
		got.BoundaryKind != org.BoundaryKind {
		t.Fatalf("after basic save = %+v", got)
	}

	// Reporting profile save: financial control, responsible person and
	// the fixture's reporting period as base year.
	ui.Press("id:org-profile-boundary")
	ui.WaitFor("id:org-profile-boundary-2", 2*time.Second)
	ui.Press("id:org-profile-boundary-2")
	ui.Type("id:org-profile-resp-name", "Li Wei")
	ui.Type("id:org-profile-resp-role", "EHS Manager")
	ui.Press("id:org-profile-base-year")
	ui.WaitFor("id:org-profile-base-year-1", 2*time.Second)
	ui.Press("id:org-profile-base-year-1")
	ui.Press("id:org-profile-save-reporting")
	ui.WaitUntil(3*time.Second, func() bool {
		latest, err := check.CurrentOrganization(ctx)
		return err == nil && latest.Responsible == "Li Wei"
	})
	got, err = check.CurrentOrganization(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.BoundaryKind != "financial_control" || got.ResponsibleRole != "EHS Manager" {
		t.Fatalf("after reporting save = %+v", got)
	}
	if got.BaseYearPeriodID == "" {
		t.Fatalf("base year was not saved: %+v", got)
	}
	if got.Industry != "technology" {
		t.Fatalf("reporting save dropped the basic edit: %+v", got)
	}
}

// TestSettingsImportOutlierRatio validates the range and persists a tuned
// multiplier for the batch import.
func TestSettingsImportOutlierRatio(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:import-outlier-ratio", 5*time.Second)

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	if ratio := importOutlierRatio(ctx, check); ratio != defaultImportOutlierRatio {
		t.Fatalf("default ratio = %v, want %v", ratio, defaultImportOutlierRatio)
	}

	ui.Clear("id:import-outlier-ratio")
	ui.Type("id:import-outlier-ratio", "1")
	if ui.Enabled("id:import-outlier-save") {
		t.Error("outlier ratio below the minimum can be saved")
	}
	ui.WaitFor("text:Enter a number between 2 and 1000", 2*time.Second)

	ui.Clear("id:import-outlier-ratio")
	ui.Type("id:import-outlier-ratio", "4")
	ui.Press("id:import-outlier-save")
	ui.WaitFor("text:Outlier multiplier saved", 2*time.Second)
	if ratio := importOutlierRatio(ctx, check); ratio != 4 {
		t.Fatalf("ratio = %v, want 4", ratio)
	}
}
