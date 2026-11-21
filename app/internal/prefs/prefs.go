// Package prefs stores app-level preferences that are not workspace data:
// appearance, language and the main window's frame.
package prefs

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

const filename = "settings.json"

// Settings is one settings.json.
type Settings struct {
	// Theme is "", "light" or "dark"; "" follows the system.
	Theme string `json:"theme,omitempty"`
	// Locale is a BCP 47 tag, or "" to follow the system.
	Locale string `json:"locale,omitempty"`
	// LLMProvider names the chosen OpenAI-compatible preset ("openai",
	// "deepseek", "moonshot" or "custom").
	LLMProvider string `json:"llmProvider,omitempty"`
	// LLMBaseURL is the endpoint root, without /chat/completions.
	LLMBaseURL string `json:"llmBaseURL,omitempty"`
	// LLMModel is the model id sent in each request.
	LLMModel string `json:"llmModel,omitempty"`
	// Window is the last main-window frame, nil before the first quit.
	Window *Window `json:"window,omitempty"`
}

// Window is a frame in points from the main screen's top left.
type Window struct {
	X      float32 `json:"x"`
	Y      float32 `json:"y"`
	Width  float32 `json:"width"`
	Height float32 `json:"height"`
}

// Path is settings.json inside dataDir.
func Path(dataDir string) string { return filepath.Join(dataDir, filename) }

// Load reads path. A missing file is the zero Settings, not an error.
func Load(path string) (Settings, error) {
	var s Settings
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// Save writes path atomically with owner-only permissions.
func Save(path string, s Settings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
