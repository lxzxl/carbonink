package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// sseServer answers one chat completion with the given data frames.
func sseServer(t *testing.T, frames ...string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		for _, f := range frames {
			fmt.Fprintf(w, "data: %s\n\n", f)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
	}))
}

func TestStreamText(t *testing.T) {
	srv := sseServer(t,
		`{"choices":[{"delta":{"content":"碳排放"}}]}`,
		`{"choices":[{"delta":{"content":" 12.4 t"}}]}`,
		`{"choices":[{"delta":{},"finish_reason":"stop"}]}`,
		`[DONE]`,
	)
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, APIKey: "test-key", Model: "test"}
	events, err := c.Stream(context.Background(), "sys", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	var text strings.Builder
	for ev := range events {
		if ev.Err != nil {
			t.Fatal(ev.Err)
		}
		text.WriteString(ev.Text)
	}
	if got, want := text.String(), "碳排放 12.4 t"; got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
}

func TestExtractToolCall(t *testing.T) {
	srv := sseServer(t,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"save_activity","arguments":"{\"amount\":"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"12.5,\"unit\":\"kWh\"}"}}]}}]}`,
		`{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		`[DONE]`,
	)
	defer srv.Close()
	tool := Tool{Name: "save_activity", Description: "Save one activity row.",
		Schema: json.RawMessage(`{"type":"object","required":["amount","unit"],"properties":{"amount":{"type":"number","minimum":0},"unit":{"type":"string","enum":["kWh","L","t"]}},"additionalProperties":false}`)}
	c := &Client{BaseURL: srv.URL, APIKey: "test-key", Model: "test"}
	got, err := c.Extract(context.Background(), "sys", "user", tool)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Amount float64 `json:"amount"`
		Unit   string  `json:"unit"`
	}
	if err := json.Unmarshal(got, &out); err != nil {
		t.Fatal(err)
	}
	if out.Amount != 12.5 || out.Unit != "kWh" {
		t.Fatalf("out = %+v", out)
	}
}

func TestExtractRejectsBadSchema(t *testing.T) {
	srv := sseServer(t,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"save_activity","arguments":"{\"amount\":-1,\"unit\":\"barrel\"}"}}]}}]}`,
		`{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		`[DONE]`,
	)
	defer srv.Close()
	tool := Tool{Name: "save_activity",
		Schema: json.RawMessage(`{"type":"object","required":["amount","unit"],"properties":{"amount":{"type":"number","minimum":0},"unit":{"type":"string","enum":["kWh","L","t"]}}}`)}
	c := &Client{BaseURL: srv.URL, APIKey: "test-key", Model: "test"}
	if _, err := c.Extract(context.Background(), "sys", "user", tool); err == nil {
		t.Fatal("expected a schema error")
	}
}

func TestExtractVisionSendsImageParts(t *testing.T) {
	var content json.RawMessage
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			return
		}
		var request struct {
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(body, &request); err != nil {
			t.Error(err)
			return
		}
		if len(request.Messages) != 2 {
			t.Errorf("messages = %d", len(request.Messages))
			return
		}
		content = request.Messages[1].Content
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"type\":\"function\",\"function\":{\"name\":\"save\",\"arguments\":\"{\\\"ok\\\":true}\"}}]}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, APIKey: "test-key", Model: "test"}
	tool := Tool{Name: "save", Schema: json.RawMessage(`{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}`)}
	if _, err := c.ExtractVision(context.Background(), "sys", "read this", []ImagePart{
		{MIMEType: "image/png", Data: []byte{1, 2, 3}},
	}, tool); err != nil {
		t.Fatal(err)
	}
	var parts []struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		ImageURL struct {
			URL string `json:"url"`
		} `json:"image_url"`
	}
	if err := json.Unmarshal(content, &parts); err != nil {
		t.Fatalf("content = %s: %v", content, err)
	}
	if len(parts) != 2 || parts[0].Type != "text" || parts[0].Text != "read this" {
		t.Fatalf("parts = %+v", parts)
	}
	if parts[1].Type != "image_url" || !strings.HasPrefix(parts[1].ImageURL.URL, "data:image/png;base64,") {
		t.Fatalf("image part = %+v", parts[1])
	}
}

func TestHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"bad key"}}`, http.StatusUnauthorized)
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, APIKey: "test-key", Model: "test"}
	if _, err := c.Stream(context.Background(), "sys", "user", nil); err == nil ||
		!strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v", err)
	}
}

func TestValidate(t *testing.T) {
	schema := []byte(`{"type":"object","required":["a"],"properties":{"a":{"type":"integer"}}}`)
	if err := Validate(schema, []byte(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	if err := Validate(schema, []byte(`{"a":"one"}`)); err == nil {
		t.Fatal("expected a type error")
	}
}
