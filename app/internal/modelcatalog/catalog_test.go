package modelcatalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCuratedDefaults(t *testing.T) {
	for _, provider := range []string{"openai", "deepseek", "moonshot", "anthropic", "gemini"} {
		if Default(provider) == "" || len(Curated(provider)) == 0 {
			t.Fatalf("%s has no catalog", provider)
		}
	}
	if len(Curated("custom")) != 0 || Default("custom") != "" {
		t.Fatal("custom provider should have no curated rows")
	}
}

func TestFetchOpenAICompatible(t *testing.T) {
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if r.URL.Path != "/v1/models" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"}]}`))
	}))
	defer srv.Close()

	models, err := Fetch(context.Background(), "openai", srv.URL+"/v1", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer secret" {
		t.Fatalf("auth = %q", auth)
	}
	if len(models) != 2 || models[0].ID != "a-model" || models[1].ID != "z-model" {
		t.Fatalf("models = %+v", models)
	}
}

func TestFetchAnthropic(t *testing.T) {
	var key, version string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key = r.Header.Get("x-api-key")
		version = r.Header.Get("anthropic-version")
		_, _ = w.Write([]byte(`{"data":[{"id":"claude-test","display_name":"Claude Test"}]}`))
	}))
	defer srv.Close()

	models, err := Fetch(context.Background(), "anthropic", srv.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if key != "secret" || version == "" {
		t.Fatalf("headers = %q / %q", key, version)
	}
	if len(models) != 1 || models[0].Name != "Claude Test" {
		t.Fatalf("models = %+v", models)
	}
}

func TestFetchGemini(t *testing.T) {
	var key string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key = r.Header.Get("x-goog-api-key")
		if r.URL.Path != "/v1beta/models" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"models":[` +
			`{"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]},` +
			`{"name":"models/gemini-2.5-flash","displayName":"Gemini 2.5 Flash","supportedGenerationMethods":["generateContent"]}` +
			`]}`))
	}))
	defer srv.Close()

	models, err := Fetch(context.Background(), "gemini", srv.URL+"/v1beta", "gem-secret")
	if err != nil {
		t.Fatal(err)
	}
	if key != "gem-secret" {
		t.Fatalf("x-goog-api-key = %q", key)
	}
	if len(models) != 1 || models[0].ID != "gemini-2.5-flash" || models[0].Name != "Gemini 2.5 Flash" {
		t.Fatalf("models = %+v", models)
	}
}

func TestFetchErrors(t *testing.T) {
	if _, err := Fetch(context.Background(), "openai", "", "key"); err == nil {
		t.Fatal("expected base URL error")
	}
	if _, err := Fetch(context.Background(), "openai", "http://example.invalid", ""); err == nil {
		t.Fatal("expected key error")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusUnauthorized)
	}))
	defer srv.Close()
	_, err := Fetch(context.Background(), "openai", srv.URL, "key")
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v", err)
	}
}
