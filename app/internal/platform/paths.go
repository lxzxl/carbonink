// Package platform resolves the paths the desktop app shares with the 1.x
// Electron install.
package platform

import (
	"os"
	"path/filepath"
)

// DataDir is where NSGo keeps an app's files: the user's config directory plus
// the app id. It lets main read preferences before nsgo.Run has a scope.
func DataDir(id string) string {
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, id)
}

// LegacyDir returns an earlier data directory (2.0-beta or 1.x Electron) when
// it still holds a workspace registry, else "". CARBONINK_LEGACY_DIR overrides
// the search; CARBONINK_NO_LEGACY_IMPORT disables it (tests).
func LegacyDir() string {
	if os.Getenv("CARBONINK_NO_LEGACY_IMPORT") != "" {
		return ""
	}
	if dir := os.Getenv("CARBONINK_LEGACY_DIR"); dir != "" {
		return dir
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return legacyDirIn(base)
}

// legacyDirIn checks the 2.0-beta directory first, then the product names
// Electron 1.x used ("carbonink" and "CarbonInk").
func legacyDirIn(base string) string {
	for _, name := range []string{"app.carbonink.desktop.beta", "carbonink", "CarbonInk"} {
		dir := filepath.Join(base, name)
		if _, err := os.Stat(filepath.Join(dir, "workspaces.json")); err == nil {
			return dir
		}
	}
	return ""
}
