package inbound

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"testing"

	"app.carbonink.desktop/internal/store"

	"github.com/xuri/excelize/v2"
)

func TestTemplateIntegrity(t *testing.T) {
	if len(Cat1.Questions) != 7 {
		t.Fatalf("questions = %d", len(Cat1.Questions))
	}
	positions := map[string]bool{}
	for _, q := range Cat1.Questions {
		if positions[q.Position] {
			t.Fatalf("duplicate position %q", q.Position)
		}
		positions[q.Position] = true
		sheet, address := splitRef(q.CellRef)
		if sheet == "" || address == "" {
			t.Fatalf("%s has a bad cell ref %q", q.Position, q.CellRef)
		}
		if _, _, ok := parseAddress(address); !ok {
			t.Fatalf("%s address %q does not parse", q.Position, address)
		}
		if q.RawZH == "" || q.RawEN == "" {
			t.Fatalf("%s lacks bilingual copy", q.Position)
		}
	}
	if got := signature(Cat1.Version, "tier1.1"); got !=
		"inbound:cat1_supplier_disclosure:1.0:tier1.1" {
		t.Fatalf("signature = %q", got)
	}
}

func TestRenderAndParseRoundTrip(t *testing.T) {
	data, err := RenderBlank(RenderOptions{
		Template: Cat1, QuestionnaireID: "qn-1", SupplierName: "Acme Steel",
		PeriodYear: 2025, OrgName: "测试组织", DueDate: "2026-03-31",
	})
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if cover, err := book.GetCellValue(coverSheet, "A3"); err != nil ||
		!bytes.Contains([]byte(cover), []byte("测试组织")) {
		t.Fatalf("cover = %q, %v", cover, err)
	}
	if question, err := book.GetCellValue("metadata", "A5"); err != nil ||
		question == "" {
		t.Fatalf("metadata A5 = %q, %v", question, err)
	}
	_ = book.Close()

	parsed, err := ParseFilled(data, Cat1, "qn-1", 2025)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Answers) != len(Cat1.Questions) {
		t.Fatalf("answers = %d", len(parsed.Answers))
	}
	if len(parsed.Warnings) != 1 || parsed.Warnings[0].Kind != "blank_template" {
		t.Fatalf("warnings = %+v", parsed.Warnings)
	}

	filled := fillCells(t, data, map[string]string{
		"metadata!B5": "Acme Steel Co.",
		"tier1!B5":    "0.52 kgCO2e/kg",
		"tier1!C5":    "PCF report attached",
		"tier2!B5":    "1,200,000",
		"tier2!B7":    "mass-based",
		"tier2!B9":    "43000",
	})
	parsed, err = ParseFilled(filled, Cat1, "qn-1", 2025)
	if err != nil {
		t.Fatal(err)
	}
	byPosition := map[string]ParsedAnswer{}
	for _, a := range parsed.Answers {
		byPosition[a.Position] = a
	}
	if a := byPosition["tier1.1"]; !a.IsNumeric || a.Number != 0.52 ||
		a.Note != "PCF report attached" {
		t.Fatalf("tier1.1 = %+v", a)
	}
	if a := byPosition["tier2.1"]; !a.IsNumeric || a.Number != 1200000 {
		t.Fatalf("tier2.1 = %+v", a)
	}
	if len(parsed.Warnings) != 0 {
		t.Fatalf("warnings = %+v", parsed.Warnings)
	}
}

func TestParseRejectsForeignWorkbooks(t *testing.T) {
	data, err := RenderBlank(RenderOptions{
		Template: Cat1, QuestionnaireID: "qn-1", PeriodYear: 2025, OrgName: "Org",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseFilled(data, Cat1, "qn-2", 2025); !errors.Is(err, ErrWrongQuestionnaire) {
		t.Fatalf("wrong questionnaire err = %v", err)
	}
	if _, err := ParseFilled(data, Cat1, "qn-1", 2024); !errors.Is(err, ErrWrongPeriod) {
		t.Fatalf("wrong period err = %v", err)
	}
	if _, err := ParseFilled([]byte("not a workbook"), Cat1, "qn-1", 2025); err == nil {
		t.Fatal("expected an open error")
	}
}

func TestInboundLifecycleIngestsTierTwo(t *testing.T) {
	s, ctx := openStore(t)
	onboard(t, s, ctx)
	supplier, err := s.CreateSupplier(ctx, "Acme Steel", "", "buyer@acme.example")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: s}
	id, count, err := service.CreateDraft(ctx, CreateRequest{
		SupplierID: supplier.ID, ReportingYear: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != len(Cat1.Questions) {
		t.Fatalf("count = %d", count)
	}
	q, err := s.QuestionnaireByID(ctx, id)
	if err != nil || q.Direction != "inbound" || q.Status != store.QuestionnaireDraft {
		t.Fatalf("draft = %+v, %v", q, err)
	}

	blank, name, err := service.ExportBlank(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if name != "inbound-acme-steel-2025.xlsx" {
		t.Fatalf("name = %q", name)
	}
	if q, _ = s.QuestionnaireByID(ctx, id); q.Status != store.QuestionnaireSent {
		t.Fatalf("after export status = %q", q.Status)
	}

	filled := fillCells(t, blank, map[string]string{
		"metadata!B5": "Acme Steel Co.",
		"metadata!B7": "FY2025",
		"metadata!B9": "Third-party verified",
		"tier2!B5":    "1200000",
		"tier2!B7":    "mass-based",
		"tier2!B9":    "43000",
	})
	preview, err := service.ImportFilled(ctx, id, filled)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Plan.Tier != 2 || preview.Plan.ActivityRows != 1 ||
		preview.Plan.TotalCO2eKg != 43000 {
		t.Fatalf("plan = %+v", preview.Plan)
	}
	if q, _ = s.QuestionnaireByID(ctx, id); q.Status != store.QuestionnaireReceived {
		t.Fatalf("after import status = %q", q.Status)
	}

	again, err := service.Preview(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if again.Plan.Tier != 2 || again.Answers[0].Finalized {
		t.Fatalf("reopened preview = %+v", again)
	}

	accepted := make([]string, 0, len(preview.Answers))
	for _, a := range preview.Answers {
		accepted = append(accepted, a.QuestionID)
	}
	result, err := service.Ingest(ctx, IngestRequest{QuestionnaireID: id, Accepted: accepted})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Ingested || len(result.ActivityIDs) != 1 {
		t.Fatalf("result = %+v", result)
	}
	activities, err := s.Activities(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, a := range activities {
		if a.ID == result.ActivityIDs[0] {
			found = true
			if a.CO2eKg != 43000 || a.Unit != "kgCO2e" {
				t.Fatalf("activity = %+v", a)
			}
		}
	}
	if !found {
		t.Fatalf("activity %s not in %+v", result.ActivityIDs[0], activities)
	}
	if q, _ = s.QuestionnaireByID(ctx, id); q.Status != store.QuestionnaireIngested {
		t.Fatalf("after ingest status = %q", q.Status)
	}
	rerun, err := service.Ingest(ctx, IngestRequest{QuestionnaireID: id, Accepted: accepted})
	if err != nil || !rerun.Ingested || len(rerun.ActivityIDs) != 1 {
		t.Fatalf("idempotent ingest = %+v, %v", rerun, err)
	}

	removed, err := service.Delete(ctx, id)
	if err != nil || removed != 1 {
		t.Fatalf("delete = %d, %v", removed, err)
	}
	if q, err := s.QuestionnaireByID(ctx, id); err != nil || q != nil {
		t.Fatalf("questionnaire after delete = %+v, %v", q, err)
	}
}

func TestInboundTierOneRequiresQuantity(t *testing.T) {
	s, ctx := openStore(t)
	onboard(t, s, ctx)
	supplier, err := s.CreateSupplier(ctx, "Parts Ltd", "", "")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: s}
	id, _, err := service.CreateDraft(ctx, CreateRequest{
		SupplierID: supplier.ID, ReportingYear: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	blank, _, err := service.ExportBlank(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	filled := fillCells(t, blank, map[string]string{
		"metadata!B5": "Parts Ltd",
		"tier1!B5":    "2.5",
		"tier1!C5":    "估算",
	})
	preview, err := service.ImportFilled(ctx, id, filled)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Plan.Tier != 1 {
		t.Fatalf("plan = %+v", preview.Plan)
	}
	tierOneID := ""
	for _, a := range preview.Answers {
		if a.Position == "tier1.1" {
			tierOneID = a.QuestionID
		}
	}
	if tierOneID == "" {
		t.Fatal("tier1.1 question id is missing")
	}
	if _, err := service.Ingest(ctx, IngestRequest{
		QuestionnaireID: id, Accepted: []string{tierOneID},
	}); !errors.Is(err, ErrQuantityRequired) {
		t.Fatalf("missing quantity err = %v", err)
	}
	quantity := 1000.0
	result, err := service.Ingest(ctx, IngestRequest{
		QuestionnaireID: id, Accepted: []string{tierOneID},
		Tier1Quantity: &quantity,
	})
	if err != nil {
		t.Fatal(err)
	}
	activities, err := s.Activities(ctx, 10)
	if err != nil || len(activities) != 1 {
		t.Fatalf("activities = %+v, %v", activities, err)
	}
	if activities[0].CO2eKg != 2500 {
		t.Fatalf("co2e = %v", activities[0].CO2eKg)
	}
	if activities[0].ID != result.ActivityIDs[0] ||
		!contains(activities[0].Notes, "供应商备注：估算") {
		t.Fatalf("activity = %+v", activities[0])
	}
}

func TestInboundSoftNoOpWhenNoTierFilled(t *testing.T) {
	s, ctx := openStore(t)
	onboard(t, s, ctx)
	supplier, err := s.CreateSupplier(ctx, "Empty Co", "", "")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: s}
	id, _, err := service.CreateDraft(ctx, CreateRequest{
		SupplierID: supplier.ID, ReportingYear: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	blank, _, err := service.ExportBlank(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := service.ImportFilled(ctx, id, blank)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Plan.Tier != 0 || len(preview.Plan.AvailableTiers) != 0 {
		t.Fatalf("plan = %+v", preview.Plan)
	}
	result, err := service.Ingest(ctx, IngestRequest{QuestionnaireID: id})
	if err != nil || result.Ingested {
		t.Fatalf("soft no-op = %+v, %v", result, err)
	}
	if q, _ := s.QuestionnaireByID(ctx, id); q.Status != store.QuestionnaireReceived {
		t.Fatalf("status = %q", q.Status)
	}
}

func fillCells(t *testing.T, data []byte, cells map[string]string) []byte {
	t.Helper()
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	for ref, value := range cells {
		sheet, address := splitRef(ref)
		if err := book.SetCellValue(sheet, address, value); err != nil {
			t.Fatalf("set %s: %v", ref, err)
		}
	}
	buf, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func openStore(t *testing.T) (*store.Store, context.Context) {
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
	return s, ctx
}

func onboard(t *testing.T, s *store.Store, ctx context.Context) {
	t.Helper()
	if _, _, _, err := s.CompleteOnboarding(ctx, store.OnboardingInput{
		Organization: store.OrganizationInput{
			NameZH: "测试组织", NameEN: "Test Org", Industry: "manufacturing",
			CountryCode: "cn", BoundaryKind: "operational_control",
		},
		Site: store.SiteInput{NameZH: "上海工厂", NameEN: "Shanghai Plant",
			Address: "Pudong", CountryCode: "cn"},
		Year: 2025,
	}); err != nil {
		t.Fatal(err)
	}
}

func contains(haystack, needle string) bool {
	return bytes.Contains([]byte(haystack), []byte(needle))
}
