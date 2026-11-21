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
