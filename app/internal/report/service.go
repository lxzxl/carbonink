// Package report assembles ISO 14064-1 and TCFD reports from the inventory,
// generates their narratives through the configured model, and exports PDF
// and Excel deliverables.
package report

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

// Kinds the app can generate.
const (
	KindISO  = "iso14064"
	KindTCFD = "tcfd"
)

// ErrNotConfigured means no LLM provider is available.
var ErrNotConfigured = errors.New("report: no LLM provider is configured")

// ErrEmptyInventory means the period has no activity rows.
var ErrEmptyInventory = errors.New("report: no activity data for the reporting period")

// Provider is one configured endpoint; the same shape extraction uses.
type Provider struct {
	Name    string
	Model   string
	BaseURL string
	APIKey  string
}

// Configured reports whether the minimum fields are present.
func (p Provider) Configured() bool {
	return p.BaseURL != "" && p.Model != ""
}

// Service generates reports for one workspace.
type Service struct {
	Store    *store.Store
	Provider Provider

	// NewClient is a test seam; nil uses the production adapters.
	NewClient func(Provider) llm.Extractor
}

// Report is one generated deliverable.
type Report struct {
	Kind        string
	Data        *store.ReportData
	ISO         *Narrative
	TCFD        *TCFDNarrative
	GeneratedAt string
}

// Generate assembles the inventory and asks the model for the narrative.
func (s *Service) Generate(ctx context.Context, periodID, language, kind string) (*Report, error) {
	if s.Store == nil {
		return nil, errors.New("report: store is required")
	}
	if !s.Provider.Configured() {
		return nil, ErrNotConfigured
	}
	if kind != KindISO && kind != KindTCFD {
		return nil, fmt.Errorf("report: unknown kind %q", kind)
	}
	data, err := s.Store.ReportInventory(ctx, periodID)
	if err != nil {
		return nil, err
	}
	if len(data.Activities) == 0 {
		return nil, ErrEmptyInventory
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	client := s.client()
	out := &Report{Kind: kind, Data: data, GeneratedAt: time.Now().Format("2006-01-02")}
	switch kind {
	case KindISO:
		raw, err := client.Extract(ctx, isoSystemPrompt(language),
			"<inventory>\n"+string(payload)+"\n</inventory>",
			llm.Tool{Name: "save_iso_report_narrative", Description: isoPromptDescription,
				Schema: json.RawMessage(isoSchema)})
		if err != nil {
			return nil, err
		}
		var narrative Narrative
		if err := json.Unmarshal(raw, &narrative); err != nil {
			return nil, fmt.Errorf("report: decode narrative: %w", err)
		}
		out.ISO = &narrative
	case KindTCFD:
		raw, err := client.Extract(ctx, tcfdSystemPrompt(language),
			"<inventory>\n"+string(payload)+"\n</inventory>",
			llm.Tool{Name: "save_tcfd_report_narrative", Description: tcfdPromptDescription,
				Schema: json.RawMessage(tcfdSchema)})
		if err != nil {
			return nil, err
		}
		var narrative TCFDNarrative
		if err := json.Unmarshal(raw, &narrative); err != nil {
			return nil, fmt.Errorf("report: decode narrative: %w", err)
		}
		out.TCFD = &narrative
	}
	return out, nil
}

func (s *Service) client() llm.Extractor {
	if s.NewClient != nil {
		return s.NewClient(s.Provider)
	}
	if s.Provider.Name == "anthropic" {
		return &llm.AnthropicClient{BaseURL: s.Provider.BaseURL, APIKey: s.Provider.APIKey,
			Model: s.Provider.Model}
	}
	return &llm.Client{BaseURL: s.Provider.BaseURL, APIKey: s.Provider.APIKey,
		Model: s.Provider.Model}
}
