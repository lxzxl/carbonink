// Package store owns the workspace SQLite database: opening it with the
// cgo-free driver, applying the Electron schema migrations, and reading the
// rows the 2.0 screens need.
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ncruces/go-sqlite3/driver"
	"github.com/ncruces/go-sqlite3/ext/fts5"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

var migrationName = regexp.MustCompile(`^(\d{3})_(.+)\.sql$`)

// Store is one open workspace database.
type Store struct {
	db   *sql.DB
	path string
}

// Activity is one ledger row joined with the names its screen shows.
type Activity struct {
	ID                string
	SiteID            string
	Site              string
	EmissionSourceID  string
	Source            string
	ReportingPeriodID string
	OccurredAt        string
	OccurredAtEnd     string
	Amount            float64
	Unit              string
	EFFactorCode      string
	EFYear            int
	EFSource          string
	EFGeography       string
	EFDatasetVersion  string
	CO2eKg            float64
	ComputedAt        string
	FuelCode          string
	Notes             string
	ExtractionID      string
	InboundQuestionID string
	InboundTier       int
	Scope             int
}

// Open opens path, registers FTS5 on every connection, and puts the database
// in WAL mode. The caller owns Close.
func Open(ctx context.Context, path string) (*Store, error) {
	u := &url.URL{Scheme: "file", Path: path}
	q := u.Query()
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	u.RawQuery = q.Encode()

	db, err := driver.Open(u.String(), fts5.Register)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if _, err := db.ExecContext(ctx, `PRAGMA journal_mode=WAL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable WAL: %w", err)
	}
	return &Store{db: db, path: path}, nil
}

// OpenReadOnly opens a workspace without taking the write lock or scheduling
// maintenance. The MCP helper process reads through this handle while the
// desktop app keeps writing.
func OpenReadOnly(ctx context.Context, path string) (*Store, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	u := &url.URL{Scheme: "file", Path: path}
	q := u.Query()
	q.Set("mode", "ro")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "foreign_keys(1)")
	u.RawQuery = q.Encode()
	db, err := driver.Open(u.String(), fts5.Register)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(2)
	return &Store{db: db, path: path}, nil
}

// Close releases the database.
func (s *Store) Close() error { return s.db.Close() }

// DB exposes the handle for packages that need a query the store does not wrap
// yet. Prefer adding a method here.
func (s *Store) DB() *sql.DB { return s.db }

// Path is the database file.
func (s *Store) Path() string { return s.path }

// Migrate applies the embedded migrations that the workspace lacks. It
// mirrors desktop/src/main/db/migrate.ts: 000 bootstraps schema_migrations,
// foreign keys are off inside each migration, and foreign_key_check runs after
// every commit.
func (s *Store) Migrate(ctx context.Context) (int, error) {
	migrations, err := loadMigrations()
	if err != nil {
		return 0, err
	}
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Close()

	var exists int
	if err := conn.QueryRowContext(ctx,
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).Scan(&exists); err != nil {
		return 0, err
	}
	count := 0
	if exists == 0 {
		bootstrap := migrations[0]
		if bootstrap.version != 0 {
			return 0, fmt.Errorf("first migration is %s, want 000_meta", bootstrap.name)
		}
		if _, err := conn.ExecContext(ctx, bootstrap.sql); err != nil {
			return 0, fmt.Errorf("%s: %w", bootstrap.name, err)
		}
		if _, err := conn.ExecContext(ctx,
			`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
			bootstrap.version, bootstrap.name, now()); err != nil {
			return 0, err
		}
		count++
	}

	applied, err := appliedVersions(ctx, conn)
	if err != nil {
		return 0, err
	}
	for _, m := range migrations {
		if applied[m.version] {
			continue
		}
		if err := applyOne(ctx, conn, m); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

// SchemaVersion is the highest applied migration version.
func (s *Store) SchemaVersion(ctx context.Context) (int, error) {
	var version int
	err := s.db.QueryRowContext(ctx, `SELECT coalesce(max(version), -1) FROM schema_migrations`).Scan(&version)
	return version, err
}

// Activities returns the newest rows, joined with site and source names.
func (s *Store) Activities(ctx context.Context, limit int) ([]Activity, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, activitySelect+`
		ORDER BY a.occurred_at_start DESC, a.id
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Activity
	for rows.Next() {
		a, err := scanActivity(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ActivitiesForYear returns every ledger row whose reporting period is year.
func (s *Store) ActivitiesForYear(ctx context.Context, year int) ([]Activity, error) {
	rows, err := s.db.QueryContext(ctx, activitySelect+`
		JOIN reporting_period rp ON rp.id = a.reporting_period_id
		WHERE rp.year = ?
		ORDER BY a.occurred_at_start DESC, a.id`, year)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Activity
	for rows.Next() {
		a, err := scanActivity(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ActivityCount is the number of ledger rows.
func (s *Store) ActivityCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM activity_data`).Scan(&n)
	return n, err
}

// Backup writes a consistent snapshot to dest with VACUUM INTO. The
// destination must not exist; the snapshot includes every table, index and
// FTS shadow table.
func (s *Store) Backup(ctx context.Context, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf("backup %s already exists", dest)
	}
	q := `VACUUM INTO '` + strings.ReplaceAll(dest, "'", "''") + `'`
	if _, err := s.db.ExecContext(ctx, q); err != nil {
		return fmt.Errorf("vacuum into %s: %w", dest, err)
	}
	if err := os.Chmod(dest, 0o600); err != nil {
		return fmt.Errorf("chmod backup: %w", err)
	}
	return nil
}

type migration struct {
	version int
	name    string
	sql     string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range entries {
		m := migrationName.FindStringSubmatch(e.Name())
		if m == nil {
			return nil, fmt.Errorf("migration filename invalid: %s", e.Name())
		}
		version, err := strconv.Atoi(m[1])
		if err != nil {
			return nil, err
		}
		sql, err := migrationFS.ReadFile(filepath.Join("migrations", e.Name()))
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: version, name: strings.TrimSuffix(e.Name(), ".sql"), sql: string(sql)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

func appliedVersions(ctx context.Context, conn *sql.Conn) (map[int]bool, error) {
	rows, err := conn.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	applied := map[int]bool{}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		applied[v] = true
	}
	return applied, rows.Err()
}

func applyOne(ctx context.Context, conn *sql.Conn, m migration) error {
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		return err
	}
	defer func() {
		_, _ = conn.ExecContext(context.WithoutCancel(ctx), `PRAGMA foreign_keys=ON`)
	}()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, m.sql); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("%s: %w", m.name, err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
		m.version, m.name, now()); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys=ON`); err != nil {
		return err
	}
	rows, err := conn.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return fmt.Errorf("%s produced a foreign key violation", m.name)
	}
	return rows.Err()
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
