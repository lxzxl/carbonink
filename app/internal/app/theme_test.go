package app

import (
	"testing"

	"github.com/nsgo-dev/nsgo/core"
)

// TestCarbonInkThemeUses1xEmerald locks 1.x's palette: the emerald primary,
// warm neutral text, and the light-on-emerald label 1.x used on fills.
func TestCarbonInkThemeUses1xEmerald(t *testing.T) {
	theme := carboninkTheme()
	if got, want := theme.Light.Accent, core.RGB(0x008c4f); got != want {
		t.Fatalf("light accent = %v, want 1.x emerald %v", got, want)
	}
	if got, want := theme.Dark.Accent, core.RGB(0x00af67); got != want {
		t.Fatalf("dark accent = %v, want 1.x dark emerald %v", got, want)
	}
	if theme.Light.Accent == core.DefaultTheme().Light.Accent {
		t.Fatal("light accent is still NSGo's default blue")
	}
	if got, want := theme.Light.AccentText, core.RGB(0xfdfcf8); got != want {
		t.Fatalf("light accent text = %v, want %v", got, want)
	}
	if got, want := theme.Light.Colors["primary"], core.RGB(0x008c4f); got != want {
		t.Fatalf("light primary token = %v, want %v", got, want)
	}
	if got, want := theme.Dark.Colors["primary-foreground"], core.RGB(0x13120c); got != want {
		t.Fatalf("dark primary foreground = %v, want %v", got, want)
	}
	if got, want := theme.Light.Colors["accentInk"], core.RGB(0x007a45); got != want {
		t.Fatalf("accent ink = %v, want %v", got, want)
	}
	if got, want := theme.Light.Background, core.RGB(0xffffff); got != want {
		t.Fatalf("light background = %v, want %v", got, want)
	}
	if got, want := theme.Light.Text, core.RGB(foreground); got != want {
		t.Fatalf("light text = %v, want %v", got, want)
	}
	if got, want := theme.Light.Border, core.RGB(border); got != want {
		t.Fatalf("light border = %v, want %v", got, want)
	}
	if got, want := theme.Light.Colors["info"], core.RGB(primary); got != want {
		t.Fatalf("light info = %v, want %v", got, want)
	}
	if got, want := theme.Dark.Colors["info"], core.RGB(primaryDark); got != want {
		t.Fatalf("dark info = %v, want %v", got, want)
	}
	if got, want := theme.Dark.Colors["raised"], core.RGB(raisedDark); got != want {
		t.Fatalf("dark raised = %v, want %v", got, want)
	}
	if got, want := theme.Dark.Colors["inset"], core.RGB(sidebarDark); got != want {
		t.Fatalf("dark inset = %v, want %v", got, want)
	}
}
