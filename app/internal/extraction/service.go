package extraction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"app.carbonink.desktop/internal/docview"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

// MinTextRunes is the 1.x threshold that separates a text-layer PDF from an
// image-only scan. Below it the vision path is required.
const MinTextRunes = 10

// VisionDPI and MaxVisionPages bound the image path's cost. Receipts and bills
// are short; a 20-page cap avoids sending an entire scanned binder.
const (
	VisionDPI      = 120
	MaxVisionPages = 20
)

// ErrNoTextLayer means the PDF has no usable text and the stage's vision path
// could not be used.
var ErrNoTextLayer = errors.New("extraction: the PDF has no readable text layer")

// ErrVisionUnsupported means the stage has no image prompt.
var ErrVisionUnsupported = errors.New("extraction: the stage does not support image input")

// ErrNotConfigured means no LLM provider settings are available.
var ErrNotConfigured = errors.New("extraction: no LLM provider is configured")

// Provider is one OpenAI-compatible endpoint and model.
type Provider struct {
	Name    string
	Model   string
	BaseURL string
	APIKey  string
}

// Configured reports whether the minimum fields are present.
func (p Provider) Configured() bool {
	return strings.TrimSpace(p.BaseURL) != "" && strings.TrimSpace(p.Model) != ""
}

// Service runs one stage against one stored document.
type Service struct {
	Store    *store.Store
	DataDir  string
	Provider Provider
	Cache    *llm.FileCache

	// The fields below are test seams; nil uses the production defaults.
	ReadFile  func(string) ([]byte, error)
	PDFText   func([]byte) (string, int, error)
	PDFPages  func([]byte) ([][]byte, error)
	Stage     func(string) (Stage, bool)
	NewClient func(Provider) llm.Extractor
}

// Run executes the text path and persists a review_needed extraction. A
// cached row for the same (document, stage, provider, model) returns without
// calling the model.
func (s *Service) Run(ctx context.Context, documentID, stageID string) (*store.Extraction, error) {
	if s.Store == nil {
		return nil, errors.New("extraction: store is required")
	}
	if !s.Provider.Configured() {
		return nil, ErrNotConfigured
	}
	stageFn := s.Stage
	if stageFn == nil {
		stageFn = Get
	}
	stage, ok := stageFn(stageID)
	if !ok {
		return nil, fmt.Errorf("extraction: stage not found: %s", stageID)
	}
	document, err := s.Store.DocumentByID(ctx, documentID)
	if err != nil {
		return nil, err
	}
	if document == nil {
		return nil, fmt.Errorf("extraction: document not found: %s", documentID)
	}
	if document.MIMEType != "application/pdf" {
		return nil, fmt.Errorf("extraction: %s documents are not supported yet", document.MIMEType)
	}

	key := store.ExtractionKey{
		DocumentID:    document.ID,
		PromptVersion: stage.ID,
		LLMProvider:   s.Provider.Name,
		LLMModel:      s.Provider.Model,
	}
	cached, err := s.Store.FindExtraction(ctx, key)
	if err != nil {
		return nil, err
	}
	if cached != nil {
		return cached, nil
	}

	readFile := s.ReadFile
	if readFile == nil {
		readFile = os.ReadFile
	}
	data, err := readFile(store.ResolveDocumentPath(document.StoragePath, s.DataDir))
	if err != nil {
		return nil, err
	}
	textFn := s.PDFText
	if textFn == nil {
		textFn = docview.PDFText
	}
	text, _, err := textFn(data)
	if err != nil {
		return nil, err
	}
	client := s.NewClient
	if client == nil {
		client = func(p Provider) llm.Extractor {
			return &llm.Client{BaseURL: p.BaseURL, APIKey: p.APIKey, Model: p.Model}
		}
	}
	tool := llm.Tool{
		Name:        "save_extraction",
		Description: stage.Description,
		Schema:      stage.Schema,
	}
	var raw json.RawMessage
	if len([]rune(strings.TrimSpace(text))) >= MinTextRunes {
		raw, err = client(s.Provider).Extract(ctx, extractionSystemPrompt, stage.BuildPrompt(text), tool)
	} else {
		if !stage.Vision() {
			return nil, ErrVisionUnsupported
		}
		pagesFn := s.PDFPages
		if pagesFn == nil {
			pagesFn = func(data []byte) ([][]byte, error) {
				return docview.RenderPDFPages(data, VisionDPI, MaxVisionPages)
			}
		}
		pages, err := pagesFn(data)
		if err != nil {
			return nil, err
		}
		if len(pages) == 0 {
			return nil, ErrNoTextLayer
		}
		images := make([]llm.ImagePart, len(pages))
		for i, page := range pages {
			images[i] = llm.ImagePart{MIMEType: "image/png", Data: page}
		}
		vision := stage.BuildVisionMessages()
		system := vision.System
		if strings.TrimSpace(system) == "" {
			system = extractionSystemPrompt
		}
		raw, err = client(s.Provider).ExtractVision(ctx, system, vision.UserText, images, tool)
	}
	if err != nil {
		return nil, err
	}
	return s.Store.InsertExtraction(ctx, store.ExtractionInput{
		DocumentID:    document.ID,
		LLMProvider:   s.Provider.Name,
		LLMModel:      s.Provider.Model,
		PromptVersion: stage.ID,
		RawResponse:   string(raw),
		ParsedJSON:    string(raw),
	})
}

const extractionSystemPrompt = `You extract structured data from documents. ` +
	`Follow the user's output rules exactly and answer only by calling the provided tool.`
