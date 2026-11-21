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

var hosts = []struct {
	ID  string
	Dir string
}{
	{"claudeCode", ".claude/skills"},
	{"pi", ".pi/agent/skills"},
	{"codex", ".codex/skills"},
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
	status := Status{CanonicalPath: canonicalDir(home)}
	status.DetectedHosts = detectedHosts(home)
	existing, err := os.ReadFile(canonicalFile(home))
	if err != nil {
		return status
	}
	status.Installed = true
	status.NeedsUpdate = sum(existing) != sum(bundled)
	status.LinkedHosts = linkedHosts(home)
	return status
}

// Install writes the canonical copy and refreshes every detected host whose
// copy is missing or CarbonInk-managed. A user's own file at a host path is
// left alone.
func Install(home string) (Result, error) {
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
		parent := filepath.Join(home, filepath.FromSlash(host.Dir))
		if !exists(parent) {
			continue
		}
		link := filepath.Join(parent, dirName, "SKILL.md")
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
	result := Result{CanonicalPath: canonicalDir(home)}
	canonical := canonicalFile(home)
	if existing, err := os.ReadFile(canonical); err == nil && isManaged(existing) {
		result.BackupPath = backupPath(canonical)
		if err := writeFile(result.BackupPath, existing); err != nil {
			return result, fmt.Errorf("backup skill: %w", err)
		}
	}
	for _, host := range hosts {
		link := filepath.Join(home, filepath.FromSlash(host.Dir), dirName, "SKILL.md")
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

func detectedHosts(home string) []string {
	var out []string
	for _, host := range hosts {
		if exists(filepath.Join(home, filepath.FromSlash(host.Dir))) {
			out = append(out, host.ID)
		}
	}
	return out
}

func linkedHosts(home string) []string {
	want := sum(bundled)
	var out []string
	for _, host := range hosts {
		data, err := os.ReadFile(filepath.Join(home, filepath.FromSlash(host.Dir), dirName, "SKILL.md"))
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
