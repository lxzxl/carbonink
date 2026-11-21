package report

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/docview"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"

	"github.com/xuri/excelize/v2"
)

type fakeExtractor struct {
	reply string
	tool  string
}

func (f *fakeExtractor) Extract(_ context.Context, _, _ string, tool llm.Tool) (json.RawMessage, error) {
	f.tool = tool.Name
	return json.RawMessage(f.reply), nil
}

func (f *fakeExtractor) ExtractVision(context.Context, string, string, []llm.ImagePart,
	llm.Tool) (json.RawMessage, error) {
	return nil, nil
}

func TestReportInventoryAndISOExport(t *testing.T) {
	s, ctx, periodID := reportFixture(t)
	data, err := s.ReportInventory(ctx, periodID)
	if err != nil {
		t.Fatal(err)
	}
	if data.Totals.TotalKg != 500 || data.Totals.Scope2Kg != 500 {
		t.Fatalf("totals = %+v", data.Totals)
	}
	if len(data.Activities) != 1 || data.Activities[0].Source != "Purchased electricity" {
		t.Fatalf("activities = %+v", data.Activities)
	}
	if len(data.Sources) != 1 || data.Sources[0].SharePct != 100 {
		t.Fatalf("sources = %+v", data.Sources)
	}
	if len(data.EFSources) != 1 || data.EFSources[0].GWPBasis != "AR6" {
		t.Fatalf("EF sources = %+v", data.EFSources)
	}

	extractor := &fakeExtractor{reply: `{
		"boundary_description":"This report covers the operational boundary of the test organization and its single active site for the reporting year.",
		"reporting_boundary_description":"The reporting boundary includes purchased electricity attributed to the site under the operational control approach.",
		"methodology_description":"Emissions are calculated from activity data and pinned emission factors; this inventory uses the AR6 GWP basis.",
		"emissions_summary":"Scope 2 emissions total 500.00 kgCO2e for the reporting year, entirely from purchased electricity.",
		"significant_changes":"No significant changes were assessed this period.",
		"observations":"Data quality relies on a single metered electricity account; future inventories should add source-level metering."
	}`}
	service := &Service{Store: s, Provider: Provider{Name: "openai", Model: "test",
		BaseURL: "http://example.invalid"},
		NewClient: func(Provider) llm.Extractor { return extractor }}
	generated, err := service.Generate(ctx, periodID, "en", KindISO)
	if err != nil {
		t.Fatal(err)
	}
	if extractor.tool != "save_iso_report_narrative" || generated.ISO == nil ||
		!strings.Contains(generated.ISO.EmissionsSummary, "500.00") {
		t.Fatalf("generated = %+v", generated.ISO)
	}

	labels := testLabels()
	pdf, err := generated.PDF(labels)
	if err != nil {
		t.Fatal(err)
	}
	text, pages, err := docview.PDFText(pdf)
	if err != nil {
		t.Fatal(err)
	}
	if pages < 2 {
		t.Fatalf("pages = %d", pages)
	}
	for _, want := range []string{"测试组织", "2025", "ISO 14064-1 inventory report",
		"Scope 2 emissions total 500.00", "Purchased electricity", "500.00"} {
		if !strings.Contains(text, want) {
			t.Errorf("PDF is missing %q", want)
		}
	}

	workbook, err := generated.XLSX(labels)
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(workbook))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	if value, err := book.GetCellValue(labels.Activities, "B2"); err != nil ||
		value != "Purchased electricity" {
		t.Fatalf("activity B2 = %q, %v", value, err)
	}
	if value, err := book.GetCellValue(labels.Sources, "A2"); err != nil ||
		value != "Purchased electricity" {
		t.Fatalf("source A2 = %q, %v", value, err)
	}
}

func TestTCFDNarrativeAndEmptyInventory(t *testing.T) {
	s, ctx, periodID := reportFixture(t)
	extractor := &fakeExtractor{reply: `{
		"governance":"The board oversees climate matters through the sustainability lead, who reports annually on the inventory.",
		"strategy":"The organization's climate strategy focuses on metering and reducing purchased electricity consumption across its sites.",
		"risk_management":"Climate risks are identified qualitatively; no quantitative scenario analysis was performed this period.",
		"metrics_targets":"Scope 2 emissions were 500.00 kgCO2e. Scope 1 and Scope 3 were not assessed in this period."
	}`}
	service := &Service{Store: s, Provider: Provider{Model: "test", BaseURL: "http://example.invalid"},
		NewClient: func(Provider) llm.Extractor { return extractor }}
	generated, err := service.Generate(ctx, periodID, "en", KindTCFD)
	if err != nil {
		t.Fatal(err)
	}
	if extractor.tool != "save_tcfd_report_narrative" || generated.TCFD == nil {
		t.Fatalf("kind = %q", extractor.tool)
	}
	pdf, err := generated.PDF(testLabels())
	if err != nil {
		t.Fatal(err)
	}
	text, _, err := docview.PDFText(pdf)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "Governance") ||
		!strings.Contains(text, "500.00") {
		t.Fatalf("PDF text = %s", text)
	}

	other := &Service{Store: s, Provider: Provider{Model: "test", BaseURL: "http://example.invalid"},
		NewClient: func(Provider) llm.Extractor { return extractor }}
	if _, err := other.Generate(ctx, "missing-period", "en", KindISO); err == nil {
		t.Fatal("expected an unknown period error")
	}
}

func reportFixture(t *testing.T) (*store.Store, context.Context, string) {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	org, site, period, err := s.CompleteOnboarding(ctx, store.OnboardingInput{
		Organization: store.OrganizationInput{
			NameZH: "测试组织", NameEN: "Test Org", Industry: "manufacturing",
			CountryCode: "cn", BoundaryKind: "operational_control",
		},
		Site: store.SiteInput{NameZH: "上海工厂", NameEN: "Shanghai Plant",
			Address: "Pudong", CountryCode: "cn"},
		Year: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	const ts = "2025-01-15T00:00:00Z"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.DB().ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO emission_source (id, site_id, name, scope, category)
		VALUES ('src', ?, 'Purchased electricity', 2, 'electricity.grid')`, site.ID)
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
			dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
		VALUES ('ef1', 2025, 'MEE', 'CN', '2025', 2, 'kWh', 0.5, 'AR6', ?, 'seed')`, ts)
	exec(`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
			occurred_at_start, occurred_at_end, amount, unit,
			ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
			computed_co2e_kg, computed_at, created_at, updated_at)
		VALUES ('act1', ?, 'src', ?, '2025-01-01', '2025-12-31', 1000, 'kWh',
			'ef1', 2025, 'MEE', 'CN', '2025', 500, ?, ?, ?)`,
		site.ID, period.ID, ts, ts, ts)
	_ = org
	return s, ctx, period.ID
}

func testLabels() Labels {
	return Labels{
		ISOTitle: "ISO 14064-1 inventory report", TCFDTitle: "TCFD climate disclosure",
		Org: "Organization", Period: "Reporting period", Boundary: "Boundary",
		BoundaryEquity: "Equity share", BoundaryFinancial: "Financial control",
		BoundaryOperational: "Operational control",
		Responsible:         "Responsible", Generated: "Generated", Sites: "Sites", Site: "Site",
		SectionBoundary:     "1. Organizational boundary",
		SectionReporting:    "2. Reporting boundary",
		SectionMethod:       "3. Methodology",
		SectionInventory:    "4. GHG inventory",
		SectionChanges:      "5. Significant changes",
		SectionObservations: "6. Observations",
		PillarGovernance:    "Governance", PillarStrategy: "Strategy",
		PillarRisk: "Risk management", PillarMetrics: "Metrics and targets",
		TCFDIntro: "This disclosure follows the TCFD four-pillar structure.",
		Summary:   "Summary", Sources: "Sources", Factors: "Emission factors",
		Activities: "Activities", Scope: "Scope", Source: "Source", Name: "Name",
		CO2e: "CO2e (kg)", Share: "Share", Year: "Year", Amount: "Amount", Unit: "Unit",
		EF: "EF", Notes: "Notes", Count: "Count", GWPBasis: "GWP basis",
		Scope1: "Scope 1", Scope2: "Scope 2", Scope3: "Scope 3", Total: "Total",
		BaseYear: "Base year", PriorYear: "Prior year",
		Significant: "Significant changes", NoSignificant: "None reported.",
		PreparedBy: "Prepared by",
	}
}

// TestBoundaryLabelFollowsDocumentLanguage keeps the PDF/XLSX boundary
// wording tied to the export language rather than hardcoded English.
func TestBoundaryLabelFollowsDocumentLanguage(t *testing.T) {
	zh := Labels{BoundaryEquity: "股权法", BoundaryFinancial: "财务控制法",
		BoundaryOperational: "运营控制法"}
	for kind, want := range map[string]string{
		"equity_share":        "股权法",
		"financial_control":   "财务控制法",
		"operational_control": "运营控制法",
	} {
		if got := boundaryLabel(kind, zh); got != want {
			t.Fatalf("boundaryLabel(%q) = %q, want %q", kind, got, want)
		}
	}
}
