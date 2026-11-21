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
	if version, err := backup.SchemaVersion(ctx); err != nil || version != 22 {
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
