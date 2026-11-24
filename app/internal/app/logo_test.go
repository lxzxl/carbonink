package app

import (
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/report"
	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestReportLogoUploadAndRemove proves the settings card stores the logo in the
// workspace's setting table and clears it again.
func TestReportLogoUploadAndRemove(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)

	logoPath := filepath.Join(t.TempDir(), "logo.png")
	writeTestLogo(t, logoPath)

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.PickFiles = func(nsgotest.FilePick) []core.File {
		return []core.File{{Name: "logo.png", Path: logoPath}}
	}
	openSettings(ui, "org")
	ui.WaitFor("id:settings-report-logo-pick", 3*time.Second)
	ui.Press("id:settings-report-logo-pick")
	ui.WaitFor("text:Report logo saved", 3*time.Second)
	ui.WaitFor("id:settings-report-logo", 3*time.Second)

	ctx := context.Background()
	db, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	raw, ok, err := db.Setting(ctx, report.LogoSetting)
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	if !ok || !strings.HasPrefix(raw, "data:image/png;base64,") {
		db.Close()
		t.Fatalf("stored logo = %q", raw)
	}
	if data, format := report.DecodeLogo(raw); len(data) == 0 || format != "PNG" {
		db.Close()
		t.Fatalf("decoded logo = %d bytes, %q", len(data), format)
	}
	db.Close()

	ui.Press("id:settings-report-logo-clear")
	ui.WaitFor("text:Report logo removed", 3*time.Second)
	ui.WaitForGone("id:settings-report-logo", 3*time.Second)

	db, err = store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, ok, err := db.Setting(ctx, report.LogoSetting); err != nil || ok {
		t.Fatalf("logo still present: ok=%v err=%v", ok, err)
	}
}

// writeTestLogo writes a red PNG wide enough to survive the PDF cover's
// aspect-preserving scale.
func writeTestLogo(t *testing.T, path string) {
	t.Helper()
	src := image.NewRGBA(image.Rect(0, 0, 40, 20))
	for y := 0; y < 20; y++ {
		for x := 0; x < 40; x++ {
			src.Set(x, y, color.RGBA{R: 220, G: 20, B: 20, A: 255})
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, src); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

// testLogoDataURL is writeTestLogo as the data URL stored in the setting.
func testLogoDataURL(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "logo.png")
	writeTestLogo(t, path)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
}

// TestReportLogoRejectsLargeAndUnsupportedFiles keeps the 1.x limits.
func TestReportLogoRejectsLargeAndUnsupportedFiles(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	dir := t.TempDir()
	large := filepath.Join(dir, "large.png")
	if err := os.WriteFile(large, make([]byte, maxLogoBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	text := filepath.Join(dir, "notes.png")
	if err := os.WriteFile(text, []byte("not an image"), 0o600); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	openSettings(ui, "org")
	ui.WaitFor("id:settings-report-logo-pick", 3*time.Second)

	ui.PickFiles = func(nsgotest.FilePick) []core.File {
		return []core.File{{Name: "large.png", Path: large}}
	}
	ui.Press("id:settings-report-logo-pick")
	ui.WaitFor("text:Image too large", 3*time.Second)

	ui.PickFiles = func(nsgotest.FilePick) []core.File {
		return []core.File{{Name: "notes.png", Path: text}}
	}
	ui.Press("id:settings-report-logo-pick")
	ui.WaitFor("text:Unsupported image", 3*time.Second)
	ui.WaitForGone("id:settings-report-logo", time.Second)
}
