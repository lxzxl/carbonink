package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestDataYearPeriodUsesTheLatestActivePeriod(t *testing.T) {
	periods := []store.ReportingPeriod{
		{ID: "2024", Year: 2024, IsActive: true},
		{ID: "2025", Year: 2025, IsActive: true},
		{ID: "2026", Year: 2026},
	}
	if got := dataYearPeriod(periods); got == nil || got.ID != "2025" {
		t.Fatalf("dataYearPeriod = %+v, want the latest active period 2025", got)
	}
	periods[0].IsActive = false
	periods[1].IsActive = false
	if got := dataYearPeriod(periods); got == nil || got.ID != "2026" {
		t.Fatalf("dataYearPeriod = %+v, want the latest period 2026", got)
	}
	if got := dataYearPeriod(nil); got != nil {
		t.Fatalf("dataYearPeriod(nil) = %+v, want nil", got)
	}
}

// TestDataExportWritesAValidBackup saves through the real SaveFile path and
// checks the saved file is a CarbonInk database.
func TestDataExportWritesAValidBackup(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	savePath := filepath.Join(t.TempDir(), "carbonink-backup.carbonink-backup")
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.SaveFile = func(core.SaveRequest) string { return savePath }
	ui.Press("id:nav:settings")
	ui.WaitFor("id:data-export", 5*time.Second)
	ui.Press("id:data-export")
	ui.WaitFor("text:Backup saved", 5*time.Second)

	info, err := os.Stat(savePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatal("backup is empty")
	}
	if err := store.ValidateBackupFile(context.Background(), savePath); err != nil {
		t.Fatalf("saved backup: %v", err)
	}

	// The temporary snapshot beside the save target is gone.
	entries, err := os.ReadDir(filepath.Dir(savePath))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("save folder has %d entries, want only the backup", len(entries))
	}
}

// TestDataImportValidatesAndRestarts proves a bad file is rejected and a
// valid backup replaces the workspace and asks for a restart.
func TestDataImportValidatesAndRestarts(t *testing.T) {
	fixture := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", fixture)
	ctx := context.Background()
	backupPath := filepath.Join(t.TempDir(), "good.carbonink-backup")
	src, err := store.Open(ctx, fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := src.Backup(ctx, backupPath); err != nil {
		t.Fatal(err)
	}
	if err := src.Close(); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:data-import", 5*time.Second)

	// A text file fails validation before anything is replaced.
	bad := filepath.Join(t.TempDir(), "not-a-backup.sqlite")
	if err := os.WriteFile(bad, []byte("definitely not sqlite"), 0o600); err != nil {
		t.Fatal(err)
	}
	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "not-a-backup.sqlite", Path: bad}}
	}
	ui.Press("id:data-import")
	ui.WaitFor("id:data-import-dialog", 2*time.Second)
	ui.Press("id:data-import-confirm")
	ui.WaitFor("text:Restore failed", 5*time.Second)
	if ui.Restarts != 0 {
		t.Fatalf("restarts after a bad backup = %d, want 0", ui.Restarts)
	}

	ui.PickFiles = func(core.FilesRequest) []core.File {
		return []core.File{{Name: "good.carbonink-backup", Path: backupPath}}
	}
	ui.Press("id:data-import")
	ui.WaitFor("id:data-import-dialog", 2*time.Second)
	ui.Press("id:data-import-confirm")
	ui.WaitFor("text:Backup restored", 5*time.Second)
	if ui.Restarts != 1 {
		t.Fatalf("restarts = %d, want 1", ui.Restarts)
	}
}

// TestDataResetRequiresTheTypedWord deletes the workspace only after RESET.
func TestDataResetRequiresTheTypedWord(t *testing.T) {
	fixture := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", fixture)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:data-reset-input", 5*time.Second)

	if ui.Enabled("id:data-reset") {
		t.Error("Reset is armed with an empty field")
	}
	ui.Type("id:data-reset-input", "RESE")
	if ui.Enabled("id:data-reset") {
		t.Error("Reset is armed before the word is complete")
	}
	ui.Clear("id:data-reset-input")
	ui.Type("id:data-reset-input", "RESET")
	if !ui.Enabled("id:data-reset") {
		t.Fatal("Reset is disabled after typing RESET")
	}
	ui.Press("id:data-reset")
	if ui.Restarts != 1 {
		t.Fatalf("restarts = %d, want 1", ui.Restarts)
	}
	if _, err := os.Stat(fixture); !os.IsNotExist(err) {
		t.Fatalf("workspace file still exists: %v", err)
	}
}

// TestDataAutoBackupToggleAndFolder persists the boot-pass gate and reveals
// this workspace's snapshot folder.
func TestDataAutoBackupToggleAndFolder(t *testing.T) {
	fixture := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", fixture)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:data-auto-backup-toggle", 5*time.Second)

	ui.Press("id:data-auto-backup-toggle")
	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, fixture)
	if err != nil {
		t.Fatal(err)
	}
	value, ok, err := check.Setting(ctx, autoBackupSettingKey)
	check.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !ok || value != "false" {
		t.Fatalf("setting = %q, %v; want false", value, ok)
	}

	ui.Press("id:data-auto-backup-open")
	if len(ui.RevealedFiles) != 1 ||
		!strings.HasSuffix(ui.RevealedFiles[0], "auto-backups") {
		t.Fatalf("revealed %v, want the auto-backup root", ui.RevealedFiles)
	}
}

// TestDataCacheClearDropsRawResponses proves the size shown matches the
// parsed extraction and that clearing keeps the parsed fields.
func TestDataCacheClearDropsRawResponses(t *testing.T) {
	fixture := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", fixture)
	ctx := context.Background()
	seed, err := store.Open(ctx, fixture)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := seed.DB().ExecContext(ctx, `
		INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
		VALUES ('doc', 'sha', 'bill.pdf', 'application/pdf', 10, 'uploads/bill.pdf', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := seed.DB().ExecContext(ctx, `
		INSERT INTO extraction
			(id, document_id, llm_provider, llm_model, prompt_version, raw_response, parsed_json, status, created_at)
		VALUES ('ext', 'doc', 'openai', 'gpt', 'v1', 'raw output', '{"amount": 1}', 'parsed', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	seed.Close()

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:data-cache-summary", 5*time.Second)
	ui.WaitFor("text:1 cached LLM responses", 2*time.Second)
	ui.Press("id:data-cache-clear")
	ui.WaitFor("text:Cleared 1 entries", 5*time.Second)
	ui.WaitFor("text:No cached LLM responses", 2*time.Second)

	check, err := store.OpenReadOnly(ctx, fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var raw *string
	var parsed string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT raw_response, parsed_json FROM extraction WHERE id = 'ext'`).
		Scan(&raw, &parsed); err != nil {
		t.Fatal(err)
	}
	if raw != nil {
		t.Fatalf("raw_response = %q, want NULL", *raw)
	}
	if !strings.Contains(parsed, "amount") {
		t.Fatalf("parsed_json = %q, want it kept", parsed)
	}
}
