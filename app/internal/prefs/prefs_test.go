package prefs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissing(t *testing.T) {
	s, err := Load(filepath.Join(t.TempDir(), "none.json"))
	if err != nil {
		t.Fatal(err)
	}
	if s != (Settings{}) {
		t.Fatalf("missing file = %+v", s)
	}
}

func TestRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "settings.json")
	want := Settings{Theme: "dark", Locale: "zh-CN",
		LLMProvider: "deepseek", LLMBaseURL: "https://api.deepseek.com/v1",
		LLMModel: "deepseek-chat",
		Window:   &Window{X: 10, Y: 20, Width: 1280, Height: 820}}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != want.Theme || got.Locale != want.Locale ||
		got.LLMProvider != want.LLMProvider || got.LLMBaseURL != want.LLMBaseURL ||
		got.LLMModel != want.LLMModel || got.Window == nil || *got.Window != *want.Window {
		t.Fatalf("Load = %+v, want %+v", got, want)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("mode = %o, want 600", perm)
	}
}
