package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/inbound"
	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/xuri/excelize/v2"
)

func TestSupplierDisclosureLifecycle(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ctx := context.Background()

	seed, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	overdueSupplier, err := seed.CreateSupplier(ctx, "Overdue Supplier", "", "late@example.com")
	if err != nil {
		t.Fatal(err)
	}
	service := &inbound.Service{Store: seed}
	overdueID, _, err := service.CreateDraft(ctx, inbound.CreateRequest{
		SupplierID: overdueSupplier.ID, ReportingYear: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ExportBlank(ctx, overdueID); err != nil {
		t.Fatal(err)
	}
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	if _, err := seed.DB().ExecContext(ctx,
		`UPDATE questionnaire SET due_date = ? WHERE id = ?`, yesterday, overdueID); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	exportPath := filepath.Join(t.TempDir(), "inbound-filled.xlsx")
	ui.SaveFile = func(nsgotest.FileSave) string { return exportPath }
	var opened []string
	ui.OpenURL = func(link string) bool {
		opened = append(opened, link)
		return true
	}

	ui.Press("id:nav:supplier-disclosures")
	ui.WaitFor("id:supplier-disclosures-new", 5*time.Second)
	ui.WaitFor("text:Overdue Supplier", 5*time.Second)
	ui.WaitFor(`text:"Overdue"`, 5*time.Second)

	ui.Press("id:supplier-disclosures-new")
	ui.WaitFor("id:supplier-disclosures-wizard-dialog", 3*time.Second)
	ui.Type("id:supplier-disclosures-wizard-name", "Fresh Steel")
	ui.Type("id:supplier-disclosures-wizard-email", "buyer@fresh.example")
	ui.Press("id:supplier-disclosures-wizard-submit")
	ui.WaitFor("text:Draft created with 7 questions.", 10*time.Second)
	ui.WaitFor("text:Fresh Steel", 5*time.Second)

	ui.Press("text:Fresh Steel")
	ui.WaitFor("id:supplier-disclosures-detail-dialog", 3*time.Second)
	ui.Press("id:supplier-disclosures-export")
	ui.WaitFor("text:Exported workbook → "+exportPath, 15*time.Second)

	book, err := excelize.OpenFile(exportPath)
	if err != nil {
		t.Fatal(err)
	}
	for ref, value := range map[string]string{
		"metadata!B5": "Fresh Steel Co.",
		"tier2!B5":    "1200000",
		"tier2!B7":    "mass-based",
		"tier2!B9":    "43000",
	} {
		sheet, address, _ := strings.Cut(ref, "!")
		if err := book.SetCellValue(sheet, address, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := book.Save(); err != nil {
		t.Fatal(err)
	}
	_ = book.Close()

	ui.PickFiles = func(nsgotest.FilePick) []core.File {
		return []core.File{{Name: filepath.Base(exportPath), Path: exportPath}}
	}
	ui.Press("id:supplier-disclosures-import")
	ui.WaitFor("id:supplier-disclosures-review-dialog", 15*time.Second)
	ui.WaitFor("id:supplier-disclosures-review-accept-tier2.3", 5*time.Second)
	ui.Press("id:supplier-disclosures-review-ingest")
	ui.WaitFor("text:Ingested 43.00 tCO2e into the inventory.", 15*time.Second)
	ui.Press("id:supplier-disclosures-detail-close")
	ui.WaitForGone("id:supplier-disclosures-detail-dialog", 3*time.Second)
	ui.WaitFor(`text:"Ingested"`, 5*time.Second)
	ui.Press("text:Fresh Steel")
	ui.WaitFor("id:supplier-disclosures-detail-dialog", 3*time.Second)
	ui.Press("id:supplier-disclosures-remind")
	ui.WaitFor("id:supplier-disclosures-remind-dialog", 3*time.Second)
	ui.Press("id:supplier-disclosures-remind-send")
	ui.WaitForGone("id:supplier-disclosures-remind-dialog", 3*time.Second)
	if len(opened) != 1 || !strings.HasPrefix(opened[0], "mailto:buyer@fresh.example") ||
		!strings.Contains(opened[0], "2025") {
		t.Fatalf("opened URLs = %v", opened)
	}
	ui.Press("id:supplier-disclosures-detail-close")
	ui.WaitForGone("id:supplier-disclosures-detail-dialog", 3*time.Second)

	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	activities, err := check.Activities(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	var ingestedID, ingestedQuestionnaireID string
	for _, activity := range activities {
		if activity.CO2eKg == 43000 && activity.Unit == "kgCO2e" &&
			strings.Contains(activity.Notes, "Fresh Steel") {
			ingestedID = activity.ID
			ingestedQuestionnaireID = activity.InboundQuestionnaireID
		}
	}
	if ingestedID == "" || ingestedQuestionnaireID == "" {
		t.Fatalf("activities = %+v", activities)
	}
	ui.Press("id:nav:activities")
	ui.WaitFor("id:activity-supplier-"+ingestedID, 5*time.Second)
	ui.Press("id:activity-supplier-" + ingestedID)
	ui.WaitFor("id:supplier-disclosures-detail-dialog", 5*time.Second)
	ui.WaitFor(`id:supplier-disclosures-detail-dialog >> text:"Fresh Steel · 2025"`, 3*time.Second)
	var audited int
	if err := check.DB().QueryRowContext(ctx,
		`SELECT count(*) FROM audit_event WHERE event_kind = 'inbound_questionnaire.ingested'`).
		Scan(&audited); err != nil || audited != 1 {
		t.Fatalf("audit rows = %d, %v", audited, err)
	}
	_ = os.Remove(exportPath)
}
