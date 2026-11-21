package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"app.carbonink.desktop/internal/docview"
	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/xuri/excelize/v2"
)

func TestImportQuestionnaireAndEditAnswers(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)

	workbookPath := filepath.Join(t.TempDir(), "customer-questionnaire.xlsx")
	if err := os.WriteFile(workbookPath, questionnaireWorkbook(t), 0o644); err != nil {
		t.Fatal(err)
	}

	const reply = `{"questions":[
		{"raw_text":"Annual electricity use (kWh)","normalized_text":"annual electricity use",
		 "answer_cell_ref":"Data!B2","expected_unit":"kWh","sheet":"Data","question_row":2,
		 "question_kind":"numerical"},
		{"raw_text":"Describe your transition plan","normalized_text":"describe your transition plan",
		 "answer_cell_ref":"Data!B3","expected_unit":null,"sheet":"Data","question_row":3,
		 "question_kind":"narrative"}]}`
	arguments, err := json.Marshal(reply)
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	var agentCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := readAll(r)
		if bytes.Contains(body, []byte("save_questions")) {
			calls.Add(1)
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, "data: %s\n\n", fmt.Sprintf(
				`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"save_questions","arguments":%s}}]}}]}`,
				arguments))
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
			fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if agentCalls.Add(1) == 1 {
			fmt.Fprint(w, `{"choices":[{"message":{"content":"","tool_calls":[`+
				`{"id":"agent_1","type":"function","function":{"name":"list_activities",`+
				`"arguments":"{\"year\":2025}"}}]}}]}`)
			return
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"","tool_calls":[`+
			`{"id":"agent_2","type":"function","function":{"name":"submit_response",`+
			`"arguments":"{\"value\":\"120000\",\"unit\":\"kWh\",\"source_summary\":\"derived from act-1\"}"}}]}}]}`)
	}))
	defer srv.Close()

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: filepath.Base(workbookPath), Path: workbookPath}}
	}
	configureLLMEndpoint(t, ui, srv.URL)

	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:questionnaires-new", 3*time.Second)
	ui.Press("id:questionnaires-new")
	ui.WaitFor("id:questionnaires-wizard-dialog", 3*time.Second)
	ui.Type("id:questionnaires-wizard-customer", "ACME Ltd")
	ui.Clear("id:questionnaires-wizard-year")
	ui.Type("id:questionnaires-wizard-year", "2025")
	ui.Press("id:questionnaires-wizard-file")
	ui.WaitFor("text:customer-questionnaire.xlsx", 3*time.Second)
	ui.Press("id:questionnaires-wizard-submit")
	ui.WaitFor("text:ACME Ltd", 15*time.Second)
	ui.WaitFor("text:Parsed 2 questions (0 reused)", 5*time.Second)
	if calls.Load() != 1 {
		t.Fatalf("model calls = %d, want 1", calls.Load())
	}

	ui.Press("text:ACME Ltd")
	ui.WaitFor("id:questionnaires-detail-dialog", 3*time.Second)
	ui.WaitFor("text:Annual electricity use (kWh)", 3*time.Second)
	ui.WaitFor("text:Describe your transition plan", 3*time.Second)
	ui.WaitFor("text:0 of 2 answered", 3*time.Second)
	ui.Press("id:questionnaires-question-0")
	ui.Press("id:questionnaires-answer-generate")
	ui.WaitFor("text:Answer saved", 10*time.Second)
	ui.WaitFor("text:1 of 2 answered", 3*time.Second)
	if agentCalls.Load() != 2 {
		t.Fatalf("agent calls = %d, want 2", agentCalls.Load())
	}
	ui.Press("id:questionnaires-answer-finalize")
	ui.WaitFor("text:Answer saved", 5*time.Second)
	ui.WaitFor("text:1 of 2 answered", 3*time.Second)
	ui.Press("id:questionnaires-finalize-all")
	ui.WaitFor("text:2025 · Finalized", 5*time.Second)
	exportPath := filepath.Join(t.TempDir(), "filled.xlsx")
	ui.SaveFile = func(core.SaveRequest) string { return exportPath }
	ui.Press("id:questionnaires-export-xlsx")
	ui.WaitFor("text:1 answers written (0 drafts).", 5*time.Second)
	ui.WaitFor("text:2025 · Exported", 3*time.Second)
	pdfPath := filepath.Join(t.TempDir(), "filled.pdf")
	ui.SaveFile = func(core.SaveRequest) string { return pdfPath }
	ui.Press("id:questionnaires-export-pdf")
	ui.WaitFor("id:questionnaires-pdf-dialog", 3*time.Second)
	ui.Press("id:questionnaires-pdf-export")
	ui.WaitFor("text:Exported PDF → "+pdfPath, 15*time.Second)
	ui.Press("id:questionnaires-pdf-cancel")
	ui.WaitForGone("id:questionnaires-pdf-dialog", 3*time.Second)
	ui.Press("id:questionnaires-detail-close")
	ui.WaitForGone("id:questionnaires-detail-dialog", 3*time.Second)
	ui.WaitFor("text:Exported", 3*time.Second)
	exported, err := excelize.OpenFile(exportPath)
	if err != nil {
		t.Fatal(err)
	}
	defer exported.Close()
	if value, err := exported.GetCellValue("Data", "B2"); err != nil || value != "120000" {
		t.Fatalf("exported B2 = %q, %v", value, err)
	}
	pdfBytes, err := os.ReadFile(pdfPath)
	if err != nil {
		t.Fatal(err)
	}
	pdfText, _, err := docview.PDFText(pdfBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(pdfText, "ACME Ltd") ||
		!strings.Contains(pdfText, "Annual electricity use") ||
		!strings.Contains(pdfText, "120000") {
		t.Fatalf("PDF text = %s", pdfText)
	}

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var questions, answers, finalized int
	if err := check.DB().QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM question),
		(SELECT COUNT(*) FROM answer),
		(SELECT COUNT(*) FROM answer WHERE finalized_at IS NOT NULL)`).Scan(
		&questions, &answers, &finalized); err != nil {
		t.Fatal(err)
	}
	if questions != 2 || answers != 1 || finalized != 1 {
		t.Fatalf("questions = %d, answers = %d, finalized = %d", questions, answers, finalized)
	}
	var value, unit, source, status string
	if err := check.DB().QueryRowContext(ctx, `SELECT a.value, coalesce(a.unit, ''),
		a.source_kind, qn.status
		FROM answer a
		JOIN question q ON q.id = a.question_id
		JOIN questionnaire qn ON qn.id = q.questionnaire_id`).Scan(
		&value, &unit, &source, &status); err != nil {
		t.Fatal(err)
	}
	if value != "120000" || unit != "kWh" || source != "manual" || status != "exported" {
		t.Fatalf("answer = %q %q %q, questionnaire = %q", value, unit, source, status)
	}
}

func readAll(r *http.Request) ([]byte, error) {
	var buf bytes.Buffer
	_, err := buf.ReadFrom(r.Body)
	return buf.Bytes(), err
}

func questionnaireWorkbook(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	if err := f.SetSheetName("Sheet1", "Data"); err != nil {
		t.Fatal(err)
	}
	values := map[string]string{
		"A1": "Question",
		"B1": "Answer",
		"A2": "Annual electricity use (kWh)",
		"A3": "Describe your transition plan",
	}
	for ref, value := range values {
		if err := f.SetCellValue("Data", ref, value); err != nil {
			t.Fatal(err)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
