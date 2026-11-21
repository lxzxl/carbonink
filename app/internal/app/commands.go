package app

import (
	"strings"

	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// commandDialog lists the screens and the places the app keeps its files.
// Cmd+K (Ctrl+K on Windows and Linux) opens it.
func (s *Session) commandDialog(cx *core.Scope, open *core.Signal[bool], active *core.Signal[Screen]) core.Node {
	items := func() []base.CommandItem {
		out := make([]base.CommandItem, 0, len(screens)+2)
		for _, sc := range screens {
			out = append(out, base.CommandItem{
				ID: "go:" + string(sc.ID), Label: sc.Title(cx),
				Group: locales.CommandGoTo(cx), Icon: sc.Icon(),
				Keywords: []string{string(sc.ID)},
			})
		}
		return append(out,
			base.CommandItem{ID: "reveal-data", Label: locales.CommandRevealData(cx),
				Group: locales.CommandFiles(cx), Icon: lucide.FolderOpen()},
			base.CommandItem{ID: "reveal-db", Label: locales.CommandRevealWorkspace(cx),
				Group: locales.CommandFiles(cx), Icon: lucide.Database()},
		)
	}

	return ui.CommandDialog{
		TestID: "command-palette",
		Open:   open.Get,
		OnOpenChange: func(o bool, _ base.Reason) {
			open.Set(o)
		},
		Command: ui.Command{
			Items:       items,
			Placeholder: locales.CommandSearch(cx),
			SearchLabel: locales.CommandSearch(cx),
			Label:       locales.CommandSearch(cx),
			OnSelect: func(id string) {
				open.Set(false)
				switch {
				case strings.HasPrefix(id, "go:"):
					active.Set(Screen(strings.TrimPrefix(id, "go:")))
				case id == "reveal-data":
					desktop.RevealFile(cx, cx.DataDir(), nil)
				case id == "reveal-db":
					desktop.RevealFile(cx, s.db.Path(), nil)
				}
			},
		},
	}
}

// paletteButton is the sidebar's way into the palette, with its key beside it.
func paletteButton(cx *core.Scope, onPress func()) core.Node {
	shortcut := "Ctrl+K"
	if cx.Env().OS() == core.OSMacOS {
		shortcut = "⌘K"
	}
	return core.View{
		Role:   core.RoleButton,
		TestID: "open-command-palette",
		OnPress: func(core.PressEvent) {
			onPress()
		},
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6,
			Height: core.Pt(30), Padding: core.Symmetric(0, 8), CornerRadius: 6, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Inset(), BorderColor: ui.ColorsOf(cx).Border()}
		},
		Children: []core.Node{
			ui.Icon(lucide.Search, 14, ui.ColorsOf(cx).Muted),
			core.Text{ContentFunc: func() string { return locales.CommandSearch(cx) },
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
			core.View{Style: core.Style{FlexGrow: 1}},
			core.Text{Content: shortcut, Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
		},
	}
}
