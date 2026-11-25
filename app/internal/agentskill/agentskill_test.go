package agentskill

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallDetectUpdateRemove(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".claude", "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	status := Detect(home)
	if status.Installed || len(status.DetectedHosts) != 1 || status.DetectedHosts[0] != "claudeCode" {
		t.Fatalf("status = %+v", status)
	}

	result, err := Install(home)
	if err != nil {
		t.Fatal(err)
	}
	if result.BackupPath != "" || len(result.LinkedHosts) != 1 || result.LinkedHosts[0] != "claudeCode" {
		t.Fatalf("result = %+v", result)
	}
	canonical := filepath.Join(home, ".agents", "skills", "carbonink-mcp", "SKILL.md")
	data, err := os.ReadFile(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), marker) {
		t.Fatalf("canonical is not marked")
	}
	claude, err := os.ReadFile(filepath.Join(home, ".claude", "skills", "carbonink-mcp", "SKILL.md"))
	if err != nil || string(claude) != string(data) {
		t.Fatalf("claude copy = %v", err)
	}

	status = Detect(home)
	if !status.Installed || status.NeedsUpdate || len(status.LinkedHosts) != 1 {
		t.Fatalf("status = %+v", status)
	}

	if err := os.WriteFile(canonical, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	status = Detect(home)
	if !status.NeedsUpdate {
		t.Fatalf("status = %+v", status)
	}
	result, err = Install(home)
	if err != nil {
		t.Fatal(err)
	}
	if result.BackupPath == "" {
		t.Fatalf("result = %+v", result)
	}
	if backup, err := os.ReadFile(result.BackupPath); err != nil || string(backup) != "old" {
		t.Fatalf("backup = %q, err = %v", backup, err)
	}

	result, err = Remove(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 2 {
		t.Fatalf("removed = %v", result.Removed)
	}
	if _, err := os.Stat(canonical); !os.IsNotExist(err) {
		t.Fatalf("canonical still exists: %v", err)
	}
}

func TestInstallLeavesForeignCopyAlone(t *testing.T) {
	home := t.TempDir()
	foreign := filepath.Join(home, ".codex", "skills", "carbonink-mcp")
	if err := os.MkdirAll(foreign, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(foreign, "SKILL.md")
	if err := os.WriteFile(path, []byte("someone else's skill"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Install(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.LinkedHosts) != 0 {
		t.Fatalf("result = %+v", result)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "someone else's skill" {
		t.Fatalf("foreign copy = %q, err = %v", data, err)
	}
}

func TestInstallSupportsCursorAndClaudeDesktop(t *testing.T) {
	home := t.TempDir()
	configDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".cursor"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(configDir, "Claude"), 0o755); err != nil {
		t.Fatal(err)
	}

	status := DetectWithConfig(home, configDir)
	if len(status.DetectedHosts) != 2 {
		t.Fatalf("detected = %v", status.DetectedHosts)
	}
	res, err := InstallWithConfig(home, configDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.LinkedHosts) != 2 {
		t.Fatalf("linked = %v", res.LinkedHosts)
	}
	if _, err := os.Stat(filepath.Join(home, ".cursor", "skills", "carbonink-mcp", "SKILL.md")); err != nil {
		t.Fatalf("cursor skill missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(configDir, "Claude", "skills", "carbonink-mcp", "SKILL.md")); err != nil {
		t.Fatalf("claude desktop skill missing: %v", err)
	}

	status = DetectWithConfig(home, configDir)
	if !status.Installed || len(status.LinkedHosts) != 2 {
		t.Fatalf("status after install = %+v", status)
	}

	removed, err := RemoveWithConfig(home, configDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed.Removed) != 3 {
		t.Fatalf("removed = %v", removed.Removed)
	}
}
