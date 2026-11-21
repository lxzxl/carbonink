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

func TestAnthropicExtract(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("x-api-key"); got != "test-key" {
			t.Errorf("x-api-key = %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != "2023-06-01" {
			t.Errorf("anthropic-version = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"content":[{"type":"tool_use","name":"save","input":{"amount":12.5,"unit":"kWh"}}]}`)
	}))
	defer srv.Close()
	c := &AnthropicClient{BaseURL: srv.URL, APIKey: "test-key", Model: "claude-test"}
	tool := Tool{Name: "save", Description: "Save one row.",
		Schema: json.RawMessage(`{"type":"object","required":["amount","unit"],"properties":{"amount":{"type":"number"},"unit":{"type":"string"}}}`)}
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
	first, _ := tools[0].(map[string]any)
	if first["name"] != "save" || first["input_schema"] == nil {
		t.Fatalf("tool = %+v", first)
	}
}

func TestAnthropicExtractVision(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"content":[{"type":"tool_use","name":"save","input":{"ok":true}}]}`)
	}))
	defer srv.Close()
	c := &AnthropicClient{BaseURL: srv.URL, APIKey: "test-key", Model: "claude-test"}
	tool := Tool{Name: "save", Schema: json.RawMessage(`{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}`)}
	if _, err := c.ExtractVision(context.Background(), "sys", "read this", []ImagePart{
		{MIMEType: "image/png", Data: []byte{1, 2, 3}},
	}, tool); err != nil {
		t.Fatal(err)
	}
	messages, _ := body["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("messages = %+v", body["messages"])
	}
	message, _ := messages[0].(map[string]any)
	content, _ := message["content"].([]any)
	if len(content) != 2 {
		t.Fatalf("content = %+v", content)
	}
	image, _ := content[1].(map[string]any)
	source, _ := image["source"].(map[string]any)
	if image["type"] != "image" || source["type"] != "base64" ||
		source["media_type"] != "image/png" || source["data"] == "" {
		t.Fatalf("image = %+v", image)
	}
}

func TestAnthropicHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"type":"authentication_error","message":"bad key"}}`, http.StatusUnauthorized)
	}))
	defer srv.Close()
	c := &AnthropicClient{BaseURL: srv.URL, APIKey: "bad", Model: "claude-test"}
	tool := Tool{Name: "save", Schema: json.RawMessage(`{"type":"object"}`)}
	if _, err := c.Extract(context.Background(), "sys", "user", tool); err == nil ||
		!strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v", err)
	}
}
