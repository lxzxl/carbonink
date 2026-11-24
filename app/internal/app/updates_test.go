package app

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestUpdatesCardRespectsCapabilityAndChecks(t *testing.T) {
	t.Run("disabled channel disables check and explains", func(t *testing.T) {
		t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
		ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
			nsgotest.Environment(core.Environment{Locale: "en-US"}),
			nsgotest.UpdaterState(core.UpdaterState{Managed: core.UpdaterChannel}))
		openSettings(ui, "updates")
		ui.WaitFor("id:settings-update-status", 5*time.Second)

		if got := ui.Find("id:settings-update-status").Text; got != "Update checks are disabled in this build." {
			t.Errorf("status = %q, want disabled-channel explanation", got)
		}
		if ui.Enabled("id:settings-update-check") {
			t.Errorf("check button should be disabled when channel is none")
		}
		if ui.Exists("id:settings-update-automatic") {
			t.Errorf("automatic-checks switch should be hidden when updates are disabled")
		}
	})

	t.Run("self-managed updater checks, toggles automatic checks, and offers download", func(t *testing.T) {
		t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
		ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
			nsgotest.Environment(core.Environment{Locale: "en-US"}),
			nsgotest.UpdaterState(core.UpdaterState{
				Managed:         core.UpdaterSelf,
				AutomaticChecks: true,
			}))
		ui.Update = func(background bool) core.UpdateCheck {
			return core.UpdateCheck{
				Managed: core.UpdaterSelf,
				Version: "2.0.1",
				URL:     "https://carbonink.xyz/download",
			}
		}
		openSettings(ui, "updates")
		ui.WaitFor("id:settings-update-automatic", 5*time.Second)

		if !ui.Find("id:settings-update-automatic").Props.Checked {
			t.Errorf("automatic checks switch should start checked")
		}
		ui.Press("id:settings-update-automatic")
		if ui.Find("id:settings-update-automatic").Props.Checked {
			t.Errorf("automatic checks switch should toggle off")
		}

		ui.Press("id:settings-update-check")
		ui.WaitFor("text:Version 2.0.1 is available.", 2*time.Second)
		ui.WaitFor("id:settings-update-download", 2*time.Second)
	})

	t.Run("shown native dialog and restart ready states", func(t *testing.T) {
		t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
		ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
			nsgotest.Environment(core.Environment{Locale: "en-US"}),
			nsgotest.UpdaterState(core.UpdaterState{Managed: core.UpdaterSelf}))
		calls := 0
		ui.Update = func(bool) core.UpdateCheck {
			calls++
			if calls == 1 {
				return core.UpdateCheck{Managed: core.UpdaterSelf, Shown: true}
			}
			return core.UpdateCheck{Managed: core.UpdaterSelf, Restart: true}
		}
		openSettings(ui, "updates")
		ui.WaitFor("id:settings-update-check", 5*time.Second)

		ui.Press("id:settings-update-check")
		ui.WaitFor("text:Update check opened in the system updater.", 2*time.Second)

		ui.Press("id:settings-update-check")
		ui.WaitFor("id:settings-update-restart", 2*time.Second)
	})
}
