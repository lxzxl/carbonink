package app

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestFormFieldsCarryAccessibleLabels proves the visible label above a field
// is also the name assistive technology reads, including in dialogs.
func TestFormFieldsCarryAccessibleLabels(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)

	for id, want := range map[string]string{
		"activity-amount": "Amount",
		"activity-unit":   "Unit",
		"activity-notes":  "Notes (optional)",
	} {
		if got := ui.Find("id:" + id).Props.Label; got != want {
			t.Fatalf("%s label = %q, want %q", id, got, want)
		}
	}

	ui.Press("id:activity-cancel")
	ui.WaitForGone("id:activity-dialog", 3*time.Second)
	openSettings(ui, "ai")
	ui.WaitFor("id:settings-llm-model", 3*time.Second)
	if got := ui.Find("id:settings-llm-model").Props.Label; got != "Model" {
		t.Fatalf("model label = %q, want Model", got)
	}
}

// TestSearchFieldsAreNamed proves the filter fields read as search boxes with
// a name, not as anonymous text fields.
func TestSearchFieldsAreNamed(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)

	ui.WaitFor("role:searchbox", 3*time.Second)
	if got := ui.Find("id:activities-search").Props.Label; got != "Search source, unit, or EF" {
		t.Fatalf("activities search label = %q", got)
	}

	ui.Press("id:nav:sources")
	ui.WaitFor("role:searchbox", 3*time.Second)
	if got := ui.Find("id:sources-search").Props.Label; got != "Search by name, category, or GHG path" {
		t.Fatalf("sources search label = %q", got)
	}
}
