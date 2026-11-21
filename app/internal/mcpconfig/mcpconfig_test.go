package mcpconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigurePreservesOtherSettings(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, ".claude.json")
	original := `{
  "theme": "dark",
  "mcpServers": {
    "other": {"command": "other-server", "args": []}
  }
}
`
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}
	entry := Entry{Command: "/Applications/CarbonInk.app/Contents/MacOS/CarbonInk",
		Args: []string{"--mcp"}}
	result, err := Configure(path, entry)
	if err != nil {
		t.Fatal(err)
	}
	if result.BackupPath == "" || result.NoChange {
		t.Fatalf("result = %+v", result)
	}
	root := readJSON(t, path)
	if root["theme"] != "dark" {
		t.Fatalf("root = %+v", root)
	}
	servers := root["mcpServers"].(map[string]any)
	if _, ok := servers["other"]; !ok {
		t.Fatalf("servers = %+v", servers)
	}
	carbonink := servers["carbonink"].(map[string]any)
	if carbonink["command"] != entry.Command {
		t.Fatalf("carbonink = %+v", carbonink)
	}

	statuses := Detect(home, t.TempDir(), entry)
	var found bool
	for _, status := range statuses {
		if status.Client == ClaudeCode {
			found = true
			if !status.Installed || !status.Configured || status.NeedsUpdate {
				t.Fatalf("status = %+v", status)
			}
		}
	}
	if !found {
		t.Fatal("claudeCode status missing")
	}

	result, err = Configure(path, entry)
	if err != nil || !result.NoChange || result.BackupPath != "" {
		t.Fatalf("second configure = %+v, err = %v", result, err)
	}

	changed := Entry{Command: "/new/CarbonInk", Args: []string{"--mcp"}}
	for _, status := range Detect(home, t.TempDir(), changed) {
		if status.Client == ClaudeCode && !status.NeedsUpdate {
			t.Fatalf("status = %+v", status)
		}
	}
	if _, err := Configure(path, changed); err != nil {
		t.Fatal(err)
	}

	removed, err := Remove(path)
	if err != nil {
		t.Fatal(err)
	}
	if removed.BackupPath == "" {
		t.Fatalf("removed = %+v", removed)
	}
	root = readJSON(t, path)
	servers = root["mcpServers"].(map[string]any)
	if _, ok := servers["carbonink"]; ok {
		t.Fatalf("carbonink still present: %+v", servers)
	}
	if _, ok := servers["other"]; !ok || root["theme"] != "dark" {
		t.Fatalf("root = %+v", root)
	}
}

func TestConfigureRefusesInvalidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	const invalid = `{"broken":`
	if err := os.WriteFile(path, []byte(invalid), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Configure(path, Entry{Command: "x", Args: []string{"--mcp"}}); err == nil {
		t.Fatal("expected an error")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != invalid {
		t.Fatalf("file changed: %q, err = %v", data, err)
	}
}

func TestClaudeDesktopPath(t *testing.T) {
	home := t.TempDir()
	config := t.TempDir()
	want := filepath.Join(config, "Claude", "claude_desktop_config.json")
	if got := Path(home, config, ClaudeDesktop); got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	if err := os.MkdirAll(filepath.Join(config, "Claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	statuses := Detect(home, config, Entry{Command: "x", Args: []string{"--mcp"}})
	for _, status := range statuses {
		if status.Client == ClaudeDesktop && !status.Installed {
			t.Fatalf("status = %+v", status)
		}
	}
}

func readJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatal(err)
	}
	return root
}
