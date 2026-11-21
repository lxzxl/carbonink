package app

import (
	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

func applyAppearance(cx *core.Scope, theme string) {
	switch theme {
	case "light":
		cx.SetAppearance(core.AppearanceLight)
	case "dark":
		cx.SetAppearance(core.AppearanceDark)
	default:
		cx.SetAppearance(core.AppearanceSystem)
	}
}

// settingsScreen switches appearance and language and shows where the app
// keeps its data. The window frame is saved on quit, not here.
func (s *Session) settingsScreen(cx *core.Scope) core.Node {
	theme := core.NewSignal(cx, s.settings.Theme)
	locale := core.NewSignal(cx, s.settings.Locale)
	status := core.NewSignal(cx, "")

	persist := func() {
		s.settings.Theme = theme.Get()
		s.settings.Locale = locale.Get()
		if err := prefs.Save(s.prefsPath, s.settings); err != nil {
			status.Set("save failed: " + err.Error())
			return
		}
		status.Set("")
	}
	setTheme := func(v string) {
		theme.Set(v)
		applyAppearance(cx, v)
		persist()
	}
	setLocale := func(v string) {
		locale.Set(v)
		cx.SetLocale(v)
		persist()
	}

	// The labels are functions, not strings: cx.SetLocale re-renders the text
	// without remounting the screen.
	button := func(label func(*core.Scope) string, onPress func()) core.Node {
		return core.View{
			Role: core.RoleButton,
			OnPress: func(core.PressEvent) {
				onPress()
			},
			Style: core.Style{Height: core.Pt(28), Padding: core.Symmetric(0, 10), CornerRadius: 6,
				BorderWidth: 1, Direction: core.Row, AlignItems: core.AlignCenter},
			StyleFunc: func() core.Style {
				return core.Style{Background: ui.ColorsOf(cx).Surface(), BorderColor: ui.ColorsOf(cx).Border()}
			},
			Children: []core.Node{core.Text{ContentFunc: func() string { return label(cx) },
				Style: core.Style{FontSize: 12}}},
		}
	}
	row := func(label func(*core.Scope) string, buttons ...core.Node) core.Node {
		return core.View{Style: core.Style{Gap: 8}, Children: []core.Node{
			core.Text{ContentFunc: func() string { return label(cx) },
				Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
			core.View{Style: core.Style{Direction: core.Row, Gap: 6}, Children: buttons},
		}}
	}

	currentTheme := func() string {
		switch theme.Get() {
		case "light":
			return locales.SettingsThemeLight(cx)
		case "dark":
			return locales.SettingsThemeDark(cx)
		default:
			return locales.SettingsThemeSystem(cx)
		}
	}
	currentLocale := func() string {
		switch locale.Get() {
		case "en":
			return locales.SettingsLanguageEnglish(cx)
		case "zh-CN":
			return locales.SettingsLanguageChinese(cx)
		default:
			return locales.SettingsLanguageSystem(cx)
		}
	}

	card := func(children ...core.Node) core.Node {
		return core.View{
			Style: core.Style{Padding: core.All(16), Gap: 14, CornerRadius: 10, BorderWidth: 1},
			StyleFunc: func() core.Style {
				return core.Style{Background: ui.ColorsOf(cx).Surface(), BorderColor: ui.ColorsOf(cx).Border()}
			},
			Children: children,
		}
	}

	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(720), AlignSelf: core.AlignStretch},
			Children: []core.Node{
				card(
					row(locales.SettingsAppearance,
						button(locales.SettingsThemeSystem, func() { setTheme("") }),
						button(locales.SettingsThemeLight, func() { setTheme("light") }),
						button(locales.SettingsThemeDark, func() { setTheme("dark") }),
					),
					core.Text{ContentFunc: func() string { return locales.SettingsCurrent(cx, currentTheme()) },
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				),
				card(
					row(locales.SettingsLanguage,
						button(locales.SettingsLanguageSystem, func() { setLocale("") }),
						button(locales.SettingsLanguageEnglish, func() { setLocale("en") }),
						button(locales.SettingsLanguageChinese, func() { setLocale("zh-CN") }),
					),
					core.Text{ContentFunc: func() string { return locales.SettingsCurrent(cx, currentLocale()) },
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				),
				card(
					core.Text{ContentFunc: func() string {
						return locales.SettingsWorkspace(cx) + ": " + s.workspace.Name + " · " + s.workspace.File
					},
						Style: core.Style{FontSize: 12}},
					core.Text{ContentFunc: func() string { return locales.SettingsDataDir(cx) + ": " + cx.DataDir() },
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					core.Text{ContentFunc: func() string { return locales.SettingsWindowNote(cx) },
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					core.Show{When: func() bool { return status.Get() != "" },
						Then: func(cx *core.Scope) core.Node {
							return core.Text{ContentFunc: func() string { return status.Get() },
								Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
						}},
				),
			},
		}},
	}
}
