package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiExtract(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models/gemini-2.5-flash:generateContent" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("x-goog-api-key"); got != "gem-key" {
			t.Errorf("x-goog-api-key = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"save","args":{"amount":12.5,"unit":"kWh"}}}]}}]}`)
	}))
	defer srv.Close()

	c := &GeminiClient{BaseURL: srv.URL + "/v1beta", APIKey: "gem-key", Model: "gemini-2.5-flash"}
	tool := Tool{
		Name:        "save",
		Description: "Save one row.",
		Schema: json.RawMessage(`{
			"$schema":"https://json-schema.org/draft/2020-12/schema",
			"type":"object",
			"additionalProperties":false,
			"required":["amount","unit"],
			"properties":{"amount":{"type":"number"},"unit":{"type":"string"}}
		}`),
	}
	raw, err := c.Extract(context.Background(), "sys", "user", tool)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"amount":12.5`) {
		t.Fatalf("raw = %s", raw)
	}
	tools, _ := body["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("tools = %+v", body["tools"])
	}
	group, _ := tools[0].(map[string]any)
	decls, _ := group["functionDeclarations"].([]any)
	if len(decls) != 1 {
		t.Fatalf("decls = %+v", group)
	}
	decl, _ := decls[0].(map[string]any)
	params, _ := decl["parameters"].(map[string]any)
	if _, has := params["additionalProperties"]; has {
		t.Fatalf("gemini parameters retained additionalProperties: %+v", params)
	}
	if _, has := params["$schema"]; has {
		t.Fatalf("gemini parameters retained $schema: %+v", params)
	}
}

func TestGeminiExtractVisionAndAgent(t *testing.T) {
	turn := 0
	var seenInline bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		contents, _ := body["contents"].([]any)
		if len(contents) == 1 {
			first, _ := contents[0].(map[string]any)
			parts, _ := first["parts"].([]any)
			for _, p := range parts {
				pm, _ := p.(map[string]any)
				if pm["inlineData"] != nil {
					seenInline = true
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		turn++
		if r.URL.RawQuery == "vision" || seenInline && turn == 1 {
			fmt.Fprint(w, `{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"save","args":{"ok":true}}}]}}]}`)
			return
		}
		if turn == 2 {
			fmt.Fprint(w, `{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"lookup","args":{"q":"power"}}}]}}]}`)
			return
		}
		fmt.Fprint(w, `{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"finish","args":{"answer":"42"}}}]}}]}`)
	}))
	defer srv.Close()

	c := &GeminiClient{BaseURL: srv.URL, APIKey: "gem-key", Model: "gemini-2.5-flash"}
	vTool := Tool{Name: "save", Schema: json.RawMessage(`{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}`)}
	if _, err := c.ExtractVision(context.Background(), "sys", "read", []ImagePart{{Data: []byte{1, 2}}}, vTool); err != nil {
		t.Fatal(err)
	}
	if !seenInline {
		t.Fatal("vision request omitted inlineData")
	}

	tools := []AgentTool{{
		Name:   "lookup",
		Schema: json.RawMessage(`{"type":"object","properties":{"q":{"type":"string"}}}`),
		Run: func(ctx context.Context, args json.RawMessage) (any, error) {
			return map[string]string{"value": "42"}, nil
		},
	}}
	finish := Tool{
		Name:   "finish",
		Schema: json.RawMessage(`{"type":"object","required":["answer"],"properties":{"answer":{"type":"string"}}}`),
	}
	run, err := c.RunAgent(context.Background(), "sys", "go", tools, finish, 4)
	if err != nil {
		t.Fatal(err)
	}
	if run.Turns != 2 || len(run.ToolCalls) != 1 || run.ToolCalls[0] != "lookup" {
		t.Fatalf("run = %+v", run)
	}
	if !strings.Contains(string(run.Output), `"answer":"42"`) {
		t.Fatalf("output = %s", run.Output)
	}
}
