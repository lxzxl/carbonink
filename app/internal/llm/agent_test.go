package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestOpenAIAgentRunsToolsThenFinishes(t *testing.T) {
	var calls atomic.Int32
	var sawToolResult atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		n := calls.Add(1)
		if bytesContains(body, `"tool"`) && bytesContains(body, `"role":"tool"`) {
			sawToolResult.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		if n == 1 {
			fmt.Fprint(w, `{"choices":[{"message":{"content":"","tool_calls":[`+
				`{"id":"call_1","type":"function","function":{"name":"list_activities",`+
				`"arguments":"{\"year\":2025}"}}]},"finish_reason":"tool_calls"}]}`)
			return
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"","tool_calls":[`+
			`{"id":"call_2","type":"function","function":{"name":"submit_response",`+
			`"arguments":"{\"value\":\"120000\",\"unit\":\"kWh\",\"source_summary\":\"from activities\"}"}}]},`+
			`"finish_reason":"tool_calls"}]}`)
	}))
	defer srv.Close()

	client := &Client{BaseURL: srv.URL, Model: "test"}
	var ran atomic.Bool
	tool := AgentTool{Name: "list_activities", Description: "list",
		Schema: json.RawMessage(`{"type":"object"}`),
		Run: func(_ context.Context, args json.RawMessage) (any, error) {
			ran.Store(true)
			if !strings.Contains(string(args), "2025") {
				t.Errorf("args = %s", args)
			}
			return map[string]any{"count": 1, "activities": []any{}}, nil
		}}
	finish := Tool{Name: "submit_response", Description: "finish",
		Schema: json.RawMessage(`{"type":"object","required":["value","unit","source_summary"],` +
			`"properties":{"value":{"type":"string"},"unit":{"type":["string","null"]},` +
			`"source_summary":{"type":"string"}}}`)}
	run, err := client.RunAgent(context.Background(), "system", "question",
		[]AgentTool{tool}, finish, 6)
	if err != nil {
		t.Fatal(err)
	}
	if run.Turns != 2 || !ran.Load() || !sawToolResult.Load() {
		t.Fatalf("run = %+v, ran = %v, tool result = %v", run, ran.Load(), sawToolResult.Load())
	}
	if len(run.ToolCalls) != 1 || run.ToolCalls[0] != "list_activities" {
		t.Fatalf("tool calls = %v", run.ToolCalls)
	}
	if len(run.Steps) != 1 || run.Steps[0].Tool != "list_activities" || run.Steps[0].Turn != 1 ||
		!strings.Contains(run.Steps[0].Args, "2025") || !strings.Contains(run.Steps[0].Result, `"count":1`) {
		t.Fatalf("steps = %+v", run.Steps)
	}
	if !strings.Contains(string(run.Output), "120000") {
		t.Fatalf("output = %s", run.Output)
	}
}

func TestOpenAIAgentStopsWithoutFinish(t *testing.T) {
	var toolCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"choices":[{"message":{"content":"","tool_calls":[`+
			`{"id":"call_%d","type":"function","function":{"name":"lookup",`+
			`"arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`, toolCalls.Add(1))
	}))
	defer srv.Close()
	client := &Client{BaseURL: srv.URL, Model: "test"}
	tools := []AgentTool{{Name: "lookup", Description: "lookup",
		Schema: json.RawMessage(`{"type":"object"}`),
		Run: func(context.Context, json.RawMessage) (any, error) {
			return map[string]any{"ok": true}, nil
		}}}
	finish := Tool{Name: "submit_response", Description: "finish",
		Schema: json.RawMessage(`{"type":"object"}`)}
	if _, err := client.RunAgent(context.Background(), "s", "u", tools, finish, 2); err != ErrAgentMaxTurns {
		t.Fatalf("error = %v, want ErrAgentMaxTurns", err)
	}

	stalled := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"content":"done","tool_calls":[]}}]}`)
	}))
	defer stalled.Close()
	client.BaseURL = stalled.URL
	if _, err := client.RunAgent(context.Background(), "s", "u", tools, finish, 2); err != ErrAgentStalled {
		t.Fatalf("error = %v, want ErrAgentStalled", err)
	}
}

func TestAnthropicAgentRunsToolResult(t *testing.T) {
	var calls atomic.Int32
	var sawToolResult atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		n := calls.Add(1)
		if bytesContains(body, `"tool_result"`) {
			sawToolResult.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		if n == 1 {
			fmt.Fprint(w, `{"content":[{"type":"tool_use","id":"tu_1","name":"sum_co2e",`+
				`"input":{"year":2025}}]}`)
			return
		}
		fmt.Fprint(w, `{"content":[{"type":"tool_use","id":"tu_2","name":"submit_response",`+
			`"input":{"value":"42","unit":"tCO2e","source_summary":"summed"}}]}`)
	}))
	defer srv.Close()
	client := &AnthropicClient{BaseURL: srv.URL, Model: "test"}
	tools := []AgentTool{{Name: "sum_co2e", Description: "sum",
		Schema: json.RawMessage(`{"type":"object"}`),
		Run: func(context.Context, json.RawMessage) (any, error) {
			return map[string]any{"total_kg": 42, "count": 1}, nil
		}}}
	finish := Tool{Name: "submit_response", Description: "finish",
		Schema: json.RawMessage(`{"type":"object","required":["value"],` +
			`"properties":{"value":{"type":"string"},"unit":{"type":["string","null"]},` +
			`"source_summary":{"type":"string"}}}`)}
	run, err := client.RunAgent(context.Background(), "s", "u", tools, finish, 6)
	if err != nil {
		t.Fatal(err)
	}
	if run.Turns != 2 || !sawToolResult.Load() || !strings.Contains(string(run.Output), "42") {
		t.Fatalf("run = %+v, tool result = %v", run, sawToolResult.Load())
	}
}

func bytesContains(data []byte, s string) bool {
	return strings.Contains(string(data), s)
}
