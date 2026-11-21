package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestModelCatalogAndProviderGuidance proves the settings screen fetches the
// provider's live model list and switches guidance with the provider.
func TestModelCatalogAndProviderGuidance(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"id":"z-fetched"},{"id":"a-fetched"}]}`)
	}))
	defer srv.Close()

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	configureLLMEndpoint(t, ui, srv.URL)

	ui.WaitFor("text:Suggested models", 3*time.Second)
	ui.Press("id:settings-llm-fetch-models")
	ui.WaitFor("text:Model list updated.", 10*time.Second)

	ui.Press("id:settings-llm-model-suggested")
	ui.WaitFor("id:settings-llm-model-suggested-4", 3*time.Second)
	ui.Press("id:settings-llm-model-suggested-4")

	ui.Press("id:settings-llm-provider")
	ui.WaitFor("id:settings-llm-provider-1", 3*time.Second)
	ui.Press("id:settings-llm-provider-1")
	ui.WaitFor("text:Low latency from China. Strong Chinese. Pay-per-token, low cost.", 3*time.Second)
}
