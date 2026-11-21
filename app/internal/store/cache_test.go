package store

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestClearExtractionRawCache(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "cache.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}

	const raw = "unparsed model output that should be reclaimable"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.DB().ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
		VALUES ('doc', 'sha', 'bill.pdf', 'application/pdf', 10, 'uploads/bill.pdf', '2026-01-01T00:00:00Z')`)
	exec(`INSERT INTO extraction
		(id, document_id, llm_provider, llm_model, prompt_version, raw_response, parsed_json, status, created_at)
		VALUES ('ext', 'doc', 'openai', 'gpt', 'v1', ?, '{"amount": 1}', 'parsed', '2026-01-01T00:00:00Z')`, raw)

	stats, err := s.CacheStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stats.ExtractionRawCount != 1 || stats.ExtractionRawBytes != int64(len(raw)) {
		t.Fatalf("stats = %+v, want one row of %d bytes", stats, len(raw))
	}
	if stats.DBFileBytes <= 0 {
		t.Fatalf("db size = %d", stats.DBFileBytes)
	}

	rows, freed, err := s.ClearExtractionRawCache(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("cleared %d rows, want 1", rows)
	}
	if freed < 0 {
		t.Fatalf("freed %d bytes", freed)
	}
	var rawResponse *string
	var parsed string
	if err := s.DB().QueryRowContext(ctx,
		`SELECT raw_response, parsed_json FROM extraction WHERE id = 'ext'`).
		Scan(&rawResponse, &parsed); err != nil {
		t.Fatal(err)
	}
	if rawResponse != nil {
		t.Fatalf("raw_response = %q, want NULL", *rawResponse)
	}
	if !strings.Contains(parsed, "amount") {
		t.Fatalf("parsed_json = %q, want it kept", parsed)
	}
	if after, err := s.CacheStats(ctx); err != nil || after.ExtractionRawCount != 0 {
		t.Fatalf("stats after clear = %+v, %v", after, err)
	}
}
