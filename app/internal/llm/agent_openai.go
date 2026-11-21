package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type agentRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Tools    []chatTool    `json:"tools,omitempty"`
}

type agentResponse struct {
	Choices []struct {
		Message struct {
			Content   string         `json:"content"`
			ToolCalls []chatToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// RunAgent drives the OpenAI-compatible tool loop without streaming.
func (c *Client) RunAgent(ctx context.Context, system, user string, tools []AgentTool,
	finish Tool, maxTurns int) (*AgentRun, error) {
	if maxTurns <= 0 {
		maxTurns = 6
	}
	defs := make([]chatTool, 0, len(tools)+1)
	for _, tool := range tools {
		defs = append(defs, chatTool{Type: "function", Function: chatFunction{
			Name: tool.Name, Description: tool.Description, Parameters: tool.Schema}})
	}
	defs = append(defs, chatTool{Type: "function", Function: chatFunction{
		Name: finish.Name, Description: finish.Description, Parameters: finish.Schema}})

	messages := []chatMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}
	run := &AgentRun{}
	for turn := 0; turn < maxTurns; turn++ {
		reply, err := c.agentCall(ctx, messages, defs)
		if err != nil {
			return nil, err
		}
		run.Turns++
		message := reply.Choices[0].Message
		for _, call := range message.ToolCalls {
			if call.Function.Name == finish.Name {
				if err := Validate(finish.Schema, []byte(call.Function.Arguments)); err != nil {
					return nil, err
				}
				run.Output = json.RawMessage(call.Function.Arguments)
				return run, nil
			}
		}
		if len(message.ToolCalls) == 0 {
			return nil, ErrAgentStalled
		}
		for i := range message.ToolCalls {
			if message.ToolCalls[i].ID == "" {
				message.ToolCalls[i].ID = fmt.Sprintf("call_%d_%d", turn, i)
			}
			if message.ToolCalls[i].Type == "" {
				message.ToolCalls[i].Type = "function"
			}
		}
		messages = append(messages, chatMessage{Role: "assistant",
			Content: message.Content, ToolCalls: message.ToolCalls})
		for _, call := range message.ToolCalls {
			content, _ := executeAgentTool(ctx, tools, call.Function.Name, call.Function.Arguments)
			run.ToolCalls = append(run.ToolCalls, call.Function.Name)
			messages = append(messages, chatMessage{Role: "tool", Content: content,
				ToolCallID: call.ID})
		}
	}
	return nil, ErrAgentMaxTurns
}

func (c *Client) agentCall(ctx context.Context, messages []chatMessage,
	tools []chatTool) (*agentResponse, error) {
	payload, err := json.Marshal(agentRequest{Model: c.Model, Messages: messages, Tools: tools})
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(c.BaseURL, "/") + "/chat/completions"
	var resp *http.Response
	err = withRetry(ctx, func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if c.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.APIKey)
		}
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
	var reply agentResponse
	if err := json.NewDecoder(resp.Body).Decode(&reply); err != nil {
		return nil, fmt.Errorf("llm: bad agent reply: %w", err)
	}
	if reply.Error != nil {
		return nil, fmt.Errorf("llm: %s: %s", reply.Error.Type, reply.Error.Message)
	}
	if len(reply.Choices) == 0 {
		return nil, fmt.Errorf("llm: agent reply has no choices")
	}
	return &reply, nil
}
