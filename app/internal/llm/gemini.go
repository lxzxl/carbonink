package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const defaultGeminiBaseURL = "https://generativelanguage.googleapis.com/v1beta"

// GeminiClient speaks Google's Gemini generateContent API and implements both
// Extractor and AgentRunner.
type GeminiClient struct {
	BaseURL   string
	APIKey    string
	Model     string
	HTTP      *http.Client
	MaxTokens int
}

type geminiPart struct {
	Text             string                  `json:"text,omitempty"`
	InlineData       *geminiInlineData       `json:"inlineData,omitempty"`
	FunctionCall     *geminiFunctionCall     `json:"functionCall,omitempty"`
	FunctionResponse *geminiFunctionResponse `json:"functionResponse,omitempty"`
}

type geminiInlineData struct {
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiFunctionCall struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type geminiFunctionResponse struct {
	Name     string `json:"name"`
	Response any    `json:"response"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiFunctionDecl struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

type geminiToolGroup struct {
	FunctionDeclarations []geminiFunctionDecl `json:"functionDeclarations"`
}

type geminiToolConfig struct {
	FunctionCallingConfig struct {
		Mode                 string   `json:"mode"`
		AllowedFunctionNames []string `json:"allowedFunctionNames,omitempty"`
	} `json:"functionCallingConfig"`
}

type geminiGenerationConfig struct {
	MaxOutputTokens int `json:"maxOutputTokens,omitempty"`
}

type geminiRequest struct {
	SystemInstruction *geminiContent          `json:"systemInstruction,omitempty"`
	Contents          []geminiContent         `json:"contents"`
	Tools             []geminiToolGroup       `json:"tools,omitempty"`
	ToolConfig        *geminiToolConfig       `json:"toolConfig,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
}

type geminiResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error"`
}

func (c *GeminiClient) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 120 * time.Second}
}

// Extract runs a one-turn structured extraction against Gemini.
func (c *GeminiClient) Extract(ctx context.Context, system, user string,
	tool Tool) (json.RawMessage, error) {
	return c.extract(ctx, system, user, nil, tool)
}

// ExtractVision runs a one-turn structured extraction over images.
func (c *GeminiClient) ExtractVision(ctx context.Context, system, user string,
	images []ImagePart, tool Tool) (json.RawMessage, error) {
	return c.extract(ctx, system, user, images, tool)
}

func (c *GeminiClient) extract(ctx context.Context, system, user string,
	images []ImagePart, tool Tool) (json.RawMessage, error) {
	parts := make([]geminiPart, 0, len(images)+1)
	parts = append(parts, geminiPart{Text: user})
	for _, image := range images {
		mimeType := image.MIMEType
		if mimeType == "" {
			mimeType = "image/png"
		}
		parts = append(parts, geminiPart{
			InlineData: &geminiInlineData{
				MIMEType: mimeType,
				Data:     base64.StdEncoding.EncodeToString(image.Data),
			},
		})
	}
	cfg := &geminiToolConfig{}
	cfg.FunctionCallingConfig.Mode = "ANY"
	cfg.FunctionCallingConfig.AllowedFunctionNames = []string{tool.Name}

	reply, err := c.generateContent(ctx, system,
		[]geminiContent{{Role: "user", Parts: parts}},
		[]geminiFunctionDecl{{
			Name:        tool.Name,
			Description: tool.Description,
			Parameters:  sanitizeGeminiSchema(tool.Schema),
		}},
		cfg,
	)
	if err != nil {
		return nil, err
	}
	var text strings.Builder
	var call *geminiFunctionCall
	for _, cand := range reply.Candidates {
		for _, part := range cand.Content.Parts {
			if part.FunctionCall != nil && call == nil {
				fc := *part.FunctionCall
				call = &fc
			}
			if part.Text != "" {
				text.WriteString(part.Text)
			}
		}
	}
	var raw []byte
	if call != nil && call.Name == tool.Name && len(bytes.TrimSpace(call.Args)) > 0 {
		raw = call.Args
	} else if i := strings.Index(text.String(), "{"); i >= 0 {
		if j := strings.LastIndex(text.String(), "}"); j > i {
			raw = []byte(text.String()[i : j+1])
		}
	}
	if len(raw) == 0 {
		return nil, errors.New("llm: no functionCall and no JSON object in the reply")
	}
	if err := Validate(tool.Schema, raw); err != nil {
		return nil, err
	}
	return json.RawMessage(raw), nil
}

// RunAgent drives Gemini's multi-turn function calling loop until finish is called.
func (c *GeminiClient) RunAgent(ctx context.Context, system, user string, tools []AgentTool,
	finish Tool, maxTurns int) (*AgentRun, error) {
	if maxTurns <= 0 {
		maxTurns = 6
	}
	decls := make([]geminiFunctionDecl, 0, len(tools)+1)
	for _, tool := range tools {
		decls = append(decls, geminiFunctionDecl{
			Name:        tool.Name,
			Description: tool.Description,
			Parameters:  sanitizeGeminiSchema(tool.Schema),
		})
	}
	decls = append(decls, geminiFunctionDecl{
		Name:        finish.Name,
		Description: finish.Description,
		Parameters:  sanitizeGeminiSchema(finish.Schema),
	})

	cfg := &geminiToolConfig{}
	cfg.FunctionCallingConfig.Mode = "AUTO"

	contents := []geminiContent{{
		Role:  "user",
		Parts: []geminiPart{{Text: user}},
	}}
	run := &AgentRun{}
	for turn := 0; turn < maxTurns; turn++ {
		reply, err := c.generateContent(ctx, system, contents, decls, cfg)
		if err != nil {
			return nil, err
		}
		run.Turns++
		if len(reply.Candidates) == 0 {
			return nil, ErrAgentStalled
		}
		modelContent := reply.Candidates[0].Content
		if modelContent.Role == "" {
			modelContent.Role = "model"
		}
		var responses []geminiPart
		for _, part := range modelContent.Parts {
			if part.FunctionCall == nil {
				continue
			}
			fc := part.FunctionCall
			if fc.Name == finish.Name {
				args := fc.Args
				if len(bytes.TrimSpace(args)) == 0 {
					args = json.RawMessage("{}")
				}
				if err := Validate(finish.Schema, args); err != nil {
					return nil, err
				}
				run.Output = args
				return run, nil
			}
			started := time.Now()
			resultJSON, isError := executeAgentTool(ctx, tools, fc.Name, string(fc.Args))
			recordAgentStep(run, run.Turns, fc.Name, string(fc.Args),
				resultJSON, isError, time.Since(started))
			var decoded any
			if err := json.Unmarshal([]byte(resultJSON), &decoded); err != nil {
				decoded = resultJSON
			}
			respPayload := map[string]any{"result": decoded}
			if isError {
				respPayload = map[string]any{"error": decoded}
			}
			responses = append(responses, geminiPart{
				FunctionResponse: &geminiFunctionResponse{
					Name:     fc.Name,
					Response: respPayload,
				},
			})
		}
		if len(responses) == 0 {
			return run, ErrAgentStalled
		}
		contents = append(contents, modelContent)
		contents = append(contents, geminiContent{
			Role:  "user",
			Parts: responses,
		})
	}
	return run, ErrAgentMaxTurns
}

func (c *GeminiClient) generateContent(ctx context.Context, system string,
	contents []geminiContent, decls []geminiFunctionDecl,
	toolConfig *geminiToolConfig) (*geminiResponse, error) {
	body := geminiRequest{
		Contents:   contents,
		ToolConfig: toolConfig,
	}
	if strings.TrimSpace(system) != "" {
		body.SystemInstruction = &geminiContent{
			Parts: []geminiPart{{Text: system}},
		}
	}
	if len(decls) > 0 {
		body.Tools = []geminiToolGroup{{FunctionDeclarations: decls}}
	}
	if c.MaxTokens > 0 {
		body.GenerationConfig = &geminiGenerationConfig{MaxOutputTokens: c.MaxTokens}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = defaultGeminiBaseURL
	}
	model := strings.TrimPrefix(strings.TrimSpace(c.Model), "models/")
	url := fmt.Sprintf("%s/models/%s:generateContent", base, model)

	var resp *http.Response
	err = withRetry(ctx, func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-goog-api-key", c.APIKey)
		resp, err = c.httpClient().Do(req)
		if err != nil {
			return err
		}
		if resp.StatusCode != http.StatusOK {
			return httpError(resp)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var reply geminiResponse
	if err := json.NewDecoder(resp.Body).Decode(&reply); err != nil {
		return nil, fmt.Errorf("llm: bad gemini reply: %w", err)
	}
	if reply.Error != nil {
		return nil, fmt.Errorf("llm: %s: %s", reply.Error.Status, reply.Error.Message)
	}
	return &reply, nil
}

// sanitizeGeminiSchema removes JSON Schema keywords (like additionalProperties
// and $schema) that Gemini's FunctionDeclaration.parameters rejects.
func sanitizeGeminiSchema(raw json.RawMessage) json.RawMessage {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	var node any
	if err := json.Unmarshal(raw, &node); err != nil {
		return raw
	}
	cleaned := stripUnsupportedSchemaKeys(node)
	out, err := json.Marshal(cleaned)
	if err != nil {
		return raw
	}
	return out
}

func stripUnsupportedSchemaKeys(node any) any {
	switch v := node.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, val := range v {
			if k == "additionalProperties" || k == "$schema" {
				continue
			}
			out[k] = stripUnsupportedSchemaKeys(val)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = stripUnsupportedSchemaKeys(item)
		}
		return out
	default:
		return node
	}
}
