package main

import (
	"os"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestMain(m *testing.M) {
	// Never import the developer's real Electron data during tests.
	os.Setenv("CARBONINK_NO_LEGACY_IMPORT", "1")
	nsgotest.Main(m)
}

// TestShellMounts proves the real shell opens a fresh workspace, shows the
// activity table, and reaches a Phase 2 placeholder.
func TestShellMounts(t *testing.T) {
	app := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	app.WaitFor("id:shell", 5*time.Second)
	app.WaitFor("id:activities-table", 5*time.Second)
	app.WaitFor("text:No activity data yet.", 2*time.Second)
	app.Press("text:Sources")
	app.WaitFor("text:This screen lands in Phase 2.", 2*time.Second)
}
