package extraction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"app.carbonink.desktop/internal/store"
)

func testStore(t *testing.T) (*store.Store, context.Context) {
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

func fixturePDF(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "spike", "fixtures", "pdf", "two-page-text.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func storedPDF(t *testing.T, s *store.Store, ctx context.Context, dataDir string) *store.Document {
	t.Helper()
	document, _, err := s.SaveDocument(ctx, store.DocumentInput{
		Filename: "bill.pdf", MIMEType: "application/pdf", Data: fixturePDF(t),
	}, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	return document
}

// extractionServer answers every request with one tool call carrying reply.
func extractionServer(t *testing.T, reply string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	arguments, err := json.Marshal(reply)
	if err != nil {
		t.Fatal(err)
	}
	frames := []string{
		fmt.Sprintf(`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"save_extraction","arguments":%s}}]}}]}`, arguments),
		`{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		`[DONE]`,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, frame := range frames {
			fmt.Fprintf(w, "data: %s\n\n", frame)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func testService(t *testing.T, srvURL, dataDir string, s *store.Store) *Service {
	t.Helper()
	return &Service{
		Store:   s,
		DataDir: dataDir,
		Provider: Provider{
			Name: "test-provider", Model: "test-model", BaseURL: srvURL, APIKey: "test-key",
		},
	}
}

func TestRunExtractionTextPath(t *testing.T) {
	s, ctx := testStore(t)
	dataDir := t.TempDir()
	document := storedPDF(t, s, ctx, dataDir)
	srv, calls := extractionServer(t, validChinaUtility)
	service := testService(t, srv.URL, dataDir, s)

	first, err := service.Run(ctx, document.ID, "china_utility.v1")
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != store.ExtractionReviewNeeded || first.PromptVersion != "china_utility.v1" {
		t.Fatalf("extraction = %+v", first)
	}
	if first.RawResponse != first.ParsedJSON {
		t.Errorf("raw response differs from parsed json")
	}
	var parsed struct {
		AmountKWh float64 `json:"amount_kwh"`
	}
	if err := json.Unmarshal([]byte(first.ParsedJSON), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.AmountKWh != 523.5 {
		t.Errorf("amount_kwh = %v", parsed.AmountKWh)
	}

	cached, err := service.Run(ctx, document.ID, "china_utility.v1")
	if err != nil {
		t.Fatal(err)
	}
	if cached.ID != first.ID {
		t.Errorf("cached id = %s, want %s", cached.ID, first.ID)
	}
	if calls.Load() != 1 {
		t.Errorf("model calls = %d, want 1", calls.Load())
	}

	if err := s.ConfirmExtraction(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	confirmed, err := s.ExtractionByID(ctx, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != store.ExtractionParsed || confirmed.ReviewedByUserAt == "" {
		t.Fatalf("confirmed = %+v", confirmed)
	}
	if err := s.ConfirmExtraction(ctx, first.ID); err == nil {
		t.Fatal("confirmed twice")
	}
}

func TestDiscardAllowsRetry(t *testing.T) {
	s, ctx := testStore(t)
	dataDir := t.TempDir()
	document := storedPDF(t, s, ctx, dataDir)
	srv, calls := extractionServer(t, validTravel)
	service := testService(t, srv.URL, dataDir, s)

	first, err := service.Run(ctx, document.ID, "travel.v1")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DiscardExtraction(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DiscardExtraction(ctx, first.ID); err != nil {
		t.Fatalf("second discard = %v", err)
	}
	rejected, err := s.ExtractionByID(ctx, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Status != store.ExtractionRejected || rejected.ParsedJSON != "" {
		t.Fatalf("rejected = %+v", rejected)
	}
	if cached, err := s.FindExtraction(ctx, store.ExtractionKey{
		DocumentID: document.ID, PromptVersion: "travel.v1",
		LLMProvider: "test-provider", LLMModel: "test-model",
	}); err != nil || cached != nil {
		t.Fatalf("rejected row was cached: %+v, %v", cached, err)
	}

	second, err := service.Run(ctx, document.ID, "travel.v1")
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID {
		t.Fatal("retry reused the rejected row")
	}
	if calls.Load() != 2 {
		t.Errorf("model calls = %d, want 2", calls.Load())
	}
}

func TestRunRequiresTextLayer(t *testing.T) {
	s, ctx := testStore(t)
	dataDir := t.TempDir()
	document := storedPDF(t, s, ctx, dataDir)
	srv, calls := extractionServer(t, validChinaUtility)
	service := testService(t, srv.URL, dataDir, s)
	service.PDFText = func([]byte) (string, int, error) { return "  \n ", 2, nil }

	if _, err := service.Run(ctx, document.ID, "china_utility.v1"); !errors.Is(err, ErrNoTextLayer) {
		t.Fatalf("err = %v", err)
	}
	if calls.Load() != 0 {
		t.Errorf("model calls = %d, want 0", calls.Load())
	}
}

func TestRunRejectsUnconfiguredProvider(t *testing.T) {
	s, ctx := testStore(t)
	service := &Service{Store: s, DataDir: t.TempDir()}
	if _, err := service.Run(ctx, "document", "china_utility.v1"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v", err)
	}
}
