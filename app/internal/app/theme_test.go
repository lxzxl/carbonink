package app

import (
	"testing"

	"github.com/nsgo-dev/nsgo/core"
)

// TestCarbonInkThemeUsesMossAccent locks the brand decision: the app no
// longer ships NSGo's default blue, filled controls use sage with graphite
// text, and accent-as-text stays on the darker moss step.
func TestCarbonInkThemeUsesMossAccent(t *testing.T) {
	theme := carboninkTheme()
	if got, want := theme.Light.Accent, core.RGB(sage); got != want {
		t.Fatalf("light accent = %v, want sage %v", got, want)
	}
	if got, want := theme.Dark.Accent, core.RGB(moss300); got != want {
		t.Fatalf("dark accent = %v, want moss-300 %v", got, want)
	}
	if theme.Light.Accent == core.DefaultTheme().Light.Accent {
		t.Fatal("light accent is still NSGo's default blue")
	}
	if got, want := theme.Light.AccentText, core.RGB(graphite); got != want {
		t.Fatalf("light accent text = %v, want graphite %v", got, want)
	}
	if got, want := theme.Light.Colors["primary"], core.RGB(sage); got != want {
		t.Fatalf("light primary token = %v, want %v", got, want)
	}
	if got, want := theme.Dark.Colors["primary-foreground"], core.RGB(graphite); got != want {
		t.Fatalf("dark primary foreground = %v, want graphite %v", got, want)
	}
	if got, want := theme.Light.Colors["accentInk"], core.RGB(moss700); got != want {
		t.Fatalf("accent ink = %v, want moss-700 %v", got, want)
	}
}
