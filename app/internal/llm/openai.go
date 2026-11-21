// Package llm is the Phase 0 proof that the pi-ai/pi-agent-core runtime can be
// replaced by Go: one OpenAI-compatible adapter with streaming, tool calls and
// JSON Schema validation. Anthropic and Gemini adapters follow the same shape.
package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// Client speaks the OpenAI Chat Completions protocol. Most of CarbonInk's 32
// providers are this protocol with a different base URL.
type Client struct {
	BaseURL string
	APIKey  string
	Model   string
	HTTP    *http.Client
}

// ImagePart is one image handed to a vision model. MIMEType defaults to
// image/png.
type ImagePart struct {
	MIMEType string
	Data     []byte
}

// Extractor is the one-turn structured-extraction surface both the
// OpenAI-compatible and Anthropic adapters implement.
type Extractor interface {
	Extract(ctx context.Context, system, user string, tool Tool) (json.RawMessage, error)
	ExtractVision(ctx context.Context, system, user string, images []ImagePart, tool Tool) (json.RawMessage, error)
}

// Tool is a function the model may call. Schema is a JSON Schema object.
type Tool struct {
	Name        string
	Description string
	Schema      json.RawMessage
}

// ToolCall is one call the model made.
type ToolCall struct {
	ID        string
	Name      string
	Arguments string
}

// Event is one streamed delta, or the final tool call, or an error.
type Event struct {
	Text string
	Tool *ToolCall
	Err  error
	Done bool
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type chatTool struct {
	Type     string       `json:"type"`
	Function chatFunction `json:"function"`
}

type chatFunction struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Stream      bool          `json:"stream"`
	Messages    []chatMessage `json:"messages"`
	Tools       []chatTool    `json:"tools,omitempty"`
	Temperature float64       `json:"temperature,omitempty"`
}

type streamChunk struct {
	Choices []struct {
		Delta struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 120 * time.Second}
}

// Stream sends one turn and streams its deltas. The channel closes when the
// turn ends; the final event is Done or Err. Callers must read it to release
// the response body.
func (c *Client) Stream(ctx context.Context, system, user string, tools []Tool) (<-chan Event, error) {
	return c.stream(ctx, system, user, nil, tools)
}

// StreamVision sends one user turn with images followed by text, for
// providers that accept the OpenAI content-parts shape.
func (c *Client) StreamVision(ctx context.Context, system, user string, images []ImagePart,
	tools []Tool) (<-chan Event, error) {
	return c.stream(ctx, system, user, images, tools)
}

func (c *Client) stream(ctx context.Context, system, user string, images []ImagePart,
	tools []Tool) (<-chan Event, error) {
	messages := []chatMessage{{Role: "system", Content: system}}
	if len(images) == 0 {
		messages = append(messages, chatMessage{Role: "user", Content: user})
	} else {
		parts := make([]any, 0, len(images)+1)
		parts = append(parts, map[string]any{"type": "text", "text": user})
		for _, image := range images {
			mimeType := image.MIMEType
			if mimeType == "" {
				mimeType = "image/png"
			}
			parts = append(parts, map[string]any{
				"type": "image_url",
				"image_url": map[string]any{
					"url": "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(image.Data),
				},
			})
		}
		messages = append(messages, chatMessage{Role: "user", Content: parts})
	}
	body := chatRequest{Model: c.Model, Stream: true, Messages: messages}
	for _, t := range tools {
		body.Tools = append(body.Tools, chatTool{Type: "function",
			Function: chatFunction{Name: t.Name, Description: t.Description, Parameters: t.Schema}})
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(c.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		return nil, fmt.Errorf("llm: %s: %s", resp.Status, strings.TrimSpace(string(msg)))
	}

	out := make(chan Event, 32)
	go func() {
		defer close(out)
		defer resp.Body.Close()
		calls := map[int]*ToolCall{}
		finish := ""
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 0, 64<<10), 4<<20)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, ":") {
				continue
			}
			data, ok := strings.CutPrefix(line, "data:")
			if !ok {
				continue
			}
			data = strings.TrimSpace(data)
			if data == "[DONE]" {
				break
			}
			var chunk streamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				out <- Event{Err: fmt.Errorf("llm: bad chunk: %w", err)}
				return
			}
			if chunk.Error != nil {
				out <- Event{Err: fmt.Errorf("llm: %s: %s", chunk.Error.Type, chunk.Error.Message)}
				return
			}
			for _, choice := range chunk.Choices {
				if choice.Delta.Content != "" {
					out <- Event{Text: choice.Delta.Content}
				}
				for _, tc := range choice.Delta.ToolCalls {
					call := calls[tc.Index]
					if call == nil {
						call = &ToolCall{}
						calls[tc.Index] = call
					}
					if tc.ID != "" {
						call.ID = tc.ID
					}
					if tc.Function.Name != "" {
						call.Name = tc.Function.Name
					}
					call.Arguments += tc.Function.Arguments
				}
				if choice.FinishReason != "" {
					finish = choice.FinishReason
				}
			}
		}
		if err := sc.Err(); err != nil {
			out <- Event{Err: err}
			return
		}
		if finish == "tool_calls" && len(calls) > 0 {
			for i := 0; i < len(calls); i++ {
				if call := calls[i]; call != nil {
					out <- Event{Tool: call}
				}
			}
		}
		out <- Event{Done: true}
	}()
	return out, nil
}

// Extract runs a one-turn structured extraction: the model must answer by
// calling tool, whose arguments are validated against its schema. A plain JSON
// answer in the text is accepted too, because some providers ignore tools.
func (c *Client) Extract(ctx context.Context, system, user string, tool Tool) (json.RawMessage, error) {
	return c.extract(ctx, system, user, nil, tool)
}

// ExtractVision runs a one-turn structured extraction over images.
func (c *Client) ExtractVision(ctx context.Context, system, user string, images []ImagePart,
	tool Tool) (json.RawMessage, error) {
	return c.extract(ctx, system, user, images, tool)
}

func (c *Client) extract(ctx context.Context, system, user string, images []ImagePart,
	tool Tool) (json.RawMessage, error) {
	events, err := c.stream(ctx, system, user, images, []Tool{tool})
	if err != nil {
		return nil, err
	}
	var text strings.Builder
	var call *ToolCall
	for ev := range events {
		switch {
		case ev.Err != nil:
			return nil, ev.Err
		case ev.Tool != nil:
			call = ev.Tool
		case ev.Text != "":
			text.WriteString(ev.Text)
		}
	}
	var raw []byte
	if call != nil && call.Name == tool.Name && strings.TrimSpace(call.Arguments) != "" {
		raw = []byte(call.Arguments)
	} else if i := strings.Index(text.String(), "{"); i >= 0 {
		if j := strings.LastIndex(text.String(), "}"); j > i {
			raw = []byte(text.String()[i : j+1])
		}
	}
	if len(raw) == 0 {
		return nil, errors.New("llm: no tool call and no JSON object in the reply")
	}
	if err := Validate(tool.Schema, raw); err != nil {
		return nil, err
	}
	return json.RawMessage(raw), nil
}

// Validate checks raw against a JSON Schema document.
func Validate(schema, raw []byte) error {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schema))
	if err != nil {
		return fmt.Errorf("llm: bad schema: %w", err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("schema.json", doc); err != nil {
		return fmt.Errorf("llm: bad schema: %w", err)
	}
	compiled, err := compiler.Compile("schema.json")
	if err != nil {
		return fmt.Errorf("llm: bad schema: %w", err)
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("llm: reply is not JSON: %w", err)
	}
	if err := compiled.Validate(value); err != nil {
		return fmt.Errorf("llm: reply does not match the schema: %w", err)
	}
	return nil
}
