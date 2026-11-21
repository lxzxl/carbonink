package mcp

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"app.carbonink.desktop/internal/workspace"
)

// dataDirEnv and dbPathEnv make the helper testable and let unusual installs
// point it at a workspace without a registry.
const (
	dataDirEnv = "CARBONINK_DATA_DIR"
	dbPathEnv  = "CARBONINK_MCP_DB"
)

// appIDs are the NSGo data directories in preference order: the stable id
// first, then the beta the 2.0 previews use, then the Electron names.
var appIDs = []string{
	"app.carbonink.desktop",
	"app.carbonink.desktop.beta",
	"CarbonInk",
	"carbonink",
}

// DataDir resolves the CarbonInk data directory the desktop app writes.
func DataDir() (string, error) {
	if override := os.Getenv(dataDirEnv); override != "" {
		return override, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("mcp: resolve config directory: %w", err)
	}
	for _, id := range appIDs {
		dir := filepath.Join(base, id)
		if _, err := os.Stat(filepath.Join(dir, "workspaces.json")); err == nil {
			return dir, nil
		}
	}
	for _, id := range appIDs {
		dir := filepath.Join(base, id)
		if _, err := os.Stat(filepath.Join(dir, "app.sqlite")); err == nil {
			return dir, nil
		}
	}
	return "", fmt.Errorf("mcp: CarbonInk data directory not found under %s. "+
		"Launch the app at least once, or set %s.", base, dataDirEnv)
}

// DBPath resolves the active workspace's database file.
func DBPath() (string, error) {
	if override := os.Getenv(dbPathEnv); override != "" {
		if _, err := os.Stat(override); err != nil {
			return "", fmt.Errorf("mcp: open %s: %w", override, err)
		}
		return override, nil
	}
	dir, err := DataDir()
	if err != nil {
		return "", err
	}
	manager := workspace.New(dir, "")
	_, path, err := manager.Active()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			fallback := filepath.Join(dir, "app.sqlite")
			if _, statErr := os.Stat(fallback); statErr == nil {
				return fallback, nil
			}
			return "", fmt.Errorf("mcp: no workspace registry in %s. Launch the app at least once.", dir)
		}
		return "", fmt.Errorf("mcp: read workspace registry: %w", err)
	}
	return path, nil
}
