package app

import (
	"context"
	"strings"

	"app.carbonink.desktop/internal/modelcatalog"
	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
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
	testing := core.NewSignal(cx, false)
	testStatus := core.NewSignal(cx, "")
	testFailed := core.NewSignal(cx, false)

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

	savedKey, hasKey, keyErr := cx.Secrets().Get(llmSecretAccount)
	keySaved := core.NewSignal(cx, keyErr == nil && hasKey)
	savedMask := core.NewSignal(cx, "")
	if keyErr == nil && hasKey {
		savedMask.Set(maskSecret(savedKey))
	}
	editingKey := core.NewSignal(cx, false)
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
			editingKey.Set(false)
			savedMask.Set(maskSecret(value))
		}
		status.Set(locales.SettingsSaveSuccess(cx))
		failed.Set(false)
	}

	testConnection := func() {
		if testing.Get() {
			return
		}
		apiKey := strings.TrimSpace(key.Get())
		if apiKey == "" {
			if saved, ok, err := cx.Secrets().Get(llmSecretAccount); err == nil && ok {
				apiKey = saved
			}
		}
		if apiKey == "" {
			testFailed.Set(true)
			testStatus.Set(locales.SettingsTestFailed(cx) + ": " +
				locales.SettingsModelFetchNoKey(cx))
			return
		}
		providerID := provider.Get()
		base := strings.TrimSpace(baseURL.Get())
		if base == "" {
			testFailed.Set(true)
			testStatus.Set(locales.SettingsTestFailed(cx))
			return
		}
		testing.Set(true)
		testFailed.Set(false)
		testStatus.Set("")
		go func() {
			list, err := modelcatalog.Fetch(context.Background(), providerID, base, apiKey)
			s.scope.Post(func() {
				testing.Set(false)
				if err != nil {
					testFailed.Set(true)
					testStatus.Set(locales.SettingsTestFailed(cx) + ": " + err.Error())
					return
				}
				testFailed.Set(false)
				testStatus.Set(locales.SettingsTestSuccess(cx))
				models.Set(&list)
			})
		}()
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
				Style: core.Style{FontSize: typeBody, FontWeight: ui.Medium}},
			namedNode(input, func() string { return label(cx) }),
		}}
	}

	children := []core.Node{
		field(locales.SettingsProviderPickerLabel,
			appSelect[string]{Options: options, Value: provider.Get,
				OnChange: func(value string) {
					provider.Set(value)
					models.Set(nil)
					fetchStatus.Set("")
					testStatus.Set("")
					if item, ok := preset(value); ok {
						baseURL.Set(item.BaseURL)
						model.Set(item.Model)
					}
				},
				Label: locales.SettingsProviderPickerLabel(cx), TestID: "settings-llm-provider",
				Style: core.Style{Width: core.Pct(100)}}),
		core.Text{ContentFunc: func() string { return providerGuidance(cx, provider.Get()) },
			Style: core.Style{FontSize: typeCaption}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
		field(locales.SettingsProviderModelLabel,
			ui.Input{Value: model.Get, OnChange: model.Set, TestID: "settings-llm-model"}),
		core.View{StyleFunc: func() core.Style {
			if cx.Env().Window().Width < 1120 {
				return core.Style{Gap: 8}
			}
			return core.Style{Direction: core.Row, Gap: 8, AlignItems: core.AlignEnd}
		},
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 4, FlexGrow: 1}, Children: []core.Node{
					core.Text{ContentFunc: func() string { return locales.SettingsModelSuggestedLabel(cx) },
						Style:     core.Style{FontSize: typeCaption, FontWeight: ui.Semibold},
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
					Style: core.Style{FontSize: typeCaption},
					StyleFunc: func() core.Style {
						if fetchFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		field(locales.SettingsProviderBaseUrlLabelAdvanced,
			ui.Input{Value: baseURL.Get, OnChange: baseURL.Set, TestID: "settings-llm-base-url"}),
		core.Show{When: func() bool { return s.adoptedProvider && !keySaved.Get() },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{Content: locales.SettingsMigrationProviderImported(cx),
					Style:     core.Style{FontSize: typeCaption},
					StyleFunc: ui.Colored(accentInk(cx))}
			}},
		field(locales.SettingsApikeyLabel,
			core.Dynamic(func(cx *core.Scope) core.Node {
				if keySaved.Get() && !editingKey.Get() {
					return core.View{TestID: "settings-llm-key-saved",
						Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
							JustifyContent: core.JustifySpaceBetween, Height: core.Pt(ui.ButtonHeight),
							Padding: core.Symmetric(0, 10), CornerRadius: ui.RadiusControl, BorderWidth: 1},
						StyleFunc: func() core.Style {
							colors := ui.ColorsOf(cx)
							return core.Style{BorderColor: colors.FieldBorder(), Background: colors.Inset()}
						},
						Children: []core.Node{
							core.Text{ContentFunc: func() string { return savedMask.Get() },
								Style:     core.Style{FontSize: typeBody, FontFamily: core.FontMonospace},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
							core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
								Gap: 8}, Children: []core.Node{
								core.Text{Content: locales.SettingsApikeySaved(cx),
									Style:     core.Style{FontSize: typeCaption},
									StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
								ui.Button{Text: locales.SettingsApikeyReplace(cx),
									Variant: ui.ButtonOutline, Size: ui.SizeSmall,
									TestID: "settings-llm-key-replace",
									OnPress: func() {
										key.Set("")
										editingKey.Set(true)
									}},
							}},
						}}
				}
				return ui.Input{Value: key.Get, OnChange: key.Set, Masked: true,
					Placeholder: locales.SettingsApikeyPlaceholder(cx), TestID: "settings-llm-key"}
			})),
	}
	if keyErr != nil {
		children = append(children, core.Text{ContentFunc: func() string {
			return locales.SettingsApikeyUnavailable(cx)
		}, Style: core.Style{FontSize: typeCaption}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	}
	children = append(children,
		core.Text{ContentFunc: func() string { return locales.SettingsAiHint(cx) },
			Style: core.Style{FontSize: typeCaption}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			JustifyContent: core.JustifySpaceBetween, Gap: 8}, Children: []core.Node{
			ui.Button{Text: locales.SettingsTestConnection(cx), Variant: ui.ButtonOutline,
				OnPress: testConnection, Busy: testing.Get, TestID: "settings-llm-test"},
			ui.Button{Text: locales.SettingsSave(cx), OnPress: save, TestID: "settings-llm-save"},
		}},
		core.Show{When: func() bool { return testStatus.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return testStatus.Get() },
					Style: core.Style{FontSize: typeCaption},
					StyleFunc: func() core.Style {
						if testFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: typeCaption},
					StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	)

	return settingsCard(cx, lucide.Sparkles, locales.SettingsSectionAi, nil, children...)
}

// maskSecret is 1.x's credential preview: keep a recognizable provider prefix
// ("sk-", "sk-ant-") plus the last four characters, never the whole key.
func maskSecret(plaintext string) string {
	if len(plaintext) < 8 {
		return strings.Repeat("*", len(plaintext))
	}
	head := ""
	if dash := strings.Index(plaintext, "-"); dash > 0 && dash <= 8 {
		head = plaintext[:dash+1]
	}
	return head + "..." + plaintext[len(plaintext)-4:]
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
	return appSelect[string]{
		Options: options, Value: value.Get, OnChange: value.Set,
		Placeholder: locales.SettingsModelPickerPlaceholder(cx),
		Searchable:  true, SearchPlaceholder: locales.SettingsModelSearchPlaceholder(cx),
		Empty: locales.SettingsPickerNoMatch(cx), TestID: "settings-llm-model-suggested",
		Style: core.Style{Width: core.Pct(100)},
	}
}
