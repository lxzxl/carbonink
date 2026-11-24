package app

import (
	"os"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/agentskill"
	"app.carbonink.desktop/internal/mcpconfig"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// agentHome and agentConfigDir let tests isolate the agent-host files.
func agentHome() string {
	if value := os.Getenv("CARBONINK_AGENT_HOME"); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func agentConfigDir() string {
	if value := os.Getenv("CARBONINK_AGENT_CONFIG_DIR"); value != "" {
		return value
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return dir
}

func agentEntry() mcpconfig.Entry {
	command, _ := os.Executable()
	return mcpconfig.Entry{Command: command, Args: []string{"--mcp"}}
}

func mcpClientLabel(cx *core.Scope, client mcpconfig.Client) string {
	switch client {
	case mcpconfig.ClaudeDesktop:
		return locales.SettingsAgentClaudeDesktop(cx)
	case mcpconfig.ClaudeCode:
		return locales.SettingsAgentClaudeCode(cx)
	default:
		return locales.SettingsAgentCursor(cx)
	}
}

// agentIntegrationCard is 1.x's MCP settings page: the Agent Skill card, the
// master toggle, the server entry, and the detected-client list. The Skill
// card owns the install/update/remove actions; the client rows own their
// configure/remove actions.
func (s *Session) agentIntegrationCard(cx *core.Scope) core.Node {
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	busy := core.NewSignal(cx, false)
	rev := core.NewSignal(cx, 0)
	master := core.NewSignal(cx, true)
	piOpen := core.NewSignal(cx, false)

	run := func(message string, work func(home, configDir string) error) {
		if busy.Get() {
			return
		}
		busy.Set(true)
		failed.Set(false)
		status.Set(locales.SettingsAgentBusy(cx))
		home, configDir := agentHome(), agentConfigDir()
		go func() {
			err := work(home, configDir)
			s.scope.Post(func() {
				busy.Set(false)
				rev.Set(rev.Get() + 1)
				s.bumpMCP()
				if err != nil {
					failed.Set(true)
					status.Set(locales.SettingsAgentFailed(cx, err.Error()))
					return
				}
				status.Set(message)
			})
		}()
	}

	hold := func() {
		_ = rev.Get()
		_ = master.Get()
	}

	return core.Dynamic(func(cx *core.Scope) core.Node {
		hold()
		home, configDir := agentHome(), agentConfigDir()
		entry := agentEntry()
		skill := agentskill.Detect(home)
		clients := mcpconfig.Detect(home, configDir, entry)
		enabled := master.Get()

		skillButtons := []core.Node{
			ui.Button{Text: locales.SettingsSkillActionInstall(cx),
				Variant: ui.ButtonPrimary,
				OnPress: func() {
					run(locales.SettingsSkillInstalled(cx, strconv.Itoa(len(skill.DetectedHosts))),
						func(home, _ string) error {
							_, err := agentskill.Install(home)
							return err
						})
				}, Busy: busy.Get, TestID: "agent-skill-install"},
		}
		skillText := locales.SettingsSkillStatusNotInstalled(cx)
		skillDetail := locales.SettingsSkillWillInstallTo(cx, skillHostList(cx, skill.DetectedHosts))
		if skill.Installed {
			skillText = locales.SettingsSkillStatusInstalled(cx, strconv.Itoa(len(skill.LinkedHosts)))
			skillDetail = skill.CanonicalPath
			skillButtons = []core.Node{}
			if skill.NeedsUpdate {
				skillText = locales.SettingsSkillStatusOutdated(cx)
				skillButtons = append(skillButtons, ui.Button{
					Text: locales.SettingsSkillActionUpdate(cx), Variant: ui.ButtonPrimary,
					OnPress: func() {
						run(locales.SettingsSkillUpdated(cx), func(home, _ string) error {
							_, err := agentskill.Install(home)
							return err
						})
					}, Busy: busy.Get, TestID: "agent-skill-install"})
			}
			skillButtons = append(skillButtons, ui.Button{
				Text: locales.SettingsSkillActionRemove(cx), Variant: ui.ButtonOutline,
				OnPress: func() {
					run(locales.SettingsSkillRemoved(cx), func(home, _ string) error {
						_, err := agentskill.Remove(home)
						return err
					})
				}, Busy: busy.Get, TestID: "agent-skill-remove"})
		}
		skillBody := []core.Node{
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart,
				Wrap: core.Wrap, Gap: 12}, Children: []core.Node{
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: []core.Node{
						core.Text{Content: skillText, Style: core.Style{FontSize: typeBody,
							FontWeight: ui.Medium}, MaxLines: 2},
						core.Text{Content: skillDetail,
							Style: core.Style{FontSize: typeCaption, FontFamily: core.FontMonospace,
								FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1,
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					}},
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Wrap: core.Wrap, Gap: 8}, Children: skillButtons},
			}},
		}
		if skill.Installed && len(skill.LinkedHosts) > 0 {
			hostLines := make([]core.Node, 0, len(skill.LinkedHosts))
			for _, host := range skill.LinkedHosts {
				hostLines = append(hostLines, core.Text{Content: "• " + skillHostLabel(cx, host),
					Style:     core.Style{FontSize: typeCaption},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1})
			}
			skillBody = append(skillBody, core.View{Style: core.Style{Gap: 2}, Children: hostLines})
		}

		stepOne := settingsCard(cx, lucide.Sparkles,
			locales.SettingsSkillStepTitle, locales.SettingsSkillStepHelp,
			skillBody...)

		serverCard := core.View{
			Style: core.Style{Gap: 3, Padding: core.All(12), AlignSelf: core.AlignStretch,
				CornerRadius: radiusItem, BorderWidth: 1},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				return core.Style{Background: colors.Inset(), BorderColor: colors.Border()}
			},
			Children: []core.Node{
				core.Text{Content: locales.SettingsMcpBinaryLabel(cx),
					Style:     core.Style{FontSize: typeMicro, FontWeight: ui.Medium},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.Text{Content: entry.Command, Style: core.Style{FontSize: typeCaption,
					FontFamily: core.FontMonospace, FlexShrink: 1, MinWidth: core.Pt(0)},
					MaxLines: 1},
				core.Text{Content: locales.SettingsMcpScriptLabel(cx),
					Style:     core.Style{FontSize: typeMicro, FontWeight: ui.Medium, Padding: core.Edges{Top: 6}},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.Text{Content: strings.Join(entry.Args, " "),
					Style: core.Style{FontSize: typeCaption, FontFamily: core.FontMonospace,
						FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
			},
		}

		clientRow := func(name, detail string, action core.Node) core.View {
			infoChildren := []core.Node{
				core.Text{Content: name, Style: core.Style{FontSize: typeBody,
					FontWeight: ui.Medium}, MaxLines: 1},
			}
			if detail != "" {
				infoChildren = append(infoChildren, core.Text{Content: detail,
					Style:     core.Style{FontSize: typeCaption},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2})
			}
			return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Wrap: core.Wrap, Gap: 12, Padding: core.Symmetric(12, 16)},
				Children: []core.Node{
					core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1,
						MinWidth: core.Pt(0)}, Children: infoChildren},
					action,
				}}
		}
		rows := make([]core.Node, 0, len(clients)+1)
		for _, client := range clients {
			client := client
			detail := mcpStatusText(cx, client)
			var action core.Node
			switch {
			case !client.Installed:
				action = ui.Button{Text: locales.SettingsMcpActionUnavailable(cx),
					Variant: ui.ButtonOutline, Disabled: func() bool { return true },
					TestID: "agent-unavailable-" + string(client.Client)}
			case client.Configured && client.NeedsUpdate:
				action = core.View{Style: core.Style{Direction: core.Row, Gap: 6},
					Children: []core.Node{
						ui.Button{Text: locales.SettingsMcpActionReconfigure(cx),
							Disabled: func() bool { return !enabled || busy.Get() },
							OnPress:  func() { configureClient(cx, run, client) },
							TestID:   "agent-config-" + string(client.Client)},
						ui.Button{Text: locales.SettingsMcpActionRemove(cx),
							Variant:  ui.ButtonOutline,
							Disabled: func() bool { return !enabled || busy.Get() },
							OnPress:  func() { removeClient(cx, run, client) },
							TestID:   "agent-remove-" + string(client.Client)},
					}}
			case client.Configured:
				action = ui.Button{Text: locales.SettingsMcpActionRemove(cx),
					Variant:  ui.ButtonOutline,
					Disabled: func() bool { return !enabled || busy.Get() },
					OnPress:  func() { removeClient(cx, run, client) },
					TestID:   "agent-remove-" + string(client.Client)}
			default:
				action = ui.Button{Text: locales.SettingsMcpActionConfigure(cx),
					Disabled: func() bool { return !enabled || busy.Get() },
					OnPress:  func() { configureClient(cx, run, client) },
					TestID:   "agent-config-" + string(client.Client)}
			}
			row := clientRow(mcpClientLabel(cx, client.Client), detail, action)
			row.Style.Borders = core.Edges{Bottom: 1}
			row.StyleFunc = func() core.Style {
				return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
			}
			rows = append(rows, row)
		}
		rows = append(rows, clientRow(locales.SettingsMcpClientPi(cx), "",
			ui.Button{Text: locales.SettingsMcpActionViewPiGuide(cx), Variant: ui.ButtonOutline,
				OnPress: func() { piOpen.Set(true) }, TestID: "mcp-pi-guide-open"}))

		stepTwo := settingsCard(cx, lucide.Cable,
			locales.SettingsMcpStepTitle, locales.SettingsMcpStepHelp,
			core.View{Style: core.Style{Gap: 6}, Children: []core.Node{
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Gap: 10}, Children: []core.Node{
					ui.Switch{Checked: master.Get, OnChange: master.Set,
						Label: locales.SettingsMcpMasterToggle(cx), TestID: "mcp-master-toggle"},
					core.Text{Content: locales.SettingsMcpMasterToggle(cx),
						Style: core.Style{FontSize: typeBody}},
				}},
				core.Text{Content: locales.SettingsMcpMasterToggleHelp(cx),
					Style:     core.Style{FontSize: typeCaption},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
			}},
			serverCard,
			core.View{Style: core.Style{AlignSelf: core.AlignStretch,
				CornerRadius: radiusItem, BorderWidth: 1},
				StyleFunc: func() core.Style {
					colors := ui.ColorsOf(cx)
					return core.Style{Background: colors.Surface(), BorderColor: colors.Border()}
				},
				Children: rows},
		)

		children := []core.Node{stepOne, stepTwo}
		children = append(children, core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: typeCaption},
					StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return core.Style{Color: accentInk(cx)()}
					},
					TestID: "agent-status"}
			}})
		children = append(children, piGuideDialog(cx, piOpen))

		return core.View{Style: core.Style{Gap: 16}, Children: children}
	})
}

// configureClient writes the app's MCP entry into one host's config.
func configureClient(cx *core.Scope, run func(string, func(string, string) error),
	client mcpconfig.Status) {
	run(locales.SettingsMcpConfigured(cx, mcpClientLabel(cx, client.Client)),
		func(home, configDir string) error {
			_, err := mcpconfig.Configure(mcpconfig.Path(home, configDir, client.Client), agentEntry())
			return err
		})
}

// removeClient deletes the app's MCP entry from one host's config.
func removeClient(cx *core.Scope, run func(string, func(string, string) error),
	client mcpconfig.Status) {
	run(locales.SettingsMcpRemoved(cx, mcpClientLabel(cx, client.Client)),
		func(home, configDir string) error {
			_, err := mcpconfig.Remove(mcpconfig.Path(home, configDir, client.Client))
			return err
		})
}

func mcpStatusText(cx *core.Scope, status mcpconfig.Status) string {
	switch {
	case !status.Installed:
		return locales.SettingsMcpStatusNotInstalled(cx)
	case status.Configured && status.NeedsUpdate:
		return locales.SettingsMcpStatusNeedsReconfigure(cx)
	case status.Configured:
		return locales.SettingsMcpStatusConfigured(cx)
	default:
		return locales.SettingsMcpStatusNotConfigured(cx)
	}
}

func skillHostList(cx *core.Scope, hosts []string) string {
	if len(hosts) == 0 {
		return locales.SettingsSkillNoHosts(cx)
	}
	labels := make([]string, 0, len(hosts))
	for _, host := range hosts {
		labels = append(labels, skillHostLabel(cx, host))
	}
	return strings.Join(labels, ", ")
}

func skillHostLabel(cx *core.Scope, host string) string {
	switch host {
	case "claudeCode":
		return locales.SettingsSkillHostClaudeCode(cx)
	case "pi":
		return locales.SettingsSkillHostPi(cx)
	case "codex":
		return locales.SettingsSkillHostCodex(cx)
	default:
		return host
	}
}

// piGuideDialog is 1.x's Pi setup guide: Pi has no native mcpServers file, so
// the bridge extension is the supported path.
func piGuideDialog(cx *core.Scope, open *core.Signal[bool]) core.Node {
	code := core.View{Style: core.Style{Padding: core.All(8), AlignSelf: core.AlignStart},
		StyleFunc: func() core.Style {
			return core.Style{CornerRadius: radiusMark, Background: ui.ColorsOf(cx).Inset()}
		}, Children: []core.Node{
			core.Text{Content: "pi install mavam/pi-mcporter",
				Style:     core.Style{FontSize: typeCaption, FontFamily: core.FontMonospace},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}}
	return dataDialog(cx, open, locales.SettingsMcpPiGuideTitle(cx), []core.Node{
		core.Text{Content: locales.SettingsMcpPiGuideIntro(cx),
			Style:     core.Style{FontSize: typeBody},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
		core.Text{Content: locales.SettingsMcpPiGuideStep1(cx), Style: core.Style{FontSize: typeBody}},
		code,
		core.Text{Content: locales.SettingsMcpPiGuideStep2(cx), Style: core.Style{FontSize: typeBody}},
	}, nil, "mcp-pi-guide")
}
