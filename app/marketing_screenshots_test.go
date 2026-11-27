package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/answer"
	"app.carbonink.desktop/internal/inbound"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"

	"github.com/go-pdf/fpdf"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/xuri/excelize/v2"
)

type marketingFixture struct {
	dbPath             string
	utilityDocID       string
	primaryQuestID     string
	receivedInboundID  string
	period2025ID       string
	importCSVPath      string
	importCSVName      string
	isoReportArguments string
	efElecArguments    string
	efDieselArguments  string
	efGasArguments     string
}

func TestCaptureMarketingScreenshotsEN(t *testing.T) {
	if os.Getenv("CARBONINK_CAPTURE_SCREENSHOTS") != "1" {
		t.Skip("set CARBONINK_CAPTURE_SCREENSHOTS=1 to capture marketing screenshots")
	}
	runMarketingCapture(t, false)
}

func TestCaptureMarketingScreenshotsZH(t *testing.T) {
	if os.Getenv("CARBONINK_CAPTURE_SCREENSHOTS") != "1" {
		t.Skip("set CARBONINK_CAPTURE_SCREENSHOTS=1 to capture marketing screenshots")
	}
	runMarketingCapture(t, true)
}

func runMarketingCapture(t *testing.T, isZh bool) {
	t.Helper()
	fx := buildMarketingFixture(t, isZh)

	envLocale := "en-US"
	langBtn := "id:settings-language-en"
	prefix := "en"
	if isZh {
		envLocale = "zh-CN"
		langBtn = "id:settings-language-zh-CN"
		prefix = "zh"
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		switch {
		case bytes.Contains(body, []byte("save_iso_report_narrative")):
			fmt.Fprintf(w, "data: %s\n\n", fmt.Sprintf(
				`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_iso","type":"function","function":{"name":"save_iso_report_narrative","arguments":%s}}]}}]}`,
				fx.isoReportArguments))
		case bytes.Contains(body, []byte("save_emission_factor_recommendations")):
			lowerBody := bytes.ToLower(body)
			args := fx.efElecArguments
			if bytes.Contains(lowerBody, []byte("diesel")) || bytes.Contains(body, []byte("柴油")) {
				args = fx.efDieselArguments
			} else if bytes.Contains(lowerBody, []byte("natural gas")) || bytes.Contains(body, []byte("天然气")) {
				args = fx.efGasArguments
			}
			fmt.Fprintf(w, "data: %s\n\n", fmt.Sprintf(
				`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_ef","type":"function","function":{"name":"save_emission_factor_recommendations","arguments":%s}}]}}]}`,
				args))
		default:
			fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"ok"}}]}`, "\n\n")
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	t.Setenv("CARBONINK_TEST_DB", fx.dbPath)
	t.Setenv("CARBONINK_TEST_IMPORT_FILE", fx.importCSVPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1400, 900),
		nsgotest.Environment(core.Environment{Locale: envLocale}),
		nsgotest.Secrets(map[string]string{"llm.api_key": "test-key"}))

	ui.PickFiles = func(nsgotest.FilePick) []core.File {
		return []core.File{{Name: fx.importCSVName, Path: fx.importCSVPath}}
	}

	// Enforce light theme, exact locale, no tour popups, and mock LLM endpoint.
	ui.WaitFor("id:nav:settings", 5*time.Second)
	ui.Press("id:nav:settings")
	ui.WaitFor("id:settings-theme-light", 3*time.Second)
	ui.Press("id:settings-theme-light")
	ui.Press(langBtn)
	ui.WaitFor("id:settings-guidance-off", 3*time.Second)
	ui.Press("id:settings-guidance-off")
	configureScreenshotLLM(t, ui, srv.URL, isZh)

	// 1. Dashboard
	ui.Press("id:nav:dashboard")
	ui.WaitFor("id:dashboard-totals", 5*time.Second)
	ui.WaitFor("id:dashboard-monthly-trend", 3*time.Second)
	ui.WaitFor("id:dashboard-recent", 3*time.Second)
	time.Sleep(300 * time.Millisecond)
	ui.Screenshot(prefix + "/dashboard")

	// 2. Emission sources
	ui.Press("id:nav:sources")
	ui.WaitFor("id:sources-search", 5*time.Second)
	time.Sleep(300 * time.Millisecond)
	ui.Screenshot(prefix + "/sources")

	// 3. Documents (utility bill extraction awaiting review)
	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-row-"+fx.utilityDocID, 5*time.Second)
	ui.Press("id:documents-row-" + fx.utilityDocID)
	ui.WaitFor("id:documents-detail-dialog", 5*time.Second)
	ui.WaitFor("id:documents-extraction-confirm", 5*time.Second)
	time.Sleep(400 * time.Millisecond)
	ui.Screenshot(prefix + "/documents")
	ui.Press("id:documents-detail-close")
	ui.WaitForGone("id:documents-detail-dialog", 3*time.Second)

	// 4. Outbound customer questionnaires (with Answer Agent trace button)
	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:questionnaires-row-"+fx.primaryQuestID, 5*time.Second)
	ui.Press("id:questionnaires-row-" + fx.primaryQuestID)
	ui.WaitFor("id:questionnaires-detail-dialog", 5*time.Second)
	ui.WaitFor("id:questionnaires-question-1", 3*time.Second)
	ui.Press("id:questionnaires-question-1")
	ui.WaitFor("id:answer-agent-trace", 3*time.Second)
	time.Sleep(350 * time.Millisecond)
	ui.Screenshot(prefix + "/questionnaires")
	ui.Press("id:questionnaires-detail-close")
	ui.WaitForGone("id:questionnaires-detail-dialog", 3*time.Second)

	// 5. Inbound supplier disclosures (4 statuses, multi-template, overdue badge)
	ui.Press("id:nav:supplier-disclosures")
	ui.WaitFor("id:supplier-disclosures-templates", 5*time.Second)
	ui.WaitFor("id:supplier-disclosures-row-"+fx.receivedInboundID, 5*time.Second)
	ui.Press("id:supplier-disclosures-row-" + fx.receivedInboundID)
	ui.WaitFor("id:supplier-disclosures-detail-dialog", 5*time.Second)
	time.Sleep(350 * time.Millisecond)
	ui.Screenshot(prefix + "/supplier-disclosures")
	ui.Press("id:supplier-disclosures-detail-close")
	ui.WaitForGone("id:supplier-disclosures-detail-dialog", 3*time.Second)

	// 6. Batch ledger import (confirm emission factors by group)
	ui.Press("id:nav:activities")
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-import")
	ui.WaitFor("id:activity-import-dialog", 3*time.Second)
	ui.Press("id:activity-import-pick")
	ui.WaitFor("id:activity-import-repick", 5*time.Second)
	ui.Press("id:activity-import-next")
	ui.WaitFor("id:activity-import-ef-0", 5*time.Second)
	// Wait for AI recommendations to settle, then confirm groups 0 and 1 leaving group 2 pending.
	ui.WaitFor("id:activity-import-ef-recommend-0-0", 5*time.Second)
	ui.Press("id:activity-import-ef-recommend-0-0")
	if ui.Exists("id:activity-import-ef-recommend-1-0") {
		ui.Press("id:activity-import-ef-recommend-1-0")
	} else if ui.Exists("id:activity-import-ef-1") {
		ui.Press("id:activity-import-ef-1")
		ui.WaitFor("id:activity-import-ef-1-0", 3*time.Second)
		ui.Press("id:activity-import-ef-1-0")
	}
	time.Sleep(400 * time.Millisecond)
	ui.Screenshot(prefix + "/activity-import")
	ui.Press("id:activity-import-dialog-close")
	ui.WaitForGone("id:activity-import-dialog", 3*time.Second)

	// 7. ISO 14064-1 inventory report preview
	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-period-"+fx.period2025ID, 5*time.Second)
	ui.Press("id:reports-period-" + fx.period2025ID)
	ui.WaitFor("id:reports-generate", 3*time.Second)
	ui.Press("id:reports-generate")
	ui.WaitFor("id:reports-export-pdf", 15*time.Second)
	ui.WaitFor("id:reports-export-deliverable", 5*time.Second)
	time.Sleep(400 * time.Millisecond)
	ui.Screenshot(prefix + "/reports")
}

func configureScreenshotLLM(t *testing.T, ui *nsgotest.App, baseURL string, isZh bool) {
	t.Helper()
	ui.Press("id:nav:settings")
	ui.WaitFor("id:settings-section-ai", 3*time.Second)
	ui.Press("id:settings-section-ai")
	ui.WaitFor("id:settings-llm-base-url", 3*time.Second)
	ui.Clear("id:settings-llm-base-url")
	ui.Type("id:settings-llm-base-url", baseURL)
	ui.Clear("id:settings-llm-model")
	ui.Type("id:settings-llm-model", "test-model")
	ui.Press("id:settings-llm-save")
	if isZh {
		ui.WaitFor("text:设置已保存", 3*time.Second)
	} else {
		ui.WaitFor("text:Settings saved", 3*time.Second)
	}
}

func buildMarketingFixture(t *testing.T, isZh bool) marketingFixture {
	t.Helper()
	ctx := context.Background()
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "marketing.sqlite")

	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}

	orgIn := store.OrganizationInput{
		NameEN:          "Meridian Precision Manufacturing Ltd.",
		Industry:        "Precision Manufacturing",
		CountryCode:     "CN",
		BoundaryKind:    "operational_control",
		Responsible:     "Lin Wei",
		ResponsibleRole: "EHS & Sustainability Lead",
	}
	site1In := store.SiteInput{
		NameEN:      "Suzhou Plant",
		Address:     "Suzhou Industrial Park",
		CountryCode: "CN",
	}
	site2In := store.SiteInput{
		NameEN:      "Shanghai HQ",
		Address:     "Pudong, Shanghai",
		CountryCode: "CN",
	}
	if isZh {
		orgIn = store.OrganizationInput{
			NameZH:          "华东精密制造有限公司",
			Industry:        "精密制造",
			CountryCode:     "CN",
			BoundaryKind:    "operational_control",
			Responsible:     "林维",
			ResponsibleRole: "EHS 与可持续发展负责人",
		}
		site1In = store.SiteInput{
			NameZH:      "苏州工厂",
			Address:     "苏州工业园区",
			CountryCode: "CN",
		}
		site2In = store.SiteInput{
			NameZH:      "上海总部",
			Address:     "上海浦东新区",
			CountryCode: "CN",
		}
	}

	org, site1, period2025, err := s.CompleteOnboarding(ctx, store.OnboardingInput{
		Organization: orgIn,
		Site:         site1In,
		Year:         2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	orgIn.BaseYearPeriodID = period2025.ID
	if err := s.UpdateOrganization(ctx, org.ID, orgIn); err != nil {
		t.Fatal(err)
	}
	site2In.OrganizationID = org.ID
	site2, err := s.CreateSite(ctx, site2In)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePeriod(ctx, store.PeriodInput{OrganizationID: org.ID, Year: 2024}); err != nil {
		t.Fatal(err)
	}

	srcNames := []string{
		"Plant Grid Electricity",
		"HQ Grid Electricity",
		"Natural Gas Boiler",
		"Company Fleet Diesel",
		"Purchased Steel & Fasteners",
		"Upstream Road Freight",
		"Business Air Travel",
	}
	if isZh {
		srcNames = []string{
			"苏州工厂外购电力",
			"上海总部外购电力",
			"厂区天然气锅炉",
			"自有柴油车队",
			"外购钢材与紧固件",
			"上游公路货运",
			"员工航空差旅",
		}
	}
	mustSource := func(siteID, name string, scope int, category, path string) *store.EmissionSource {
		src, err := s.CreateSource(ctx, store.SourceInput{
			SiteID: siteID, Name: name, Scope: scope, Category: category, GHGProtocolPath: path,
		})
		if err != nil {
			t.Fatal(err)
		}
		return src
	}
	srcElecPlant := mustSource(site1.ID, srcNames[0], 2, "electricity.grid", "scope2.location")
	srcElecHQ := mustSource(site2.ID, srcNames[1], 2, "electricity.grid", "scope2.location")
	srcGas := mustSource(site1.ID, srcNames[2], 1, "fuel.stationary", "scope1.stationary_combustion")
	srcDiesel := mustSource(site1.ID, srcNames[3], 1, "fuel.mobile", "scope1.mobile_combustion")
	srcSteel := mustSource(site1.ID, srcNames[4], 3, "purchase.material.steel", "scope3.cat1_purchased_goods")
	srcFreight := mustSource(site1.ID, srcNames[5], 3, "freight.road.heavy_diesel_truck", "scope3.cat4_upstream_transportation")
	srcTravel := mustSource(site2.ID, srcNames[6], 3, "travel.air.economy.shorthaul", "scope3.cat6_business_travel")

	efElecEast := store.EmissionFactorKey{FactorCode: "electricity.grid.cn.east.2024", Year: 2024, Source: "MEE_China", Geography: "CN-East", DatasetVersion: "2024.q4"}
	efGas := store.EmissionFactorKey{FactorCode: "fuel.natural_gas.combustion.global.2024", Year: 2024, Source: "IPCC_AR6", Geography: "GLOBAL", DatasetVersion: "2024.v1"}
	efDiesel := store.EmissionFactorKey{FactorCode: "fuel.diesel.combustion.global.2024", Year: 2024, Source: "IPCC_AR6", Geography: "GLOBAL", DatasetVersion: "2024.v1"}
	efSteel := store.EmissionFactorKey{FactorCode: "purchase.material.steel_primary", Year: 2024, Source: "EcoInvent", Geography: "GLOBAL", DatasetVersion: "3.10"}
	efFreight := store.EmissionFactorKey{FactorCode: "freight.road.heavy_diesel_truck", Year: 2024, Source: "DEFRA", Geography: "GLOBAL", DatasetVersion: "2024.annual"}
	efTravel := store.EmissionFactorKey{FactorCode: "travel.air.economy.shorthaul", Year: 2024, Source: "DEFRA", Geography: "GLOBAL", DatasetVersion: "2024.annual"}

	docDir := filepath.Join(tmp, "docs")
	savePDFDoc := func(filename, docType, pdfTitle, pdfBody, uploadedAt string) *store.Document {
		pdf := fpdf.New("P", "mm", "A4", "")
		pdf.AddPage()
		pdf.SetFont("Helvetica", "B", 14)
		pdf.Cell(0, 10, pdfTitle)
		pdf.Ln(12)
		pdf.SetFont("Helvetica", "", 11)
		pdf.MultiCell(0, 7, pdfBody, "", "", false)
		var buf bytes.Buffer
		if err := pdf.Output(&buf); err != nil {
			t.Fatal(err)
		}
		doc, _, err := s.SaveDocument(ctx, store.DocumentInput{
			Filename: filename, MIMEType: "application/pdf", Data: buf.Bytes(),
		}, docDir)
		if err != nil {
			t.Fatal(err)
		}
		absPath := filepath.Join(docDir, doc.StoragePath)
		if _, err := s.DB().ExecContext(ctx,
			`UPDATE document SET storage_path = ?, uploaded_at = ? WHERE id = ?`,
			absPath, uploadedAt, doc.ID); err != nil {
			t.Fatal(err)
		}
		if docType != "" {
			if err := s.SetDocumentType(ctx, doc.ID, docType); err != nil {
				t.Fatal(err)
			}
		}
		return doc
	}

	docUtilName := "2025-11-suzhou-utility-bill.pdf"
	docFuelName := "2025-11-fleet-diesel-receipt.pdf"
	docFreightName := "2025-10-freight-waybill.pdf"
	docPurchaseName := "2025-09-steel-supply-invoice.pdf"
	docTravelName := "2025-08-flight-itinerary.pdf"
	if isZh {
		docUtilName = "2025-11-苏州工厂电费单.pdf"
		docFuelName = "2025-11-车队柴油发票.pdf"
		docFreightName = "2025-10-公路货运运单.pdf"
		docPurchaseName = "2025-09-钢材采购发票.pdf"
		docTravelName = "2025-08-差旅机票行程单.pdf"
	}

	docUtil := savePDFDoc(docUtilName, "china_utility.v1",
		"State Grid Jiangsu Electric Power - Monthly Bill",
		"Account: 320501884210\nBilling Period: 2025-11-01 to 2025-11-30\nActive Electricity: 142,800 kWh\nTotal Amount: CNY 104,244.00",
		"2025-12-03T09:15:00Z")
	docFuel := savePDFDoc(docFuelName, "fuel_receipt.v1",
		"Sinopec Fleet Fuel Card Statement",
		"Fuel Type: #0 Diesel\nVolume: 3,420 L\nPeriod: 2025-11-01 to 2025-11-30\nAmount: CNY 26,334.00",
		"2025-11-29T16:40:00Z")
	docFreight := savePDFDoc(docFreightName, "freight.v1",
		"EastPort Logistics Waybill #EP-20251042",
		"Route: Suzhou -> Ningbo Port\nMode: Heavy Diesel Truck\nWeight: 28 t | Distance: 310 km (8,680 tkm)",
		"2025-10-25T11:20:00Z")
	docPurchase := savePDFDoc(docPurchaseName, "purchase.v1",
		"Baosteel Industrial Supply VAT Invoice",
		"Item: Cold-rolled Steel Coil & Precision Fasteners\nQuantity: 12,500 kg\nDate: 2025-09-18",
		"2025-09-22T14:05:00Z")
	_ = savePDFDoc(docTravelName, "travel.v1",
		"Electronic Flight Itinerary CA1831",
		"Route: PVG -> PEK -> PVG (Economy)\nDistance: 2,350 passenger-km\nDate: 2025-08-14",
		"2025-08-19T10:10:00Z")

	utilSupplier := "State Grid Jiangsu Electric Power Co."
	if isZh {
		utilSupplier = "国网江苏省电力有限公司"
	}
	utilParsed, _ := json.Marshal(map[string]any{
		"supplier_name": utilSupplier,
		"doc_type":      "china_utility.v1",
		"account_no":    "320501884210",
		"amount_kwh":    142800,
		"amount_yuan":   104244,
		"period_start":  "2025-11-01",
		"period_end":    "2025-11-30",
		"confidence":    "high",
	})
	if _, err := s.InsertExtraction(ctx, store.ExtractionInput{
		DocumentID: docUtil.ID, LLMProvider: "openai", LLMModel: "test-model",
		PromptVersion: "china_utility.v1", RawResponse: string(utilParsed), ParsedJSON: string(utilParsed),
	}); err != nil {
		t.Fatal(err)
	}
	fuelParsed, _ := json.Marshal(map[string]any{
		"supplier_name": "Sinopec",
		"doc_type":      "fuel_receipt.v1",
		"fuel_type":     "diesel",
		"volume_l":      3420,
		"amount_yuan":   26334,
		"occurred_at":   "2025-11-30",
		"confidence":    "high",
	})
	fuelExt, err := s.InsertExtraction(ctx, store.ExtractionInput{
		DocumentID: docFuel.ID, LLMProvider: "openai", LLMModel: "test-model",
		PromptVersion: "fuel_receipt.v1", RawResponse: string(fuelParsed), ParsedJSON: string(fuelParsed),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ConfirmExtraction(ctx, fuelExt.ID); err != nil {
		t.Fatal(err)
	}
	freightParsed, _ := json.Marshal(map[string]any{
		"supplier_name": "EastPort Logistics",
		"doc_type":      "freight.v1",
		"mode":          "road",
		"weight_kg":     28000,
		"distance_km":   310,
		"occurred_at":   "2025-10-22",
		"confidence":    "medium",
	})
	if _, err := s.InsertExtraction(ctx, store.ExtractionInput{
		DocumentID: docFreight.ID, LLMProvider: "openai", LLMModel: "test-model",
		PromptVersion: "freight.v1", RawResponse: string(freightParsed), ParsedJSON: string(freightParsed),
	}); err != nil {
		t.Fatal(err)
	}
	purchaseParsed, _ := json.Marshal(map[string]any{
		"supplier_name":    "Baosteel Supply",
		"doc_type":         "purchase.v1",
		"item_description": "Cold-rolled steel coil",
		"quantity_kg":      12500,
		"occurred_at":      "2025-09-18",
		"confidence":       "high",
	})
	purchaseExt, err := s.InsertExtraction(ctx, store.ExtractionInput{
		DocumentID: docPurchase.ID, LLMProvider: "openai", LLMModel: "test-model",
		PromptVersion: "purchase.v1", RawResponse: string(purchaseParsed), ParsedJSON: string(purchaseParsed),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ConfirmExtraction(ctx, purchaseExt.ID); err != nil {
		t.Fatal(err)
	}

	mustActivity := func(in store.ActivityInput) {
		if _, err := s.CreateActivity(ctx, in); err != nil {
			t.Fatal(err)
		}
	}
	monthlyElecKWh := []float64{
		98000, 92000, 106000, 112000, 119000, 134000,
		152000, 158000, 131000, 118000, 126000, 138000,
	}
	for m, kwh := range monthlyElecKWh {
		month := m + 1
		start := fmt.Sprintf("2025-%02d-01", month)
		end := time.Date(2025, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
		mustActivity(store.ActivityInput{
			EmissionSourceID:  srcElecPlant.ID,
			ReportingPeriodID: period2025.ID,
			OccurredAtStart:   start,
			OccurredAtEnd:     end,
			Amount:            kwh,
			Unit:              "kWh",
			EF:                efElecEast,
		})
	}
	mustActivity(store.ActivityInput{
		EmissionSourceID:  srcElecHQ.ID,
		ReportingPeriodID: period2025.ID,
		OccurredAtStart:   "2025-12-01",
		OccurredAtEnd:     "2025-12-31",
		Amount:            28400,
		Unit:              "kWh",
		EF:                efElecEast,
	})
	mustActivity(store.ActivityInput{
		EmissionSourceID:  srcGas.ID,
		ReportingPeriodID: period2025.ID,
		OccurredAtStart:   "2025-10-01",
		OccurredAtEnd:     "2025-12-28",
		Amount:            18600,
		Unit:              "m3",
		EF:                efGas,
	})
	mustActivity(store.ActivityInput{
		EmissionSourceID:   srcDiesel.ID,
		ReportingPeriodID:  period2025.ID,
		OccurredAtStart:    "2025-11-01",
		OccurredAtEnd:      "2025-11-30",
		Amount:             3420,
		Unit:               "L",
		EF:                 efDiesel,
		FuelCode:           "diesel",
		ExtractionID:       fuelExt.ID,
		EvidenceDocumentID: docFuel.ID,
	})
	mustActivity(store.ActivityInput{
		EmissionSourceID:   srcSteel.ID,
		ReportingPeriodID:  period2025.ID,
		OccurredAtStart:    "2025-09-18",
		OccurredAtEnd:      "2025-09-18",
		Amount:             12500,
		Unit:               "kg",
		EF:                 efSteel,
		ExtractionID:       purchaseExt.ID,
		EvidenceDocumentID: docPurchase.ID,
	})
	mustActivity(store.ActivityInput{
		EmissionSourceID:  srcFreight.ID,
		ReportingPeriodID: period2025.ID,
		OccurredAtStart:   "2025-10-15",
		OccurredAtEnd:     "2025-12-18",
		Amount:            86400,
		Unit:              "tkm",
		EF:                efFreight,
	})
	mustActivity(store.ActivityInput{
		EmissionSourceID:  srcTravel.ID,
		ReportingPeriodID: period2025.ID,
		OccurredAtStart:   "2025-08-14",
		OccurredAtEnd:     "2025-12-10",
		Amount:            42000,
		Unit:              "passenger_km",
		EF:                efTravel,
	})

	qBook := excelize.NewFile()
	_ = qBook.SetSheetName("Sheet1", "Climate Disclosure")
	_ = qBook.SetCellValue("Climate Disclosure", "A1", "Question")
	_ = qBook.SetCellValue("Climate Disclosure", "B1", "Response")
	var qBuf bytes.Buffer
	if err := qBook.Write(&qBuf); err != nil {
		t.Fatal(err)
	}
	_ = qBook.Close()
	qDoc, _, err := s.SaveDocument(ctx, store.DocumentInput{
		Filename: "nordic-motors-esg-2025.xlsx",
		MIMEType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Data:     qBuf.Bytes(),
	}, docDir)
	if err != nil {
		t.Fatal(err)
	}

	cust1Name := "Nordic Motors GmbH"
	cust2Name := "Alpine Electronics AG"
	qTexts := []struct {
		raw, norm, kind, unit, pos string
		val, ansUnit, summary      string
		finalize                   bool
	}{
		{
			raw: "Scope 2 location-based electricity emissions (FY2025)", norm: "scope 2 location based electricity",
			kind: "numerical", unit: "tCO2e", pos: "C3.1",
			val: "844.83", ansUnit: "tCO2e",
			summary:  "Summed 13 grid electricity activities at Suzhou Plant and Shanghai HQ using MEE_China CN-East 2024 factor (0.5586 kgCO2e/kWh).",
			finalize: true,
		},
		{
			raw: "Total Scope 1 direct combustion emissions (FY2025)", norm: "scope 1 direct combustion",
			kind: "numerical", unit: "tCO2e", pos: "C3.2",
			val: "44.13", ansUnit: "tCO2e",
			summary:  "Summed Natural Gas Boiler (18,600 m3) and Company Fleet Diesel (3,420 L) with IPCC AR6 factors.",
			finalize: true,
		},
		{
			raw: "Describe your organizational consolidation boundary", norm: "organizational boundary",
			kind: "narrative", unit: "", pos: "C1.2",
			val: "Operational control across 100% of Suzhou Plant and Shanghai HQ operations.", ansUnit: "",
			summary:  "Derived from organization profile (operational_control, base year 2025).",
			finalize: false,
		},
		{
			raw: "Scope 3 upstream purchased goods & freight intensity", norm: "scope 3 purchased goods freight",
			kind: "numerical", unit: "tCO2e", pos: "C4.1",
		},
	}
	if isZh {
		cust1Name = "诺德汽车（欧洲）"
		cust2Name = "阿尔卑斯电子"
		qTexts[0].raw = "2025 年度范围二外购电力排放量（基于位置）"
		qTexts[0].val = "844.83"
		qTexts[0].summary = "汇总苏州工厂与上海总部 13 条电网电力记录，采用生态环境部华东电网 2024 排放因子（0.5586 kgCO2e/kWh）。"
		qTexts[1].raw = "2025 年度范围一直接燃烧排放总量"
		qTexts[1].val = "44.13"
		qTexts[1].summary = "汇总厂区天然气锅炉（18,600 m3）与自有柴油车队（3,420 L），采用 IPCC AR6 因子。"
		qTexts[2].raw = "请说明贵公司的温室气体盘查组织边界方法"
		qTexts[2].val = "采用运营控制权法，覆盖苏州工厂及上海总部全部运营场所（基准年 2025）。"
		qTexts[2].summary = "读取组织档案边界设置（运营控制法）。"
		qTexts[3].raw = "范围三外购钢材与上游货运排放量"
	}

	qInputs := make([]store.QuestionInput, 0, len(qTexts))
	for _, qt := range qTexts {
		qInputs = append(qInputs, store.QuestionInput{
			RawText: qt.raw, NormalizedText: qt.norm, QuestionKind: qt.kind,
			ExpectedUnit: qt.unit, Position: qt.pos, Required: true,
		})
	}
	primaryQID, _, err := s.CreateQuestionnaire(ctx, store.QuestionnaireInput{
		CustomerName: cust1Name, DocumentID: qDoc.ID, ReportingYear: 2025,
		Status: store.QuestionnaireAnswering, Direction: "outbound", DueDate: "2026-03-31",
		Questions: qInputs,
	})
	if err != nil {
		t.Fatal(err)
	}
	createdQs, err := s.ListQuestions(ctx, primaryQID)
	if err != nil {
		t.Fatal(err)
	}
	traceJSON, _ := json.Marshal(answer.AgentTrace{
		Mode:       "agent",
		StopReason: "completed",
		Turns:      2,
		DurationMs: 1180,
		Steps: []llm.AgentStep{
			{
				Turn:       1,
				Tool:       "list_activities",
				Args:       `{"year": 2025}`,
				Result:     `{"count": 19, "scope2_kg": 844826.64}`,
				DurationMs: 24,
			},
			{
				Turn:       2,
				Tool:       "list_emission_sources",
				Args:       `{}`,
				Result:     `{"sources": ["Plant Grid Electricity", "HQ Grid Electricity"]}`,
				DurationMs: 12,
			},
		},
	})
	byPos := make(map[string]store.Question, len(createdQs))
	for _, q := range createdQs {
		byPos[q.Position] = q
	}
	for _, qt := range qTexts {
		if qt.val == "" {
			continue
		}
		target, ok := byPos[qt.pos]
		if !ok {
			t.Fatalf("missing question at position %q", qt.pos)
		}
		if _, err := s.SaveAnswer(ctx, store.SaveAnswerInput{
			QuestionID:    target.ID,
			Value:         qt.val,
			Unit:          qt.ansUnit,
			SourceKind:    "ai_suggested",
			SourceSummary: qt.summary,
			AgentTrace:    string(traceJSON),
			Finalize:      qt.finalize,
		}); err != nil {
			t.Fatal(err)
		}
	}

	if _, _, err := s.CreateQuestionnaire(ctx, store.QuestionnaireInput{
		CustomerName: cust2Name, DocumentID: qDoc.ID, ReportingYear: 2025,
		Status: store.QuestionnaireFinalized, Direction: "outbound", DueDate: "2026-02-15",
		Questions: []store.QuestionInput{
			{RawText: qTexts[0].raw, NormalizedText: qTexts[0].norm, QuestionKind: "numerical", ExpectedUnit: "tCO2e", Position: "B2"},
			{RawText: qTexts[1].raw, NormalizedText: qTexts[1].norm, QuestionKind: "numerical", ExpectedUnit: "tCO2e", Position: "B3"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	inboundSvc := &inbound.Service{Store: s}
	supNames := []string{
		"Delta Injection Molding",
		"Pacific Fasteners Co.",
		"EastPort Logistics Ltd.",
		"GreenCycle Waste Services",
	}
	if isZh {
		supNames = []string{
			"苏州注塑件厂",
			"宁波紧固件供应商",
			"华东物流运输有限公司",
			"长三角固废处置中心",
		}
	}
	sup1, err := s.CreateSupplier(ctx, supNames[0], "", "esg@delta-molding.example")
	if err != nil {
		t.Fatal(err)
	}
	overdueID, _, err := inboundSvc.CreateDraft(ctx, inbound.CreateRequest{
		SupplierID: sup1.ID, TemplateKind: inbound.TemplateCat1, ReportingYear: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := inboundSvc.ExportBlank(ctx, overdueID); err != nil {
		t.Fatal(err)
	}
	overdueDate := time.Now().AddDate(0, 0, -12).Format("2006-01-02")
	if _, err := s.DB().ExecContext(ctx, `UPDATE questionnaire SET due_date = ? WHERE id = ?`, overdueDate, overdueID); err != nil {
		t.Fatal(err)
	}

	fillInboundXlsx := func(data []byte, values map[string]string) []byte {
		book, err := excelize.OpenReader(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		for ref, val := range values {
			sheet, cell, _ := strings.Cut(ref, "!")
			if err := book.SetCellValue(sheet, cell, val); err != nil {
				t.Fatal(err)
			}
		}
		var out bytes.Buffer
		if err := book.Write(&out); err != nil {
			t.Fatal(err)
		}
		_ = book.Close()
		return out.Bytes()
	}

	sup2, err := s.CreateSupplier(ctx, supNames[1], "", "sustainability@pacific-fasteners.example")
	if err != nil {
		t.Fatal(err)
	}
	receivedID, _, err := inboundSvc.CreateDraft(ctx, inbound.CreateRequest{
		SupplierID: sup2.ID, TemplateKind: inbound.TemplateCat1, ReportingYear: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	blank2, _, err := inboundSvc.ExportBlank(ctx, receivedID)
	if err != nil {
		t.Fatal(err)
	}
	metaVerified := "Third-party verified"
	allocBasis := "mass-based"
	if isZh {
		metaVerified = "第三方核查"
		allocBasis = "按质量份额"
	}
	filled2 := fillInboundXlsx(blank2, map[string]string{
		"metadata!B5": supNames[1],
		"metadata!B7": "2025",
		"metadata!B9": metaVerified,
		"tier1!B5":    "1.92",
		"tier2!B5":    "685000",
		"tier2!B7":    allocBasis,
		"tier2!B9":    "31400",
	})
	if _, err := inboundSvc.ImportFilled(ctx, receivedID, filled2); err != nil {
		t.Fatal(err)
	}

	sup3, err := s.CreateSupplier(ctx, supNames[2], "", "dispatch@eastport.example")
	if err != nil {
		t.Fatal(err)
	}
	ingestedID, _, err := inboundSvc.CreateDraft(ctx, inbound.CreateRequest{
		SupplierID: sup3.ID, TemplateKind: inbound.TemplateCat4, ReportingYear: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	blank3, _, err := inboundSvc.ExportBlank(ctx, ingestedID)
	if err != nil {
		t.Fatal(err)
	}
	filled3 := fillInboundXlsx(blank3, map[string]string{
		"metadata!B5": supNames[2],
		"metadata!B7": "2025",
		"metadata!B9": "ISO 14064 certified",
		"tier2!B5":    "920000",
		"tier2!B7":    "physical",
		"tier2!B9":    "18450",
	})
	preview3, err := inboundSvc.ImportFilled(ctx, ingestedID, filled3)
	if err != nil {
		t.Fatal(err)
	}
	var accepted3 []string
	for _, ans := range preview3.Answers {
		if !ans.IsBlank {
			accepted3 = append(accepted3, ans.QuestionID)
		}
	}
	if _, err := inboundSvc.Ingest(ctx, inbound.IngestRequest{
		QuestionnaireID: ingestedID, Accepted: accepted3, TierOverride: 2,
	}); err != nil {
		t.Fatal(err)
	}

	sup4, err := s.CreateSupplier(ctx, supNames[3], "", "compliance@greencycle.example")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := inboundSvc.CreateDraft(ctx, inbound.CreateRequest{
		SupplierID: sup4.ID, TemplateKind: inbound.TemplateCat5, ReportingYear: 2025,
	}); err != nil {
		t.Fatal(err)
	}

	// Batch import CSV with repeated descriptions per source -> 3 clean multi-row groups
	csvName := "2025-Q4-energy-ledger.csv"
	csvData := "Source,Description,Amount,Unit,Date\n" +
		"Plant Grid Electricity,Suzhou Plant Grid Electricity,38200,kWh,2025-10-15\n" +
		"Plant Grid Electricity,Suzhou Plant Grid Electricity,36400,kWh,2025-11-15\n" +
		"Plant Grid Electricity,Suzhou Plant Grid Electricity,39100,kWh,2025-12-15\n" +
		"Company Fleet Diesel,Fleet Logistics Diesel,1250,L,2025-11-18\n" +
		"Company Fleet Diesel,Fleet Logistics Diesel,1180,L,2025-12-18\n" +
		"Natural Gas Boiler,Boiler Heating Natural Gas,4100,m3,2025-11-20\n" +
		"Natural Gas Boiler,Boiler Heating Natural Gas,4350,m3,2025-12-20\n"
	if isZh {
		csvName = "2025-Q4-能源活动台账.csv"
		csvData = "排放源,描述,数量,单位,日期\n" +
			"苏州工厂外购电力,苏州工厂生产用电,38200,kWh,2025-10-15\n" +
			"苏州工厂外购电力,苏州工厂生产用电,36400,kWh,2025-11-15\n" +
			"苏州工厂外购电力,苏州工厂生产用电,39100,kWh,2025-12-15\n" +
			"自有柴油车队,物流车队柴油消耗,1250,L,2025-11-18\n" +
			"自有柴油车队,物流车队柴油消耗,1180,L,2025-12-18\n" +
			"厂区天然气锅炉,厂区锅炉天然气,4100,m3,2025-11-20\n" +
			"厂区天然气锅炉,厂区锅炉天然气,4350,m3,2025-12-20\n"
	}
	csvPath := filepath.Join(tmp, csvName)
	if err := os.WriteFile(csvPath, []byte(csvData), 0o644); err != nil {
		t.Fatal(err)
	}

	isoReplyMap := map[string]string{
		"boundary_description":           "Meridian Precision Manufacturing Ltd. applies the operational control consolidation approach covering 100% of its two active sites: Suzhou Plant and Shanghai HQ.",
		"reporting_boundary_description": "The 2025 inventory covers Scope 1 (stationary natural gas boiler, mobile fleet diesel), Scope 2 location-based grid electricity, and significant Scope 3 categories (Cat 1 purchased steel, Cat 4 upstream road freight, Cat 6 business travel).",
		"methodology_description":        "Emissions are calculated from metered activity records multiplied by pinned IPCC AR6, China MEE regional grid, DEFRA, and US EPA eGRID emission factors on an AR6 100-year GWP basis.",
		"emissions_summary":              "Total FY2025 emissions equal 949.53 tCO2e across all scopes, led by purchased electricity at Suzhou Plant and Shanghai HQ (Scope 2, 844.83 tCO2e) followed by Scope 3 (60.58 tCO2e) and Scope 1 direct combustion (44.13 tCO2e).",
		"significant_changes":            "2025 is established as the organization's base year; no structural recalculations apply.",
		"observations":                   "Utility bills, fuel card statements, and supplier disclosures remain linked per row with SHA-256 evidence digests.",
	}
	if isZh {
		isoReplyMap = map[string]string{
			"boundary_description":           "华东精密制造有限公司遵循 ISO 14064-1:2018 标准，采用运营控制权法界定组织边界，全面覆盖报告期内的苏州生产基地与上海研发总部两处运营场所，纳入 100% 运营排放权责。",
			"reporting_boundary_description": "2025 年度报告边界覆盖范围一（厂区天然气锅炉、自有柴油车队）、范围二（外购电网电力）及重大范围三类别（外购钢材与紧固件、上游公路货运与员工航空差旅）。",
			"methodology_description":        "本盘查严格依据活动水平数据乘以已冻结快照的排放因子开展量化，采用中国生态环境部区域电网因子、IPCC AR6、DEFRA 与 US EPA eGRID 权威因子库，并统一按照 IPCC 第六次评估报告（AR6）100 年期全球变暖潜能值（GWP100）口径折算为二氧化碳当量，全程保留逐行凭证溯源。",
			"emissions_summary":              "2025 年度企业温室气体排放总计 949.53 tCO2e。按范围划分，外购电力导致的间接排放占比最高（范围二 844.83 tCO2e，主要来自苏州生产基地连续生产用电），其次为范围三供应链与差旅排放（60.58 tCO2e）及范围一直接燃料燃烧排放（44.13 tCO2e）。",
			"significant_changes":            "2025 年度已设定为组织盘查基准年，本期无组织边界调整、设施剥离或方法学重算等重大结构变更事项。",
			"observations":                   "全部活动数据均保留电费发票、天然气账单、台账原表及供应商披露表等电子凭证与 SHA-256 摘要，并已通过计算快照锁定所采用的排放因子，全面满足第三方核查追溯要求。",
		}
	}
	isoRaw, _ := json.Marshal(isoReplyMap)
	isoArgs, _ := json.Marshal(string(isoRaw))

	marshalRecs := func(items []map[string]any) string {
		raw, _ := json.Marshal(map[string]any{"recommendations": items})
		encoded, _ := json.Marshal(string(raw))
		return string(encoded)
	}

	elecReason := "Matches East China grid electricity in kWh."
	elecFallback1 := "China national grid fallback in kWh."
	elecFallback2 := "Regional China grid alternative."
	dieselReason := "Matches mobile diesel combustion in liters (L)."
	dieselFallback := "Mobile gasoline combustion fallback in liters."
	dieselFallback2 := "Mobile jet fuel combustion fallback in liters."
	gasReason := "Matches pipeline natural gas combustion in m3."
	gasFallback1 := "Compressed natural gas combustion in m3."
	gasFallback2 := "Stationary LPG combustion fallback."
	if isZh {
		elecReason = "匹配华东区域电网电力因子（单位 kWh）。"
		elecFallback1 = "匹配中国国家电网平均因子（单位 kWh）。"
		elecFallback2 = "区域电网备选排放因子。"
		dieselReason = "匹配移动源柴油燃烧排放因子（单位 L）。"
		dieselFallback = "移动源汽油燃烧备选因子（单位 L）。"
		dieselFallback2 = "航空煤油燃烧备选因子（单位 L）。"
		gasReason = "匹配管道天然气燃烧排放因子（单位 m3）。"
		gasFallback1 = "匹配压缩天然气燃烧排放因子（单位 m3）。"
		gasFallback2 = "固定源液化石油气备选因子。"
	}

	efElecArgs := marshalRecs([]map[string]any{
		{"factor_code": "electricity.grid.cn.east.2024", "year": 2024, "source": "MEE_China", "geography": "CN-East", "dataset_version": "2024.q4", "reasoning": elecReason},
		{"factor_code": "electricity.grid.cn.national.2024", "year": 2024, "source": "MEE_China", "geography": "CN", "dataset_version": "2024.q4", "reasoning": elecFallback1},
		{"factor_code": "electricity.grid.cn.north.2024", "year": 2024, "source": "MEE_China", "geography": "CN-North", "dataset_version": "2024.q4", "reasoning": elecFallback2},
	})
	efDieselArgs := marshalRecs([]map[string]any{
		{"factor_code": "fuel.diesel.combustion.global.2024", "year": 2024, "source": "IPCC_AR6", "geography": "GLOBAL", "dataset_version": "2024.v1", "reasoning": dieselReason},
		{"factor_code": "fuel.gasoline.combustion.global.2024", "year": 2024, "source": "IPCC_AR6", "geography": "GLOBAL", "dataset_version": "2024.v1", "reasoning": dieselFallback},
		{"factor_code": "fuel.jet_a.combustion", "year": 2024, "source": "IPCC_AR6", "geography": "GLOBAL", "dataset_version": "2024.v2", "reasoning": dieselFallback2},
	})
	efGasArgs := marshalRecs([]map[string]any{
		{"factor_code": "fuel.natural_gas.combustion.global.2024", "year": 2024, "source": "IPCC_AR6", "geography": "GLOBAL", "dataset_version": "2024.v1", "reasoning": gasReason},
		{"factor_code": "fuel.cng.combustion", "year": 2024, "source": "IPCC_AR6", "geography": "GLOBAL", "dataset_version": "2024.v2", "reasoning": gasFallback1},
		{"factor_code": "fuel.lpg.combustion.global.2024", "year": 2024, "source": "IPCC_AR6", "geography": "GLOBAL", "dataset_version": "2024.v1", "reasoning": gasFallback2},
	})

	return marketingFixture{
		dbPath:             dbPath,
		utilityDocID:       docUtil.ID,
		primaryQuestID:     primaryQID,
		receivedInboundID:  receivedID,
		period2025ID:       period2025.ID,
		importCSVPath:      csvPath,
		importCSVName:      csvName,
		isoReportArguments: string(isoArgs),
		efElecArguments:    efElecArgs,
		efDieselArguments:  efDieselArgs,
		efGasArguments:     efGasArgs,
	}
}
