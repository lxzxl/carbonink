package store

import (
	"context"
	"fmt"
)

// ValidateBackupFile checks that path is a CarbonInk database: SQLite can
// open it and it carries the schema_migrations table every export starts
// from. Older backups are fine — the normal migration run upgrades them on
// the next launch.
func ValidateBackupFile(ctx context.Context, path string) error {
	s, err := OpenReadOnly(ctx, path)
	if err != nil {
		return fmt.Errorf("not a CarbonInk database: %w", err)
	}
	defer s.Close()
	if _, err := s.SchemaVersion(ctx); err != nil {
		return fmt.Errorf("backup is missing schema_migrations: %w", err)
	}
	return nil
}
