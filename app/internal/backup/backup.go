// Package backup keeps the last week of daily snapshots for a workspace.
// It mirrors the 1.x layout:
//
//	<data>/auto-backups/<workspace_id>/auto-YYYYMMDD-HHmmss.carbonink-backup
package backup

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"app.carbonink.desktop/internal/store"
)

const (
	// DirName is the directory under the app's data dir.
	DirName = "auto-backups"
	// Retention is how many snapshots one workspace keeps.
	Retention = 7
	// Interval is the shortest time between snapshots.
	Interval = 23 * time.Hour
	prefix   = "auto-"
	suffix   = ".carbonink-backup"
	// defaultDBFile is the file every pre-workspace install used; legacy
	// flat snapshots belong to it.
	defaultDBFile = "app.sqlite"
)

// Run makes a snapshot when the newest one is older than Interval, then
// prunes to Retention. It returns the new path, or "" when no snapshot was
// due.
func Run(ctx context.Context, db *store.Store, dataDir, workspaceID string, now time.Time) (string, error) {
	return snapshot(ctx, db, dataDir, workspaceID, now)
}

// Target is one workspace the boot pass may snapshot.
type Target struct {
	ID   string
	File string
}

// RunAll snapshots every registered workspace whose newest snapshot is due,
// then prunes each workspace to Retention. It mirrors the 1.x boot pass:
// inactive files are opened with a short-lived connection so their WAL is
// folded in, a workspace with no file yet is skipped, and one broken
// workspace never costs the others their snapshot. The returned paths are
// the snapshots written this pass.
func RunAll(ctx context.Context, active *store.Store, dataDir string, targets []Target,
	activeID string, now time.Time) ([]string, error) {
	migrateLegacyFlat(dataDir, targets)
	var (
		made []string
		errs []error
	)
	for _, target := range targets {
		dest, err := snapshotTarget(ctx, active, dataDir, target, activeID, now)
		if err != nil {
			errs = append(errs, fmt.Errorf("workspace %s: %w", target.ID, err))
			continue
		}
		if dest != "" {
			made = append(made, dest)
		}
	}
	return made, errors.Join(errs...)
}

func snapshotTarget(ctx context.Context, active *store.Store, dataDir string, target Target,
	activeID string, now time.Time) (string, error) {
	dir := filepath.Join(dataDir, DirName, target.ID)
	files, err := snapshots(dir)
	if err != nil {
		return "", err
	}
	if len(files) > 0 {
		newest, err := snapshotTime(dir, files[len(files)-1])
		if err == nil && now.Sub(newest) < Interval {
			return "", nil
		}
	}
	path := filepath.Join(dataDir, target.File)
	if target.ID != activeID {
		if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
			return "", nil
		} else if err != nil {
			return "", err
		}
		db, err := store.Open(ctx, path)
		if err != nil {
			return "", err
		}
		dest, err := snapshot(ctx, db, dataDir, target.ID, now)
		closeErr := db.Close()
		if err != nil {
			return "", err
		}
		return dest, closeErr
	}
	return snapshot(ctx, active, dataDir, target.ID, now)
}

func snapshot(ctx context.Context, db *store.Store, dataDir, workspaceID string, now time.Time) (string, error) {
	dir := filepath.Join(dataDir, DirName, workspaceID)
	files, err := snapshots(dir)
	if err != nil {
		return "", err
	}
	if len(files) > 0 {
		newest, err := snapshotTime(dir, files[len(files)-1])
		if err == nil && now.Sub(newest) < Interval {
			return "", nil
		}
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	dest := filepath.Join(dir, prefix+now.Format("20060102-150405")+suffix)
	for n := 1; ; n++ {
		if _, err := os.Stat(dest); os.IsNotExist(err) {
			break
		}
		dest = filepath.Join(dir, fmt.Sprintf("%s%s-%d%s", prefix, now.Format("20060102-150405"), n, suffix))
	}
	if err := db.Backup(ctx, dest); err != nil {
		return "", err
	}
	if err := prune(dir, Retention); err != nil {
		return dest, err
	}
	return dest, nil
}

// migrateLegacyFlat moves pre-workspace snapshots that sit directly in
// auto-backups/ into the default workspace's directory, as 1.x does, so
// retention history carries over.
func migrateLegacyFlat(dataDir string, targets []Target) {
	root := filepath.Join(dataDir, DirName)
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	destID := ""
	for _, target := range targets {
		if target.File == defaultDBFile {
			destID = target.ID
			break
		}
	}
	if destID == "" && len(targets) > 0 {
		destID = targets[0].ID
	}
	if destID == "" {
		return
	}
	dir := filepath.Join(root, destID)
	for _, entry := range entries {
		name := entry.Name()
		if !entry.Type().IsRegular() || !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, suffix) {
			continue
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return
		}
		if err := os.Rename(filepath.Join(root, name), filepath.Join(dir, name)); err != nil {
			continue
		}
	}
}

// snapshotTime reads the timestamp in a snapshot's name, falling back to its
// modification time. The name is stable across copies; the modtime is not.
func snapshotTime(dir, name string) (time.Time, error) {
	base := strings.TrimSuffix(strings.TrimPrefix(name, prefix), suffix)
	if len(base) >= 15 {
		if t, err := time.ParseInLocation("20060102-150405", base[:15], time.Local); err == nil {
			return t, nil
		}
	}
	info, err := os.Stat(filepath.Join(dir, name))
	if err != nil {
		return time.Time{}, err
	}
	return info.ModTime(), nil
}

// snapshots lists the snapshot file names oldest first.
func snapshots(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		name := e.Name()
		if !e.Type().IsRegular() || !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, suffix) {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

func prune(dir string, keep int) error {
	names, err := snapshots(dir)
	if err != nil || len(names) <= keep {
		return err
	}
	for _, name := range names[:len(names)-keep] {
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}
