package app

import (
	"archive/zip"
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

	"app.carbonink.desktop/internal/docview"
	"app.carbonink.desktop/internal/report"
	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/xuri/excelize/v2"
)

// TestGenerateAndExportReportThroughUI configures an OpenAI-compatible
// endpoint, generates an ISO narrative from the fixture inventory, previews
// it, and exports both the PDF and the Excel appendix.
func TestGenerateAndExportReportThroughUI(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	db, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.SetSetting(context.Background(), report.LogoSetting, testLogoDataURL(t)); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	const boundary = "Boundary narrative from the model."
	reply, err := json.Marshal(map[string]string{
		"boundary_description": boundary + " The organizational boundary covers the" +
			" operating entity and its single active site under the operational control approach.",
		"reporting_boundary_description": "The reporting boundary covers the " +
			"operational control site for the year and includes purchased electricity consumed there.",
		"methodology_description": "Activity data is multiplied by pinned emission " +
			"factors on the AR6 GWP basis. Each factor is pinned to a dataset version so" +
			" the calculation can be reproduced, and no estimate or extrapolation is applied.",
		"emissions_summary": "Scope 2 totals 120.00 kgCO2e, all from purchased " +
			"electricity, and Scope 1 and Scope 3 have no activity data this period. The" +
			" inventory therefore reports the grid electricity factor as its single emission source.",
		"significant_changes": "No significant changes were assessed this period.",
		"observations":        "A single metered electricity account underpins the inventory.",
	})
	if err != nil {
		t.Fatal(err)
	}
	arguments, err := json.Marshal(string(reply))
	if err != nil {
		t.Fatal(err)
	}
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", fmt.Sprintf(
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"save_iso_report_narrative","arguments":%s}}]}}]}`,
			arguments))
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	dir := t.TempDir()
	xlsxPath := filepath.Join(dir, "report.xlsx")
	pdfPath := filepath.Join(dir, "report.pdf")
	zipPath := filepath.Join(dir, "deliverable.zip")
	var saved []string
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	ui.SaveFile = func(req nsgotest.FileSave) string {
		saved = append(saved, req.Name)
		if strings.HasSuffix(req.Name, ".xlsx") {
			return xlsxPath
		}
		if strings.HasSuffix(req.Name, ".zip") {
			return zipPath
		}
		return pdfPath
	}
	configureLLMEndpoint(t, ui, srv.URL)

	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-period-period", 3*time.Second)
	ui.Press("id:reports-period-period")
	ui.WaitFor("id:reports-generate", 3*time.Second)
	ui.Press("id:reports-generate")
	ui.WaitFor("text:"+boundary, 15*time.Second)
	ui.WaitFor("text:Total CO2e", 3*time.Second)
	ui.WaitFor("id:reports-logo", 3*time.Second)
	ui.WaitFor("id:guidance-report-export", 3*time.Second)
	ui.Press("id:guidance-report-export-next")
	ui.WaitFor("text:Export PDF and Excel", 2*time.Second)
	ui.Press("id:guidance-report-export-next")
	ui.WaitFor("text:Deliverable bundle", 2*time.Second)
	ui.Press("id:guidance-report-export-done")

	// Inline narrative edit must flow into the exported PDF.
	const editedBoundary = "Edited boundary narrative before export."
	ui.Clear("id:reports-narrative-boundary")
	ui.Type("id:reports-narrative-boundary", editedBoundary)

	ui.Press("id:reports-export-both")
	ui.WaitFor("text:Exported Excel → "+xlsxPath, 10*time.Second)
	if calls != 1 {
		t.Fatalf("model calls = %d, want 1", calls)
	}
	if len(saved) != 2 || !strings.HasSuffix(saved[0], ".pdf") ||
		!strings.HasSuffix(saved[1], ".xlsx") {
		t.Fatalf("saved = %v", saved)
	}

	// Client deliverable: report + appendix + readiness sheet + sha256
	// manifest, with a fresh sweep inside the bundle.
	ui.Press("id:reports-export-deliverable")
	ui.WaitFor("text:Deliverable bundle saved to "+zipPath, 15*time.Second)
	if len(saved) != 3 || !strings.HasSuffix(saved[2], ".zip") {
		t.Fatalf("saved after deliverable = %v", saved)
	}
	bundle, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	var manifest, readinessCSV string
	for _, file := range bundle.File {
		names[file.Name] = true
		switch file.Name {
		case "manifest.csv":
			manifest = readZipEntry(t, file)
		case "readiness.csv":
			readinessCSV = readZipEntry(t, file)
		}
	}
	bundle.Close()
	for _, want := range []string{"carbonink-iso-2025.pdf", "carbonink-iso-2025.xlsx",
		"readiness.csv", "manifest.csv"} {
		if !names[want] {
			t.Fatalf("bundle entries = %v", names)
		}
	}
	if !strings.Contains(manifest, `"report"`) || !strings.Contains(manifest, `"included"`) {
		t.Fatalf("manifest:\n%s", manifest)
	}
	if !strings.Contains(readinessCSV, `"No base year set"`) {
		t.Fatalf("readiness csv:\n%s", readinessCSV)
	}

	pdf, err := os.ReadFile(pdfPath)
	if err != nil {
		t.Fatal(err)
	}
	text, _, err := docview.PDFText(pdf)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{editedBoundary, "测试组织", "Scope 2 (kg CO2e)", "120.00"} {
		if !strings.Contains(text, want) {
			t.Fatalf("PDF text is missing %q:\n%s", want, text)
		}
	}

	book, err := excelize.OpenFile(xlsxPath)
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	if book.GetSheetList()[0] != "Summary" {
		t.Fatalf("sheets = %v", book.GetSheetList())
	}
	for cell, want := range map[string]string{
		"B1":  "测试组织",
		"B8":  "120.00",
		"B10": "120.00",
	} {
		got, err := book.GetCellValue("Summary", cell)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("Summary!%s = %q, want %q", cell, got, want)
		}
	}
	activities, err := book.GetRows("Activities")
	if err != nil {
		t.Fatal(err)
	}
	if len(activities) != 2 || activities[1][2] != "2" {
		t.Fatalf("activity rows = %v", activities)
	}
}

func readZipEntry(t *testing.T, file *zip.File) string {
	t.Helper()
	reader, err := file.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestCancelReportGeneration(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	started := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() {
		close(release)
		srv.Close()
	}()

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	configureLLMEndpoint(t, ui, srv.URL)

	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-period-period", 3*time.Second)
	ui.Press("id:reports-period-period")
	ui.WaitFor("id:reports-generate", 3*time.Second)
	ui.Press("id:reports-generate")
	<-started
	ui.WaitFor("id:reports-cancel", 3*time.Second)
	ui.Press("id:reports-cancel")
	ui.WaitFor("text:Report generation canceled.", 3*time.Second)
}
