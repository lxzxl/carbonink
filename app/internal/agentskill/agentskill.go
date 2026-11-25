// Package agentskill installs CarbonInk's Agent Skill into the shared
// ~/.agents/skills directory and copies it into the skill folders of detected
// agent hosts.
//
// Copies, not symlinks: Windows needs privileges for symlinks, and the skill
// is one small text file. Every copy carries a marker comment so updates and
// removals only touch files CarbonInk wrote.
package agentskill

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed SKILL.md
var bundled []byte

const (
	dirName = "carbonink-mcp"
	marker  = "managed by CarbonInk"
)

type hostSpec struct {
	ID         string
	DetectDir  func(home, configDir string) string
	InstallDir func(home, configDir string) string
}

var hosts = []hostSpec{
	{
		ID:         "claudeCode",
		DetectDir:  func(home, _ string) string { return filepath.Join(home, ".claude", "skills") },
		InstallDir: func(home, _ string) string { return filepath.Join(home, ".claude", "skills") },
	},
	{
		ID:         "pi",
		DetectDir:  func(home, _ string) string { return filepath.Join(home, ".pi", "agent", "skills") },
		InstallDir: func(home, _ string) string { return filepath.Join(home, ".pi", "agent", "skills") },
	},
	{
		ID:         "codex",
		DetectDir:  func(home, _ string) string { return filepath.Join(home, ".codex", "skills") },
		InstallDir: func(home, _ string) string { return filepath.Join(home, ".codex", "skills") },
	},
	{
		ID:         "cursor",
		DetectDir:  func(home, _ string) string { return filepath.Join(home, ".cursor") },
		InstallDir: func(home, _ string) string { return filepath.Join(home, ".cursor", "skills") },
	},
	{
		ID: "claudeDesktop",
		DetectDir: func(_, configDir string) string {
			if strings.TrimSpace(configDir) == "" {
				return ""
			}
			return filepath.Join(configDir, "Claude")
		},
		InstallDir: func(_, configDir string) string {
			if strings.TrimSpace(configDir) == "" {
				return ""
			}
			return filepath.Join(configDir, "Claude", "skills")
		},
	},
}

// Status is what the settings screen shows without changing anything.
type Status struct {
	Installed     bool
	NeedsUpdate   bool
	CanonicalPath string
	DetectedHosts []string
	LinkedHosts   []string
}

// Result describes one install or removal.
type Result struct {
	CanonicalPath string
	BackupPath    string
	LinkedHosts   []string
	Removed       []string
}

// Detect inspects the home directory for an existing install.
func Detect(home string) Status {
	return DetectWithConfig(home, "")
}

// DetectWithConfig inspects both home and configDir (used for Claude Desktop).
func DetectWithConfig(home, configDir string) Status {
	status := Status{CanonicalPath: canonicalDir(home)}
	status.DetectedHosts = detectedHosts(home, configDir)
	existing, err := os.ReadFile(canonicalFile(home))
	if err != nil {
		return status
	}
	status.Installed = true
	status.NeedsUpdate = sum(existing) != sum(bundled)
	status.LinkedHosts = linkedHosts(home, configDir)
	return status
}

// Install writes the canonical copy and refreshes every detected host whose
// copy is missing or CarbonInk-managed. A user's own file at a host path is
// left alone.
func Install(home string) (Result, error) {
	return InstallWithConfig(home, "")
}

// InstallWithConfig writes the canonical copy and refreshes detected hosts
// across home and configDir (including Cursor and Claude Desktop).
func InstallWithConfig(home, configDir string) (Result, error) {
	result := Result{CanonicalPath: canonicalDir(home)}
	canonical := canonicalFile(home)
	if existing, err := os.ReadFile(canonical); err == nil && sum(existing) != sum(bundled) {
		result.BackupPath = backupPath(canonical)
		if err := writeFile(result.BackupPath, existing); err != nil {
			return result, fmt.Errorf("backup existing skill: %w", err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(canonical), 0o755); err != nil {
		return result, fmt.Errorf("create skill directory: %w", err)
	}
	if err := writeFile(canonical, bundled); err != nil {
		return result, fmt.Errorf("write skill: %w", err)
	}

	for _, host := range hosts {
		detectDir := host.DetectDir(home, configDir)
		installDir := host.InstallDir(home, configDir)
		if detectDir == "" || installDir == "" || !exists(detectDir) {
			continue
		}
		link := filepath.Join(installDir, dirName, "SKILL.md")
		if existing, err := os.ReadFile(link); err == nil && !isManaged(existing) {
			// The user (or another tool) owns this copy; never overwrite it.
			continue
		}
		if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
			continue
		}
		if err := writeFile(link, bundled); err == nil {
			result.LinkedHosts = append(result.LinkedHosts, host.ID)
		}
	}
	return result, nil
}

// Remove deletes the copies CarbonInk wrote and backs up the canonical file.
func Remove(home string) (Result, error) {
	return RemoveWithConfig(home, "")
}

// RemoveWithConfig deletes CarbonInk-managed copies across home and configDir.
func RemoveWithConfig(home, configDir string) (Result, error) {
	result := Result{CanonicalPath: canonicalDir(home)}
	canonical := canonicalFile(home)
	if existing, err := os.ReadFile(canonical); err == nil && isManaged(existing) {
		result.BackupPath = backupPath(canonical)
		if err := writeFile(result.BackupPath, existing); err != nil {
			return result, fmt.Errorf("backup skill: %w", err)
		}
	}
	for _, host := range hosts {
		installDir := host.InstallDir(home, configDir)
		if installDir == "" {
			continue
		}
		link := filepath.Join(installDir, dirName, "SKILL.md")
		existing, err := os.ReadFile(link)
		if err != nil || !isManaged(existing) {
			continue
		}
		if err := os.Remove(link); err == nil {
			result.Removed = append(result.Removed, link)
		}
	}
	if existing, err := os.ReadFile(canonical); err == nil && isManaged(existing) {
		if err := os.RemoveAll(canonicalDir(home)); err == nil {
			result.Removed = append(result.Removed, canonicalDir(home))
		}
	}
	return result, nil
}

func canonicalDir(home string) string {
	return filepath.Join(home, ".agents", "skills", dirName)
}

func canonicalFile(home string) string {
	return filepath.Join(canonicalDir(home), "SKILL.md")
}

func detectedHosts(home, configDir string) []string {
	var out []string
	for _, host := range hosts {
		dir := host.DetectDir(home, configDir)
		if dir != "" && exists(dir) {
			out = append(out, host.ID)
		}
	}
	return out
}

func linkedHosts(home, configDir string) []string {
	want := sum(bundled)
	var out []string
	for _, host := range hosts {
		installDir := host.InstallDir(home, configDir)
		if installDir == "" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(installDir, dirName, "SKILL.md"))
		if err == nil && sum(data) == want {
			out = append(out, host.ID)
		}
	}
	return out
}

func isManaged(data []byte) bool {
	return strings.Contains(string(data), marker)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func writeFile(path string, data []byte) error {
	tmp := path + ".carbonink-tmp-" + fmt.Sprint(time.Now().UnixNano())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func backupPath(path string) string {
	stamp := strings.NewReplacer(":", "-", ".", "-").Replace(time.Now().UTC().Format("20060102-150405.000000000"))
	return fmt.Sprintf("%s.carbonink-bak-%s-%d", path, stamp, os.Getpid())
}

func sum(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

// ErrNotInstalled is returned by callers that expected a canonical copy.
var ErrNotInstalled = errors.New("agentskill: not installed")
