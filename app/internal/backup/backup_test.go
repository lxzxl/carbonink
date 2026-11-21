package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"
)

func TestRunAndRetention(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	s, err := store.Open(ctx, filepath.Join(dataDir, "app.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}

	day := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	first, err := Run(ctx, s, dataDir, "ws", day)
	if err != nil {
		t.Fatal(err)
	}
	if first == "" {
		t.Fatal("first run made no snapshot")
	}
	if again, err := Run(ctx, s, dataDir, "ws", day.Add(time.Hour)); err != nil || again != "" {
		t.Fatalf("second run = %q, %v; want no snapshot", again, err)
	}
	for i := 1; i < Retention+2; i++ {
		if _, err := Run(ctx, s, dataDir, "ws", day.Add(time.Duration(i)*24*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	dir := filepath.Join(dataDir, DirName, "ws")
	names, err := snapshots(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != Retention {
		t.Fatalf("kept %d snapshots, want %d", len(names), Retention)
	}

	backup, err := store.Open(ctx, filepath.Join(dir, names[len(names)-1]))
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	if version, err := backup.SchemaVersion(ctx); err != nil || version != 23 {
		t.Fatalf("backup schema = %d, %v", version, err)
	}
	info, err := os.Stat(filepath.Join(dir, names[len(names)-1]))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("backup mode = %o, want 600", perm)
	}
	var factors int
	if err := backup.DB().QueryRowContext(ctx, `SELECT count(*) FROM ef_fts`).Scan(&factors); err != nil || factors == 0 {
		t.Fatalf("backup FTS rows = %d, %v", factors, err)
	}
	if _, err := os.Stat(first); !os.IsNotExist(err) {
		t.Fatalf("oldest snapshot survived pruning: %v", err)
	}
}

func TestRunAllCoversEveryWorkspace(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	activePath := filepath.Join(dataDir, "app.sqlite")
	active, err := store.Open(ctx, activePath)
	if err != nil {
		t.Fatal(err)
	}
	defer active.Close()
	if _, err := active.Migrate(ctx); err != nil {
		t.Fatal(err)
	}

	inactive, err := store.Open(ctx, filepath.Join(dataDir, "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inactive.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := inactive.Close(); err != nil {
		t.Fatal(err)
	}

	// A pre-workspace snapshot at the root moves into the default
	// workspace's directory instead of being stranded.
	legacy := filepath.Join(dataDir, DirName, "auto-20260101-090000.carbonink-backup")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}

	targets := []Target{
		{ID: "a", File: "app.sqlite"},
		{ID: "b", File: "client.sqlite"},
		{ID: "never-opened", File: "missing.sqlite"},
	}
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	made, err := RunAll(ctx, active, dataDir, targets, "a", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(made) != 2 {
		t.Fatalf("made %v, want one snapshot for a and b", made)
	}
	for _, id := range []string{"a", "b"} {
		names, err := snapshots(filepath.Join(dataDir, DirName, id))
		if err != nil {
			t.Fatal(err)
		}
		if len(names) == 0 {
			t.Fatalf("workspace %s has no snapshot", id)
		}
	}
	if names, err := snapshots(filepath.Join(dataDir, DirName, "a")); err != nil ||
		len(names) != 2 {
		t.Fatalf("workspace a snapshots = %v, %v; want the migrated legacy one and one new",
			names, err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy flat snapshot still at the root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, DirName, "never-opened")); !os.IsNotExist(err) {
		t.Fatalf("a workspace with no file got a backup directory: %v", err)
	}

	again, err := RunAll(ctx, active, dataDir, targets, "a", now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("second pass made %v, want none", again)
	}
}
