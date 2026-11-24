package app

import (
	"runtime"

	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/icons/lucide"
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

	name := func(cx *core.Scope) string {
		if localized := locales.AppName(cx); localized != "" {
			return localized
		}
		if app.Name != "" {
			return app.Name
		}
		return "CarbonInk"
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

	label := func(text func(*core.Scope) string) core.Node {
		return core.Text{ContentFunc: func() string { return text(cx) },
			Style:     core.Style{FontSize: 14, Width: core.Pt(64), FlexShrink: 0},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
	}
	value := func(text func(*core.Scope) string) core.Node {
		return core.Text{ContentFunc: func() string { return text(cx) },
			Style: core.Style{FontSize: 14, FlexShrink: 1}}
	}
	row := func(testID string, left, right core.Node) core.Node {
		return core.View{TestID: testID, Style: core.Style{Direction: core.Row,
			AlignItems: core.AlignStart, Gap: 24},
			Children: []core.Node{left, right}}
	}

	rows := []core.Node{
		row("settings-about-app", label(locales.SettingsAboutAppName),
			value(name)),
		row("settings-about-version", label(locales.SettingsAboutVersion),
			value(version)),
		row("settings-about-platform", label(locales.SettingsAboutPlatform),
			value(func(*core.Scope) string { return runtime.GOOS + " · " + runtime.GOARCH })),
		row("settings-about-runtime", label(locales.SettingsAboutRuntime),
			value(func(cx *core.Scope) string {
				return locales.SettingsAboutNsgo(cx) + " · " + runtime.Version()
			})),
	}
	if app.ID != "" {
		rows = append(rows, row("settings-about-id", label(locales.SettingsAboutAppId),
			value(func(*core.Scope) string { return app.ID })))
	}
	rows = append(rows, row("settings-about-user-data", label(locales.SettingsAboutUserData),
		core.Text{Content: cx.DataDir(), Style: core.Style{FontSize: 12,
			FontFamily: core.FontMonospace, FlexShrink: 1},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}))

	action := func(text func(*core.Scope) string, hint func(*core.Scope) string,
		icon func() *core.SVG, testID string, onPress func()) core.Node {
		return core.View{Style: core.Style{Gap: 6}, Children: []core.Node{
			ui.Button{Text: text(cx), Variant: ui.ButtonOutline, Icon: icon,
				OnPress: onPress, TestID: testID,
				Style: core.Style{AlignSelf: core.AlignStart}},
			core.Text{ContentFunc: func() string { return hint(cx) },
				Style:     core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
		}}
	}
	openData := func() {
		desktop.RevealFile(cx, cx.DataDir(), func(err error) {
			if err != nil {
				report(locales.SettingsAboutOpenDataDirFailed(cx), true)
			}
		})
	}
	openLogs := func() {
		desktop.RevealFile(cx, cx.LogsDir(), func(err error) {
			if err != nil {
				report(locales.SettingsAboutOpenLogDirFailed(cx), true)
			}
		})
	}
	openLink := func(url string, failure func(*core.Scope) string) func() {
		return func() {
			cx.OpenURL(url, func(opened bool) {
				if !opened {
					report(failure(cx), true)
				}
			})
		}
	}
	link := func(text func(*core.Scope) string, testID string, onPress func()) core.Node {
		return core.View{TestID: testID, Role: core.RoleButton, OnPress: func(core.PressEvent) {
			onPress()
		}, Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Gap: 4, AlignSelf: core.AlignStart}, Children: []core.Node{
			core.Text{ContentFunc: func() string { return text(cx) },
				Style:     core.Style{FontSize: 14},
				StyleFunc: ui.Colored(accentInk(cx))},
			ui.Icon(lucide.ExternalLink, 12, accentInk(cx)),
		}}
	}

	children := []core.Node{
		core.View{Style: core.Style{Gap: 8}, Children: rows},
		action(locales.SettingsAboutOpenDataDir, locales.SettingsAboutOpenDataDirHint,
			lucide.FolderOpen, "settings-about-open-data", openData),
		action(locales.SettingsAboutOpenLogDir, locales.SettingsAboutOpenLogDirHint,
			lucide.FileText, "settings-about-open-logs", openLogs),
		core.View{Style: core.Style{Gap: 8, Padding: core.Edges{Top: 8},
			Borders:     core.Edges{Top: 1},
			BorderColor: ui.ColorsOf(cx).Line()}, Children: []core.Node{
			row("settings-about-support", label(locales.SettingsAboutSupportLabel),
				link(locales.SettingsAboutSupportEmail, "settings-about-support-link",
					openLink("mailto:"+locales.SettingsAboutSupportEmail(cx),
						locales.SettingsAboutOpenSupportFailed))),
			row("settings-about-website", label(locales.SettingsAboutWebsiteLabel),
				link(locales.SettingsAboutWebsiteUrl, "settings-about-open-website",
					openLink("https://carbonink.xyz", locales.SettingsAboutOpenWebsiteFailed))),
		}},
	}
	children = append(children, core.Show{When: func() bool { return status.Get() != "" },
		Then: func(cx *core.Scope) core.Node {
			return core.Text{ContentFunc: func() string { return status.Get() },
				Style: core.Style{FontSize: 11},
				StyleFunc: func() core.Style {
					if failed.Get() {
						return ui.Colored(ui.ColorsOf(cx).Danger)()
					}
					return ui.Colored(ui.ColorsOf(cx).Muted)()
				}}
		}})

	return core.View{TestID: "settings-about", Style: core.Style{Gap: 16},
		Children: children}
}
