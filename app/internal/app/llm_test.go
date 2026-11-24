package app

import (
	"testing"

	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/llm"
)

func TestNewExtractorPicksAdapter(t *testing.T) {
	if _, ok := newExtractor(extraction.Provider{Name: "anthropic"}).(*llm.AnthropicClient); !ok {
		t.Fatal("anthropic did not get the Anthropic client")
	}
	if _, ok := newExtractor(extraction.Provider{Name: "gemini"}).(*llm.GeminiClient); !ok {
		t.Fatal("gemini did not get the Gemini client")
	}
	if _, ok := newExtractor(extraction.Provider{Name: "openai"}).(*llm.Client); !ok {
		t.Fatal("openai did not get the OpenAI-compatible client")
	}
	if _, ok := newAgentRunner(extraction.Provider{Name: "gemini"}).(*llm.GeminiClient); !ok {
		t.Fatal("gemini did not get the Gemini agent runner")
	}
}
