// Package extraction turns an uploaded document into a reviewable structured
// result. Stages are pure data: a stable id, a JSON Schema, and the prompt
// text for the text and image paths. The service owns I/O and persistence.
package extraction

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"

	"app.carbonink.desktop/internal/llm"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

// VisionMessages is the text half of an image turn. The caller appends one
// image part per rendered PDF page after UserText.
type VisionMessages struct {
	System   string
	UserText string
}

// Stage is one structured-extraction task. ID carries the version suffix
// (for example "china_utility.v1") and is persisted as the extraction cache
// key, so bumping the version invalidates earlier results.
type Stage struct {
	ID          string
	Version     string
	Description string
	Schema      json.RawMessage
	BuildPrompt func(pdfText string) string
	// BuildVisionMessages is nil for stages that only accept text.
	BuildVisionMessages func() VisionMessages
}

// Vision reports whether the stage can accept rendered pages.
func (s Stage) Vision() bool { return s.BuildVisionMessages != nil }

var registry = map[string]Stage{}

func register(stage Stage) {
	if stage.ID == "" {
		panic("extraction: stage without an id")
	}
	if len(stage.Schema) == 0 {
		panic("extraction: stage " + stage.ID + " without a schema")
	}
	if stage.BuildPrompt == nil {
		panic("extraction: stage " + stage.ID + " without a prompt builder")
	}
	if _, exists := registry[stage.ID]; exists {
		panic("extraction: duplicate stage " + stage.ID)
	}
	registry[stage.ID] = stage
}

// Get returns the stage with id.
func Get(id string) (Stage, bool) {
	stage, ok := registry[id]
	return stage, ok
}

// List returns every registered stage in id order.
func List() []Stage {
	out := make([]Stage, 0, len(registry))
	for _, stage := range registry {
		out = append(out, stage)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Validate checks one raw model reply against a stage's schema.
func (s Stage) Validate(raw []byte) error {
	if err := validateSchema(s.Schema); err != nil {
		return fmt.Errorf("extraction: stage %s: %w", s.ID, err)
	}
	return validateReply(s.Schema, raw)
}

func validateSchema(schema []byte) error {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schema))
	if err != nil {
		return err
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("stage.json", doc); err != nil {
		return err
	}
	_, err = compiler.Compile("stage.json")
	return err
}

func validateReply(schema, raw []byte) error {
	return llm.Validate(schema, raw)
}
