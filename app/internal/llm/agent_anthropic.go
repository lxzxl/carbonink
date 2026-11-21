package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// RunAgent drives the Anthropic Messages tool loop without streaming.
func (c *AnthropicClient) RunAgent(ctx context.Context, system, user string, tools []AgentTool,
	finish Tool, maxTurns int) (*AgentRun, error) {
	if maxTurns <= 0 {
		maxTurns = 6
	}
	defs := make([]anthropicTool, 0, len(tools)+1)
	for _, tool := range tools {
		defs = append(defs, anthropicTool{Name: tool.Name, Description: tool.Description,
			InputSchema: tool.Schema})
	}
	defs = append(defs, anthropicTool{Name: finish.Name, Description: finish.Description,
		InputSchema: finish.Schema})

	messages := []anthropicMessage{{Role: "user", Content: []any{
		map[string]any{"type": "text", "text": user},
	}}}
	run := &AgentRun{}
	for turn := 0; turn < maxTurns; turn++ {
		reply, err := c.agentMessage(ctx, system, messages, defs)
		if err != nil {
			return nil, err
		}
		run.Turns++
		assistant := make([]any, 0, len(reply.Content))
		var results []any
		for _, block := range reply.Content {
			switch block.Type {
			case "text":
				assistant = append(assistant, map[string]any{"type": "text", "text": block.Text})
			case "tool_use":
				if block.Name == finish.Name {
					if err := Validate(finish.Schema, block.Input); err != nil {
						return nil, err
					}
					run.Output = block.Input
					return run, nil
				}
				var input any
				if err := json.Unmarshal(block.Input, &input); err != nil {
					input = map[string]any{}
				}
				assistant = append(assistant, map[string]any{"type": "tool_use",
					"id": block.ID, "name": block.Name, "input": input})
				content, isError := executeAgentTool(ctx, tools, block.Name,
					string(block.Input))
				run.ToolCalls = append(run.ToolCalls, block.Name)
				result := map[string]any{"type": "tool_result", "tool_use_id": block.ID,
					"content": content}
				if isError {
					result["is_error"] = true
				}
				results = append(results, result)
			}
		}
		if len(results) == 0 {
			return nil, ErrAgentStalled
		}
		messages = append(messages, anthropicMessage{Role: "assistant", Content: assistant})
		messages = append(messages, anthropicMessage{Role: "user", Content: results})
	}
	return nil, ErrAgentMaxTurns
}

func (c *AnthropicClient) agentMessage(ctx context.Context, system string,
	messages []anthropicMessage, tools []anthropicTool) (*anthropicResponse, error) {
	maxTokens := c.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	body := anthropicRequest{Model: c.Model, MaxTokens: maxTokens, System: system,
		Messages: messages, Tools: tools}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = "https://api.anthropic.com"
	}
	url := base + "/v1/messages"
	var resp *http.Response
	err = withRetry(ctx, func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", c.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
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
	var reply anthropicResponse
	if err := json.NewDecoder(resp.Body).Decode(&reply); err != nil {
		return nil, fmt.Errorf("llm: bad agent reply: %w", err)
	}
	if reply.Error != nil {
		return nil, fmt.Errorf("llm: %s: %s", reply.Error.Type, reply.Error.Message)
	}
	return &reply, nil
}
