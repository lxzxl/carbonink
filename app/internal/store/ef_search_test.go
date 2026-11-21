package store

import (
	"context"
	"path/filepath"
	"testing"
)

func searchTestStore(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "ef-search.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestRankEmissionFactorsByHint(t *testing.T) {
	ctx := context.Background()
	s := searchTestStore(t)
	candidates, err := s.ListEmissionFactors(ctx, EFFilter{Scope: 1, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) == 0 {
		t.Fatal("no seeded emission factors")
	}
	ranked := s.RankEmissionFactors(ctx, candidates, "diesel")
	if len(ranked) != len(candidates) {
		t.Fatalf("ranked %d, want all %d candidates", len(ranked), len(candidates))
	}
	if ranked[0].FactorCode != "fuel.diesel.combustion.global.2024" {
		t.Fatalf("top hit = %s, want the diesel factor", ranked[0].FactorCode)
	}
	// Every candidate must still be present exactly once.
	seen := map[string]int{}
	for _, ef := range ranked {
		seen[ef.FactorCode]++
	}
	for _, ef := range candidates {
		if seen[ef.FactorCode] != 1 {
			t.Fatalf("candidate %s appears %d times", ef.FactorCode, seen[ef.FactorCode])
		}
	}
}

func TestRankEmissionFactorsEmptyHintKeepsOrder(t *testing.T) {
	ctx := context.Background()
	s := searchTestStore(t)
	candidates, err := s.ListEmissionFactors(ctx, EFFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	ranked := s.RankEmissionFactors(ctx, candidates, "")
	if len(ranked) != len(candidates) {
		t.Fatalf("ranked %d, want %d", len(ranked), len(candidates))
	}
	for i := range candidates {
		if ranked[i].FactorCode != candidates[i].FactorCode {
			t.Fatalf("position %d = %s, want %s", i, ranked[i].FactorCode,
				candidates[i].FactorCode)
		}
	}
}
