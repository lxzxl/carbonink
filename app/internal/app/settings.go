package app

import (
	"context"
	"strings"

	"app.carbonink.desktop/internal/modelcatalog"
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
				s.aiProviderCard(cx),
				s.agentIntegrationCard(cx),
				s.migrationCard(cx),
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

// aiProviderCard configures the OpenAI-compatible endpoint used by document
// extraction. The API key goes to the platform's secure store; settings.json
// keeps only the provider, base URL and model.
func (s *Session) aiProviderCard(cx *core.Scope) core.Node {
	provider := core.NewSignal(cx, s.settings.LLMProvider)
	if provider.Get() == "" {
		provider.Set(llmPresets[0].ID)
	}
	baseURL := core.NewSignal(cx, s.settings.LLMBaseURL)
	model := core.NewSignal(cx, s.settings.LLMModel)
	key := core.NewSignal(cx, "")
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	models := core.NewSignal[*[]modelcatalog.Model](cx, nil)
	fetching := core.NewSignal(cx, false)
	fetchStatus := core.NewSignal(cx, "")
	fetchFailed := core.NewSignal(cx, false)

	preset := func(id string) (llmPreset, bool) {
		for _, item := range llmPresets {
			if item.ID == id {
				return item, true
			}
		}
		return llmPreset{ID: id}, false
	}
	if current, ok := preset(provider.Get()); ok {
		if baseURL.Get() == "" {
			baseURL.Set(current.BaseURL)
		}
		if model.Get() == "" {
			model.Set(current.Model)
		}
	}

	options := make([]ui.Option[string], 0, len(llmPresets)+1)
	for _, item := range llmPresets {
		options = append(options, ui.Option[string]{Value: item.ID, Label: item.Label})
	}
	options = append(options, ui.Option[string]{Value: "custom", Label: locales.SettingsProviderCustom(cx)})

	_, hasKey, keyErr := cx.Secrets().Get(llmSecretAccount)
	keySaved := core.NewSignal(cx, keyErr == nil && hasKey)
	save := func() {
		base := strings.TrimSpace(baseURL.Get())
		name := strings.TrimSpace(model.Get())
		if base == "" || name == "" {
			status.Set(locales.SettingsSaveFailed(cx))
			failed.Set(true)
			return
		}
		s.settings.LLMProvider = provider.Get()
		s.settings.LLMBaseURL = base
		s.settings.LLMModel = name
		if err := prefs.Save(s.prefsPath, s.settings); err != nil {
			status.Set(locales.SettingsSaveFailed(cx) + ": " + err.Error())
			failed.Set(true)
			return
		}
		if value := strings.TrimSpace(key.Get()); value != "" {
			if err := cx.Secrets().Set(llmSecretAccount, value); err != nil {
				status.Set(locales.SettingsSaveFailed(cx) + ": " + err.Error())
				failed.Set(true)
				return
			}
			key.Set("")
			keySaved.Set(true)
		}
		status.Set(locales.SettingsSaveSuccess(cx))
		failed.Set(false)
	}

	fetchModels := func() {
		if fetching.Get() {
			return
		}
		apiKey := strings.TrimSpace(key.Get())
		if apiKey == "" {
			if saved, ok, err := cx.Secrets().Get(llmSecretAccount); err == nil && ok {
				apiKey = saved
			}
		}
		if apiKey == "" {
			fetchFailed.Set(true)
			fetchStatus.Set(locales.SettingsModelFetchNoKey(cx))
			return
		}
		providerID := provider.Get()
		base := strings.TrimSpace(baseURL.Get())
		fetching.Set(true)
		fetchFailed.Set(false)
		fetchStatus.Set(locales.SettingsModelFetching(cx))
		successMessage := locales.SettingsModelFetchSuccess(cx)
		go func() {
			list, err := modelcatalog.Fetch(context.Background(), providerID, base, apiKey)
			s.scope.Post(func() {
				fetching.Set(false)
				if err != nil {
					fetchFailed.Set(true)
					fetchStatus.Set(locales.SettingsModelFetchFailed(cx, err.Error()))
					return
				}
				models.Set(&list)
				fetchFailed.Set(false)
				fetchStatus.Set(successMessage)
			})
		}()
	}

	field := func(label func(*core.Scope) string, input core.Node) core.Node {
		return core.View{Style: core.Style{Gap: 4, FlexGrow: 1}, Children: []core.Node{
			core.Text{ContentFunc: func() string { return label(cx) },
				Style:     core.Style{FontSize: 12, FontWeight: ui.Semibold},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			input,
		}}
	}

	children := []core.Node{
		core.Text{ContentFunc: func() string { return locales.SettingsSectionAi(cx) },
			Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
		core.Text{ContentFunc: func() string { return locales.SettingsSectionAiDescription(cx) },
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
		core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
			field(locales.SettingsProviderPickerLabel,
				ui.Select[string]{Options: options, Value: provider.Get,
					OnChange: func(value string) {
						provider.Set(value)
						models.Set(nil)
						fetchStatus.Set("")
						if item, ok := preset(value); ok {
							baseURL.Set(item.BaseURL)
							model.Set(item.Model)
						}
					},
					Label: locales.SettingsProviderPickerLabel(cx), TestID: "settings-llm-provider"}),
			field(locales.SettingsProviderModelLabel,
				ui.Input{Value: model.Get, OnChange: model.Set, TestID: "settings-llm-model"}),
		}},
		core.Text{ContentFunc: func() string { return providerGuidance(cx, provider.Get()) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
		core.View{Style: core.Style{Direction: core.Row, Gap: 8, AlignItems: core.AlignEnd},
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 4, FlexGrow: 1}, Children: []core.Node{
					core.Text{ContentFunc: func() string { return locales.SettingsModelSuggestedLabel(cx) },
						Style:     core.Style{FontSize: 12, FontWeight: ui.Semibold},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					core.Dynamic(func(cx *core.Scope) core.Node {
						var fetched []modelcatalog.Model
						if stored := models.Get(); stored != nil {
							fetched = *stored
						}
						return modelPicker(cx, provider.Get(), model, fetched)
					}),
				}},
				ui.Button{Text: locales.SettingsModelFetchLatest(cx), Variant: ui.ButtonSecondary,
					OnPress: fetchModels, Busy: fetching.Get,
					TestID: "settings-llm-fetch-models"},
			}},
		core.Show{When: func() bool { return fetchStatus.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return fetchStatus.Get() },
					Style: core.Style{FontSize: 11},
					StyleFunc: func() core.Style {
						if fetchFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		field(locales.SettingsProviderBaseUrlLabelAdvanced,
			ui.Input{Value: baseURL.Get, OnChange: baseURL.Set, TestID: "settings-llm-base-url"}),
		field(locales.SettingsApikeyLabel,
			ui.Input{Value: key.Get, OnChange: key.Set, Masked: true,
				Placeholder: locales.SettingsApikeyPlaceholder(cx), TestID: "settings-llm-key"}),
	}
	children = append(children, core.Show{When: keySaved.Get, Then: func(cx *core.Scope) core.Node {
		return core.Text{ContentFunc: func() string { return locales.SettingsApikeySaved(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
	}})
	if keyErr != nil {
		children = append(children, core.Text{ContentFunc: func() string {
			return locales.SettingsApikeyUnavailable(cx)
		}, Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	}
	children = append(children,
		core.Text{ContentFunc: func() string { return locales.SettingsAiHint(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
			ui.Button{Text: locales.SettingsSave(cx), OnPress: save, TestID: "settings-llm-save"},
			core.Show{When: func() bool { return status.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string { return status.Get() },
						Style: core.Style{FontSize: 12},
						StyleFunc: func() core.Style {
							if failed.Get() {
								return ui.Colored(ui.ColorsOf(cx).Danger)()
							}
							return ui.Colored(ui.ColorsOf(cx).Muted)()
						}}
				}},
		}},
	)

	return core.View{
		Style: core.Style{Padding: core.All(16), Gap: 10, CornerRadius: 10, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Surface(), BorderColor: ui.ColorsOf(cx).Border()}
		},
		Children: children,
	}
}

// providerGuidance is the one-line trade-off shown under the provider picker.
func providerGuidance(cx *core.Scope, provider string) string {
	switch provider {
	case "deepseek":
		return locales.SettingsProviderGuidanceDeepseek(cx)
	case "moonshot":
		return locales.SettingsProviderGuidanceMoonshot(cx)
	case "anthropic":
		return locales.SettingsProviderGuidanceAnthropic(cx)
	case "custom":
		return locales.SettingsProviderGuidanceCustom(cx)
	default:
		return locales.SettingsProviderGuidanceOpenai(cx)
	}
}

// modelPicker merges bundled suggestions with the provider's last fetched
// list. Choosing a row fills the free-text model field above, so a custom id
// never loses the escape hatch.
func modelPicker(cx *core.Scope, provider string, value *core.Signal[string],
	fetched []modelcatalog.Model) core.Node {
	seen := map[string]bool{}
	merged := make([]modelcatalog.Model, 0, len(fetched)+4)
	for _, model := range append(modelcatalog.Curated(provider), fetched...) {
		if model.ID == "" || seen[model.ID] {
			continue
		}
		seen[model.ID] = true
		merged = append(merged, model)
	}
	options := make([]ui.Option[string], 0, len(merged))
	for _, model := range merged {
		label := model.Name
		if label == "" || label == model.ID {
			label = model.ID
		} else {
			label += " — " + model.ID
		}
		options = append(options, ui.Option[string]{Value: model.ID, Label: label})
	}
	return ui.Select[string]{
		Options: options, Value: value.Get, OnChange: value.Set,
		Placeholder: locales.SettingsModelPickerPlaceholder(cx),
		Searchable:  true, SearchPlaceholder: locales.SettingsModelSearchPlaceholder(cx),
		Empty: locales.SettingsPickerNoMatch(cx), TestID: "settings-llm-model-suggested",
	}
}
