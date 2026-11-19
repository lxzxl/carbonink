package main

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestMain(m *testing.M) { nsgotest.Main(m) }

// TestShellMounts proves the harness opens and every experiment is reachable.
func TestShellMounts(t *testing.T) {
	app := nsgotest.Start(t, Root, nsgotest.Size(1280, 820))
	app.WaitFor("text:10,000 rows", 2*time.Second)
	app.Press("text:PDF preview")
	app.WaitFor("id:pdf-view", 5*time.Second)
	app.Press("text:PDF text")
	app.WaitFor("text:Extract all", 2*time.Second)
}
