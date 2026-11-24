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

// TestOnboardingCollectsIndustryAndSiteAddress proves the first-run form
// writes the same organization + site fields 1.x collected across its wizard
// steps, including the optional industry and site address.
func TestOnboardingCollectsIndustryAndSiteAddress(t *testing.T) {
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

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))

	ui.WaitFor("id:onboarding-org-zh", 3*time.Second)
	ui.Type("id:onboarding-org-zh", "测试制造有限公司")
	ui.Press("id:onboarding-org-industry")
	ui.WaitFor("id:onboarding-org-industry-0", 2*time.Second)
	ui.Press("id:onboarding-org-industry-0")
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-year", 2*time.Second)
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-boundary-operational_control", 2*time.Second)
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-site-zh", 2*time.Second)
	ui.Type("id:onboarding-site-zh", "苏州工厂")
	ui.Type("id:onboarding-site-address", "江苏省苏州市工业园区")
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-skip", 2*time.Second)
	ui.Press("id:onboarding-skip")
	ui.WaitFor("id:shell", 5*time.Second)

	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	org, err := check.CurrentOrganization(ctx)
	if err != nil || org == nil {
		t.Fatalf("organization = %+v, %v", org, err)
	}
	if org.Industry != "manufacturing" {
		t.Errorf("industry = %q, want manufacturing", org.Industry)
	}
	sites, err := check.ListSites(ctx, org.ID)
	if err != nil || len(sites) != 1 {
		t.Fatalf("sites = %+v, %v", sites, err)
	}
	if sites[0].Address != "江苏省苏州市工业园区" {
		t.Errorf("site address = %q", sites[0].Address)
	}
}

// TestOnboardingRequiresOneNameAndAValidYear holds Finish disabled until the
// form can actually create an organization, site, and reporting period.
func TestOnboardingRequiresOneNameAndAValidYear(t *testing.T) {
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

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))

	ui.WaitFor("id:onboarding-org-zh", 3*time.Second)
	if !ui.Exists("text:At least one language is required.") {
		t.Fatal("the onboarding form does not explain the name requirement")
	}
	// Step 1 refuses to advance without a company name.
	ui.Press("id:onboarding-next")
	if ui.Exists("id:onboarding-year") {
		t.Fatal("the wizard advanced past step 1 with no company name")
	}
	ui.Type("id:onboarding-org-zh", "测试制造有限公司")
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-year", 2*time.Second)

	// Step 2 refuses an out-of-range year.
	ui.Clear("id:onboarding-year")
	ui.Type("id:onboarding-year", "1999")
	ui.Press("id:onboarding-next")
	if !ui.Exists("id:onboarding-year") {
		t.Fatal("the wizard advanced past step 2 with an out-of-range year")
	}
	ui.Clear("id:onboarding-year")
	ui.Type("id:onboarding-year", "2026")
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-boundary-operational_control", 2*time.Second)
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-site-zh", 2*time.Second)

	// Step 4 refuses to advance without a site name.
	ui.Press("id:onboarding-next")
	if ui.Exists("id:onboarding-skip") {
		t.Fatal("the wizard advanced past step 4 with no site name")
	}
	ui.Type("id:onboarding-site-zh", "苏州工厂")
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-skip", 2*time.Second)
}

// TestOnboardingInputsKeepFocusWhileTyping ensures typing in required company
// and site name inputs updates hint styling reactively without rebuilding the
// step body or dropping focus on each character.
func TestOnboardingInputsKeepFocusWhileTyping(t *testing.T) {
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

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))

	checkTyping := func(id string, first, second, want string) {
		t.Helper()
		origID := ui.Find("id:" + id).ID
		ui.Type("id:"+id, first)
		v := ui.Find("id:" + id)
		if !v.Focused || v.ID != origID {
			t.Fatalf("%s lost focus or rebuilt after %q: focused=%v id=%v (want %v)",
				id, first, v.Focused, v.ID, origID)
		}
		ui.Type("id:"+id, second)
		v = ui.Find("id:" + id)
		if !v.Focused || v.ID != origID || v.Text != want {
			t.Fatalf("%s after %q: focused=%v id=%v (want %v) text=%q (want %q)",
				id, second, v.Focused, v.ID, origID, v.Text, want)
		}
	}

	ui.WaitFor("id:onboarding-org-zh", 3*time.Second)
	zhID := ui.Find("id:onboarding-org-zh").ID
	ui.Press("id:onboarding-next")
	if got := ui.Find("id:onboarding-org-zh").ID; got != zhID {
		t.Fatalf("onboarding-org-zh rebuilt on failed validation: id=%v, want %v", got, zhID)
	}
	checkTyping("onboarding-org-zh", "A", "B", "AB")
	checkTyping("onboarding-org-en", "C", "D", "CD")

	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-year", 2*time.Second)
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-boundary-operational_control", 2*time.Second)
	ui.Press("id:onboarding-next")
	ui.WaitFor("id:onboarding-site-zh", 2*time.Second)

	siteZHID := ui.Find("id:onboarding-site-zh").ID
	ui.Press("id:onboarding-next")
	if got := ui.Find("id:onboarding-site-zh").ID; got != siteZHID {
		t.Fatalf("onboarding-site-zh rebuilt on failed validation: id=%v, want %v", got, siteZHID)
	}
	checkTyping("onboarding-site-zh", "S", "Z", "SZ")
	checkTyping("onboarding-site-en", "H", "Q", "HQ")
}
