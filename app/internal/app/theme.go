package app

import (
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// CarbonInk's palette is 1.x's, value for value: an emerald primary with a
// warm neutral ramp. 1.x declared the tokens in OKLch; the constants here are
// the sRGB equivalents so a 2.0 window reads as the same product.
const (
	primary        = 0x008c4f // light primary
	primaryHover   = 0x1a9861 // primary at 90% over white
	primaryPressed = 0x0d9258 // primary at 95% over white
	primaryInk     = 0x008c4f // accent as text and links
	primaryTint    = 0xe5eee8 // accent at 6% over white

	primaryDark        = 0x00af67
	primaryDarkHover   = 0x0bad6a
	primaryDarkPressed = 0x089659
	primaryDarkTint    = 0x26312b

	foreground     = 0x13120c
	foregroundDark = 0xf0eee9
	muted          = 0x65635c
	mutedDark      = 0x918f87
	faint          = 0xa8a6a0
	faintDark      = 0x918f87
	border         = 0xe7e7e7
	borderDark     = 0x2b2922
	surfaceDark    = 0x1c1b14
	pageDark       = 0x13120c
	sidebar        = 0xfafafa
	fieldBorder    = 0xdfded8
	secondary      = 0xf3f2ec
	secondaryText  = 0x1c1b14
	mutedSurface   = 0xf0eee9
	danger         = 0xcc272e
	dangerDark     = 0xf94144
)

// accentInk is the accent as text and links: darker than a fill so body
// copy keeps its contrast on the page.
func accentInk(cx *core.Scope) func() core.Color {
	return func() core.Color { return cx.Palette().Colors["accentInk"] }
}

// accentTint is the accent's wash, used behind the one primary mark on a
// card (a completed step, a brand block). Selection is neutral, as in 1.x.
func accentTint(cx *core.Scope) func() core.Color {
	return func() core.Color { return cx.Palette().Colors["accentTint"] }
}

// selectionTint is the selected-row fill: 1.x tints with the text color, not
// with the brand green, so a green button stays the only colored control.
func selectionTint(cx *core.Scope) core.Color {
	return cx.Palette().Colors["selectionTint"]
}

// cardSurface is a card's palette colors as a dynamic style, so the card
// follows a light/dark switch instead of freezing the palette it was built
// under.
func cardSurface(cx *core.Scope) func() core.Style {
	return func() core.Style {
		return ui.CardStyle(cx).Merge(core.Style{CornerRadius: 8})
	}
}

// carboninkTheme is 1.x's palette in NSGo's theme shape.
func carboninkTheme() *core.Theme {
	t := core.DefaultTheme()
	t.Radius = 8

	t.Light.TextMuted = core.RGB(muted)
	t.Light.SetColor("faint", core.RGB(faint))
	t.Light.SetColor("field", core.RGB(0xffffff))
	t.Light.SetColor("fieldBorder", core.RGB(fieldBorder))
	t.Light.SetColor("inset", core.RGB(sidebar))
	t.Light.SetColor("line", core.RGBA(foreground, 0.07))

	t.Light.Accent = core.RGB(primary)
	t.Light.AccentHover = core.RGB(primaryHover)
	t.Light.AccentPressed = core.RGB(primaryPressed)
	t.Light.AccentText = core.RGB(0xfdfcf8)
	t.Light.Selection = core.RGBA(primary, 0.18)
	t.Light.Focus = core.RGBA(primary, 0.5)
	t.Light.Danger = core.RGB(danger)
	for name, color := range map[string]core.Color{
		"accentFill":                 core.RGB(primary),
		"accentInk":                  core.RGB(primaryInk),
		"accentTint":                 core.RGB(primaryTint),
		"selectionTint":              core.RGBA(foreground, 0.06),
		"primary":                    core.RGB(primary),
		"primary-foreground":         core.RGB(0xfdfcf8),
		"ring":                       core.RGB(primary),
		"foreground":                 core.RGB(foreground),
		"card":                       core.RGB(0xffffff),
		"card-foreground":            core.RGB(foreground),
		"popover":                    core.RGB(0xffffff),
		"popover-foreground":         core.RGB(foreground),
		"secondary":                  core.RGB(secondary),
		"secondary-foreground":       core.RGB(secondaryText),
		"muted":                      core.RGB(mutedSurface),
		"muted-foreground":           core.RGB(muted),
		"accent-foreground":          core.RGB(secondaryText),
		"destructive":                core.RGB(danger),
		"destructive-foreground":     core.RGB(0xfdfcf8),
		"input":                      core.RGB(fieldBorder),
		"sidebar":                    core.RGB(sidebar),
		"sidebar-foreground":         core.RGB(foreground),
		"sidebar-accent":             core.RGBA(foreground, 0.06),
		"sidebar-accent-foreground":  core.RGB(foreground),
		"sidebar-border":             core.RGB(border),
		"sidebar-ring":               core.RGB(primary),
		"sidebar-primary":            core.RGB(primary),
		"sidebar-primary-foreground": core.RGB(0xfdfcf8),
	} {
		t.Light.SetColor(name, color)
	}

	t.Dark.Background = core.RGB(pageDark)
	t.Dark.Surface = core.RGB(surfaceDark)
	t.Dark.SurfaceHover = core.RGBA(foregroundDark, 0.08)
	t.Dark.SurfacePressed = core.RGBA(foregroundDark, 0.14)
	t.Dark.Border = core.RGB(borderDark)
	t.Dark.Text = core.RGB(foregroundDark)
	t.Dark.TextMuted = core.RGB(mutedDark)
	t.Dark.SetColor("faint", core.RGB(faintDark))
	t.Dark.SetColor("field", core.RGB(surfaceDark))
	t.Dark.SetColor("fieldBorder", core.RGB(borderDark))
	t.Dark.SetColor("inset", core.RGB(pageDark))
	t.Dark.SetColor("line", core.RGBA(foregroundDark, 0.10))

	t.Dark.Accent = core.RGB(primaryDark)
	t.Dark.AccentHover = core.RGB(primaryDarkHover)
	t.Dark.AccentPressed = core.RGB(primaryDarkPressed)
	t.Dark.AccentText = core.RGB(pageDark)
	t.Dark.Selection = core.RGBA(primaryDark, 0.24)
	t.Dark.Focus = core.RGBA(primaryDark, 0.6)
	t.Dark.Danger = core.RGB(dangerDark)
	for name, color := range map[string]core.Color{
		"accentFill":                 core.RGB(primaryDark),
		"accentInk":                  core.RGB(primaryDark),
		"accentTint":                 core.RGB(primaryDarkTint),
		"selectionTint":              core.RGBA(foregroundDark, 0.08),
		"primary":                    core.RGB(primaryDark),
		"primary-foreground":         core.RGB(pageDark),
		"ring":                       core.RGB(primaryDark),
		"foreground":                 core.RGB(foregroundDark),
		"card":                       core.RGB(surfaceDark),
		"card-foreground":            core.RGB(foregroundDark),
		"popover":                    core.RGB(surfaceDark),
		"popover-foreground":         core.RGB(foregroundDark),
		"secondary":                  core.RGB(0x23221b),
		"secondary-foreground":       core.RGB(foregroundDark),
		"muted":                      core.RGB(borderDark),
		"muted-foreground":           core.RGB(mutedDark),
		"accent-foreground":          core.RGB(foregroundDark),
		"destructive":                core.RGB(dangerDark),
		"destructive-foreground":     core.RGB(pageDark),
		"input":                      core.RGB(borderDark),
		"sidebar":                    core.RGB(pageDark),
		"sidebar-foreground":         core.RGB(foregroundDark),
		"sidebar-accent":             core.RGBA(foregroundDark, 0.08),
		"sidebar-accent-foreground":  core.RGB(foregroundDark),
		"sidebar-border":             core.RGB(borderDark),
		"sidebar-ring":               core.RGB(primaryDark),
		"sidebar-primary":            core.RGB(primaryDark),
		"sidebar-primary-foreground": core.RGB(pageDark),
	} {
		t.Dark.SetColor(name, color)
	}

	return t
}
