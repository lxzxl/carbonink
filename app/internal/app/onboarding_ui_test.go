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
	ui.Type("id:onboarding-org-industry", "manufacturing")
	ui.Type("id:onboarding-site-zh", "苏州工厂")
	ui.Type("id:onboarding-site-address", "江苏省苏州市工业园区")
	ui.Press("id:onboarding-submit")
	ui.WaitFor("text:测试制造有限公司", 5*time.Second)

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
