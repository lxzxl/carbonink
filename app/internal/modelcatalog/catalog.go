// Package modelcatalog lists the models each provider can serve and fetches
// the provider's live list when the user asks. It is deliberately small: the
// bundled rows are suggestions, and any model id can still be typed by hand.
package modelcatalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Model is one selectable model.
type Model struct {
	ID            string
	Name          string
	Reasoning     bool
	ContextWindow int
}

// Curated returns the bundled suggestions for a provider id.
func Curated(provider string) []Model {
	switch provider {
	case "openai":
		return []Model{
			{ID: "gpt-4o-mini", Name: "GPT-4o mini", ContextWindow: 128000},
			{ID: "gpt-4o", Name: "GPT-4o", ContextWindow: 128000},
			{ID: "o3-mini", Name: "o3-mini", Reasoning: true, ContextWindow: 200000},
		}
	case "deepseek":
		return []Model{
			{ID: "deepseek-chat", Name: "DeepSeek Chat", ContextWindow: 128000},
			{ID: "deepseek-reasoner", Name: "DeepSeek Reasoner", Reasoning: true,
				ContextWindow: 128000},
		}
	case "moonshot":
		return []Model{
			{ID: "moonshot-v1-8k", Name: "Moonshot v1 8K", ContextWindow: 8000},
			{ID: "moonshot-v1-32k", Name: "Moonshot v1 32K", ContextWindow: 32000},
			{ID: "moonshot-v1-128k", Name: "Moonshot v1 128K", ContextWindow: 128000},
		}
	case "anthropic":
		return []Model{
			{ID: "claude-sonnet-4-5", Name: "Claude Sonnet 4.5", ContextWindow: 200000},
			{ID: "claude-opus-4-1", Name: "Claude Opus 4.1", ContextWindow: 200000},
			{ID: "claude-haiku-4-5", Name: "Claude Haiku 4.5", ContextWindow: 200000},
		}
	}
	return nil
}

// Default is the provider's suggested model id.
func Default(provider string) string {
	models := Curated(provider)
	if len(models) == 0 {
		return ""
	}
	return models[0].ID
}

// Fetch asks the provider for its current model list.
func Fetch(ctx context.Context, provider, baseURL, apiKey string) ([]Model, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, errors.New("base URL is required")
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("an API key is required")
	}
	client := &http.Client{Timeout: 15 * time.Second}
	var request *http.Request
	var err error
	switch provider {
	case "anthropic":
		request, err = http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v1/models?limit=100", nil)
		if err != nil {
			return nil, err
		}
		request.Header.Set("x-api-key", apiKey)
		request.Header.Set("anthropic-version", "2023-06-01")
	default:
		request, err = http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/models", nil)
		if err != nil {
			return nil, err
		}
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("model list returned HTTP %d: %s",
			response.StatusCode, truncate(string(body), 300))
	}
	var parsed struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode model list: %w", err)
	}
	models := make([]Model, 0, len(parsed.Data))
	seen := map[string]bool{}
	for _, row := range parsed.Data {
		id := strings.TrimSpace(row.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		name := strings.TrimSpace(row.DisplayName)
		if name == "" {
			name = id
		}
		models = append(models, Model{ID: id, Name: name})
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}

func truncate(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "…"
}
