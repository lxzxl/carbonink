package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/docview"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/xuri/excelize/v2"
)

// TestGenerateAndExportReportThroughUI configures an OpenAI-compatible
// endpoint, generates an ISO narrative from the fixture inventory, previews
// it, and exports both the PDF and the Excel appendix.
func TestGenerateAndExportReportThroughUI(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))

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
	var saved []string
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	ui.SaveFile = func(req core.SaveRequest) string {
		saved = append(saved, req.Name)
		if strings.HasSuffix(req.Name, ".xlsx") {
			return xlsxPath
		}
		return pdfPath
	}
	configureLLMEndpoint(t, ui, srv.URL)

	ui.Press("id:nav:reports")
	ui.WaitFor("id:reports-generate", 3*time.Second)
	ui.Press("id:reports-generate")
	ui.WaitFor("text:"+boundary, 15*time.Second)
	ui.WaitFor("text:Total CO2e", 3*time.Second)

	ui.Press("id:reports-export-both")
	ui.WaitFor("text:Exported Excel → "+xlsxPath, 10*time.Second)
	if calls != 1 {
		t.Fatalf("model calls = %d, want 1", calls)
	}
	if len(saved) != 2 || !strings.HasSuffix(saved[0], ".pdf") ||
		!strings.HasSuffix(saved[1], ".xlsx") {
		t.Fatalf("saved = %v", saved)
	}

	pdf, err := os.ReadFile(pdfPath)
	if err != nil {
		t.Fatal(err)
	}
	text, _, err := docview.PDFText(pdf)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{boundary, "测试组织", "Scope 2 (kg CO2e)", "120.00"} {
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
