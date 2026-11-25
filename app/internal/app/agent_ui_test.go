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
	if err := os.MkdirAll(filepath.Join(home, ".cursor"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(configDir, "Claude"), 0o755); err != nil {
		t.Fatal(err)
	}

	var launchedHost, launchedPrompt string
	origLaunch := launchAgentSessionFunc
	launchAgentSessionFunc = func(host, _, _, prompt string) error {
		launchedHost = host
		launchedPrompt = prompt
		return nil
	}
	t.Cleanup(func() { launchAgentSessionFunc = origLaunch })

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	openSettings(ui, "mcp")
	ui.WaitFor("id:agent-skill-install", 5*time.Second)

	ui.Press("id:agent-skill-install")
	ui.WaitFor("text:Installed Skill", 10*time.Second)
	if label := ui.Find("id:sidebar-mcp-status").Props.Label; label != "MCP · Not configured" {
		t.Fatalf("sidebar MCP label before configure = %q", label)
	}
	canonical := filepath.Join(home, ".agents", "skills", "carbonink-mcp", "SKILL.md")
	if _, err := os.Stat(canonical); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".claude", "skills", "carbonink-mcp", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".cursor", "skills", "carbonink-mcp", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(configDir, "Claude", "skills", "carbonink-mcp", "SKILL.md")); err != nil {
		t.Fatal(err)
	}

	ui.WaitFor("id:agent-launch-session", 3*time.Second)
	ui.Press("id:agent-launch-session")
	ui.WaitFor("text:Launched", 3*time.Second)
	if launchedHost == "" || launchedPrompt != agentSessionPrompt {
		t.Fatalf("launched = (%q, %q)", launchedHost, launchedPrompt)
	}

	ui.Press("id:agent-config-claudeCode")
	ui.WaitFor("text:Configured Claude Code", 10*time.Second)
	ui.WaitUntil(5*time.Second, func() bool {
		return ui.Find("id:sidebar-mcp-status").Props.Label == "MCP"
	})
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
	ui.WaitFor("text:Removed CarbonInk from Claude Code", 10*time.Second)
	ui.WaitUntil(5*time.Second, func() bool {
		return ui.Find("id:sidebar-mcp-status").Props.Label == "MCP · Not configured"
	})
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

func TestAgentFirstRunPopupInstallsSkillAndConfiguresMCP(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	t.Setenv("CARBONINK_AGENT_PROMPT", "1")
	home := t.TempDir()
	configDir := t.TempDir()
	t.Setenv("CARBONINK_AGENT_HOME", home)
	t.Setenv("CARBONINK_AGENT_CONFIG_DIR", configDir)
	if err := os.MkdirAll(filepath.Join(home, ".claude", "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".cursor"), 0o755); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:agent-first-run-dialog", 5*time.Second)
	ui.Press("id:agent-first-run-install")
	ui.WaitForGone("id:agent-first-run-dialog", 10*time.Second)

	if _, err := os.Stat(filepath.Join(home, ".agents", "skills", "carbonink-mcp", "SKILL.md")); err != nil {
		t.Fatalf("skill missing after first-run install: %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, ".cursor", "mcp.json")); err != nil {
		t.Fatalf("cursor mcp.json missing after first-run install: %v", err)
	}
	ui.WaitUntil(5*time.Second, func() bool {
		return ui.Find("id:sidebar-mcp-status").Props.Label == "MCP"
	})
}
