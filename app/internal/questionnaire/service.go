package questionnaire

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

const xlsxMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// ErrNotConfigured means no LLM provider is available for question extraction.
var ErrNotConfigured = errors.New("questionnaire: no LLM provider is configured")

// Provider is one configured endpoint. It is the same shape the extraction
// service uses, so the app has one provider picker.
type Provider = extraction.Provider

// Service imports customer workbooks.
type Service struct {
	Store    *store.Store
	DataDir  string
	Provider Provider

	// NewClient is a test seam; nil uses the OpenAI-compatible adapter (or
	// Anthropic when the provider says so).
	NewClient func(Provider) llm.Extractor
}

// CreateRequest is one workbook import.
type CreateRequest struct {
	CustomerName  string
	ReportingYear int
	DueDate       string
	Filename      string
	Data          []byte
}

// CreateResult reports what the import produced.
type CreateResult struct {
	QuestionnaireID string
	QuestionCount   int
	ReusedCount     int
}

// Create parses the workbook, extracts questions, and writes the document,
// customer, questionnaire, questions, and reused answers.
func (s *Service) Create(ctx context.Context, in CreateRequest) (*CreateResult, error) {
	if s.Store == nil {
		return nil, errors.New("questionnaire: store is required")
	}
	if strings.TrimSpace(in.CustomerName) == "" {
		return nil, errors.New("questionnaire: customer name is required")
	}
	if strings.TrimSpace(in.Filename) == "" {
		return nil, errors.New("questionnaire: filename is required")
	}
	cells, err := ParseWorkbook(in.Data)
	if err != nil {
		return nil, err
	}

	var extracted []ExtractedQuestion
	if len(cells) > 0 {
		if !s.Provider.Configured() {
			return nil, ErrNotConfigured
		}
		client := s.NewClient
		if client == nil {
			client = func(p Provider) llm.Extractor {
				if p.Name == "anthropic" {
					return &llm.AnthropicClient{BaseURL: p.BaseURL, APIKey: p.APIKey, Model: p.Model}
				}
				return &llm.Client{BaseURL: p.BaseURL, APIKey: p.APIKey, Model: p.Model}
			}
		}
		raw, err := client(s.Provider).Extract(ctx, extractSystemPrompt,
			BuildExtractPrompt(cells), llm.Tool{
				Name:        "save_questions",
				Description: "Return the questions found in the workbook and the cell each answer belongs in.",
				Schema:      json.RawMessage(extractSchema),
			})
		if err != nil {
			return nil, err
		}
		extracted, err = ParseExtractReply(raw)
		if err != nil {
			return nil, err
		}
	}

	document, _, err := s.Store.SaveDocument(ctx, store.DocumentInput{
		Filename:   in.Filename,
		MIMEType:   xlsxMIME,
		Data:       in.Data,
		UploadedBy: "questionnaire",
	}, s.DataDir)
	if err != nil {
		return nil, err
	}

	questions := make([]store.QuestionInput, 0, len(extracted))
	for _, q := range extracted {
		normalized := strings.TrimSpace(q.NormalizedText)
		if normalized == "" {
			normalized = strings.TrimSpace(q.RawText)
		}
		if normalized == "" {
			continue
		}
		position := ""
		if q.AnswerCellRef != nil {
			position = strings.TrimSpace(*q.AnswerCellRef)
		}
		unit := ""
		if q.ExpectedUnit != nil {
			unit = strings.TrimSpace(*q.ExpectedUnit)
		}
		questions = append(questions, store.QuestionInput{
			RawText:        q.RawText,
			NormalizedText: normalized,
			QuestionKind:   q.QuestionKind,
			ExpectedUnit:   unit,
			Position:       position,
		})
	}

	id, reused, err := s.Store.CreateQuestionnaire(ctx, store.QuestionnaireInput{
		CustomerName:  in.CustomerName,
		DocumentID:    document.ID,
		TemplateKind:  "cdp_supplier_questionnaire",
		ReportingYear: in.ReportingYear,
		Status:        store.QuestionnaireMapping,
		Direction:     "outbound",
		DueDate:       in.DueDate,
		Questions:     questions,
	})
	if err != nil {
		return nil, err
	}
	return &CreateResult{QuestionnaireID: id, QuestionCount: len(questions), ReusedCount: reused}, nil
}

const extractSystemPrompt = `You extract structured data from documents. ` +
	`Follow the user's output rules exactly and answer only by calling the provided tool.`
