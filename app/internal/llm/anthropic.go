package llm

import (
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
)

// AnthropicClient speaks the Messages API and implements Extractor. Anthropic
// names the schema field input_schema and authenticates with x-api-key, so it
// cannot reuse the OpenAI-compatible Client.
type AnthropicClient struct {
	BaseURL   string
	APIKey    string
	Model     string
	HTTP      *http.Client
	MaxTokens int
}

type anthropicSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content []any  `json:"content"`
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	Tools     []anthropicTool    `json:"tools,omitempty"`
}

type anthropicResponse struct {
	Content []struct {
		Type  string          `json:"type"`
		Text  string          `json:"text"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	} `json:"content"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

func (c *AnthropicClient) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 120 * time.Second}
}

// Extract runs a one-turn text extraction.
func (c *AnthropicClient) Extract(ctx context.Context, system, user string,
	tool Tool) (json.RawMessage, error) {
	return c.messages(ctx, system, user, nil, tool)
}

// ExtractVision runs a one-turn extraction over images.
func (c *AnthropicClient) ExtractVision(ctx context.Context, system, user string,
	images []ImagePart, tool Tool) (json.RawMessage, error) {
	return c.messages(ctx, system, user, images, tool)
}

func (c *AnthropicClient) messages(ctx context.Context, system, user string,
	images []ImagePart, tool Tool) (json.RawMessage, error) {
	content := make([]any, 0, len(images)+1)
	content = append(content, map[string]any{"type": "text", "text": user})
	for _, image := range images {
		mimeType := image.MIMEType
		if mimeType == "" {
			mimeType = "image/png"
		}
		content = append(content, map[string]any{
			"type": "image",
			"source": anthropicSource{
				Type:      "base64",
				MediaType: mimeType,
				Data:      base64.StdEncoding.EncodeToString(image.Data),
			},
		})
	}
	maxTokens := c.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	body := anthropicRequest{
		Model:     c.Model,
		MaxTokens: maxTokens,
		System:    system,
		Messages:  []anthropicMessage{{Role: "user", Content: content}},
		Tools: []anthropicTool{{
			Name:        tool.Name,
			Description: tool.Description,
			InputSchema: tool.Schema,
		}},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = "https://api.anthropic.com"
	}
	url := base + "/v1/messages"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		return nil, fmt.Errorf("llm: %s: %s", resp.Status, strings.TrimSpace(string(msg)))
	}
	var reply anthropicResponse
	if err := json.NewDecoder(resp.Body).Decode(&reply); err != nil {
		return nil, fmt.Errorf("llm: bad reply: %w", err)
	}
	if reply.Error != nil {
		return nil, fmt.Errorf("llm: %s: %s", reply.Error.Type, reply.Error.Message)
	}
	var text strings.Builder
	var raw json.RawMessage
	for _, block := range reply.Content {
		switch block.Type {
		case "tool_use":
			if block.Name == tool.Name && len(block.Input) > 0 {
				raw = block.Input
			}
		case "text":
			text.WriteString(block.Text)
		}
	}
	if len(raw) == 0 {
		if i := strings.Index(text.String(), "{"); i >= 0 {
			if j := strings.LastIndex(text.String(), "}"); j > i {
				raw = json.RawMessage(text.String()[i : j+1])
			}
		}
	}
	if len(raw) == 0 {
		return nil, errors.New("llm: no tool call and no JSON object in the reply")
	}
	if err := Validate(tool.Schema, raw); err != nil {
		return nil, err
	}
	return raw, nil
}
