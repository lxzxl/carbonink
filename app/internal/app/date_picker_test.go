package app

import (
	"context"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestDateValueConversion(t *testing.T) {
	if got := parseDateValue(""); got.IsSet() {
		t.Fatalf("empty string parsed as %+v, want unset", got)
	}
	if got := parseDateValue("not-a-date"); got.IsSet() {
		t.Fatalf("invalid string parsed as %+v, want unset", got)
	}
	if got := formatDateValue(base.DateValue{}); got != "" {
		t.Fatalf("zero DateValue formatted as %q, want empty", got)
	}
	d := parseDateValue("2025-03-14")
	if !d.IsSet() || formatDateValue(d) != "2025-03-14" {
		t.Fatalf("ISO round-trip got %q", formatDateValue(d))
	}
	ts := parseDateValue("2025-01-15T00:00:00Z")
	if !ts.IsSet() || formatDateValue(ts) != "2025-01-15" {
		t.Fatalf("RFC3339 round-trip got %q", formatDateValue(ts))
	}
}

func TestActivityFormDatePickers(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)

	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)

	startNode := ui.Find("id:activity-start")
	if startNode.Props.Role != core.RoleCombobox {
		t.Fatalf("activity-start role = %v, want RoleCombobox", startNode.Props.Role)
	}
	if startNode.Props.Label != "Start date" {
		t.Fatalf("activity-start label = %q, want Start date", startNode.Props.Label)
	}
	endNode := ui.Find("id:activity-end")
	if endNode.Props.Role != core.RoleCombobox {
		t.Fatalf("activity-end role = %v, want RoleCombobox", endNode.Props.Role)
	}
	if endNode.Props.Label != "End date" {
		t.Fatalf("activity-end label = %q, want End date", endNode.Props.Label)
	}
	ui.WaitFor("id:activity-start >> text:2025-01-01", 2*time.Second)
	ui.WaitFor("id:activity-end >> text:2025-12-31", 2*time.Second)

	ui.Press("id:activity-start")
	ui.WaitFor("label:2025-01-15", 2*time.Second)
	ui.Press("label:2025-01-15")
	ui.WaitFor("id:activity-start >> text:2025-01-15", 2*time.Second)

	ui.Press("id:activity-cancel")
	ui.WaitForGone("id:activity-dialog", 2*time.Second)

	ui.Press("id:activities-table >> role:option")
	ui.WaitUntil(2*time.Second, func() bool { return ui.Enabled("id:activity-edit") })
	ui.Press("id:activity-edit")
	ui.WaitFor("id:activity-edit-dialog", 2*time.Second)
	ui.WaitFor("id:activity-edit-start >> text:2025-01-15", 2*time.Second)
	ui.WaitFor("id:activity-edit-end >> text:2025-01-15", 2*time.Second)
}

func TestAuditFilterDatePickers(t *testing.T) {
	dbPath := fixtureDB(t)
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	const (
		earlyDate = "2026-01-02"
		midDate   = "2026-01-10"
		lateDate  = "2026-01-20"
	)
	if _, err := s.DB().ExecContext(ctx, `INSERT INTO audit_event
		(id, event_kind, payload, occurred_at) VALUES
		('early', 'activity_data.created', '{}', ?),
		('late', 'activity_data.updated', '{}', ?)`,
		earlyDate+"T10:00:00Z", lateDate+"T10:00:00Z"); err != nil {
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
	ui.WaitFor("id:audit-row-early", 3*time.Second)
	ui.WaitFor("id:audit-row-late", 3*time.Second)

	sinceNode := ui.Find("id:audit-since")
	if sinceNode.Props.Role != core.RoleCombobox {
		t.Fatalf("audit-since role = %v, want RoleCombobox", sinceNode.Props.Role)
	}
	if untilNode := ui.Find("id:audit-until"); untilNode.Props.Role != core.RoleCombobox {
		t.Fatalf("audit-until role = %v, want RoleCombobox", untilNode.Props.Role)
	}

	ui.Press("id:audit-since")
	ui.WaitFor("label:"+midDate, 2*time.Second)
	ui.Press("label:" + midDate)
	ui.WaitFor("id:audit-since >> text:"+midDate, 2*time.Second)
	ui.WaitForGone("id:audit-row-early", 2*time.Second)
	ui.WaitFor("id:audit-row-late", 2*time.Second)

	ui.Press("label:Clear")
	ui.WaitFor("id:audit-row-early", 2*time.Second)
	ui.WaitFor("id:audit-since >> text:Select a date…", 2*time.Second)
}

func TestQuestionnaireWizardDueDatePicker(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)

	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:questionnaires-new", 3*time.Second)
	ui.Press("id:questionnaires-new")
	ui.WaitFor("id:questionnaires-wizard-dialog", 3*time.Second)

	dueNode := ui.Find("id:questionnaires-wizard-due")
	if dueNode.Props.Role != core.RoleCombobox {
		t.Fatalf("questionnaires-wizard-due role = %v, want RoleCombobox", dueNode.Props.Role)
	}

	const pickDate = "2026-01-15"

	ui.Press("id:questionnaires-wizard-due")
	ui.WaitFor("label:"+pickDate, 2*time.Second)
	ui.Press("label:" + pickDate)
	ui.WaitFor("id:questionnaires-wizard-due >> text:"+pickDate, 2*time.Second)

	ui.Press("label:Clear")
	ui.WaitFor("id:questionnaires-wizard-due >> text:Select a date…", 2*time.Second)
}
