package app

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func emptyOnboardDB(t *testing.T) string {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "empty.sqlite")
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Migrate(ctx); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	return dbPath
}

// TestTopbarCommandTriggerOpensPalette verifies that clicking the visible ⌘K/Ctrl+K
// topbar button opens the command palette.
func TestTopbarCommandTriggerOpensPalette(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:topbar-command", 5*time.Second)
	ui.Press("id:topbar-command")
	ui.WaitFor("id:command-palette", 2*time.Second)
}

// TestOnboardingByotRedirectsToSettingsAI verifies the financial_control boundary
// choice persists and the BYOT setup button lands directly on Settings → AI provider.
func TestOnboardingByotRedirectsToSettingsAI(t *testing.T) {
	dbPath := emptyOnboardDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))

	ui.WaitFor("id:onboarding-org-zh", 5*time.Second)
	ui.Type("id:onboarding-org-zh", "青山制造")
	ui.Press("id:onboarding-next")

	ui.WaitFor("id:onboarding-year", 2*time.Second)
	ui.Press("id:onboarding-next")

	ui.WaitFor("id:onboarding-boundary-financial_control", 2*time.Second)
	ui.Press("id:onboarding-boundary-financial_control")
	ui.Press("id:onboarding-next")

	ui.WaitFor("id:onboarding-site-zh", 2*time.Second)
	ui.Type("id:onboarding-site-zh", "华东工厂")
	ui.Press("id:onboarding-next")

	ui.WaitFor("id:onboarding-byot", 2*time.Second)
	ui.Press("id:onboarding-byot")
	ui.WaitFor("id:settings-llm-model", 5*time.Second)

	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	org, err := s.CurrentOrganization(ctx)
	if err != nil || org == nil {
		t.Fatalf("expected persisted organization, got org=%v err=%v", org, err)
	}
	if org.BoundaryKind != "financial_control" {
		t.Fatalf("expected boundary financial_control, got %q", org.BoundaryKind)
	}
}

// TestReportsAutoSelectsLatestPeriod verifies Reports pre-selects the latest active
// period on open so Generate preview is immediately reachable.
func TestReportsAutoSelectsLatestPeriod(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:nav:reports", 5*time.Second)
	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-generate", 3*time.Second)
}

// TestDarkModeSwitchSmoke toggles dark appearance at runtime and visits key screens
// to ensure reactive StyleFunc rendering succeeds cleanly.
func TestDarkModeSwitchSmoke(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:settings-theme-dark", 3*time.Second)
	ui.Press("id:settings-theme-dark")
	if !ui.Find("id:settings-theme-dark").Props.Selected {
		t.Fatal("dark appearance option is not selected")
	}

	ui.Press("id:nav:dashboard")
	ui.WaitFor("text:Total CO2e", 2*time.Second)

	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-upload", 2*time.Second)

	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-generate", 2*time.Second)

	ui.Press("id:nav:settings")
	ui.WaitFor("id:settings-section-about", 2*time.Second)
}
