package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"app.carbonink.desktop/internal/efimport"
)

var (
	// ErrEFLibraryExists means the name is taken and Replace was not set.
	ErrEFLibraryExists = errors.New("an EF library with this name already exists")
	// ErrEFLibraryInvalidName means the name is empty, too long, or carries
	// control characters.
	ErrEFLibraryInvalidName = errors.New("library name must be 1-50 characters without control characters")
	// ErrEFLibraryEmpty means there are no valid rows to import.
	ErrEFLibraryEmpty = errors.New("no valid emission factors to import")
)

// EFLibrary is one user-imported factor library.
type EFLibrary struct {
	ID             string
	Name           string
	Source         string
	Version        string
	SourceFilename string
	DocumentID     string
	FactorCount    int
	ImportedAt     string
	CreatedAt      string
}

// EFLibraryImport is one staged library ready to commit.
type EFLibraryImport struct {
	Name         string
	Version      string
	Filename     string
	Rows         []efimport.ValidRow
	Replace      bool
	TotalRows    int
	Skipped      int
	WarningCount int
}

// ImportEFLibrary writes the valid rows under the `user:<name>` source
// namespace, replacing an existing library when Replace is set. Pinned
// snapshots on activity rows are untouched.
func (s *Store) ImportEFLibrary(ctx context.Context, in EFLibraryImport) (*EFLibrary, int, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 50 || hasControlChars(name) {
		return nil, 0, ErrEFLibraryInvalidName
	}
	if len(in.Rows) == 0 {
		return nil, 0, ErrEFLibraryEmpty
	}
	version := strings.TrimSpace(in.Version)
	if version == "" {
		version = now()[:10]
	}
	source := "user:" + name
	ts := now()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()
	existing, err := efLibraryByName(ctx, tx, name)
	if err != nil {
		return nil, 0, err
	}
	if existing != nil && !in.Replace {
		return nil, 0, ErrEFLibraryExists
	}
	if existing != nil {
		if _, err := tx.ExecContext(ctx, `DELETE FROM emission_factor WHERE source = ?`, existing.Source); err != nil {
			return nil, 0, err
		}
	}
	const insert = `INSERT INTO emission_factor (
			factor_code, year, source, geography, dataset_version,
			scope, category, ghg_protocol_path, input_unit,
			co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
			hfc_kg_per_unit, pfc_kg_per_unit, sf6_kg_per_unit, nf3_kg_per_unit,
			gwp_basis, name_zh, name_en, description_zh, description_en,
			notes, biogenic_co2_factor, citation_url
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	for _, row := range in.Rows {
		if _, err := tx.ExecContext(ctx, insert,
			row.FactorCode, row.Year, source, row.Geography, version,
			row.Scope, nullIfEmpty(row.Category), nil, row.InputUnit,
			row.CO2e, floatArg(row.CH4), floatArg(row.N2O), floatArg(row.HFC),
			floatArg(row.PFC), floatArg(row.SF6), floatArg(row.NF3),
			row.GWP, nullIfEmpty(row.NameZH), nullIfEmpty(row.NameEN),
			nullIfEmpty(row.DescriptionZH), nullIfEmpty(row.DescriptionEN),
			nullIfEmpty(row.Notes), floatArg(row.Biogenic), nullIfEmpty(row.CitationURL)); err != nil {
			return nil, 0, err
		}
	}
	var library *EFLibrary
	if existing != nil {
		if _, err := tx.ExecContext(ctx, `UPDATE user_ef_library
				SET version = ?, source_filename = ?, factor_count = ?, imported_at = ?
				WHERE id = ?`, version, nullIfEmpty(in.Filename), len(in.Rows), ts, existing.ID); err != nil {
			return nil, 0, err
		}
		library, err = efLibraryByID(ctx, tx, existing.ID)
	} else {
		id := newID()
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_ef_library
				(id, name, source, version, source_filename, factor_count, imported_at, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, name, source, version, nullIfEmpty(in.Filename), len(in.Rows), ts, ts); err != nil {
			return nil, 0, err
		}
		library, err = efLibraryByID(ctx, tx, id)
	}
	if err != nil {
		return nil, 0, err
	}
	if err := writeAudit(ctx, tx, "ef_library.imported", ts, map[string]any{
		"library_id":     library.ID,
		"name":           name,
		"version":        version,
		"replaced":       existing != nil,
		"total_rows":     in.TotalRows,
		"imported_count": len(in.Rows),
		"skipped_count":  in.Skipped,
		"warning_count":  in.WarningCount,
	}); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return library, len(in.Rows), nil
}

// ListEFLibraries returns imported libraries newest first.
func (s *Store) ListEFLibraries(ctx context.Context) ([]EFLibrary, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, source, version,
			coalesce(source_filename, ''), coalesce(document_id, ''), factor_count,
			imported_at, created_at
		FROM user_ef_library ORDER BY imported_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EFLibrary
	for rows.Next() {
		var library EFLibrary
		if err := rows.Scan(&library.ID, &library.Name, &library.Source, &library.Version,
			&library.SourceFilename, &library.DocumentID, &library.FactorCount,
			&library.ImportedAt, &library.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, library)
	}
	return out, rows.Err()
}

// DeleteEFLibrary removes the library's factors and its registry row. Pinned
// snapshots stay, so existing activity rows keep their numbers.
func (s *Store) DeleteEFLibrary(ctx context.Context, id string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	library, err := efLibraryByID(ctx, tx, id)
	if err != nil {
		return 0, err
	}
	if library == nil {
		return 0, fmt.Errorf("EF library not found: %s", id)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM emission_factor WHERE source = ?`, library.Source)
	if err != nil {
		return 0, err
	}
	deleted, _ := result.RowsAffected()
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_ef_library WHERE id = ?`, id); err != nil {
		return 0, err
	}
	if err := writeAudit(ctx, tx, "ef_library.deleted", now(), map[string]any{
		"library_id":    id,
		"name":          library.Name,
		"deleted_count": deleted,
	}); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return int(deleted), nil
}

// KnownUnits returns every canonical unit and alias, for the advisory
// unknown-unit warning during import.
func (s *Store) KnownUnits(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT unit FROM unit_definition
		UNION SELECT alias FROM unit_alias`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]bool)
	for rows.Next() {
		var unit string
		if err := rows.Scan(&unit); err != nil {
			return nil, err
		}
		out[unit] = true
	}
	return out, rows.Err()
}

func efLibraryByName(ctx context.Context, q queryer, name string) (*EFLibrary, error) {
	row := q.QueryRowContext(ctx, `SELECT id, name, source, version,
			coalesce(source_filename, ''), coalesce(document_id, ''), factor_count,
			imported_at, created_at
		FROM user_ef_library WHERE name = ?`, name)
	library, err := scanEFLibrary(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &library, nil
}

func efLibraryByID(ctx context.Context, q queryer, id string) (*EFLibrary, error) {
	row := q.QueryRowContext(ctx, `SELECT id, name, source, version,
			coalesce(source_filename, ''), coalesce(document_id, ''), factor_count,
			imported_at, created_at
		FROM user_ef_library WHERE id = ?`, id)
	library, err := scanEFLibrary(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &library, nil
}

func scanEFLibrary(row rowScanner) (EFLibrary, error) {
	var library EFLibrary
	err := row.Scan(&library.ID, &library.Name, &library.Source, &library.Version,
		&library.SourceFilename, &library.DocumentID, &library.FactorCount,
		&library.ImportedAt, &library.CreatedAt)
	return library, err
}

func hasControlChars(text string) bool {
	for _, r := range text {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

func floatArg(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}
