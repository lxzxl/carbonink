package deliverable

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/store"
)

func testDB(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "deliverable.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	const ts = "2025-01-15T00:00:00Z"
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.DB().ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO organization (id, singleton_key, name_zh, country_code,
			boundary_kind, created_at, updated_at)
		VALUES ('org', 1, '测试组织', 'CN', 'operational_control', ?, ?)`, ts, ts)
	exec(`INSERT INTO site (id, organization_id, name_zh, country_code, created_at,
			updated_at) VALUES ('site', 'org', '上海工厂', 'CN', ?, ?)`, ts, ts)
	exec(`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at,
			ends_at, created_at) VALUES ('period', 'org', 2025, 'annual',
			'2025-01-01', '2025-12-31', ?)`, ts)
	exec(`INSERT INTO emission_source (id, site_id, name, scope, category)
		VALUES ('src', 'site', '外购电力', 2, 'electricity.grid')`)
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
			dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at,
			pinned_from) VALUES ('ef', 2024, 'MEE', 'CN', '2024', 2, 'kWh', 0.5,
			'AR6', ?, 'seed')`, ts)
	exec(`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
			occurred_at_start, occurred_at_end, amount, unit, ef_factor_code, ef_year,
			ef_source, ef_geography, ef_dataset_version, computed_co2e_kg, computed_at,
			created_at, updated_at) VALUES ('act', 'site', 'src', 'period', ?, ?, 100,
			'kWh', 'ef', 2024, 'MEE', 'CN', '2024', 50, ?, ?, ?)`, ts, ts, ts, ts, ts)
	return db
}

func addDocument(t *testing.T, db *store.Store, id, name string, data []byte,
	dir string) string {
	t.Helper()
	relative := filepath.Join("documents", name)
	path := filepath.Join(dir, relative)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	if _, err := db.DB().ExecContext(context.Background(), `INSERT INTO document
			(id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
		VALUES (?, ?, ?, 'application/pdf', ?, ?, '2025-01-15T00:00:00Z')`,
		id, hex.EncodeToString(digest[:]), name, len(data), relative); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestBuildIncludesEvidenceAndManifest(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)
	dir := t.TempDir()
	addDocument(t, db, "doc-1", "bill.pdf", []byte("evidence-one"), dir)
	missingPath := filepath.Join(dir, "gone.pdf")
	if _, err := db.DB().ExecContext(ctx, `INSERT INTO document
			(id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
		VALUES ('doc-2', 'deadbeef', 'gone.pdf', 'application/pdf', 4, ?,
			'2025-01-15T00:00:00Z')`, missingPath); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{{"e1", "doc-1"}, {"e2", "doc-2"}} {
		if _, err := db.DB().ExecContext(ctx, `INSERT INTO evidence_attachment
				(id, activity_data_id, document_id, created_at) VALUES (?, 'act', ?, ?)`,
			pair[0], pair[1], "2025-01-15T00:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}
	out := filepath.Join(t.TempDir(), "bundle.zip")
	result, err := Build(ctx, db, Input{
		PeriodID: "period",
		Activities: []ActivityRef{
			{ID: "act", SourceName: "Purchased electricity"},
		},
		ReportPDF: NamedBytes{Name: "report.pdf", Bytes: []byte("PDFDATA")},
		Appendix:  NamedBytes{Name: "appendix.xlsx", Bytes: []byte("XLSXDATA")},
		Readiness: &Readiness{
			CheckedAt: "2026-11-21T12:00:00Z", CheckCount: 14,
			Warnings: 1,
			Rows: []ReadinessRow{{
				Severity: "Warning", CheckID: "D1",
				Title: "No base year set", Detail: "Year-over-year has nothing to anchor to.",
				EntityType: "organization", EntityID: "org",
			}},
		},
		OutPath: out,
		DataDir: dir,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.EvidenceTotal != 2 || result.EvidenceMissing != 1 {
		t.Fatalf("result = %+v", result)
	}

	reader, err := zip.OpenReader(out)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	entries := map[string]*zip.File{}
	for _, file := range reader.File {
		entries[file.Name] = file
	}
	for _, want := range []string{"report.pdf", "appendix.xlsx", "readiness.csv",
		"evidence/001-bill.pdf", "manifest.csv"} {
		if entries[want] == nil {
			t.Fatalf("missing entry %s; got %v", want, entryNames(entries))
		}
	}
	if got := readEntry(t, entries["evidence/001-bill.pdf"]); got != "evidence-one" {
		t.Fatalf("evidence bytes = %q", got)
	}
	manifest := readEntry(t, entries["manifest.csv"])
	if !strings.HasPrefix(manifest, "\ufeff") {
		t.Fatal("manifest has no UTF-8 BOM")
	}
	if strings.Count(manifest, `"included"`) != 4 || strings.Count(manifest, `"missing"`) != 1 {
		t.Fatalf("manifest status counts:\n%s", manifest)
	}
	expected := sha256.Sum256([]byte("evidence-one"))
	if !strings.Contains(manifest, hex.EncodeToString(expected[:])) {
		t.Fatalf("manifest lacks the evidence hash:\n%s", manifest)
	}
	readiness := readEntry(t, entries["readiness.csv"])
	if !strings.Contains(readiness, `"No base year set"`) ||
		!strings.Contains(readiness, `"14"`) {
		t.Fatalf("readiness csv:\n%s", readiness)
	}
}

func entryNames(entries map[string]*zip.File) []string {
	out := make([]string, 0, len(entries))
	for name := range entries {
		out = append(out, name)
	}
	return out
}

func readEntry(t *testing.T, file *zip.File) string {
	t.Helper()
	reader, err := file.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestEvidenceNamesAreSanitizedAndUnique(t *testing.T) {
	used := map[string]struct{}{}
	first := evidenceName(1, "bill.pdf", used)
	second := evidenceName(1, "bill.pdf", used)
	if first != "evidence/001-bill.pdf" || second != "evidence/001-bill-2.pdf" {
		t.Fatalf("names = %q, %q", first, second)
	}
	escaped := evidenceName(2, `../../etc/passwd`, used)
	if strings.Count(escaped, "/") != 1 || !strings.HasPrefix(escaped, "evidence/002-") {
		t.Fatalf("escaped name = %q", escaped)
	}
}
