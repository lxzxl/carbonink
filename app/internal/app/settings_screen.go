package app

import (
	"context"
	"strconv"

	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
	"github.com/nsgo-dev/nsgo/updater"
)

// settingsSection is one entry in 1.x's Settings rail: an icon, a label and
// the pane it opens.
type settingsSection struct {
	key         string
	icon        func() *core.SVG
	title       func(*core.Scope) string
	description func(*core.Scope) string
}

// settingsSections is the rail order 1.x used, value for value.
var settingsSections = []settingsSection{
	{"general", lucide.Settings, locales.SettingsSectionGeneral, locales.SettingsSectionGeneralDescription},
	{"ai", lucide.Sparkles, locales.SettingsSectionAi, locales.SettingsSectionAiDescription},
	{"amap", lucide.MapPin, locales.SettingsSectionAmap, locales.SettingsSectionAmapDescription},
	{"mcp", lucide.Cable, locales.SettingsSectionMcp, locales.SettingsSectionMcpDescription},
	{"org", lucide.Building, locales.SettingsSectionOrg, locales.SettingsSectionOrgDescription},
	{"workspaces", lucide.Briefcase, locales.SettingsSectionWorkspaces, locales.SettingsSectionWorkspacesDescription},
	{"efLibrary", lucide.Library, locales.SettingsSectionEfLibrary, locales.SettingsSectionEfLibraryDescription},
	{"data", lucide.Database, locales.SettingsSectionData, locales.SettingsSectionDataDescription},
	{"updates", lucide.RefreshCw, locales.SettingsSectionUpdates, locales.SettingsSectionUpdatesDescription},
	{"about", lucide.Info, locales.SettingsSectionAbout, locales.SettingsSectionAboutDescription},
}

// settingsScreen is 1.x's Settings: a 200 pt rail of sections and a single
// scrolling pane, so adjacent settings never read as one long form.
func (s *Session) settingsScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	initial := s.pendingSettingsSection
	if initial == "" {
		initial = "general"
	}
	s.pendingSettingsSection = ""
	active := core.NewSignal(cx, initial)
	rail := make([]core.Node, 0, len(settingsSections))
	for _, section := range settingsSections {
		section := section
		rail = append(rail, core.View{
			TestID: "settings-section-" + section.key,
			Role:   core.RoleButton,
			OnPress: func(core.PressEvent) {
				active.Set(section.key)
			},
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Height: core.Pt(30), Padding: core.Symmetric(0, 8), CornerRadius: radiusItem},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				st := core.Style{
					Hover:        &core.Style{Background: colors.Hover()},
					FocusVisible: ui.FocusRing(cx, -2),
				}
				if active.Get() == section.key {
					st.Background = selectionTint(cx)
				}
				return st
			},
			Children: []core.Node{
				ui.Icon(section.icon, 16, func() core.Color {
					colors := ui.ColorsOf(cx)
					if active.Get() == section.key {
						return colors.Text()
					}
					return colors.Muted()
				}),
				core.Text{ContentFunc: func() string { return section.title(cx) },
					Style: core.Style{FontSize: typeBody, FlexGrow: 1, FlexShrink: 1,
						MinWidth: core.Pt(0)},
					StyleFunc: func() core.Style {
						colors := ui.ColorsOf(cx)
						if active.Get() == section.key {
							return core.Style{FontWeight: ui.Medium, Color: colors.Text()}
						}
						return core.Style{Color: colors.Muted()}
					},
					MaxLines: 1},
			},
		})
	}

	// Build each pane once. A section owns signals (form drafts, status),
	// so rebuilding it inside the switcher would discard the draft on
	// every re-render.
	bodies := make(map[string]core.Node, len(settingsSections))
	for _, section := range settingsSections {
		bodies[section.key] = s.settingsSectionBody(cx, dataRev, section.key)
	}
	body := core.Dynamic(func(cx *core.Scope) core.Node {
		key := active.Get()
		for _, section := range settingsSections {
			if section.key != key {
				continue
			}
			return core.View{Style: core.Style{Gap: 16}, Children: []core.Node{
				settingsSectionHeading(cx, section.title, section.description),
				bodies[key],
			}}
		}
		return core.View{}
	})

	return core.View{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
			Direction: core.Row},
		Children: []core.Node{
			core.View{TestID: "settings-rail",
				Style: core.Style{Width: core.Pt(200), FlexShrink: 0, Padding: core.Symmetric(16, 8),
					Gap: 2, Borders: core.Edges{Right: 1}},
				StyleFunc: func() core.Style {
					return core.Style{Background: ui.ColorsOf(cx).Background(),
						BorderColor: ui.ColorsOf(cx).Line()}
				},
				Children: []core.Node{core.Scroll{
					Style:    core.Style{FlexGrow: 1, MinHeight: core.Pt(0)},
					Children: []core.Node{core.View{Style: core.Style{Gap: 2}, Children: rail}},
				}}},
			core.View{TestID: "settings-scroll",
				Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0),
					MinHeight: core.Pt(0)},
				Children: []core.Node{core.Scroll{
					Style: core.Style{FlexGrow: 1, MinHeight: core.Pt(0)},
					Children: []core.Node{core.View{
						Style: core.Style{Width: core.Pct(100), MaxWidth: core.Pt(672),
							Padding:   core.Edges{Left: 32, Right: 32, Top: 24, Bottom: 24},
							AlignSelf: core.AlignCenter},
						Children: []core.Node{body},
					}},
				}}},
		},
	}
}

func (s *Session) settingsSectionBody(cx *core.Scope, dataRev *core.Signal[int],
	key string) core.Node {
	switch key {
	case "general":
		return s.settingsGeneralSection(cx)
	case "ai":
		return s.aiProviderCard(cx)
	case "amap":
		return s.amapKeyCard(cx)
	case "mcp":
		return s.agentIntegrationCard(cx)
	case "org":
		return core.View{Style: core.Style{Gap: 16}, Children: []core.Node{
			s.organizationProfileCard(cx),
			s.reportLogoCard(cx),
			s.importSettingsCard(cx),
		}}
	case "workspaces":
		return s.workspacesCard(cx)
	case "efLibrary":
		return s.efLibraryBody(cx, dataRev)
	case "data":
		return core.View{Style: core.Style{Gap: 16}, Children: []core.Node{
			s.dataCard(cx),
			s.migrationCard(cx),
		}}
	case "updates":
		return s.updatesCard(cx)
	case "about":
		return s.aboutCard(cx)
	}
	return core.View{}
}

// settingsGeneralSection is 1.x's General pane: language, appearance, guided
// tours, and the AI cache. Each block is a label, a hint, and one control.
func (s *Session) settingsGeneralSection(cx *core.Scope) core.Node {
	theme := core.NewSignal(cx, s.settings.Theme)
	locale := core.NewSignal(cx, s.settings.Locale)
	guidanceOn := core.NewSignal(cx, !s.settings.GuidanceDisabled)
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)

	persist := func() {
		s.settings.Theme = theme.Get()
		s.settings.Locale = locale.Get()
		if err := prefs.Save(s.prefsPath, s.settings); err != nil {
			status.Set(err.Error())
		}
	}
	setTheme := func(value string) {
		theme.Set(value)
		applyAppearance(cx, value)
		persist()
	}
	setLocale := func(value string) {
		locale.Set(value)
		cx.SetLocale(value)
		persist()
	}
	setGuidance := func(on bool) {
		guidanceOn.Set(on)
		s.settings.GuidanceDisabled = !on
		if err := prefs.Save(s.prefsPath, s.settings); err != nil {
			status.Set(err.Error())
		}
	}
	clearCache := func() {
		if busy.Get() {
			return
		}
		busy.Set(true)
		ctx := context.Background()
		rows, freed, err := s.db.ClearExtractionRawCache(ctx)
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		status.Set(locales.SettingsAiCacheCleared(cx, strconv.FormatInt(rows, 10)))
		_ = freed
	}

	block := func(label, hint func(*core.Scope) string, control core.Node) core.Node {
		children := []core.Node{
			core.Text{ContentFunc: func() string { return label(cx) },
				Style: core.Style{FontSize: typeBody, FontWeight: ui.Medium}},
		}
		if hint != nil {
			children = append(children, core.Text{ContentFunc: func() string { return hint(cx) },
				Style:     core.Style{FontSize: typeCaption},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
		}
		children = append(children, control)
		return core.View{Style: core.Style{Gap: 8}, Children: children}
	}

	return core.View{Style: core.Style{Gap: 16, AlignSelf: core.AlignStretch}, Children: []core.Node{
		settingsCard(cx, lucide.Palette, locales.SettingsGeneralAppearanceHeading, nil,
			block(locales.SettingsGeneralLanguageLabel, locales.SettingsGeneralLanguageHint,
				settingsSegmented(cx, []settingsChoice{
					{Value: "zh-CN", Label: locales.SettingsGeneralLanguageZh},
					{Value: "en", Label: locales.SettingsGeneralLanguageEn},
				}, locale.Get, setLocale, "settings-language")),
			hairline(cx),
			block(locales.SettingsGeneralThemeLabel, locales.SettingsGeneralThemeHint,
				settingsSegmented(cx, []settingsChoice{
					{Value: "", Label: locales.SettingsGeneralThemeSystem},
					{Value: "light", Label: locales.SettingsGeneralThemeLight},
					{Value: "dark", Label: locales.SettingsGeneralThemeDark},
				}, theme.Get, setTheme, "settings-theme")),
		),
		settingsCard(cx, lucide.Sparkles, locales.SettingsGeneralExperienceHeading, nil,
			block(locales.SettingsGeneralGuidanceLabel, locales.SettingsGeneralGuidanceHint,
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Wrap: core.Wrap, Gap: 12}, Children: []core.Node{
					settingsSegmented(cx, []settingsChoice{
						{Value: "on", Label: locales.SettingsGeneralGuidanceOn},
						{Value: "off", Label: locales.SettingsGeneralGuidanceOff},
					}, func() string {
						if guidanceOn.Get() {
							return "on"
						}
						return "off"
					}, func(value string) { setGuidance(value == "on") }, "settings-guidance"),
					ui.Button{Text: locales.SettingsGeneralGuidanceReplay(cx),
						Variant: ui.ButtonSecondary,
						OnPress: func() {
							s.resetGuidance()
							status.Set(locales.SettingsGeneralGuidanceReplayDone(cx))
						}, TestID: "settings-guidance-replay"},
				}}),
			hairline(cx),
			block(locales.SettingsAiCacheLabel, locales.SettingsAiCacheHint,
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Wrap: core.Wrap, Gap: 12}, Children: []core.Node{
					ui.Button{Text: locales.SettingsAiCacheClear(cx), Variant: ui.ButtonSecondary,
						Busy: busy.Get, OnPress: clearCache, TestID: "settings-ai-cache-clear"},
				}}),
			core.Show{When: func() bool { return status.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string { return status.Get() },
						Style:     core.Style{FontSize: typeCaption},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3}
				}},
		),
	}}
}

type settingsChoice struct {
	Value string
	Label func(*core.Scope) string
}

// settingsSegmented is 1.x's small pill switcher: one border around the
// group and a dark (foreground) fill on the selected option.
func settingsSegmented(cx *core.Scope, choices []settingsChoice,
	value func() string, onChange func(string), testID string) core.Node {
	children := make([]core.Node, 0, len(choices))
	for _, choice := range choices {
		choice := choice
		children = append(children, core.View{
			TestID:   testID + "-" + choice.Value,
			Role:     core.RoleButton,
			Selected: func() bool { return value() == choice.Value },
			OnPress: func(core.PressEvent) {
				onChange(choice.Value)
			},
			Style: core.Style{Height: core.Pt(ui.ButtonHeight - 6),
				AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter,
				Padding: core.Symmetric(0, 12), CornerRadius: radiusMark},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				st := core.Style{FocusVisible: ui.FocusRing(cx, -2)}
				if value() == choice.Value {
					st.Background = colors.Text()
					return st
				}
				st.Hover = &core.Style{Background: ui.Alpha(colors.Text(), 0.05)}
				return st
			},
			Children: []core.Node{core.Text{ContentFunc: func() string {
				return choice.Label(cx)
			}, Style: core.Style{FontSize: typeCaption, FontWeight: ui.Medium},
				StyleFunc: func() core.Style {
					if value() == choice.Value {
						return core.Style{Color: ui.ColorsOf(cx).Background()}
					}
					return ui.Colored(ui.ColorsOf(cx).Muted)()
				}}},
		})
	}
	return core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Height: core.Pt(ui.ButtonHeight), Padding: core.All(2),
			CornerRadius: radiusItem, BorderWidth: 1, AlignSelf: core.AlignStart},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Surface(),
				BorderColor: ui.ColorsOf(cx).Border()}
		},
		Children: children,
	}
}

// updatesCard is Settings → Software updates. It inspects updater.CapabilityOf
// before offering check controls and reads updater.Status inside reactive
// bindings so dev/channel-disabled builds explain themselves instead of claiming
// to be up to date.
func (s *Session) updatesCard(cx *core.Scope) core.Node {
	status := core.NewSignal(cx, "")
	available := core.NewSignal(cx, "")
	url := core.NewSignal(cx, "")
	restartReady := core.NewSignal(cx, false)
	busy := core.NewSignal(cx, false)

	capabilityMessage := func(cx *core.Scope, cap updater.Capability, availableVersion string) string {
		switch cap.Managed {
		case updater.ManagedDevelopment:
			return locales.UpdaterCapabilityDevelopment(cx)
		case updater.ManagedChannel:
			return locales.UpdaterCapabilityChannel(cx)
		case updater.ManagedStore:
			return locales.UpdaterCapabilityStore(cx, cap.Store)
		case updater.ManagedUnavailable:
			return locales.UpdaterCapabilityUnavailable(cx)
		default:
			if availableVersion != "" {
				return locales.UpdaterStatusAvailable(cx, availableVersion)
			}
			return locales.UpdaterStatusIdle(cx)
		}
	}
	canCheck := func(managed updater.Managed) bool {
		return managed == updater.ManagedSelf || managed == updater.ManagedPage
	}

	check := func() {
		if busy.Get() || !canCheck(updater.CapabilityOf(cx).Managed) {
			return
		}
		busy.Set(true)
		status.Set(locales.UpdaterStatusChecking(cx))
		available.Set("")
		url.Set("")
		restartReady.Set(false)
		cx.CheckForUpdates(false, func(update core.UpdateCheck) {
			busy.Set(false)
			if update.Err != nil {
				status.Set(locales.UpdaterStatusError(cx, update.Err.Error()))
				return
			}
			if update.Shown {
				status.Set(locales.UpdaterStatusShown(cx))
				return
			}
			if update.Restart {
				restartReady.Set(true)
				status.Set(locales.UpdaterStatusRestart(cx))
				return
			}
			managed := updater.Managed(update.Managed)
			if !canCheck(managed) {
				status.Set(capabilityMessage(cx, updater.Capability{Managed: managed, Store: update.Store}, ""))
				return
			}
			if update.Version == "" {
				status.Set(locales.UpdaterStatusNotAvailable(cx))
				return
			}
			available.Set(update.Version)
			url.Set(update.URL)
			status.Set(locales.UpdaterStatusAvailable(cx, update.Version))
		})
	}
	version := core.App().Version
	if version == "" {
		version = locales.SettingsAboutDevelopment(cx)
	}
	statusText := func() string {
		if msg := status.Get(); msg != "" {
			return msg
		}
		state := updater.Status(cx)
		return capabilityMessage(cx, state.Capability, state.Available)
	}
	return settingsCard(cx, lucide.RefreshCw, locales.SettingsSectionUpdates, nil,
		core.Text{ContentFunc: func() string {
			return locales.UpdaterCurrentVersion(cx, version)
		}, Style: core.Style{FontSize: typeBody, FontVariant: core.FontTabularNums}},
		core.Show{
			When: func() bool { return canCheck(updater.CapabilityOf(cx).Managed) },
			Then: func(cx *core.Scope) core.Node {
				return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Gap: 10}, Children: []core.Node{
					ui.Switch{
						Checked:  func() bool { return updater.Status(cx).AutomaticChecks },
						OnChange: func(on bool) { updater.SetAutomaticChecks(cx, on) },
						Label:    locales.UpdaterAutomaticLabel(cx),
						TestID:   "settings-update-automatic",
					},
					core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, Children: []core.Node{
						core.Text{ContentFunc: func() string { return locales.UpdaterAutomaticLabel(cx) },
							Style: core.Style{FontSize: typeBody}},
						core.Text{ContentFunc: func() string { return locales.UpdaterAutomaticHint(cx) },
							Style:     core.Style{FontSize: typeCaption},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
					}},
				}}
			},
		},
		core.View{Style: core.Style{Padding: core.All(12), AlignSelf: core.AlignStretch,
			CornerRadius: radiusItem, BorderWidth: 1},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				return core.Style{Background: colors.Inset(), BorderColor: colors.Border()}
			},
			Children: []core.Node{
				core.Text{ContentFunc: statusText,
					TestID:    "settings-update-status",
					Style:     core.Style{FontSize: typeBody},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
			}},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
			ui.Button{Text: locales.UpdaterCheckButton(cx), Variant: ui.ButtonOutline,
				Busy:     busy.Get,
				Disabled: func() bool { return !canCheck(updater.CapabilityOf(cx).Managed) },
				OnPress:  check, TestID: "settings-update-check"},
			core.Show{When: func() bool { return restartReady.Get() },
				Then: func(cx *core.Scope) core.Node {
					return ui.Button{Text: locales.UpdaterInstallButton(cx),
						OnPress: func() { cx.RequestRestart() },
						TestID:  "settings-update-restart"}
				}},
			core.Show{When: func() bool { return url.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return ui.Button{Text: locales.UpdaterDownloadButton(cx),
						OnPress: func() { cx.OpenURL(url.Get(), nil) },
						TestID:  "settings-update-download"}
				}},
		}},
	)
}
