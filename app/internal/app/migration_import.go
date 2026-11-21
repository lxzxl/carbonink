package app

import (
	"context"
	"encoding/json"
	"strings"

	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/internal/store"
)

// legacyProvider is the shape 1.x stored under the `llm.provider` setting:
// public provider metadata only. The API key never lived here — Electron kept
// it as a safeStorage blob under <userData>/credentials.
type legacyProvider struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	BaseURL  string `json:"baseUrl"`
}

// adoptLegacyProvider copies the provider choice from an imported 1.x
// workspace into prefs. It reports whether it wrote anything.
//
// The API key cannot be carried over: safeStorage blobs are tied to the old
// app's encryption context, so 2.0 asks the user to re-enter it once instead
// of shipping an Electron-only export step.
func adoptLegacyProvider(ctx context.Context, db *store.Store, s *prefs.Settings) bool {
	if s.LLMProvider != "" || s.LLMBaseURL != "" || s.LLMModel != "" {
		return false
	}
	raw, ok, err := db.Setting(ctx, "llm.provider")
	if err != nil || !ok {
		return false
	}
	var cfg legacyProvider
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return false
	}
	provider := strings.TrimSpace(cfg.Provider)
	model := strings.TrimSpace(cfg.Model)
	if provider == "" || model == "" {
		return false
	}
	baseURL := strings.TrimSpace(cfg.BaseURL)
	preset, known := llmPresetByID(provider)
	if !known {
		// 1.x's catalog came from pi-ai and is wider than ours. Keep the
		// endpoint so those providers still work as a custom one.
		if baseURL == "" {
			return false
		}
		provider = "custom"
	} else if baseURL == "" {
		baseURL = preset.BaseURL
	}
	s.LLMProvider = provider
	s.LLMModel = model
	s.LLMBaseURL = baseURL
	return true
}

func llmPresetByID(id string) (llmPreset, bool) {
	for _, preset := range llmPresets {
		if preset.ID == id {
			return preset, true
		}
	}
	return llmPreset{}, false
}
