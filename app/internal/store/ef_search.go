package store

import (
	"context"
	"strconv"
	"strings"
)

// RankEmissionFactors orders candidates by their FTS relevance to hint. The
// 1.x matcher used one quoted phrase over the whole hint, so a Chinese name is
// matched exactly before the LLM rerank. Candidates without a hit keep their
// original order after the hits, because the browse list still shows them.
func (s *Store) RankEmissionFactors(ctx context.Context, candidates []EmissionFactor,
	hint string) []EmissionFactor {
	hint = strings.TrimSpace(hint)
	if hint == "" || len(candidates) == 0 {
		return append([]EmissionFactor(nil), candidates...)
	}
	query := `"` + strings.ReplaceAll(hint, `"`, `""`) + `"`
	rows, err := s.db.QueryContext(ctx, `SELECT factor_code, year, source, geography, dataset_version
		FROM ef_fts WHERE ef_fts MATCH ? ORDER BY bm25(ef_fts) ASC`, query)
	if err != nil {
		return append([]EmissionFactor(nil), candidates...)
	}
	defer rows.Close()
	byKey := make(map[string]EmissionFactor, len(candidates))
	for _, ef := range candidates {
		byKey[efKeyString(ef)] = ef
	}
	out := make([]EmissionFactor, 0, len(candidates))
	seen := make(map[string]bool, len(candidates))
	for rows.Next() {
		var key EmissionFactorKey
		if err := rows.Scan(&key.FactorCode, &key.Year, &key.Source, &key.Geography,
			&key.DatasetVersion); err != nil {
			return append([]EmissionFactor(nil), candidates...)
		}
		encoded := emissionFactorKeyString(key)
		ef, ok := byKey[encoded]
		if !ok || seen[encoded] {
			continue
		}
		out = append(out, ef)
		seen[encoded] = true
	}
	if err := rows.Err(); err != nil {
		return append([]EmissionFactor(nil), candidates...)
	}
	for _, ef := range candidates {
		encoded := efKeyString(ef)
		if seen[encoded] {
			continue
		}
		out = append(out, ef)
	}
	return out
}

func efKeyString(ef EmissionFactor) string {
	return emissionFactorKeyString(EmissionFactorKey{
		FactorCode: ef.FactorCode, Year: ef.Year, Source: ef.Source,
		Geography: ef.Geography, DatasetVersion: ef.DatasetVersion,
	})
}

func emissionFactorKeyString(key EmissionFactorKey) string {
	return key.FactorCode + "\x1f" + strconv.Itoa(key.Year) + "\x1f" + key.Source + "\x1f" +
		key.Geography + "\x1f" + key.DatasetVersion
}
