package efmatch

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

type fakeExtractor struct {
	prompt string
	reply  string
	err    error
}

func (f *fakeExtractor) Extract(_ context.Context, _, user string, _ llm.Tool) (json.RawMessage, error) {
	f.prompt = user
	if f.err != nil {
		return nil, f.err
	}
	return json.RawMessage(f.reply), nil
}

func (f *fakeExtractor) ExtractVision(context.Context, string, string, []llm.ImagePart,
	llm.Tool) (json.RawMessage, error) {
	return nil, f.err
}

func matchStore(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "efmatch.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return s
}

func sourceWithScope(scope int, category string) store.EmissionSource {
	return store.EmissionSource{Scope: scope, Category: category}
}

func TestHintPerStage(t *testing.T) {
	if got := Hint("china_utility.v1", `{"supplier_name":"国网"}`); got != "国网" {
		t.Fatalf("hint = %q", got)
	}
	if got := Hint("freight.v1", `{"mode":"truck","supplier_name":"DHL"}`); got != "truck DHL" {
		t.Fatalf("hint = %q", got)
	}
	if got := Hint("unknown", `{"supplier_name":"x"}`); got != "" {
		t.Fatalf("unknown hint = %q", got)
	}
}

func TestRecommendTextRanksAndMaps(t *testing.T) {
	ctx := context.Background()
	s := matchStore(t)
	candidates, err := s.ListEmissionFactors(ctx, store.EFFilter{Scope: 1, Category: "fuel.mobile"})
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) < 1 {
		t.Fatal("no fuel candidates")
	}
	diesel := candidates[0]
	for _, ef := range candidates {
		if ef.FactorCode == "fuel.diesel.combustion.global.2024" {
			diesel = ef
		}
	}
	reply, err := json.Marshal(map[string]any{
		"recommendations": []map[string]any{
			{"factor_code": diesel.FactorCode, "year": diesel.Year, "source": diesel.Source,
				"geography": diesel.Geography, "dataset_version": diesel.DatasetVersion,
				"reasoning": "Unit and fuel type match."},
			{"factor_code": "hallucinated", "year": 1, "source": "x", "geography": "x",
				"dataset_version": "x", "reasoning": "drop me"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeExtractor{reply: string(reply)}
	service := &Service{Store: s, Provider: extraction.Provider{Name: "openai", Model: "test",
		BaseURL: "http://example.invalid"}, Language: "en",
		NewClient: func(extraction.Provider) llm.Extractor { return fake }}
	result, err := service.RecommendText(ctx, "diesel", "L", sourceWithScope(1, "fuel.mobile"))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.RankedFull) == 0 || result.RankedFull[0].FactorCode != diesel.FactorCode {
		t.Fatalf("ranked full = %+v", result.RankedFull)
	}
	if len(result.Recommended) != 1 || result.Recommended[0].EF.FactorCode != diesel.FactorCode {
		t.Fatalf("recommended = %+v", result.Recommended)
	}
	if result.Recommended[0].Reasoning != "Unit and fuel type match." {
		t.Fatalf("reasoning = %q", result.Recommended[0].Reasoning)
	}
	if !strings.Contains(fake.prompt, "<ledger_group>") ||
		!strings.Contains(fake.prompt, "diesel L") {
		t.Fatalf("prompt = %q", fake.prompt)
	}
}

func TestRecommendExtractionUsesParsedJSON(t *testing.T) {
	ctx := context.Background()
	s := matchStore(t)
	if _, err := s.DB().ExecContext(ctx, `INSERT INTO document
		(id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
		VALUES ('doc', 'sha', 'bill.pdf', 'application/pdf', 1, 'documents/sha', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	row, err := s.InsertExtraction(ctx, store.ExtractionInput{
		DocumentID: "doc", LLMProvider: "openai", LLMModel: "test",
		PromptVersion: "fuel_receipt.v1", RawResponse: "{}",
		ParsedJSON: `{"fuel_type":"柴油"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeExtractor{reply: `{"recommendations":[]}`}
	service := &Service{Store: s, Provider: extraction.Provider{Name: "openai", Model: "test",
		BaseURL: "http://example.invalid"},
		NewClient: func(extraction.Provider) llm.Extractor { return fake }}
	result, err := service.Recommend(ctx, row.ID, sourceWithScope(1, "fuel.mobile"))
	if err != nil {
		t.Fatal(err)
	}
	if result.RankedFull == nil || len(result.RankedFull) == 0 {
		t.Fatal("no ranked candidates")
	}
	if !strings.Contains(fake.prompt, "<parsed_json>") || !strings.Contains(fake.prompt, "柴油") {
		t.Fatalf("prompt = %q", fake.prompt)
	}
	if len(result.Recommended) != 0 {
		t.Fatalf("empty reply mapped to %+v", result.Recommended)
	}
}

func TestRecommendDegradesToFTSOnModelFailure(t *testing.T) {
	ctx := context.Background()
	s := matchStore(t)
	fake := &fakeExtractor{err: context.DeadlineExceeded}
	service := &Service{Store: s, Provider: extraction.Provider{Name: "openai", Model: "test",
		BaseURL: "http://example.invalid"},
		NewClient: func(extraction.Provider) llm.Extractor { return fake }}
	result, err := service.RecommendText(ctx, "diesel", "L", sourceWithScope(1, "fuel.mobile"))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.RankedFull) == 0 {
		t.Fatal("FTS ranking should survive a model failure")
	}
	if len(result.Recommended) != 0 {
		t.Fatalf("recommended = %+v", result.Recommended)
	}
}

func TestRecommendTextUsesFileCache(t *testing.T) {
	ctx := context.Background()
	s := matchStore(t)
	candidates, err := s.ListEmissionFactors(ctx, store.EFFilter{Scope: 1, Category: "fuel.mobile"})
	if err != nil || len(candidates) == 0 {
		t.Fatalf("candidates = %d, err = %v", len(candidates), err)
	}
	diesel := candidates[0]
	reply, _ := json.Marshal(map[string]any{
		"recommendations": []map[string]any{{
			"factor_code":     diesel.FactorCode,
			"year":            diesel.Year,
			"source":          diesel.Source,
			"geography":       diesel.Geography,
			"dataset_version": diesel.DatasetVersion,
			"reasoning":       "Matches diesel fuel.",
		}},
	})
	calls := 0
	service := &Service{
		Store: s,
		Provider: extraction.Provider{
			Name: "openai", Model: "test", BaseURL: "http://example.invalid",
		},
		Cache: llm.NewFileCache(t.TempDir()),
		NewClient: func(extraction.Provider) llm.Extractor {
			return &countingExtractor{reply: reply, calls: &calls}
		},
	}
	first, err := service.RecommendText(ctx, "diesel", "L", sourceWithScope(1, "fuel.mobile"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.RecommendText(ctx, "diesel", "L", sourceWithScope(1, "fuel.mobile"))
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("model calls = %d, want 1 (second call cached)", calls)
	}
	if len(first.Recommended) != 1 || len(second.Recommended) != 1 ||
		second.Recommended[0].EF.FactorCode != diesel.FactorCode {
		t.Fatalf("cached result = %+v", second.Recommended)
	}
}

type countingExtractor struct {
	reply json.RawMessage
	calls *int
}

func (c *countingExtractor) Extract(context.Context, string, string, llm.Tool) (json.RawMessage, error) {
	*c.calls++
	return c.reply, nil
}

func (c *countingExtractor) ExtractVision(context.Context, string, string, []llm.ImagePart,
	llm.Tool) (json.RawMessage, error) {
	*c.calls++
	return c.reply, nil
}
