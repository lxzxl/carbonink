package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestAgentIntegrationFromSettings(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	home := t.TempDir()
	configDir := t.TempDir()
	t.Setenv("CARBONINK_AGENT_HOME", home)
	t.Setenv("CARBONINK_AGENT_CONFIG_DIR", configDir)
	if err := os.MkdirAll(filepath.Join(home, ".claude", "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(configDir, "Claude"), 0o755); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("text:Agent integration", 5*time.Second)

	ui.Press("id:agent-skill-install")
	ui.WaitFor("text:Agent skill installed.", 10*time.Second)
	canonical := filepath.Join(home, ".agents", "skills", "carbonink-mcp", "SKILL.md")
	if _, err := os.Stat(canonical); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".claude", "skills", "carbonink-mcp", "SKILL.md")); err != nil {
		t.Fatal(err)
	}

	ui.Press("id:agent-config-claudeCode")
	ui.WaitFor("text:Claude Code MCP entry written.", 10*time.Second)
	data, err := os.ReadFile(filepath.Join(home, ".claude.json"))
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatal(err)
	}
	servers, _ := root["mcpServers"].(map[string]any)
	carbonink, _ := servers["carbonink"].(map[string]any)
	args, _ := carbonink["args"].([]any)
	if carbonink["command"] == "" || len(args) != 1 || args[0] != "--mcp" {
		t.Fatalf("entry = %+v", carbonink)
	}

	ui.Press("id:agent-remove-claudeCode")
	ui.WaitFor("text:Claude Code MCP entry removed.", 10*time.Second)
	data, err = os.ReadFile(filepath.Join(home, ".claude.json"))
	if err != nil {
		t.Fatal(err)
	}
	root = map[string]any{}
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatal(err)
	}
	if servers, ok := root["mcpServers"].(map[string]any); ok {
		if _, present := servers["carbonink"]; present {
			t.Fatalf("entry still present: %+v", servers)
		}
	}
}
