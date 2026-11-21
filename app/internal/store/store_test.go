package store

import (
	"context"
	"crypto/sha256"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateFresh(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "fresh.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	applied, err := s.Migrate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if applied != 22 {
		t.Fatalf("applied %d migrations, want 22", applied)
	}
	version, err := s.SchemaVersion(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if version != 22 {
		t.Fatalf("schema version = %d, want 22", version)
	}
	if again, err := s.Migrate(ctx); err != nil || again != 0 {
		t.Fatalf("second Migrate = %d, %v; want 0, nil", again, err)
	}

	var tables, factors, fts int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM sqlite_master WHERE type='table'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables < 30 {
		t.Fatalf("%d tables, want at least 30", tables)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM emission_factor`).Scan(&factors); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM ef_fts`).Scan(&fts); err != nil {
		t.Fatal(err)
	}
	if factors == 0 || fts != factors {
		t.Fatalf("emission_factor=%d ef_fts=%d", factors, fts)
	}
	var code string
	if err := s.db.QueryRowContext(ctx,
		`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH 'diesel' ORDER BY bm25(ef_fts) LIMIT 1`).Scan(&code); err != nil {
		t.Fatalf("fts5 query: %v", err)
	}
	var one int
	if err := s.db.QueryRowContext(ctx, `SELECT json_extract('{"a":1}', '$.a')`).Scan(&one); err != nil || one != 1 {
		t.Fatalf("json1 = %d, %v", one, err)
	}
	var fk int
	if err := s.db.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&fk); err != nil || fk != 1 {
		t.Fatalf("foreign_keys = %d, %v", fk, err)
	}
	if n, err := s.ActivityCount(ctx); err != nil || n != 0 {
		t.Fatalf("fresh activity count = %d, %v", n, err)
	}
}

// TestMigrationsMatchElectron fails when the embedded copy drifts from the
// 1.x schema before Electron is removed.
func TestMigrationsMatchElectron(t *testing.T) {
	legacy := filepath.Join("..", "..", "..", "desktop", "src", "main", "db", "migrations")
	entries, err := os.ReadDir(legacy)
	if os.IsNotExist(err) {
		t.Skip("Electron migrations are gone; the copy is now canonical")
	}
	if err != nil {
		t.Fatal(err)
	}
	embedded, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != len(embedded) {
		t.Fatalf("Electron has %d migrations, embedded has %d", len(entries), len(embedded))
	}
	for i, e := range entries {
		if e.Name() != embedded[i].name+".sql" {
			t.Fatalf("migration %d = %s, embedded %s", i, e.Name(), embedded[i].name+".sql")
		}
		want, err := os.ReadFile(filepath.Join(legacy, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if sha256.Sum256(want) != sha256.Sum256([]byte(embedded[i].sql)) {
			t.Fatalf("%s differs from the Electron copy", e.Name())
		}
	}
}

func TestRealWorkspace(t *testing.T) {
	src := os.Getenv("CARBONINK_TEST_DB")
	if src == "" {
		t.Skip("CARBONINK_TEST_DB not set")
	}
	ctx := context.Background()
	dst := filepath.Join(t.TempDir(), "workspace.sqlite")
	for _, suffix := range []string{"", "-wal", "-shm"} {
		copyIfExists(t, src+suffix, dst+suffix)
	}
	s, err := Open(ctx, dst)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	applied, err := s.Migrate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if applied != 0 {
		t.Fatalf("applied %d migrations to a current workspace", applied)
	}
	version, err := s.SchemaVersion(ctx)
	if err != nil {
		t.Fatal(err)
	}
	count, err := s.ActivityCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.Activities(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != min(count, 50) {
		t.Fatalf("Activities returned %d of %d rows", len(rows), count)
	}
	t.Logf("schema=%d activities=%d returned=%d", version, count, len(rows))
	if len(rows) > 0 {
		t.Logf("first: %s %s %.2f %s %.2f kgCO2e scope=%d",
			rows[0].OccurredAt, rows[0].Source, rows[0].Amount, rows[0].Unit, rows[0].CO2eKg, rows[0].Scope)
	}
}

func copyIfExists(t *testing.T, src, dst string) {
	t.Helper()
	in, err := os.Open(src)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := os.Create(dst)
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
