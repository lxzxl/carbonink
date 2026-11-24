package app

import (
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestSettingsAboutShowsRuntimeAndActions proves the About card reports the
// build identity, the runtime and the machine, and that its folder, support
// and website actions reach the platform.
func TestSettingsAboutShowsRuntimeAndActions(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	openSettings(ui, "about")
	ui.WaitFor("id:settings-about", 5*time.Second)

	rowText := func(selector string) string {
		row := ui.Find(selector)
		var parts []string
		for _, child := range row.Children {
			if child.Text != "" {
				parts = append(parts, child.Text)
			}
		}
		return strings.Join(parts, " ")
	}

	wantVersion := core.App().Version
	if wantVersion == "" {
		wantVersion = "Development"
	}
	if got := rowText("id:settings-about-version"); !strings.Contains(got, "Version") ||
		!strings.Contains(got, wantVersion) {
		t.Errorf("version row = %q, want the app's %q", got, wantVersion)
	}
	if got := rowText("id:settings-about-platform"); !strings.Contains(got, runtime.GOOS) ||
		!strings.Contains(got, runtime.GOARCH) {
		t.Errorf("platform row = %q, want %s and %s", got, runtime.GOOS, runtime.GOARCH)
	}
	ui.WaitFor("text:NSGo · "+runtime.Version(), 2*time.Second)

	ui.Press("id:settings-about-open-data")
	ui.Press("id:settings-about-open-logs")
	ui.Press("id:settings-about-open-website")
	ui.Press("id:settings-about-support-link")

	if len(ui.RevealedFiles) != 2 {
		t.Errorf("revealed %v, want the data and log folders", ui.RevealedFiles)
	}
	wantURLs := []string{"https://carbonink.xyz", "mailto:support@carbonink.xyz"}
	if !slices.Equal(ui.OpenedURLs, wantURLs) {
		t.Errorf("opened %v, want the website and support address", ui.OpenedURLs)
	}
}
