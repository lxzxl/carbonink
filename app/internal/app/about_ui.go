package app

import (
	"runtime"

	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/ui"
)

// aboutCard shows the build's identity, the runtime it runs on, where its
// files live, and the support links the 1.x About screen offered.
func (s *Session) aboutCard(cx *core.Scope) core.Node {
	app := core.App()
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	report := func(message string, isFailure bool) {
		status.Set(message)
		failed.Set(isFailure)
	}

	name := app.Name
	if name == "" {
		name = "CarbonInk"
	}
	version := func(cx *core.Scope) string {
		if app.Version == "" {
			return locales.SettingsAboutDevelopment(cx)
		}
		if app.Build != "" && app.Build != app.Version {
			return app.Version + " (" + app.Build + ")"
		}
		return app.Version
	}

	rowStyle := core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12}
	label := func(text func(*core.Scope) string) core.Node {
		return core.Text{ContentFunc: func() string { return text(cx) },
			Style:     core.Style{FontSize: 12, Width: core.Pt(96)},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
	}
	value := func(text func(*core.Scope) string) core.Node {
		return core.Text{ContentFunc: func() string { return text(cx) },
			Style: core.Style{FontSize: 12, FlexShrink: 1}}
	}
	row := func(testID string, labelText func(*core.Scope) string, valueText func(*core.Scope) string) core.Node {
		return core.View{TestID: testID, Style: rowStyle,
			Children: []core.Node{label(labelText), value(valueText)}}
	}

	rows := []core.Node{
		row("settings-about-app", locales.SettingsAboutAppName, func(*core.Scope) string { return name }),
		row("settings-about-version", locales.SettingsAboutVersion, version),
		row("settings-about-platform", locales.SettingsAboutPlatform, func(*core.Scope) string {
			return runtime.GOOS + " · " + runtime.GOARCH
		}),
		row("settings-about-runtime", locales.SettingsAboutRuntime, func(cx *core.Scope) string {
			return locales.SettingsAboutNsgo(cx) + " · " + runtime.Version()
		}),
	}
	if app.ID != "" {
		rows = append(rows, row("settings-about-id", locales.SettingsAboutAppId,
			func(*core.Scope) string { return app.ID }))
	}

	copied := func() {
		cx.SetClipboard(locales.SettingsAboutSupportEmail(cx))
		report(locales.SettingsAboutCopied(cx), false)
	}

	children := []core.Node{
		core.Text{ContentFunc: func() string { return locales.SettingsSectionAbout(cx) },
			Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
		core.Text{ContentFunc: func() string { return locales.SettingsSectionAboutDescription(cx) },
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
	}
	children = append(children, rows...)
	children = append(children,
		core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 6}, Children: []core.Node{
			ui.Button{Text: locales.SettingsAboutOpenDataDir(cx), Variant: ui.ButtonSecondary,
				OnPress: func() {
					desktop.RevealFile(cx, cx.DataDir(), func(err error) {
						if err != nil {
							report(locales.SettingsAboutOpenDataDirFailed(cx), true)
						}
					})
				}, TestID: "settings-about-open-data"},
			ui.Button{Text: locales.SettingsAboutOpenLogDir(cx), Variant: ui.ButtonSecondary,
				OnPress: func() {
					desktop.RevealFile(cx, cx.LogsDir(), func(err error) {
						if err != nil {
							report(locales.SettingsAboutOpenLogDirFailed(cx), true)
						}
					})
				}, TestID: "settings-about-open-logs"},
		}},
		core.Text{ContentFunc: func() string { return locales.SettingsAboutOpenDataDirHint(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint), MaxLines: 2},
		core.Text{ContentFunc: func() string { return locales.SettingsAboutOpenLogDirHint(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint), MaxLines: 2},
		core.View{TestID: "settings-about-support", Style: rowStyle, Children: []core.Node{
			label(locales.SettingsAboutSupportLabel),
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
				Children: []core.Node{
					value(locales.SettingsAboutSupportEmail),
					ui.Button{Text: locales.SettingsAboutCopy(cx), Variant: ui.ButtonSecondary,
						OnPress: copied, TestID: "settings-about-support-copy"},
				}},
		}},
		core.View{TestID: "settings-about-website", Style: rowStyle, Children: []core.Node{
			label(locales.SettingsAboutWebsiteLabel),
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
				Children: []core.Node{
					value(locales.SettingsAboutWebsiteUrl),
					ui.Button{Text: locales.SettingsAboutOpenWebsite(cx), Variant: ui.ButtonSecondary,
						OnPress: func() {
							cx.OpenURL("https://carbonink.xyz", func(opened bool) {
								if !opened {
									report(locales.SettingsAboutOpenWebsiteFailed(cx), true)
								}
							})
						}, TestID: "settings-about-open-website"},
				}},
		}},
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: 11},
					StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	)

	return core.View{
		TestID: "settings-about",
		Style:  core.Style{Padding: core.All(16), Gap: 10, CornerRadius: 10, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Surface(), BorderColor: ui.ColorsOf(cx).Border()}
		},
		Children: children,
	}
}
