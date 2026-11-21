package platform

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoggerWritesAndRotates(t *testing.T) {
	dir := t.TempDir()
	l, err := newLogger(dir, 64)
	if err != nil {
		t.Fatal(err)
	}
	l.Info("first", "value", strings.Repeat("a", 80))
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}

	l, err = newLogger(dir, 64)
	if err != nil {
		t.Fatal(err)
	}
	l.Info("second")
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(dir, logName+".1")); err != nil {
		t.Fatalf("rotated log: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, logName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"msg":"second"`) {
		t.Fatalf("current log = %s", data)
	}
	info, err := os.Stat(filepath.Join(dir, logName))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("log mode = %o, want 600", perm)
	}
}
