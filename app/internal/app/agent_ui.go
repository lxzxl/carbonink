package app

import (
	"os"

	"app.carbonink.desktop/internal/agentskill"
	"app.carbonink.desktop/internal/mcpconfig"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
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

// agentIntegrationCard installs the Agent Skill and writes MCP entries into
// the host config files the user already has.
func (s *Session) agentIntegrationCard(cx *core.Scope) core.Node {
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	busy := core.NewSignal(cx, false)
	rev := core.NewSignal(cx, 0)

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
	}
	card := func(children ...core.Node) core.Node {
		return core.View{
			Style:     core.Style{Gap: 12, Padding: core.All(16), AlignSelf: core.AlignStretch},
			StyleFunc: cardSurface(cx),
			Children:  children,
		}
	}

	return core.Dynamic(func(cx *core.Scope) core.Node {
		hold()
		home, configDir := agentHome(), agentConfigDir()
		skill := agentskill.Detect(home)
		clients := mcpconfig.Detect(home, configDir, agentEntry())

		skillLabel := locales.SettingsAgentSkillMissing(cx)
		if skill.Installed {
			skillLabel = locales.SettingsAgentSkillInstalled(cx)
		}
		if skill.NeedsUpdate {
			skillLabel = locales.SettingsAgentSkillUpdate(cx)
		}
		skillAction := locales.SettingsAgentInstall(cx)
		if skill.Installed {
			skillAction = locales.SettingsAgentUpdate(cx)
		}
		skillVariant := ui.BadgeNeutral
		if skill.NeedsUpdate {
			skillVariant = ui.BadgeWarn
		} else if skill.Installed {
			skillVariant = ui.BadgeAccent
		}
		skillButtons := []core.Node{
			ui.Button{Text: skillAction, Variant: ui.ButtonSecondary, OnPress: func() {
				run(locales.SettingsAgentSkillDone(cx), func(home, _ string) error {
					if _, err := agentskill.Install(home); err != nil {
						return err
					}
					return nil
				})
			}, Busy: busy.Get, TestID: "agent-skill-install"},
		}
		if skill.Installed {
			skillButtons = append(skillButtons,
				ui.Button{Text: locales.SettingsAgentRemove(cx), Variant: ui.ButtonSecondary,
					OnPress: func() {
						run(locales.SettingsAgentSkillRemoved(cx), func(home, _ string) error {
							if _, err := agentskill.Remove(home); err != nil {
								return err
							}
							return nil
						})
					}, Busy: busy.Get, TestID: "agent-skill-remove"})
		}

		row := func(name, label, detail string, variant ui.BadgeVariant, buttons []core.Node) core.Node {
			heading := []core.Node{
				core.Text{Content: name, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
			}
			if label != "" {
				heading = append(heading, ui.Badge{Text: label, Variant: variant})
			}
			children := []core.Node{
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: []core.Node{
						core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
							Wrap: core.Wrap, Gap: 6}, Children: heading},
						core.Text{Content: detail, Style: core.Style{FontSize: 12},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
					}},
			}
			if len(buttons) > 0 {
				children = append(children, core.View{Style: core.Style{Direction: core.Row,
					AlignItems: core.AlignCenter, Wrap: core.Wrap, Gap: 6}, Children: buttons})
			}
			return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Wrap: core.Wrap, Gap: 8}, Children: children}
		}

		rows := []core.Node{row(locales.SettingsAgentSkill(cx), skillLabel,
			locales.SettingsSkillStepHelp(cx), skillVariant, skillButtons)}

		for _, client := range clients {
			client := client
			label := locales.SettingsAgentNotInstalled(cx)
			variant := ui.BadgeNeutral
			if client.Installed {
				switch {
				case client.Configured && client.NeedsUpdate:
					label = locales.SettingsAgentSkillUpdate(cx)
					variant = ui.BadgeWarn
				case client.Configured:
					label = locales.SettingsAgentConfigured(cx)
					variant = ui.BadgeAccent
				default:
					label = locales.SettingsAgentNotConfigured(cx)
				}
			}
			buttons := []core.Node{}
			if client.Installed {
				configureLabel := locales.SettingsAgentConfigure(cx)
				if client.Configured {
					configureLabel = locales.SettingsAgentUpdate(cx)
				}
				buttons = append(buttons, ui.Button{Text: configureLabel, Variant: ui.ButtonSecondary,
					OnPress: func() {
						run(locales.SettingsAgentClientConfigured(cx,
							mcpClientLabel(cx, client.Client)), func(home, configDir string) error {
							path := mcpconfig.Path(home, configDir, client.Client)
							if _, err := mcpconfig.Configure(path, agentEntry()); err != nil {
								return err
							}
							return nil
						})
					}, Busy: busy.Get, TestID: "agent-config-" + string(client.Client)})
				if client.Configured {
					buttons = append(buttons, ui.Button{Text: locales.SettingsAgentRemove(cx),
						Variant: ui.ButtonSecondary, OnPress: func() {
							run(locales.SettingsAgentClientRemoved(cx,
								mcpClientLabel(cx, client.Client)), func(home, configDir string) error {
								path := mcpconfig.Path(home, configDir, client.Client)
								if _, err := mcpconfig.Remove(path); err != nil {
									return err
								}
								return nil
							})
						}, Busy: busy.Get, TestID: "agent-remove-" + string(client.Client)})
				}
			}
			rows = append(rows, row(mcpClientLabel(cx, client.Client), label, "", variant, buttons))
		}

		return card(
			core.Text{Content: locales.SettingsAgentTitle(cx),
				Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
			core.Text{Content: locales.SettingsAgentHint(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			core.View{Style: core.Style{Gap: 14}, Children: rows},
			core.Text{Content: locales.SettingsAgentPiHint(cx), Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
			core.Text{Content: locales.SettingsAgentRestartHint(cx), Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
			core.Show{When: func() bool { return status.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string { return status.Get() },
						Style: core.Style{FontSize: 12},
						StyleFunc: func() core.Style {
							if failed.Get() {
								return ui.Colored(ui.ColorsOf(cx).Danger)()
							}
							return core.Style{Color: accentInk(cx)()}
						},
						TestID: "agent-status"}
				}},
		)
	})
}
