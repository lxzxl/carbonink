package app

import (
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// CarbonInk's moss accent, from the X2 icon palette. moss-500 is the
// brand mark's green and the selected-row tint; filled controls use the
// sage step with graphite text (5.4:1), and accent-as-text uses
// moss-700 (7.5:1 on white). White on moss-500 is only 4.2:1, below the
// WCAG AA floor this product commits to.
const (
	moss200     = 0xc8d5c4
	moss300     = 0xa3b8a0
	moss400     = 0x8fa98b
	moss500     = 0x6b8266
	sage        = 0x7c9476
	sageHover   = 0x748c6e
	sagePressed = 0x71896b
	moss600     = 0x586c54
	moss700     = 0x475743
	graphite    = 0x15171a
)

// accentInk is the accent as text and links: darker than a fill so body
// copy keeps its contrast on the page.
func accentInk(cx *core.Scope) func() core.Color {
	return func() core.Color { return cx.Palette().Colors["accentInk"] }
}

// selectionTint is the selected-row fill: the mark's moss, not the
// lighter control fill.
func selectionTint(cx *core.Scope) core.Color {
	return cx.Palette().Colors["selectionTint"]
}

// cardSurface is a card's palette colors as a dynamic style, so the card
// follows a light/dark switch instead of freezing the palette it was built
// under.
func cardSurface(cx *core.Scope) func() core.Style {
	return func() core.Style { return ui.CardStyle(cx) }
}

// carboninkTheme is NSGo's neutral chrome with CarbonInk's brand accent.
// Every accent role moves together: fills, selection, focus, caret, and
// the shadcn tokens a component may read by name.
func carboninkTheme() *core.Theme {
	t := core.DefaultTheme()

	// Secondary text carries metadata (counts, dates, factor sources), so
	// it keeps WCAG AA on both appearances: muted 6.4:1, faint 4.5:1 in
	// light; 7.0:1 and 4.5:1 in dark.
	t.Light.TextMuted = core.RGB(0x5f5f5f)
	t.Light.SetColor("faint", core.RGB(0x767676))
	t.Dark.TextMuted = core.RGB(0xaaaaaa)
	t.Dark.SetColor("faint", core.RGB(0x878787))

	t.Light.Accent = core.RGB(sage)
	t.Light.AccentHover = core.RGB(sageHover)
	t.Light.AccentPressed = core.RGB(sagePressed)
	t.Light.AccentText = core.RGB(graphite)
	t.Light.Selection = core.RGBA(moss500, 0.22)
	t.Light.Focus = core.RGB(moss600)
	for name, color := range map[string]core.Color{
		"accentFill":                 core.RGB(sage),
		"accentInk":                  core.RGB(moss700),
		"selectionTint":              core.RGBA(moss500, 0.18),
		"primary":                    core.RGB(sage),
		"primary-foreground":         core.RGB(graphite),
		"ring":                       core.RGB(moss600),
		"sidebar-primary":            core.RGB(sage),
		"sidebar-primary-foreground": core.RGB(graphite),
	} {
		t.Light.SetColor(name, color)
	}

	t.Dark.Accent = core.RGB(moss300)
	t.Dark.AccentHover = core.RGB(moss200)
	t.Dark.AccentPressed = core.RGB(moss400)
	t.Dark.AccentText = core.RGB(graphite)
	t.Dark.Selection = core.RGBA(moss300, 0.24)
	t.Dark.Focus = core.RGB(moss300)
	for name, color := range map[string]core.Color{
		"accentFill":                 core.RGB(moss300),
		"accentInk":                  core.RGB(moss200),
		"selectionTint":              core.RGBA(moss300, 0.22),
		"primary":                    core.RGB(moss300),
		"primary-foreground":         core.RGB(graphite),
		"ring":                       core.RGB(moss300),
		"sidebar-primary":            core.RGB(moss300),
		"sidebar-primary-foreground": core.RGB(graphite),
	} {
		t.Dark.SetColor(name, color)
	}

	return t
}
