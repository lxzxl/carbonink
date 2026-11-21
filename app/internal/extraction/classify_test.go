package extraction

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// classificationServer answers every request with one save_classification
// tool call carrying reply.
func classificationServer(t *testing.T, reply string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	arguments, err := json.Marshal(reply)
	if err != nil {
		t.Fatal(err)
	}
	frames := []string{
		fmt.Sprintf(`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"save_classification","arguments":%s}}]}}]}`, arguments),
		`{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		`[DONE]`,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, frame := range frames {
			fmt.Fprintf(w, "data: %s\n\n", frame)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func TestClassifyRecordsStageAndRuns(t *testing.T) {
	s, ctx := testStore(t)
	dataDir := t.TempDir()
	document := storedPDF(t, s, ctx, dataDir)
	srv, calls := classificationServer(t,
		`{"doc_type":"china_utility.v1","confidence":0.93}`)
	service := testService(t, srv.URL, dataDir, s)

	stage, err := service.Classify(ctx, document.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stage != "china_utility.v1" {
		t.Fatalf("stage = %q", stage)
	}
	stored, err := s.DocumentByID(ctx, document.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.DocType != "china_utility.v1" {
		t.Errorf("doc_type = %q", stored.DocType)
	}
	again, err := service.Classify(ctx, document.ID)
	if err != nil || again != "china_utility.v1" {
		t.Fatalf("second classify = %q, %v", again, err)
	}
	if calls.Load() != 1 {
		t.Errorf("model calls = %d, want 1", calls.Load())
	}
}

func TestClassifyRejectsLowConfidenceAndUnknown(t *testing.T) {
	for _, reply := range []string{
		`{"doc_type":"purchase.v1","confidence":0.42}`,
		`{"doc_type":"unknown","confidence":0.99}`,
	} {
		t.Run(reply, func(t *testing.T) {
			s, ctx := testStore(t)
			dataDir := t.TempDir()
			document := storedPDF(t, s, ctx, dataDir)
			srv, _ := classificationServer(t, reply)
			service := testService(t, srv.URL, dataDir, s)
			if _, err := service.Classify(ctx, document.ID); !errors.Is(err, ErrUnclassified) {
				t.Fatalf("err = %v, want ErrUnclassified", err)
			}
			stored, err := s.DocumentByID(ctx, document.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.DocType != "" {
				t.Errorf("doc_type = %q, want empty", stored.DocType)
			}
		})
	}
}

func TestClassifyUsesVisionWhenThereIsNoText(t *testing.T) {
	s, ctx := testStore(t)
	dataDir := t.TempDir()
	document := storedPDF(t, s, ctx, dataDir)
	srv, calls := classificationServer(t, `{"doc_type":"fuel_receipt.v1","confidence":0.88}`)
	service := testService(t, srv.URL, dataDir, s)
	service.PDFText = func([]byte) (string, int, error) { return "", 1, nil }
	service.PDFPages = func([]byte) ([][]byte, error) { return [][]byte{{1, 2, 3}}, nil }

	stage, err := service.Classify(ctx, document.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stage != "fuel_receipt.v1" || calls.Load() != 1 {
		t.Fatalf("stage = %q, calls = %d", stage, calls.Load())
	}
}

func TestClassifyAndRunUsesTheClassifiedStage(t *testing.T) {
	s, ctx := testStore(t)
	dataDir := t.TempDir()
	document := storedPDF(t, s, ctx, dataDir)
	if err := s.SetDocumentType(ctx, document.ID, "china_utility.v1"); err != nil {
		t.Fatal(err)
	}
	srv, _ := extractionServer(t, validChinaUtility)
	service := testService(t, srv.URL, dataDir, s)

	row, stage, err := service.ClassifyAndRun(ctx, document.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stage != "china_utility.v1" || row.PromptVersion != stage {
		t.Fatalf("stage = %q, row = %+v", stage, row)
	}
}

func TestClassifyRequiresProvider(t *testing.T) {
	s, ctx := testStore(t)
	dataDir := t.TempDir()
	document := storedPDF(t, s, ctx, dataDir)
	service := &Service{Store: s, DataDir: dataDir}
	if _, err := service.Classify(ctx, document.ID); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v", err)
	}
}
