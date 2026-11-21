package store

import (
	"context"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openFixture(t *testing.T) (*Store, context.Context) {
	t.Helper()
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return s, ctx
}

func onboard(t *testing.T, s *Store, ctx context.Context) (*Organization, *Site, *ReportingPeriod) {
	t.Helper()
	org, site, period, err := s.CompleteOnboarding(ctx, OnboardingInput{
		Organization: OrganizationInput{
			NameZH:       "测试组织",
			NameEN:       "Test Org",
			Industry:     "manufacturing",
			CountryCode:  "cn",
			BoundaryKind: "operational_control",
		},
		Site: SiteInput{
			NameZH:      "上海工厂",
			NameEN:      "Shanghai Plant",
			Address:     "Pudong",
			CountryCode: "cn",
		},
		Year: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	return org, site, period
}

func TestDomainCRUD(t *testing.T) {
	s, ctx := openFixture(t)
	org, site, period := onboard(t, s, ctx)
	if org.CountryCode != "CN" || site.CountryCode != "CN" {
		t.Fatalf("country codes were not normalized: org=%q site=%q", org.CountryCode, site.CountryCode)
	}
	if period.Year != 2025 || period.Granularity != "annual" {
		t.Fatalf("unexpected period: %+v", period)
	}
	if current, err := s.CurrentOrganization(ctx); err != nil || current == nil || current.ID != org.ID {
		t.Fatalf("CurrentOrganization = %+v, %v", current, err)
	}
	if _, _, _, err := s.CompleteOnboarding(ctx, OnboardingInput{
		Organization: OrganizationInput{NameEN: "Second", CountryCode: "US", BoundaryKind: "equity_share"},
		Site:         SiteInput{NameEN: "Second site", CountryCode: "US"},
		Year:         2025,
	}); err == nil {
		t.Fatal("second onboarding succeeded; singleton should be enforced")
	}

	if err := s.UpdateOrganization(ctx, org.ID, OrganizationInput{
		NameZH: "测试组织（更新）", NameEN: "Test Org Updated", Industry: "services",
		CountryCode: "CN", BoundaryKind: "equity_share",
	}); err != nil {
		t.Fatal(err)
	}
	updated, err := s.OrganizationByID(ctx, org.ID)
	if err != nil || updated == nil || updated.NameEN != "Test Org Updated" || updated.BoundaryKind != "equity_share" {
		t.Fatalf("updated organization = %+v, %v", updated, err)
	}

	secondSite, err := s.CreateSite(ctx, SiteInput{
		OrganizationID: org.ID, NameEN: "Suzhou Warehouse", CountryCode: "CN",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateSite(ctx, secondSite.ID, SiteInput{
		OrganizationID: org.ID, NameEN: "Suzhou DC", Address: "Industrial Park", CountryCode: "CN",
	}, false); err != nil {
		t.Fatal(err)
	}
	sites, err := s.ListSites(ctx, org.ID)
	if err != nil || len(sites) != 2 {
		t.Fatalf("sites = %d, %v", len(sites), err)
	}
	if sites[1].NameEN != "Suzhou DC" || sites[1].IsActive {
		t.Fatalf("updated site = %+v", sites[1])
	}

	secondPeriod, err := s.CreatePeriod(ctx, PeriodInput{OrganizationID: org.ID, Year: 2026})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdatePeriod(ctx, secondPeriod.ID, 2027, false); err != nil {
		t.Fatal(err)
	}
	periods, err := s.ListPeriods(ctx, org.ID)
	if err != nil || len(periods) != 2 {
		t.Fatalf("periods = %d, %v", len(periods), err)
	}
	if periods[1].Year != 2027 || periods[1].IsActive {
		t.Fatalf("updated period = %+v", periods[1])
	}

	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
		GHGProtocolPath: "scope2.location",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateSource(ctx, src.ID, SourcePatch{
		Name: "Purchased electricity (grid)", Scope: 2, Category: "electricity.grid",
		GHGProtocolPath: "scope2.location", IsActive: false,
	}); err != nil {
		t.Fatal(err)
	}
	sources, err := s.ListSources(ctx, org.ID)
	if err != nil || len(sources) != 1 {
		t.Fatalf("sources = %d, %v", len(sources), err)
	}
	if sources[0].Name != "Purchased electricity (grid)" || sources[0].IsActive {
		t.Fatalf("updated source = %+v", sources[0])
	}
	summary, err := s.Summary(ctx, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Sites != 2 || summary.Periods != 2 || summary.Sources != 1 || summary.Activities != 0 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestCreateActivityPinsComputesAuditsAndDeletes(t *testing.T) {
	s, ctx := openFixture(t)
	org, site, period := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
		GHGProtocolPath: "scope2.location",
	})
	if err != nil {
		t.Fatal(err)
	}
	ef := findFactor(t, s, ctx, EFFilter{Scope: 2, Category: "electricity.grid", Search: "national"})
	document, _, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "ledger.csv", MIMEType: "text/csv", Data: []byte("source,amount\npower,100\n"),
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	activity, err := s.CreateActivity(ctx, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-01-01", OccurredAtEnd: "2025-01-31",
		Amount: 100, Unit: "度", EF: keyOf(ef), Notes: "sensitive free text",
		EvidenceDocumentID: document.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if activity.SiteID != site.ID || activity.EmissionSourceID != src.ID || activity.Scope != 2 {
		t.Fatalf("created activity = %+v", activity)
	}
	if math.Abs(activity.CO2eKg-57.03) > 0.0001 {
		t.Fatalf("CO2e = %v, want 57.03", activity.CO2eKg)
	}
	if activity.Notes != "sensitive free text" {
		t.Fatalf("notes = %q", activity.Notes)
	}
	var pinned int
	if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM pinned_emission_factor`).Scan(&pinned); err != nil {
		t.Fatal(err)
	}
	if pinned != 1 {
		t.Fatalf("pinned factors = %d, want 1", pinned)
	}
	events, err := s.AuditEvents(ctx, 10)
	if err != nil || len(events) != 1 {
		t.Fatalf("audit events = %d, %v", len(events), err)
	}
	if events[0].Kind != "activity_data.created" || strings.Contains(events[0].Payload, "sensitive free text") {
		t.Fatalf("audit event = %+v", events[0])
	}
	if !strings.Contains(events[0].Payload, document.ID) {
		t.Fatalf("audit event is missing the evidence document: %+v", events[0])
	}
	var evidence int
	if err := s.DB().QueryRowContext(ctx,
		`SELECT count(*) FROM evidence_attachment WHERE activity_data_id = ? AND document_id = ?`,
		activity.ID, document.ID).Scan(&evidence); err != nil {
		t.Fatal(err)
	}
	if evidence != 1 {
		t.Fatalf("evidence attachments = %d, want 1", evidence)
	}
	linked, linkedTotal, err := s.DocumentEvidence(ctx, document.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if linkedTotal != 1 || len(linked) != 1 {
		t.Fatalf("document evidence = %d/%d", len(linked), linkedTotal)
	}
	if linked[0].ActivityID != activity.ID || linked[0].SourceName != src.Name ||
		linked[0].SiteName != site.NameZH || linked[0].Scope != 2 ||
		math.Abs(linked[0].CO2eKg-57.03) > 0.0001 {
		t.Fatalf("linked activity = %+v", linked[0])
	}
	summary, err := s.Summary(ctx, org.ID)
	if err != nil || summary.Activities != 1 {
		t.Fatalf("summary = %+v, %v", summary, err)
	}

	if err := s.DeleteActivity(ctx, activity.ID); err != nil {
		t.Fatal(err)
	}
	if got, err := s.ActivityByID(ctx, activity.ID); err != nil || got != nil {
		t.Fatalf("deleted activity = %+v, %v", got, err)
	}
	if err := s.DB().QueryRowContext(ctx,
		`SELECT count(*) FROM evidence_attachment WHERE activity_data_id = ?`, activity.ID).
		Scan(&evidence); err != nil {
		t.Fatal(err)
	}
	if evidence != 0 {
		t.Fatalf("evidence after delete = %d, want 0", evidence)
	}
	if _, linkedTotal, err = s.DocumentEvidence(ctx, document.ID, 10); err != nil || linkedTotal != 0 {
		t.Fatalf("document evidence after delete = %d, %v", linkedTotal, err)
	}
	events, err = s.AuditEvents(ctx, 10)
	if err != nil || len(events) != 2 || events[0].Kind != "activity_data.deleted" {
		t.Fatalf("audit after delete = %+v, %v", events, err)
	}
}

func TestCreateActivityCrossFamilyFuelConversion(t *testing.T) {
	s, ctx := openFixture(t)
	_, site, period := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Gasoline", Scope: 1, Category: "fuel.mobile",
		GHGProtocolPath: "scope1.mobile_combustion",
	})
	if err != nil {
		t.Fatal(err)
	}
	ef := findFactor(t, s, ctx, EFFilter{Scope: 1, Search: "gasoline combustion"})
	activity, err := s.CreateActivity(ctx, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-02-01", OccurredAtEnd: "2025-02-01",
		Amount: 100, Unit: "kg", FuelCode: "gasoline", EF: keyOf(ef),
	})
	if err != nil {
		t.Fatal(err)
	}
	want := 100 / 0.745 * 2.296
	if math.Abs(activity.CO2eKg-want) > 0.001 {
		t.Fatalf("CO2e = %.6f, want %.6f", activity.CO2eKg, want)
	}
}

func TestUpdateActivityRecomputesAndAuditsRebind(t *testing.T) {
	s, ctx := openFixture(t)
	_, site, period := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
	})
	if err != nil {
		t.Fatal(err)
	}
	national := findFactor(t, s, ctx, EFFilter{Scope: 2, Category: "electricity.grid", Search: "national"})
	east := findFactor(t, s, ctx, EFFilter{Scope: 2, Category: "electricity.grid", Search: "east"})
	activity, err := s.CreateActivity(ctx, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-01-01", OccurredAtEnd: "2025-01-31",
		Amount: 100, Unit: "kWh", EF: keyOf(national), Notes: "private note",
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := s.UpdateActivity(ctx, activity.ID, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-02-01", OccurredAtEnd: "2025-02-28",
		Amount: 200, Unit: "kWh", EF: keyOf(national), Notes: "changed private note",
	})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(updated.CO2eKg-114.06) > 0.0001 || updated.OccurredAt != "2025-02-01" {
		t.Fatalf("updated activity = %+v", updated)
	}
	rebound, err := s.UpdateActivity(ctx, activity.ID, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-02-01", OccurredAtEnd: "2025-02-28",
		Amount: 200, Unit: "kWh", EF: keyOf(east),
	})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(rebound.CO2eKg-111.72) > 0.0001 || rebound.EFFactorCode != east.FactorCode {
		t.Fatalf("rebound activity = %+v", rebound)
	}
	events, err := s.AuditEvents(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[0].Kind != "activity_rebind_ef" ||
		events[1].Kind != "activity_data.updated" || events[2].Kind != "activity_data.created" {
		t.Fatalf("audit kinds = %+v", events)
	}
	for _, event := range events {
		if strings.Contains(event.Payload, "private note") {
			t.Fatalf("notes leaked into %s: %s", event.Kind, event.Payload)
		}
	}
}

func TestImportActivitiesSkipsBadRowsAndKeepsAudits(t *testing.T) {
	s, ctx := openFixture(t)
	org, site, period := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
	})
	if err != nil {
		t.Fatal(err)
	}
	ef := EmissionFactorKey{
		FactorCode: "electricity.grid.cn.national.2024", Year: 2024,
		Source: "MEE_China", Geography: "CN", DatasetVersion: "2024.q4",
	}
	base := ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-03-01", OccurredAtEnd: "2025-03-01",
		Amount: 100, Unit: "kWh", EF: ef,
	}
	bad := base
	bad.EmissionSourceID = "missing"
	result, err := s.ImportActivities(ctx, []ActivityInput{base, bad, base})
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != 2 || result.Failed != 1 || len(result.Failures) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if result.Failures[0].Index != 1 || !strings.Contains(result.Failures[0].Error, "not found") {
		t.Errorf("failure = %+v", result.Failures[0])
	}
	summary, err := s.Summary(ctx, org.ID)
	if err != nil || summary.Activities != 2 {
		t.Fatalf("summary = %+v, %v", summary, err)
	}
	events, err := s.AuditEvents(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	created := 0
	for _, event := range events {
		if event.Kind == "activity_data.created" {
			created++
		}
	}
	if created != 2 {
		t.Errorf("created audit events = %d, want 2", created)
	}
}

func TestAuditQueryFiltersAndPages(t *testing.T) {
	s, ctx := openFixture(t)
	_, site, period := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
	})
	if err != nil {
		t.Fatal(err)
	}
	ef := EmissionFactorKey{
		FactorCode: "electricity.grid.cn.national.2024", Year: 2024,
		Source: "MEE_China", Geography: "CN", DatasetVersion: "2024.q4",
	}
	for i := 0; i < 3; i++ {
		if _, err := s.CreateActivity(ctx, ActivityInput{
			EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
			OccurredAtStart: "2025-04-01", OccurredAtEnd: "2025-04-01",
			Amount: float64(10 + i), Unit: "kWh", EF: ef,
		}); err != nil {
			t.Fatal(err)
		}
	}
	created, err := s.QueryAuditEvents(ctx, AuditQuery{Kind: "activity_data.created", Limit: 10})
	if err != nil || len(created) != 3 {
		t.Fatalf("created events = %d, %v", len(created), err)
	}
	today := time.Now().UTC().Format("2006-01-02")
	since, err := s.QueryAuditEvents(ctx, AuditQuery{Since: today, Until: today, Limit: 10})
	if err != nil || len(since) != 3 {
		t.Fatalf("today events = %d, %v", len(since), err)
	}
	page1, err := s.QueryAuditEvents(ctx, AuditQuery{Limit: 2})
	if err != nil || len(page1) != 2 {
		t.Fatalf("page1 = %d, %v", len(page1), err)
	}
	page2, err := s.QueryAuditEvents(ctx, AuditQuery{
		BeforeTime: page1[1].OccurredAt, BeforeID: page1[1].ID, Limit: 2,
	})
	if err != nil || len(page2) != 1 || page2[0].ID == page1[0].ID || page2[0].ID == page1[1].ID {
		t.Fatalf("page2 = %+v, %v", page2, err)
	}
	future, err := s.QueryAuditEvents(ctx, AuditQuery{Since: "2999-01-01", Limit: 10})
	if err != nil || len(future) != 0 {
		t.Fatalf("future events = %d, %v", len(future), err)
	}
}

func TestCreateActivityRejectsBadInputWithoutPartialWrites(t *testing.T) {
	s, ctx := openFixture(t)
	_, site, period := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{SiteID: site.ID, Name: "Electricity", Scope: 2})
	if err != nil {
		t.Fatal(err)
	}
	ef := findFactor(t, s, ctx, EFFilter{Scope: 2, Category: "electricity.grid"})
	cases := []ActivityInput{
		{EmissionSourceID: src.ID, ReportingPeriodID: period.ID, OccurredAtStart: "2025-01-01",
			OccurredAtEnd: "2025-01-01", Amount: 0, Unit: "kWh", EF: keyOf(ef)},
		{EmissionSourceID: src.ID, ReportingPeriodID: period.ID, OccurredAtStart: "2025-01-01",
			OccurredAtEnd: "2025-01-01", Amount: 1, Unit: "bogus", EF: keyOf(ef)},
		{EmissionSourceID: src.ID, ReportingPeriodID: period.ID, OccurredAtStart: "2025-02-01",
			OccurredAtEnd: "2025-01-01", Amount: 1, Unit: "kWh", EF: keyOf(ef)},
	}
	for _, in := range cases {
		if _, err := s.CreateActivity(ctx, in); err == nil {
			t.Fatalf("CreateActivity(%+v) succeeded", in)
		}
	}
	var activities, pinned int
	if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM activity_data`).Scan(&activities); err != nil {
		t.Fatal(err)
	}
	if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM pinned_emission_factor`).Scan(&pinned); err != nil {
		t.Fatal(err)
	}
	if activities != 0 || pinned != 0 {
		t.Fatalf("partial writes: activities=%d pinned=%d", activities, pinned)
	}
}

func findFactor(t *testing.T, s *Store, ctx context.Context, filter EFFilter) EmissionFactor {
	t.Helper()
	factors, err := s.ListEmissionFactors(ctx, filter)
	if err != nil {
		t.Fatal(err)
	}
	if len(factors) == 0 {
		t.Fatalf("no emission factors for %+v", filter)
	}
	return factors[0]
}

func keyOf(ef EmissionFactor) EmissionFactorKey {
	return EmissionFactorKey{
		FactorCode: ef.FactorCode, Year: ef.Year, Source: ef.Source,
		Geography: ef.Geography, DatasetVersion: ef.DatasetVersion,
	}
}

func TestCreateSourcesInsertsBatchAtomically(t *testing.T) {
	s, ctx := openFixture(t)
	_, site, _ := onboard(t, s, ctx)
	rows, err := s.CreateSources(ctx, []SourceInput{
		{SiteID: site.ID, Name: "Grid electricity", Scope: 2, Category: "electricity",
			GHGProtocolPath: "scope2.purchased_electricity", TemplateOrigin: "preset-grid"},
		{SiteID: site.ID, Name: "Business travel", Scope: 3, Category: "travel",
			GHGProtocolPath: "scope3.cat6_business_travel", TemplateOrigin: "preset-travel"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Name != "Grid electricity" || rows[1].Name != "Business travel" {
		t.Fatalf("rows = %+v", rows)
	}
	if rows[0].Category != "electricity" || rows[1].Category != "travel" {
		t.Errorf("EF categories = %q, %q", rows[0].Category, rows[1].Category)
	}
	if rows[0].GHGProtocolPath != "scope2.purchased_electricity" ||
		rows[1].GHGProtocolPath != "scope3.cat6_business_travel" {
		t.Errorf("paths = %q, %q", rows[0].GHGProtocolPath, rows[1].GHGProtocolPath)
	}
	if rows[0].TemplateOrigin != "preset-grid" || rows[1].TemplateOrigin != "preset-travel" {
		t.Errorf("origins = %q, %q", rows[0].TemplateOrigin, rows[1].TemplateOrigin)
	}

	_, err = s.CreateSources(ctx, []SourceInput{
		{SiteID: site.ID, Name: "Rolled back", Scope: 1, Category: "fuel.mobile"},
		{SiteID: "missing-site", Name: "Broken", Scope: 1, Category: "fuel.mobile"},
	})
	if err == nil {
		t.Fatal("batch with an unknown site succeeded")
	}
	var count int
	if err := s.DB().QueryRowContext(ctx,
		`SELECT count(*) FROM emission_source WHERE name = 'Rolled back'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("partial batch survived: %d rows", count)
	}
}
