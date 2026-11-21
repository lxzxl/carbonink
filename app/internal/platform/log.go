package platform

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

const (
	logName    = "carbonink.log"
	maxLogSize = 5 << 20
)

// Logger writes JSON lines to <logs>/carbonink.log and stderr. It rotates the
// file to carbonink.log.1 when it reaches maxLogSize.
type Logger struct {
	*slog.Logger
	file *os.File
}

// NewLogger opens the app log. A directory or file that cannot be opened
// falls back to stderr; logging never blocks startup.
func NewLogger(dir string) *Logger {
	l, err := newLogger(dir, maxLogSize)
	if err != nil {
		return &Logger{Logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}
	}
	return l
}

func newLogger(dir string, max int64) (*Logger, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, logName)
	if info, err := os.Stat(path); err == nil && info.Size() >= max {
		_ = os.Remove(path + ".1")
		if err := os.Rename(path, path+".1"); err != nil {
			return nil, err
		}
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	handler := slog.NewJSONHandler(io.MultiWriter(f, os.Stderr), &slog.HandlerOptions{Level: slog.LevelInfo})
	return &Logger{Logger: slog.New(handler), file: f}, nil
}

// Close closes the log file.
func (l *Logger) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	return l.file.Close()
}
