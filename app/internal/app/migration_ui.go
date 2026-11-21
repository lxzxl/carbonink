package app

import (
	"app.carbonink.desktop/internal/platform"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/ui"
)

// migrationCard explains where the 1.x data went and offers both folders.
// The import itself happens in workspace.Ensure before the first screen.
func (s *Session) migrationCard(cx *core.Scope) core.Node {
	legacy := platform.LegacyDir()
	status := locales.SettingsMigrationNone(cx)
	if s.imported {
		status = locales.SettingsMigrationImported(cx)
	} else if legacy != "" {
		status = locales.SettingsMigrationAvailable(cx)
	}

	children := []core.Node{
		core.Text{Content: locales.SettingsMigrationTitle(cx),
			Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
		core.Text{Content: status, Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.Text{Content: locales.SettingsMigrationCurrentPath(cx, cx.DataDir()),
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
	}
	if legacy != "" {
		children = append(children, core.Text{
			Content: locales.SettingsMigrationLegacyPath(cx, legacy),
			Style:   core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)})
	}
	buttons := []core.Node{
		ui.Button{Text: locales.SettingsMigrationRevealCurrent(cx), Variant: ui.ButtonSecondary,
			OnPress: func() { desktop.RevealFile(cx, cx.DataDir(), nil) },
			TestID:  "migration-reveal-current"},
	}
	if legacy != "" {
		legacyPath := legacy
		buttons = append(buttons, ui.Button{Text: locales.SettingsMigrationRevealLegacy(cx),
			Variant: ui.ButtonSecondary,
			OnPress: func() { desktop.RevealFile(cx, legacyPath, nil) },
			TestID:  "migration-reveal-legacy"})
	}
	children = append(children,
		core.View{Style: core.Style{Direction: core.Row, Gap: 6}, Children: buttons},
		core.Text{Content: locales.SettingsMigrationBackups(cx), Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
	)
	style := ui.CardStyle(cx)
	style.Gap = 10
	style.Padding = core.All(16)
	style.AlignSelf = core.AlignStretch
	return core.View{Style: style, Children: children}
}
