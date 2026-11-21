package app

import (
	"app.carbonink.desktop/internal/extraction"

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

// llmPresets are OpenAI-compatible endpoints. Anthropic and Gemini need
// dedicated adapters and are not offered here yet.
var llmPresets = []llmPreset{
	{ID: "openai", Label: "OpenAI", BaseURL: "https://api.openai.com/v1", Model: "gpt-4o-mini"},
	{ID: "deepseek", Label: "DeepSeek", BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-chat"},
	{ID: "moonshot", Label: "Moonshot", BaseURL: "https://api.moonshot.cn/v1", Model: "moonshot-v1-8k"},
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
