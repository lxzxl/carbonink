package platform

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLegacyDirIn(t *testing.T) {
	base := t.TempDir()
	if got := legacyDirIn(base); got != "" {
		t.Fatalf("empty base returned %q", got)
	}
	// The search checks the lowercase product name first; macOS resolves both
	// spellings to the same directory, so the test creates that one.
	dir := filepath.Join(base, "carbonink")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "workspaces.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := legacyDirIn(base); got != dir {
		t.Fatalf("legacyDirIn = %q, want %q", got, dir)
	}

	// When a 2.0-beta data directory exists alongside 1.x, prefer the beta directory.
	betaDir := filepath.Join(base, "app.carbonink.desktop.beta")
	if err := os.MkdirAll(betaDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(betaDir, "workspaces.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := legacyDirIn(base); got != betaDir {
		t.Fatalf("legacyDirIn with beta = %q, want %q", got, betaDir)
	}
}

func TestLegacyDirOverride(t *testing.T) {
	t.Setenv("CARBONINK_LEGACY_DIR", "/tmp/example")
	if got := LegacyDir(); got != "/tmp/example" {
		t.Fatalf("LegacyDir = %q", got)
	}
	t.Setenv("CARBONINK_NO_LEGACY_IMPORT", "1")
	if got := LegacyDir(); got != "" {
		t.Fatalf("disabled LegacyDir = %q", got)
	}
}
