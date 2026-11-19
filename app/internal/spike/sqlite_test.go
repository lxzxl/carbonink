package spike

import (
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/ncruces/go-sqlite3/driver"
	"github.com/ncruces/go-sqlite3/ext/fts5"
)

// openSQLite opens a database through the cgo-free wasm build, registering
// the FTS5 extension on every pooled connection.
func openSQLite(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := driver.Open(path, fts5.Register)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// TestSQLiteFeatures proves the driver carries the features the schema needs:
// FTS5 with bm25 ranking, JSON1, and WAL.
func TestSQLiteFeatures(t *testing.T) {
	path := filepath.Join(t.TempDir(), "features.sqlite")
	db := openSQLite(t, path)
	mustExec(t, db, `PRAGMA journal_mode=WAL`)
	mustExec(t, db, `CREATE TABLE ef (code TEXT PRIMARY KEY, name_zh TEXT, meta TEXT)`)
	mustExec(t, db, `CREATE VIRTUAL TABLE ef_fts USING fts5(
		code UNINDEXED, name_zh, tokenize = "unicode61 remove_diacritics 2")`)
	mustExec(t, db, `INSERT INTO ef VALUES ('diesel', '柴油', '{"scope":1}')`)
	mustExec(t, db, `INSERT INTO ef_fts VALUES ('diesel', '柴油 车用 柴油')`)

	var code string
	var rank float64
	err := db.QueryRow(`SELECT code, bm25(ef_fts) FROM ef_fts
		WHERE ef_fts MATCH ? ORDER BY bm25(ef_fts)`, `"柴油"`).Scan(&code, &rank)
	if err != nil {
		t.Fatalf("fts5 match: %v", err)
	}
	if code != "diesel" {
		t.Fatalf("fts5 match = %q, want diesel", code)
	}

	var scope int
	if err := db.QueryRow(`SELECT json_extract(meta, '$.scope') FROM ef WHERE code = 'diesel'`).Scan(&scope); err != nil {
		t.Fatalf("json_extract: %v", err)
	}
	if scope != 1 {
		t.Fatalf("json_extract scope = %d, want 1", scope)
	}

	var mode string
	if err := db.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatalf("journal_mode: %v", err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}
}

// TestRealWorkspaceDB runs the read paths against a copy of a workspace
// database. Point CARBONINK_SPIKE_DB at an app.sqlite / workspace-*.sqlite.
func TestRealWorkspaceDB(t *testing.T) {
	src := os.Getenv("CARBONINK_SPIKE_DB")
	if src == "" {
		t.Skip("CARBONINK_SPIKE_DB not set")
	}
	dst := filepath.Join(t.TempDir(), "workspace.sqlite")
	copyFile(t, src, dst)
	db := openSQLite(t, dst)

	var factors int
	if err := db.QueryRow(`SELECT count(*) FROM emission_factor`).Scan(&factors); err != nil {
		t.Fatalf("count emission_factor: %v", err)
	}
	if factors == 0 {
		t.Fatal("workspace has no emission factors to exercise the FTS index")
	}

	rows, err := db.Query(`SELECT factor_code FROM ef_fts
		WHERE ef_fts MATCH ? ORDER BY bm25(ef_fts) LIMIT 5`, `"diesel"`)
	if err != nil {
		t.Fatalf("fts5 match: %v", err)
	}
	defer rows.Close()
	hits := 0
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			t.Fatalf("scan: %v", err)
		}
		hits++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	t.Logf("emission_factor=%d fts_hits=%d", factors, hits)

	var audits int
	if err := db.QueryRow(`SELECT count(*) FROM audit_event
		WHERE json_extract(payload, '$.event_kind') IS NOT NULL`).Scan(&audits); err != nil {
		t.Fatalf("json_extract over audit_event: %v", err)
	}
	t.Logf("audit_events_with_kind=%d", audits)
}

func mustExec(t *testing.T, db *sql.DB, query string) {
	t.Helper()
	if _, err := db.Exec(query); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func copyFile(t *testing.T, src, dst string) {
	t.Helper()
	in, err := os.Open(src)
	if err != nil {
		t.Fatalf("open source db: %v", err)
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatalf("create target db: %v", err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		t.Fatalf("copy db: %v", err)
	}
	if err := out.Close(); err != nil {
		t.Fatalf("close target db: %v", err)
	}
}
