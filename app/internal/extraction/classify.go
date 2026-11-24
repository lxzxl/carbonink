package extraction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"app.carbonink.desktop/internal/docview"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

// ClassifyConfidenceThreshold mirrors 1.x: below this the model's choice is
// ignored and the user picks a stage manually.
const ClassifyConfidenceThreshold = 0.7

// ErrUnclassified means the model could not name a stage with enough
// confidence, or named one that is not registered.
var ErrUnclassified = errors.New("extraction: the document could not be classified")

var classifySchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "doc_type": {
      "type": "string",
      "enum": ["china_utility.v1", "fuel_receipt.v1", "freight.v1", "purchase.v1", "travel.v1", "unknown"]
    },
    "confidence": {"type": "number", "minimum": 0, "maximum": 1}
  },
  "required": ["doc_type", "confidence"]
}`)

const classifySystemPrompt = `You classify carbon-accounting documents. ` +
	`Answer only by calling the provided tool.`

// classifyPrompt is the 1.x classifier prompt, kept verbatim so its cache
// semantics and stage choices stay comparable.
func classifyPrompt(text string) string {
	return `你是一名碳核算助理。请判断下面这份单据属于以下哪一类。如果不能确定（80% 以下），请返回 "unknown"。

类型清单：
- china_utility.v1: 中国电费缴费通知单 / 电网账单 (供电公司、户号、用电量 kWh、计费周期、应缴电费)
- fuel_receipt.v1: 加油发票 / 燃油票 (加油站、油品类型、升数、单价、车牌号)
- freight.v1: 货物运输发票 / 物流单 (承运方、运输方式、起运地、到达地、货物重量、运费)
- purchase.v1: 采购发票 / 增值税发票 (销售方、商品名称、数量、金额)
- travel.v1: 差旅票据 / 机票 / 高铁票 / 出租车票 (承运方、旅客、出发地、目的地、舱位)

<document>
` + textOrImages(text) + `
</document>

返回 JSON: { doc_type: <类型 ID 或 "unknown">, confidence: <0..1 的浮点数> }`
}

func textOrImages(text string) string {
	if strings.TrimSpace(text) == "" {
		return "(no parsed text — see attached images)"
	}
	return text
}

type classification struct {
	DocType    string  `json:"doc_type"`
	Confidence float64 `json:"confidence"`
}

// Classify picks a stage for a document and records it on the document row.
// A previously recorded type is returned without calling the model.
func (s *Service) Classify(ctx context.Context, documentID string) (string, error) {
	if s.Store == nil {
		return "", errors.New("extraction: store is required")
	}
	if !s.Provider.Configured() {
		return "", ErrNotConfigured
	}
	document, err := s.Store.DocumentByID(ctx, documentID)
	if err != nil {
		return "", err
	}
	if document == nil {
		return "", fmt.Errorf("extraction: document not found: %s", documentID)
	}
	if document.DocType != "" {
		if _, ok := Get(document.DocType); ok {
			return document.DocType, nil
		}
	}
	if document.MIMEType != "application/pdf" {
		return "", fmt.Errorf("extraction: %s documents are not supported yet", document.MIMEType)
	}
	readFile := s.ReadFile
	if readFile == nil {
		readFile = os.ReadFile
	}
	data, err := readFile(store.ResolveDocumentPath(document.StoragePath, s.DataDir))
	if err != nil {
		return "", err
	}
	textFn := s.PDFText
	if textFn == nil {
		textFn = docview.PDFText
	}
	text, _, err := textFn(data)
	if err != nil {
		return "", err
	}
	client := s.NewClient
	if client == nil {
		client = func(p Provider) llm.Extractor {
			return &llm.Client{BaseURL: p.BaseURL, APIKey: p.APIKey, Model: p.Model}
		}
	}
	tool := llm.Tool{
		Name:        "save_classification",
		Description: "Record the document's extraction stage and classification confidence.",
		Schema:      classifySchema,
	}
	var raw json.RawMessage
	var cacheKey string
	if len([]rune(strings.TrimSpace(text))) >= MinTextRunes {
		cacheKey = llm.BuildCacheKey("classify", s.Provider.Name, s.Provider.Model, "v1",
			"", "", llm.SHA256Hex([]byte(text)))
		var cached classification
		if s.Cache != nil && s.Cache.Get(cacheKey, &cached) {
			if encoded, mErr := json.Marshal(cached); mErr == nil {
				raw = encoded
			}
		}
		if len(raw) == 0 {
			raw, err = client(s.Provider).Extract(ctx, classifySystemPrompt, classifyPrompt(text), tool)
		}
	} else {
		pagesFn := s.PDFPages
		if pagesFn == nil {
			pagesFn = func(data []byte) ([][]byte, error) {
				return docview.RenderPDFPages(data, VisionDPI, MaxVisionPages)
			}
		}
		pages, pagesErr := pagesFn(data)
		if pagesErr != nil {
			return "", pagesErr
		}
		if len(pages) == 0 {
			return "", ErrNoTextLayer
		}
		pageHashes := make([]string, len(pages))
		images := make([]llm.ImagePart, len(pages))
		for i, page := range pages {
			images[i] = llm.ImagePart{MIMEType: "image/png", Data: page}
			pageHashes[i] = llm.SHA256Hex(page)
		}
		cacheKey = llm.BuildCacheKey("classify", s.Provider.Name, s.Provider.Model, "v1",
			"", "", pageHashes)
		var cached classification
		if s.Cache != nil && s.Cache.Get(cacheKey, &cached) {
			if encoded, mErr := json.Marshal(cached); mErr == nil {
				raw = encoded
			}
		}
		if len(raw) == 0 {
			raw, err = client(s.Provider).ExtractVision(ctx, classifySystemPrompt,
				classifyPrompt(""), images, tool)
		}
	}
	if err != nil {
		return "", err
	}
	var result classification
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnclassified, err)
	}
	if s.Cache != nil && cacheKey != "" {
		_ = s.Cache.Set(cacheKey, result, 30*24*time.Hour)
	}
	if result.Confidence < ClassifyConfidenceThreshold || result.DocType == "unknown" {
		return "", ErrUnclassified
	}
	if _, ok := Get(result.DocType); !ok {
		return "", ErrUnclassified
	}
	if err := s.Store.SetDocumentType(ctx, document.ID, result.DocType); err != nil {
		return "", err
	}
	return result.DocType, nil
}

// ClassifyAndRun classifies a document when needed and runs the chosen
// stage. It is the batch worker's unit of work and the manual "recognize"
// path's shortcut.
func (s *Service) ClassifyAndRun(ctx context.Context, documentID string) (*store.Extraction, string, error) {
	stage, err := s.Classify(ctx, documentID)
	if err != nil {
		return nil, "", err
	}
	row, err := s.Run(ctx, documentID, stage)
	return row, stage, err
}
