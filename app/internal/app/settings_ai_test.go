package app

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestAiProviderSavedKeyRow proves a saved key is shown as 1.x's masked,
// read-only row until Replace switches back to the password field.
func TestAiProviderSavedKeyRow(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "sk-test-12345"}))

	openSettings(ui, "ai")
	ui.WaitFor("id:settings-llm-key-saved", 3*time.Second)
	ui.WaitFor("text:sk-...2345", 3*time.Second)
	ui.WaitFor("text:Saved", 3*time.Second)

	ui.Press("id:settings-llm-key-replace")
	ui.WaitFor("id:settings-llm-key", 3*time.Second)
}
