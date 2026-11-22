package app

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestMigrationCardFromLegacyWorkspace proves the app imports an Electron
// data directory on first launch, opens the imported database, and reports
// the migration on the settings screen.
func TestMigrationCardFromLegacyWorkspace(t *testing.T) {
	legacy := filepath.Join(t.TempDir(), "CarbonInk")
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	fixture := fixtureDB(t)
	db, err := store.Open(context.Background(), fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.SetSetting(context.Background(), "llm.provider",
		`{"provider":"deepseek","model":"deepseek-chat"}`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		copyFile(t, fixture+suffix, filepath.Join(legacy, "app.sqlite"+suffix))
	}
	registry := `{
	  "version": 1,
	  "workspaces": [
	    {"id": "01KY6QPV8EY31MTRCMFRT8DK04", "name": "Imported", "file": "app.sqlite", "created_at": "2026-07-23T05:38:24.143Z"}
	  ],
	  "active_id": "01KY6QPV8EY31MTRCMFRT8DK04"
	}`
	if err := os.WriteFile(filepath.Join(legacy, "workspaces.json"), []byte(registry), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_NO_LEGACY_IMPORT", "")
	t.Setenv("CARBONINK_LEGACY_DIR", legacy)
	t.Setenv("CARBONINK_TEST_DB", "")

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.WaitFor("text:外购电力", 3*time.Second)

	ui.Press("id:nav:settings")
	ui.WaitFor("text:Migration from CarbonInk 1.x", 5*time.Second)
	// The sidebar already says "Imported from CarbonInk 1.x", so match on the
	// card's longer sentence.
	ui.WaitFor("text:this workspace now lives in the new data folder", 3*time.Second)
	if got := ui.Find("id:settings-llm-model").Text; got != "deepseek-chat" {
		t.Fatalf("model field = %q, want the imported deepseek-chat", got)
	}
	if got := ui.Find("id:settings-llm-base-url").Text; got != "https://api.deepseek.com/v1" {
		t.Fatalf("base URL field = %q, want the DeepSeek preset", got)
	}
	ui.WaitFor("text:The AI provider setting was imported from 1.x", 3*time.Second)
	ui.WaitFor("text:CarbonInk 1.x data folder:", 3*time.Second)

	// Entering the key is the one manual step; the reminder goes away with it.
	ui.Type("id:settings-llm-key", "sk-test-12345")
	ui.Press("id:settings-llm-save")
	ui.WaitFor("text:Settings saved", 3*time.Second)
	ui.WaitForGone("text:The AI provider setting was imported from 1.x", 3*time.Second)
}

func copyFile(t *testing.T, src, dst string) {
	t.Helper()
	in, err := os.Open(src)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
}
