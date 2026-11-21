package app

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestTourRunsOnceAndReplays proves the questionnaire tour steps through its
// copy, stays gone after finishing, and comes back after a Settings replay —
// until the user turns guidance off.
func TestTourRunsOnceAndReplays(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)

	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:guidance-questionnaires", 3*time.Second)
	ui.WaitFor("text:Start from a customer questionnaire", 2*time.Second)
	ui.Press("id:guidance-questionnaires-next")
	ui.WaitFor("text:Track by status and due date", 2*time.Second)
	ui.Press("id:guidance-questionnaires-done")
	ui.WaitForGone("id:guidance-questionnaires", 3*time.Second)

	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-search", 3*time.Second)
	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:questionnaires-search", 3*time.Second)
	ui.WaitForGone("id:guidance-questionnaires", time.Second)

	ui.Press("id:nav:settings")
	ui.WaitFor("text:Guided tours", 3*time.Second)
	ui.Press("id:settings-guidance-replay")
	ui.WaitFor("text:Guided tours will play again", 3*time.Second)
	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:guidance-questionnaires", 3*time.Second)

	ui.Press("id:nav:settings")
	ui.WaitFor("id:settings-guidance-toggle", 3*time.Second)
	ui.Press("id:settings-guidance-toggle")
	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:questionnaires-search", 3*time.Second)
	ui.WaitForGone("id:guidance-questionnaires", time.Second)
}
