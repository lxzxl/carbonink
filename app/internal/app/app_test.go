package app

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/xuri/excelize/v2"
)

func TestMain(m *testing.M) {
	os.Setenv("CARBONINK_NO_LEGACY_IMPORT", "1")
	nsgotest.Main(m)
}

// TestActivitiesFromWorkspace opens a fixture workspace and proves the table
// renders its row, not placeholder data.
func TestActivitiesFromWorkspace(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("text:上海工厂", 2*time.Second)
	ui.WaitFor("text:外购电力", 2*time.Second)
	ui.WaitFor("text:240.00", 2*time.Second)
	ui.WaitFor("text:120.00", 2*time.Second)
}

// TestSettingsSwitchThemeAndLanguage proves the settings screen persists a
// choice and that labels, including the sidebar, follow the new locale.
func TestSettingsSwitchThemeAndLanguage(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("text:Appearance", 2*time.Second)
	ui.Press("text:Dark")
	ui.WaitFor("text:Current: Dark", 2*time.Second)
	ui.Press("text:中文")
	ui.WaitFor("text:外观", 2*time.Second)
	ui.WaitFor("text:活动数据", 2*time.Second)
}

// TestCommandPalette opens the palette, searches, and runs a screen command.
func TestCommandPalette(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:open-command-palette")
	ui.WaitFor("id:command-palette", 2*time.Second)
	ui.Type("id:command-palette >> role:textbox", "settings")
	ui.Key("enter")
	ui.WaitFor("text:Appearance", 2*time.Second)
}

// TestCreateActivityThroughUI proves the add-activity dialog pins an EF and
// writes a row the ledger immediately renders.
func TestCreateActivityThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)
	ui.Type("id:activity-amount", "100")
	ui.Type("id:activity-unit", "kWh")
	ui.Press("id:activity-save")
	ui.WaitFor("text:100.00", 3*time.Second)
}

// TestEditActivityThroughUI selects a ledger row, edits its amount and
// rebinds its emission factor, then proves the audit log records the change.
func TestEditActivityThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:data-table-hit")
	ui.Key("down")
	ui.Press("id:activity-edit")
	ui.WaitFor("id:activity-edit-dialog", 2*time.Second)
	ui.Clear("id:activity-edit-amount")
	ui.Type("id:activity-edit-amount", "480")
	ui.Press("id:activity-edit-ef")
	ui.Press("id:activity-edit-ef-0")
	ui.Press("id:activity-edit-save")
	ui.WaitFor("text:268.13", 3*time.Second)
	ui.Press("id:nav:audit")
	ui.WaitFor("text:Rebind emission factor", 3*time.Second)
}

// TestImportActivitiesThroughUI picks a CSV ledger, auto-maps it, confirms one
// EF for the group, and proves both rows land in the ledger.
func TestImportActivitiesThroughUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	csvPath := filepath.Join(t.TempDir(), "ledger.csv")
	const ledger = "Source,Description,Amount,Unit,Date\n" +
		"外购电力,Office power,10,kWh,2025-03-01\n" +
		"外购电力,Office power,20,kWh,2025-03-01\n"
	if err := os.WriteFile(csvPath, []byte(ledger), 0o644); err != nil {
		t.Fatal(err)
	}
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "ledger.csv", Path: csvPath}}
	}
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-import")
	ui.WaitFor("id:activity-import-dialog", 2*time.Second)
	ui.Press("id:activity-import-pick")
	ui.WaitFor("text:2 data rows", 3*time.Second)
	ui.Press("id:activity-import-next")
	ui.WaitFor("text:Confirm emission factors by group", 3*time.Second)
	ui.Press("id:activity-import-ef-0")
	ui.Press("id:activity-import-ef-0-0")
	ui.Press("id:activity-import-run")
	ui.WaitFor("text:2 rows imported", 3*time.Second)
	ui.Press("id:activity-import-done")
	ui.WaitFor("text:5.59", 3*time.Second)
	ui.WaitFor("text:11.17", 3*time.Second)

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var documents, links, distinctDocuments int
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM document WHERE filename = 'ledger.csv' AND mime_type = 'text/csv'`).
		Scan(&documents); err != nil {
		t.Fatal(err)
	}
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*), COUNT(DISTINCT document_id) FROM evidence_attachment`).
		Scan(&links, &distinctDocuments); err != nil {
		t.Fatal(err)
	}
	if documents != 1 || links != 2 || distinctDocuments != 1 {
		t.Errorf("archived ledger = %d, evidence links = %d across %d documents",
			documents, links, distinctDocuments)
	}

	ui.Press("id:nav:documents")
	ui.WaitFor("text:ledger.csv", 3*time.Second)
	ui.Press("text:Details")
	ui.WaitFor("id:documents-detail-dialog", 3*time.Second)
	ui.WaitFor("text:2 linked", 3*time.Second)
	ui.WaitFor("id:documents-detail-evidence-1", 3*time.Second)
	ui.WaitFor("text:Text extraction is available for PDFs.", 3*time.Second)
	ui.Press("id:documents-detail-close")
}

// TestImportActivitiesWithManualMapping starts from a ledger whose headers
// auto-map only partially, remaps the remaining columns, and imports the row.
func TestImportActivitiesWithManualMapping(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	csvPath := filepath.Join(t.TempDir(), "ledger.csv")
	const ledger = "Facility,Memo,Qty,UOM,When\n" +
		"外购电力,Office power,10,kWh,2025-03-01\n"
	if err := os.WriteFile(csvPath, []byte(ledger), 0o644); err != nil {
		t.Fatal(err)
	}
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "ledger.csv", Path: csvPath}}
	}
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-import")
	ui.WaitFor("id:activity-import-dialog", 2*time.Second)
	ui.Press("id:activity-import-pick")
	ui.WaitFor("text:1 data rows", 3*time.Second)
	ui.WaitFor("text:0 valid", 2*time.Second)

	remap := func(field string, option int) {
		ui.Press("id:activity-import-map-" + field)
		selector := "id:activity-import-map-" + field + "-" + strconv.Itoa(option)
		ui.WaitFor(selector, 2*time.Second)
		ui.Press(selector)
	}
	remap("description", 2)
	remap("unit", 4)
	remap("occurred_at_start", 5)
	ui.WaitFor("text:1 valid", 3*time.Second)

	ui.Press("id:activity-import-next")
	ui.WaitFor("text:Confirm emission factors by group", 3*time.Second)
	ui.Press("id:activity-import-ef-0")
	ui.Press("id:activity-import-ef-0-0")
	ui.Press("id:activity-import-run")
	ui.WaitFor("text:1 rows imported", 3*time.Second)
	ui.Press("id:activity-import-done")
	ui.WaitFor("text:5.59", 3*time.Second)
}

// TestImportActivitiesCreatesMissingSource proves an unresolved ledger name
// can be turned into a real emission source without leaving the wizard.
func TestImportActivitiesCreatesMissingSource(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	csvPath := filepath.Join(t.TempDir(), "ledger.csv")
	const ledger = "Source,Description,Amount,Unit,Date\n" +
		"New boiler,Natural gas,10,kWh,2025-03-01\n"
	if err := os.WriteFile(csvPath, []byte(ledger), 0o644); err != nil {
		t.Fatal(err)
	}
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "ledger.csv", Path: csvPath}}
	}
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-import")
	ui.WaitFor("id:activity-import-dialog", 2*time.Second)
	ui.Press("id:activity-import-pick")
	ui.WaitFor("text:1 data rows", 3*time.Second)
	ui.WaitFor("id:activity-import-source-create-New boiler", 3*time.Second)

	ui.Press("id:activity-import-source-create-New boiler")
	ui.WaitFor("id:activity-import-create-save", 2*time.Second)
	ui.Press("id:activity-import-create-scope")
	ui.WaitFor("id:activity-import-create-scope-1", 2*time.Second)
	ui.Press("id:activity-import-create-scope-1")
	ui.Type("id:activity-import-create-category", "electricity.grid")
	ui.Press("id:activity-import-create-save")
	ui.WaitFor("text:Matched existing", 3*time.Second)

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var scope int
	var category string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT scope, category FROM emission_source WHERE name = 'New boiler'`).
		Scan(&scope, &category); err != nil {
		t.Fatal(err)
	}
	if scope != 2 || category != "electricity.grid" {
		t.Errorf("created source scope = %d, category = %q", scope, category)
	}

	ui.Press("id:activity-import-next")
	ui.WaitFor("id:activity-import-ef-0", 3*time.Second)
	ui.Press("id:activity-import-ef-0")
	ui.Press("id:activity-import-ef-0-0")
	ui.Press("id:activity-import-run")
	ui.WaitFor("text:1 rows imported", 3*time.Second)
	ui.Press("id:activity-import-done")
	ui.WaitFor("text:5.59", 3*time.Second)
}

// TestImportEFLibraryThroughUI downloads the template, imports a factor
// library from CSV, and proves the new factor reaches the activity picker.
func TestImportEFLibraryThroughUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	dir := t.TempDir()
	csvPath := filepath.Join(dir, "factors.csv")
	const library = "name_en,scope,year,input_unit,co2e_kg_per_unit,category,geography,gwp_basis\n" +
		"Test factor,2,2024,kWh,0.42,electricity.grid,CN,AR6\n"
	if err := os.WriteFile(csvPath, []byte(library), 0o644); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(dir, "template.xlsx")
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "factors.csv", Path: csvPath}}
	}
	ui.SaveFile = func(core.SaveRequest) string { return templatePath }

	ui.Press("id:nav:sources")
	ui.WaitFor("id:ef-library-import", 3*time.Second)
	ui.Press("id:ef-library-import")
	ui.WaitFor("id:ef-import-dialog", 2*time.Second)
	ui.Press("id:ef-template")
	ui.WaitFor("text:Template saved", 3*time.Second)
	workbook, err := excelize.OpenFile(templatePath)
	if err != nil {
		t.Fatalf("template: %v", err)
	}
	headers, err := workbook.GetRows(workbook.GetSheetName(0))
	if err != nil {
		t.Fatalf("template rows: %v", err)
	}
	if index, err := workbook.GetSheetIndex("说明 notes"); err != nil || index < 0 {
		t.Errorf("template is missing the notes sheet")
	}
	workbook.Close()
	if len(headers) == 0 || !strings.Contains(strings.Join(headers[0], ","), "co2e_kg_per_unit") {
		t.Fatalf("template headers = %v", headers)
	}

	ui.Press("id:ef-import-pick")
	ui.WaitFor("text:1 rows", 3*time.Second)
	ui.Type("id:ef-import-name", "Test library")
	ui.Press("id:ef-import-run")
	ui.WaitFor("text:Imported 1 factors", 3*time.Second)
	ui.Press("id:ef-import-cancel")
	ui.WaitFor("text:Test library", 3*time.Second)
	ui.Press("id:ef-library-browse-Test library")
	ui.WaitFor("id:ef-library-browse-dialog", 2*time.Second)
	ui.WaitFor("text:Test factor", 3*time.Second)
	ui.WaitFor("text:1 of 1", 2*time.Second)
	ui.Type("id:ef-browse-search", "zzz")
	ui.WaitFor("text:No factors match this search.", 3*time.Second)
	ui.Clear("id:ef-browse-search")
	ui.Type("id:ef-browse-search", "Test")
	ui.WaitFor("text:Test factor", 3*time.Second)
	ui.Press("id:ef-browse-close")

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var count int
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM emission_factor WHERE source = 'user:Test library'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("imported factors = %d, want 1", count)
	}

	ui.Press("id:nav:activities")
	ui.WaitFor("id:activities-table", 3*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)
	ui.Press("id:activity-ef")
	ui.WaitFor("id:activity-ef >> text:EF-00001", 3*time.Second)
	ui.Press("id:activity-ef-0")
	ui.Press("id:activity-cancel")

	ui.Press("id:nav:sources")
	ui.WaitFor("text:Delete library", 3*time.Second)
	ui.Press("text:Delete library")
	ui.WaitFor("id:ef-library-delete-dialog", 2*time.Second)
	ui.Press("id:ef-library-delete-confirm")
	ui.WaitForGone("text:Test library", 3*time.Second)
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM emission_factor WHERE source = 'user:Test library'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("factors after delete = %d, want 0", count)
	}
}

// TestAuditExportThroughUI writes the filtered audit log to CSV through the
// real save path.
func TestAuditExportThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	savePath := filepath.Join(t.TempDir(), "audit.csv")
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.SaveFile = func(core.SaveRequest) string { return savePath }
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)
	ui.Type("id:activity-amount", "100")
	ui.Type("id:activity-unit", "kWh")
	ui.Press("id:activity-save")
	ui.WaitFor("text:100.00", 3*time.Second)
	ui.Press("id:nav:audit")
	ui.WaitFor("text:Activity data created", 3*time.Second)
	ui.Press("id:audit-export")
	ui.WaitFor("text:Exported 1 rows", 3*time.Second)
	data, err := os.ReadFile(savePath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "occurred_at,event_kind,payload") ||
		!strings.Contains(text, "activity_data.created") {
		t.Errorf("csv = %s", text)
	}
}

// TestCreateSourceThroughUI proves the Sources page can create a source from
// the taxonomy and that the derived EF category is stored with it.
func TestCreateSourceThroughUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:sources")
	ui.WaitFor("id:source-add", 2*time.Second)
	ui.Press("id:source-add")
	ui.WaitFor("id:source-add-dialog", 2*time.Second)
	ui.Type("id:source-add-name", "Diesel fleet")
	ui.Press("id:source-add-category-select")
	ui.WaitFor("id:source-add-category-select-1", 2*time.Second)
	ui.Press("id:source-add-category-select-1")
	ui.Press("id:source-add-save")
	ui.WaitFor("text:Diesel fleet", 3*time.Second)
	ui.WaitFor("text:Mobile combustion", 2*time.Second)

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var category, path string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT category, ghg_protocol_path FROM emission_source WHERE name = 'Diesel fleet'`).
		Scan(&category, &path); err != nil {
		t.Fatal(err)
	}
	if category != "fuel.mobile" || path != "scope1.mobile_combustion" {
		t.Errorf("source category = %q, path = %q", category, path)
	}
}

// TestCreateSourceWithCustomCategory keeps the non-standard escape hatch: a
// value outside the taxonomy still stores both fields verbatim.
func TestCreateSourceWithCustomCategory(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:sources")
	ui.WaitFor("id:source-add", 2*time.Second)
	ui.Press("id:source-add")
	ui.WaitFor("id:source-add-dialog", 2*time.Second)
	ui.Type("id:source-add-name", "Custom source")
	ui.Press("id:source-add-category-select")
	ui.WaitFor("id:source-add-category-select-5", 2*time.Second)
	ui.Press("id:source-add-category-select-5")
	ui.Type("id:source-add-category", "fuel.custom")
	ui.Type("id:source-add-path", "scope1.custom")
	ui.Press("id:source-add-save")
	ui.WaitFor("text:Custom source", 3*time.Second)

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var category, path string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT category, ghg_protocol_path FROM emission_source WHERE name = 'Custom source'`).
		Scan(&category, &path); err != nil {
		t.Fatal(err)
	}
	if category != "fuel.custom" || path != "scope1.custom" {
		t.Errorf("custom source category = %q, path = %q", category, path)
	}
}

// TestUploadDocumentsThroughUI picks the same PDF twice and proves the
// Documents screen lists it once while the store keeps a content-addressed
// copy under the app's data directory.
func TestUploadDocumentsThroughUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	fixture, err := os.ReadFile(filepath.Join("..", "..", "internal", "spike", "fixtures", "pdf", "two-page-text.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	pdfPath := filepath.Join(t.TempDir(), "bill.pdf")
	if err := os.WriteFile(pdfPath, fixture, 0o644); err != nil {
		t.Fatal(err)
	}
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{
			{Name: "bill.pdf", Path: pdfPath},
			{Name: "bill-copy.pdf", Path: pdfPath},
		}
	}
	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-upload", 3*time.Second)
	ui.WaitFor("text:No documents yet", 2*time.Second)
	ui.Press("id:documents-upload")
	ui.WaitFor("text:bill.pdf", 5*time.Second)
	ui.WaitFor("text:Uploaded 2 · 0 failed", 3*time.Second)
	ui.Press("text:Details")
	ui.WaitFor("id:documents-detail-dialog", 3*time.Second)
	ui.WaitFor("text:Test content for Phase 1c pdfToImages.", 10*time.Second)
	ui.WaitFor("text:2 pages", 3*time.Second)
	ui.WaitFor("text:No activities are linked to this file yet.", 3*time.Second)
	ui.Press("id:documents-detail-close")
	ui.Press("text:Preview")
	ui.WaitFor("id:documents-preview-dialog", 5*time.Second)
	ui.WaitFor("text:Page 1 of 2", 10*time.Second)
	ui.Press("id:documents-preview-next")
	ui.WaitFor("text:Page 2 of 2", 10*time.Second)
	ui.Press("id:documents-preview-close")

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var count int
	var storagePath, sha string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT COUNT(*), MIN(storage_path), MIN(sha256) FROM document`).
		Scan(&count, &storagePath, &sha); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("documents = %d, want 1", count)
	}
	if !strings.HasPrefix(storagePath, "documents/") || !strings.HasSuffix(storagePath, ".pdf") {
		t.Errorf("storage path = %q", storagePath)
	}
	if len(sha) != 64 {
		t.Errorf("sha256 = %q", sha)
	}
}

// TestPreviewImageThroughUI proves the preview dialog renders an image
// document's pixels directly, without a PDF round trip.
func TestPreviewImageThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	photoPath := filepath.Join(t.TempDir(), "meter.png")
	photo := image.NewRGBA(image.Rect(0, 0, 8, 6))
	for y := 0; y < 6; y++ {
		for x := 0; x < 8; x++ {
			photo.Set(x, y, color.RGBA{R: uint8(x * 20), G: uint8(y * 30), B: 90, A: 255})
		}
	}
	file, err := os.Create(photoPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, photo); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "meter.png", Path: photoPath}}
	}
	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-upload", 3*time.Second)
	ui.Press("id:documents-upload")
	ui.WaitFor("text:meter.png", 5*time.Second)
	ui.Press("text:Preview")
	ui.WaitFor("id:documents-preview-dialog", 5*time.Second)
	ui.WaitFor("id:documents-preview-image", 5*time.Second)
	ui.Press("id:documents-preview-close")
}

// TestRunDocumentExtractionThroughUI configures an OpenAI-compatible endpoint,
// uploads a text-layer PDF, runs the china_utility stage, and proves the
// staged fields land in the detail dialog before being discarded.
func TestRunDocumentExtractionThroughUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	fixture, err := os.ReadFile(filepath.Join("..", "..", "internal", "spike", "fixtures", "pdf", "two-page-text.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	pdfPath := filepath.Join(t.TempDir(), "bill.pdf")
	if err := os.WriteFile(pdfPath, fixture, 0o644); err != nil {
		t.Fatal(err)
	}

	const reply = `{"doc_type":"china_utility","supplier_name":"国网北京市电力公司",` +
		`"account_no":"1234567890","amount_kwh":523.5,"amount_yuan":312.7,` +
		`"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}`
	arguments, err := json.Marshal(reply)
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", fmt.Sprintf(
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"save_extraction","arguments":%s}}]}}]}`,
			arguments))
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "bill.pdf", Path: pdfPath}}
	}
	ui.Press("id:nav:settings")
	ui.WaitFor("id:settings-llm-base-url", 3*time.Second)
	ui.Clear("id:settings-llm-base-url")
	ui.Type("id:settings-llm-base-url", srv.URL)
	ui.Clear("id:settings-llm-model")
	ui.Type("id:settings-llm-model", "test-model")
	ui.Press("id:settings-llm-save")
	ui.WaitFor("text:Settings saved", 3*time.Second)

	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-upload", 3*time.Second)
	ui.Press("id:documents-upload")
	ui.WaitFor("text:bill.pdf", 5*time.Second)
	ui.Press("text:Details")
	ui.WaitFor("id:documents-detail-dialog", 3*time.Second)
	ui.WaitFor("text:AI extraction", 3*time.Second)
	ui.Press("id:documents-extraction-run")
	ui.WaitFor("text:Extraction ready for review", 15*time.Second)
	ui.WaitFor("text:国网北京市电力公司", 5*time.Second)
	ui.WaitFor("text:523.5", 5*time.Second)
	ui.WaitFor("text:Needs review", 3*time.Second)
	ui.Press("id:documents-extraction-confirm")
	ui.WaitFor("id:documents-extraction-activity-dialog", 3*time.Second)
	ui.Press("id:documents-extraction-activity-save")
	ui.WaitFor("text:Extraction confirmed", 5*time.Second)
	ui.WaitFor("text:Confirmed", 3*time.Second)
	ui.WaitFor("text:1 linked", 3*time.Second)
	if calls.Load() != 1 {
		t.Errorf("model calls = %d, want 1", calls.Load())
	}

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var status, reviewed string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT status, coalesce(reviewed_by_user_at, '') FROM extraction`).Scan(&status, &reviewed); err != nil {
		t.Fatal(err)
	}
	if status != store.ExtractionParsed || reviewed == "" {
		t.Fatalf("extraction = %s, reviewed = %q", status, reviewed)
	}
	var activities, links int
	if err := check.DB().QueryRowContext(ctx,
		`SELECT (SELECT count(*) FROM activity_data), (SELECT count(*) FROM evidence_attachment)`).
		Scan(&activities, &links); err != nil {
		t.Fatal(err)
	}
	if activities != 2 || links != 1 {
		t.Fatalf("activities = %d, evidence links = %d", activities, links)
	}
}

func fixtureDB(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "fixture.sqlite")
	s, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	conn, err := s.DB().Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	const ts = "2025-01-15T00:00:00Z"
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO organization (id, singleton_key, name_zh, country_code, boundary_kind, created_at, updated_at)
		VALUES ('org', 1, '测试组织', 'CN', 'operational_control', ?, ?)`, ts, ts)
	exec(`INSERT INTO site (id, organization_id, name_zh, country_code, created_at, updated_at)
		VALUES ('site', 'org', '上海工厂', 'CN', ?, ?)`, ts, ts)
	exec(`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
		VALUES ('period', 'org', 2025, 'annual', '2025-01-01', '2025-12-31', ?)`, ts)
	exec(`INSERT INTO emission_source (id, site_id, name, scope, category)
		VALUES ('src', 'site', '外购电力', 2, 'electricity.grid')`)
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
		scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
		VALUES ('ef', 2024, 'MEE', 'CN', '2024', 2, 'kWh', 0.5, 'AR6', ?, 'seed')`, ts)
	exec(`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
		occurred_at_start, occurred_at_end, amount, unit,
		ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
		computed_co2e_kg, computed_at, created_at, updated_at)
		VALUES ('act', 'site', 'src', 'period', ?, ?, 240.0, 'kWh',
		'ef', 2024, 'MEE', 'CN', '2024', 120.0, ?, ?, ?)`, ts, ts, ts, ts, ts)
	return path
}
