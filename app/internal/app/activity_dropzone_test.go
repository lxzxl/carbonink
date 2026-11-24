package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// readFixturePDF reads a bundled sample PDF by source-relative path, so the
// NSGo macOS runner (which launches the binary from a temporary directory)
// finds it just as `go test` does.
func readFixturePDF(t *testing.T, name string) []byte {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate the test source")
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "spike", "fixtures", "pdf", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func fixturePDF(t *testing.T) string {
	t.Helper()
	data := readFixturePDF(t, "two-page-text.pdf")
	path := filepath.Join(t.TempDir(), "bill.pdf")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func fileURL(t *testing.T, path string) string {
	t.Helper()
	u := url.URL{Scheme: "file", Path: path}
	return u.String()
}

// TestActivityDropzoneExtractsAndPrefills proves the add form still accepts a
// dropped PDF the way 1.x did: upload, classify, extract, then fill the fields.
func TestActivityDropzoneExtractsAndPrefills(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	pdfPath := fixturePDF(t)

	classifyReply := `{"doc_type":"china_utility.v1","confidence":0.93}`
	extractReply := `{"doc_type":"china_utility","supplier_name":"国网北京市电力公司",` +
		`"account_no":"1234567890","amount_kwh":523.5,"amount_yuan":312.7,` +
		`"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}`
	recommendReply := `{"recommendations":[` +
		`{"factor_code":"electricity.grid.cn.national.2024","year":2024,"source":"MEE_China",` +
		`"geography":"CN","dataset_version":"2024.q4","reasoning":"Best match for grid power."},` +
		`{"factor_code":"electricity.grid.cn.east.2024","year":2024,"source":"MEE_China",` +
		`"geography":"CN-East","dataset_version":"2024.q4","reasoning":"East China grid."},` +
		`{"factor_code":"electricity.grid.cn.north.2024","year":2024,"source":"MEE_China",` +
		`"geography":"CN-North","dataset_version":"2024.q4","reasoning":"North China grid."}]}`
	var classifyCalls, extractCalls, recommendCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		tool, reply := "save_extraction", extractReply
		switch {
		case bytes.Contains(body, []byte(`"save_emission_factor_recommendations"`)):
			recommendCalls.Add(1)
			tool, reply = "save_emission_factor_recommendations", recommendReply
		case bytes.Contains(body, []byte(`"save_classification"`)):
			classifyCalls.Add(1)
			tool, reply = "save_classification", classifyReply
		default:
			extractCalls.Add(1)
		}
		arguments, err := json.Marshal(reply)
		if err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", fmt.Sprintf(
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":%q,"arguments":%s}}]}}]}`,
			tool, arguments))
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	configureLLMEndpoint(t, ui, srv.URL)

	ui.Press("id:nav:activities")
	ui.WaitFor("id:activity-add", 3*time.Second)
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dropzone", 3*time.Second)
	ui.DropFiles("id:activity-dropzone", fileURL(t, pdfPath))
	ui.WaitFor("text:523.5", 15*time.Second)
	ui.WaitFor("text:国网北京市电力公司", 5*time.Second)
	ui.WaitFor("text:2025-09-01", 3*time.Second)
	ui.WaitFor("id:activity-ef-recommend-0", 5*time.Second)
	ui.WaitFor("text:Best match for grid power.", 3*time.Second)
	ui.WaitFor("id:activity-dropzone >> text:bill.pdf", 3*time.Second)
	ui.WaitFor("id:activity-dropzone >> text:Recognized", 3*time.Second)
	ui.Press("id:activity-drop-reset")
	ui.WaitFor("id:activity-drop-pick", 3*time.Second)
	ui.Press("id:activity-ef-recommend-0")
	ui.Press("id:activity-save")
	ui.WaitFor("text:523.50", 5*time.Second)

	if classifyCalls.Load() != 1 || extractCalls.Load() != 1 {
		t.Errorf("calls = classify %d, extract %d; want 1 each", classifyCalls.Load(), extractCalls.Load())
	}
	if recommendCalls.Load() != 1 {
		t.Errorf("recommendation calls = %d, want 1", recommendCalls.Load())
	}

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var activities, evidence int
	var status, extractionID, factorCode string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT (SELECT count(*) FROM activity_data),
		        (SELECT count(*) FROM evidence_attachment)`,
	).Scan(&activities, &evidence); err != nil {
		t.Fatal(err)
	}
	if activities != 2 || evidence != 1 {
		t.Fatalf("activities = %d, evidence = %d; want 2 and 1", activities, evidence)
	}
	if err := check.DB().QueryRowContext(ctx,
		`SELECT status FROM extraction`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != store.ExtractionParsed {
		t.Fatalf("extraction status = %q, want %q", status, store.ExtractionParsed)
	}
	if err := check.DB().QueryRowContext(ctx,
		`SELECT coalesce(extraction_id, '') FROM activity_data WHERE id != 'act'`).
		Scan(&extractionID); err != nil {
		t.Fatal(err)
	}
	if extractionID == "" {
		t.Fatal("new activity has no extraction id")
	}
	if err := check.DB().QueryRowContext(ctx,
		`SELECT ef_factor_code FROM activity_data WHERE id != 'act'`).Scan(&factorCode); err != nil {
		t.Fatal(err)
	}
	if factorCode != "electricity.grid.cn.national.2024" {
		t.Fatalf("saved factor = %q, want the recommended one", factorCode)
	}
}

// TestDocumentsDropUploads proves files dropped on the Documents page take the
// same path as the picker.
func TestDocumentsDropUploads(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	pdfPath := fixturePDF(t)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-drop", 3*time.Second)
	ui.DropFiles("id:documents-drop", fileURL(t, pdfPath))
	ui.WaitFor("text:bill.pdf", 5*time.Second)

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var documents int
	if err := check.DB().QueryRowContext(ctx,
		`SELECT count(*) FROM document`).Scan(&documents); err != nil {
		t.Fatal(err)
	}
	if documents != 1 {
		t.Fatalf("documents = %d, want 1", documents)
	}
}

// TestImportGroupRecommendations proves the batch-import group picker shows
// the model's top factors and that picking one drives the imported rows.
func TestImportGroupRecommendations(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	csvPath := filepath.Join(t.TempDir(), "ledger.csv")
	const ledger = "Source,Description,Amount,Unit,Date\n" +
		"外购电力,Office power,10,kWh,2025-03-01\n" +
		"外购电力,Office power,20,kWh,2025-03-01\n"
	if err := os.WriteFile(csvPath, []byte(ledger), 0o644); err != nil {
		t.Fatal(err)
	}
	recommendReply := `{"recommendations":[` +
		`{"factor_code":"electricity.grid.cn.national.2024","year":2024,"source":"MEE_China",` +
		`"geography":"CN","dataset_version":"2024.q4","reasoning":"Grid power fits the group."},` +
		`{"factor_code":"electricity.grid.cn.east.2024","year":2024,"source":"MEE_China",` +
		`"geography":"CN-East","dataset_version":"2024.q4","reasoning":"East China grid."},` +
		`{"factor_code":"electricity.grid.cn.north.2024","year":2024,"source":"MEE_China",` +
		`"geography":"CN-North","dataset_version":"2024.q4","reasoning":"North China grid."}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		arguments, err := json.Marshal(recommendReply)
		if err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", fmt.Sprintf(
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"save_emission_factor_recommendations","arguments":%s}}]}}]}`,
			arguments))
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	configureLLMEndpoint(t, ui, srv.URL)
	ui.PickFiles = func(nsgotest.FilePick) []core.File {
		return []core.File{{Name: "ledger.csv", Path: csvPath}}
	}
	ui.Press("id:nav:activities")
	ui.WaitFor("id:activity-import", 3*time.Second)
	ui.Press("id:activity-import")
	ui.WaitFor("id:activity-import-dialog", 2*time.Second)
	ui.Press("id:activity-import-pick")
	ui.WaitFor("text:2 data rows", 3*time.Second)
	ui.Press("id:activity-import-next")
	ui.WaitFor("text:Confirm emission factors by group", 3*time.Second)
	ui.WaitFor("id:activity-import-ef-recommend-0-0", 5*time.Second)
	ui.WaitFor("text:Grid power fits the group.", 3*time.Second)
	ui.Press("id:activity-import-ef-recommend-0-0")
	ui.Press("id:activity-import-run")
	ui.WaitFor("text:2 rows imported", 3*time.Second)

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	rows, err := check.DB().QueryContext(ctx,
		`SELECT ef_factor_code FROM activity_data WHERE id != 'act'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	imported := 0
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			t.Fatal(err)
		}
		imported++
		if code != "electricity.grid.cn.national.2024" {
			t.Fatalf("imported factor = %q", code)
		}
	}
	if imported != 2 {
		t.Fatalf("imported rows = %d, want 2", imported)
	}
}
