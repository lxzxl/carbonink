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

// TestShellMounts proves a fresh workspace runs onboarding and then opens the
// real inventory shell.
func TestShellMounts(t *testing.T) {
	app := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	app.WaitFor("id:shell", 5*time.Second)
	app.WaitFor("id:onboarding-org-zh", 5*time.Second)
	app.Type("id:onboarding-org-zh", "测试组织")
	app.Type("id:onboarding-site-zh", "上海工厂")
	app.Press("id:onboarding-submit")
	app.WaitFor("text:测试组织", 5*time.Second)
	app.Press("text:Sources")
	app.WaitFor("text:No emission sources yet", 2*time.Second)
}
