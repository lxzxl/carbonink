// Package efmatch ports the 1.x emission-factor recommender: rank a source's
// candidate factors with the FTS backbone, then ask the configured model for
// the three closest ones with a short reason.
package efmatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

// CandidateLimit mirrors 1.x: the prompt shows at most 20 factors.
const CandidateLimit = 20

// Recommendation is one factor plus the model's reason.
type Recommendation struct {
	EF        store.EmissionFactor
	Reasoning string
}

// Result carries the top three and the full ranked pool the browse list uses.
type Result struct {
	Recommended []Recommendation
	RankedFull  []store.EmissionFactor
}

// Service recommends factors for one extraction or one ledger group.
type Service struct {
	Store    *store.Store
	Provider extraction.Provider
	// Language picks the reasoning language ("en" or "zh-CN").
	Language string
	Cache    *llm.FileCache

	// NewClient is a test seam; nil uses the production adapter.
	NewClient func(extraction.Provider) llm.Extractor
}

// Recommend ranks factors for a staged extraction against one source.
func (s *Service) Recommend(ctx context.Context, extractionID string,
	source store.EmissionSource) (*Result, error) {
	if s.Store == nil {
		return nil, errors.New("efmatch: store is required")
	}
	row, err := s.Store.ExtractionByID(ctx, extractionID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return &Result{}, nil
	}
	hint := Hint(row.PromptVersion, row.ParsedJSON)
	return s.rank(ctx, source, hint, func(candidates []store.EmissionFactor) string {
		return extractionPrompt(candidates, row.ParsedJSON, s.reasoningLanguage())
	})
}

// RecommendText ranks factors for an imported ledger group's description.
func (s *Service) RecommendText(ctx context.Context, description, unit string,
	source store.EmissionSource) (*Result, error) {
	hint := strings.Join(strings.Fields(strings.TrimSpace(description)+" "+
		strings.TrimSpace(unit)), " ")
	if hint == "" {
		return &Result{}, nil
	}
	return s.rank(ctx, source, hint, func(candidates []store.EmissionFactor) string {
		return groupPrompt(candidates, hint, s.reasoningLanguage())
	})
}

func (s *Service) rank(ctx context.Context, source store.EmissionSource, hint string,
	buildPrompt func([]store.EmissionFactor) string) (*Result, error) {
	candidates, err := s.Store.ListEmissionFactors(ctx, store.EFFilter{
		Scope: source.Scope, Category: source.Category, Limit: 500,
	})
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return &Result{}, nil
	}
	ranked := s.Store.RankEmissionFactors(ctx, candidates, hint)
	if len(ranked) > CandidateLimit {
		ranked = ranked[:CandidateLimit]
	}
	result := &Result{RankedFull: ranked}
	if !s.Provider.Configured() {
		return result, nil
	}
	cacheKey := llm.BuildCacheKey("ef-match", s.Provider.Name, s.Provider.Model, "v1",
		efCandidateFingerprint(ranked), "", map[string]any{
			"hint": hint,
			"lang": s.reasoningLanguage(),
		})
	var raw json.RawMessage
	if s.Cache != nil && s.Cache.Get(cacheKey, &raw) && len(raw) > 0 {
		result.Recommended = mapRecommendations(raw, ranked)
		return result, nil
	}
	client := s.NewClient
	if client == nil {
		client = func(p extraction.Provider) llm.Extractor {
			return &llm.Client{BaseURL: p.BaseURL, APIKey: p.APIKey, Model: p.Model}
		}
	}
	raw, err = client(s.Provider).Extract(ctx, recommendationSystemPrompt,
		buildPrompt(ranked), recommendationTool)
	if err != nil {
		// The 1.x matcher never fails the UI: FTS order stays usable.
		return result, nil
	}
	if s.Cache != nil {
		_ = s.Cache.Set(cacheKey, raw, 30*24*time.Hour)
	}
	result.Recommended = mapRecommendations(raw, ranked)
	return result, nil
}

func efCandidateFingerprint(factors []store.EmissionFactor) string {
	keys := make([]string, len(factors))
	for i, f := range factors {
		keys[i] = f.FactorCode + "@" + strconv.Itoa(f.Year) + "@" + f.Source + "@" +
			f.Geography + "@" + f.DatasetVersion
	}
	return llm.SHA256Hex([]byte(strings.Join(keys, "\n")))[:16]
}

func (s *Service) reasoningLanguage() string {
	if strings.HasPrefix(strings.ToLower(s.Language), "zh") {
		return "zh"
	}
	return "en"
}

// Hint is the 1.x per-stage free-text query.
func Hint(stageID, parsedJSON string) string {
	fields := map[string][]string{
		"china_utility.v1": {"supplier_name"},
		"fuel_receipt.v1":  {"fuel_type", "fuel_category"},
		"freight.v1":       {"mode", "vehicle_class", "supplier_name"},
		"purchase.v1":      {"category", "item_description", "supplier_name"},
		"travel.v1":        {"mode", "travel_class", "supplier_name"},
	}
	keys, ok := fields[stageID]
	if !ok {
		return ""
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(parsedJSON), &parsed); err != nil {
		return ""
	}
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		if value, ok := parsed[key].(string); ok && strings.TrimSpace(value) != "" {
			parts = append(parts, strings.TrimSpace(value))
		}
	}
	return strings.Join(parts, " ")
}

const recommendationSystemPrompt = `You recommend emission factors for carbon accounting. ` +
	`Answer only by calling the provided tool.`

var recommendationTool = llm.Tool{
	Name:        "save_emission_factor_recommendations",
	Description: "Record the three closest emission factors and a short reason for each.",
	Schema: json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "recommendations": {
      "type": "array",
      "minItems": 3,
      "maxItems": 3,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "factor_code": {"type": "string"},
          "year": {"type": "integer"},
          "source": {"type": "string"},
          "geography": {"type": "string"},
          "dataset_version": {"type": "string"},
          "reasoning": {"type": "string", "maxLength": 240}
        },
        "required": ["factor_code", "year", "source", "geography", "dataset_version", "reasoning"]
      }
    }
  },
  "required": ["recommendations"]
}`),
}

func extractionPrompt(candidates []store.EmissionFactor, parsedJSON, language string) string {
	return fmt.Sprintf(`You are a carbon-accounting assistant. A document extraction and a candidate emission-factor list follow.
Pick the three factors that fit the document best and give a short reason for each.

<parsed_json>
%s
</parsed_json>

<candidates>
%s
</candidates>

%s
Copy factor_code, year, source, geography and dataset_version verbatim from the candidates; never invent a key.`,
		parsedJSON, candidateList(candidates), reasoningInstruction(language))
}

func groupPrompt(candidates []store.EmissionFactor, hintText, language string) string {
	return fmt.Sprintf(`You are a carbon-accounting assistant. A ledger group's shared description and unit, plus a candidate emission-factor list, follow.
Pick the three factors that fit the group best and give a short reason for each.

<ledger_group>
%s
</ledger_group>

<candidates>
%s
</candidates>

%s
Copy factor_code, year, source, geography and dataset_version verbatim from the candidates; never invent a key.`,
		hintText, candidateList(candidates), reasoningInstruction(language))
}

func reasoningInstruction(language string) string {
	if language == "zh" {
		return `Write "reasoning" in 1-2 short Chinese sentences (for example matching unit or fuel type).`
	}
	return `Write "reasoning" in 1-2 short English sentences (for example matching unit or fuel type).`
}

func candidateList(candidates []store.EmissionFactor) string {
	var b strings.Builder
	for i, ef := range candidates {
		name := ef.NameEN
		if name == "" {
			name = ef.NameZH
		}
		if name == "" {
			name = ef.FactorCode
		}
		b.WriteString(strconv.Itoa(i + 1))
		b.WriteString(". ")
		b.WriteString(strings.Join([]string{
			ef.FactorCode, strconv.Itoa(ef.Year), ef.Source, ef.Geography, ef.DatasetVersion,
			ef.InputUnit, strconv.FormatFloat(ef.CO2eKgPerUnit, 'f', -1, 64) + " kgCO2e/unit", name,
		}, " | "))
		b.WriteByte('\n')
	}
	return strings.TrimRight(b.String(), "\n")
}

type recommendationResponse struct {
	Recommendations []struct {
		FactorCode     string `json:"factor_code"`
		Year           int    `json:"year"`
		Source         string `json:"source"`
		Geography      string `json:"geography"`
		DatasetVersion string `json:"dataset_version"`
		Reasoning      string `json:"reasoning"`
	} `json:"recommendations"`
}

func mapRecommendations(raw json.RawMessage, pool []store.EmissionFactor) []Recommendation {
	var parsed recommendationResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	out := make([]Recommendation, 0, len(parsed.Recommendations))
	for _, rec := range parsed.Recommendations {
		for i := range pool {
			ef := pool[i]
			if ef.FactorCode != rec.FactorCode || ef.Year != rec.Year || ef.Source != rec.Source ||
				ef.Geography != rec.Geography || ef.DatasetVersion != rec.DatasetVersion {
				continue
			}
			out = append(out, Recommendation{EF: ef, Reasoning: rec.Reasoning})
			break
		}
	}
	return out
}
