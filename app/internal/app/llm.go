package app

import (
	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/llm"

	"github.com/nsgo-dev/nsgo/core"
)

// llmSecretAccount is the keychain item that holds the provider API key.
// Provider, base URL and model live in settings.json; the key never does.
const llmSecretAccount = "llm.api_key"

type llmPreset struct {
	ID      string
	Label   string
	BaseURL string
	Model   string
}

// llmPresets are the provider endpoints the app can speak to. Anthropic uses
// its own adapter; the rest share the OpenAI-compatible client.
var llmPresets = []llmPreset{
	{ID: "openai", Label: "OpenAI", BaseURL: "https://api.openai.com/v1", Model: "gpt-4o-mini"},
	{ID: "deepseek", Label: "DeepSeek", BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-chat"},
	{ID: "moonshot", Label: "Moonshot", BaseURL: "https://api.moonshot.cn/v1", Model: "moonshot-v1-8k"},
	{ID: "anthropic", Label: "Anthropic", BaseURL: "https://api.anthropic.com", Model: "claude-sonnet-4-5"},
}

func (s *Session) llmProvider(cx *core.Scope) extraction.Provider {
	provider := extraction.Provider{
		Name:    s.settings.LLMProvider,
		BaseURL: s.settings.LLMBaseURL,
		Model:   s.settings.LLMModel,
	}
	if provider.Name == "" {
		provider.Name = "openai"
	}
	if key, ok, err := cx.Secrets().Get(llmSecretAccount); err == nil && ok {
		provider.APIKey = key
	}
	return provider
}

func newExtractor(provider extraction.Provider) llm.Extractor {
	if provider.Name == "anthropic" {
		return &llm.AnthropicClient{BaseURL: provider.BaseURL, APIKey: provider.APIKey,
			Model: provider.Model}
	}
	return &llm.Client{BaseURL: provider.BaseURL, APIKey: provider.APIKey, Model: provider.Model}
}
