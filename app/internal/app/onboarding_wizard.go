package app

import (
	"context"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/i18n"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

const onboardingSteps = 5

// onboardingWizard is the draft the five steps share. It lives only in
// memory; the database gets one row set when the last step commits.
type onboardingWizard struct {
	step      *core.Signal[int]
	nameZH    *core.Signal[string]
	nameEN    *core.Signal[string]
	industry  *core.Signal[string]
	country   *core.Signal[string]
	boundary  *core.Signal[string]
	siteZH    *core.Signal[string]
	siteEN    *core.Signal[string]
	address   *core.Signal[string]
	siteCC    *core.Signal[string]
	year      *core.Signal[string]
	attempted *core.Signal[int]
	status    *core.Signal[string]
	busy      *core.Signal[bool]
}

type onboardingLookup struct {
	Code string
	ZH   string
	EN   string
}

// onboardingIndustries and onboardingCountries mirror 1.x's onboarding
// lookups, so the pickers offer the same short, relevant lists.
var onboardingIndustries = []onboardingLookup{
	{"manufacturing", "制造业", "Manufacturing"},
	{"power_utility", "电力与公用事业", "Power & utilities"},
	{"oil_and_gas", "石油与天然气", "Oil & gas"},
	{"chemicals", "化工", "Chemicals"},
	{"metals_and_mining", "金属与采矿", "Metals & mining"},
	{"construction_materials", "建筑材料与水泥", "Construction materials"},
	{"construction", "建筑业", "Construction"},
	{"transportation", "交通运输", "Transportation"},
	{"logistics_warehousing", "物流与仓储", "Logistics & warehousing"},
	{"consumer_goods", "消费品", "Consumer goods"},
	{"food_and_beverage", "食品与饮料", "Food & beverage"},
	{"agriculture", "农业", "Agriculture"},
	{"retail", "零售", "Retail"},
	{"technology", "信息技术", "Technology"},
	{"telecom", "电信", "Telecom"},
	{"financial_services", "金融服务", "Financial services"},
	{"real_estate", "房地产", "Real estate"},
	{"healthcare", "医疗健康", "Healthcare"},
	{"pharmaceutical", "制药", "Pharmaceuticals"},
	{"education", "教育", "Education"},
	{"hospitality", "酒店与餐饮", "Hospitality"},
	{"professional_services", "专业服务", "Professional services"},
	{"government_nonprofit", "政府与非营利", "Government / nonprofit"},
	{"other", "其他", "Other"},
}

var onboardingCountries = []onboardingLookup{
	{"CN", "中国", "China"},
	{"HK", "香港 SAR", "Hong Kong SAR"},
	{"TW", "台湾", "Taiwan"},
	{"JP", "日本", "Japan"},
	{"KR", "韩国", "South Korea"},
	{"SG", "新加坡", "Singapore"},
	{"US", "美国", "United States"},
	{"GB", "英国", "United Kingdom"},
	{"DE", "德国", "Germany"},
}

func lookupOptions(items []onboardingLookup) []ui.Option[string] {
	options := make([]ui.Option[string], 0, len(items))
	for _, item := range items {
		options = append(options, ui.Option[string]{
			Value: item.Code, Label: item.ZH + " · " + item.EN,
		})
	}
	return options
}

// onboardingRoot is the full-window setup assistant 1.x showed before the
// inventory shell: progress segments, one centered card, no sidebar.
func (s *Session) onboardingRoot(cx *core.Scope) core.Node {
	now := time.Now()
	w := &onboardingWizard{
		step:      core.NewSignal(cx, 1),
		nameZH:    core.NewSignal(cx, ""),
		nameEN:    core.NewSignal(cx, ""),
		industry:  core.NewSignal(cx, ""),
		country:   core.NewSignal(cx, "CN"),
		boundary:  core.NewSignal(cx, "operational_control"),
		siteZH:    core.NewSignal(cx, ""),
		siteEN:    core.NewSignal(cx, ""),
		address:   core.NewSignal(cx, ""),
		siteCC:    core.NewSignal(cx, "CN"),
		year:      core.NewSignal(cx, strconv.Itoa(now.Year()-1)),
		attempted: core.NewSignal(cx, 0),
		status:    core.NewSignal(cx, ""),
		busy:      core.NewSignal(cx, false),
	}

	setLocale := func(value string) {
		s.settings.Locale = value
		_ = prefs.Save(s.prefsPath, s.settings)
		cx.SetLocale(value)
	}
	chrome := core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			JustifyContent: core.JustifySpaceBetween, Gap: 12},
		Children: []core.Node{
			onboardingProgress(cx, w.step.Get),
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Padding: core.All(2), CornerRadius: 6, BorderWidth: 1,
				Background:  ui.ColorsOf(cx).Surface(),
				BorderColor: ui.ColorsOf(cx).Border()}, Children: []core.Node{
				onboardingLocaleButton(cx, "zh-CN", locales.SettingsGeneralLanguageZh, setLocale),
				onboardingLocaleButton(cx, "en", locales.SettingsGeneralLanguageEn, setLocale),
			}},
		},
	}

	back := func() {
		if w.busy.Get() {
			return
		}
		w.status.Set("")
		if w.step.Get() > 1 {
			w.step.Set(w.step.Get() - 1)
		}
	}
	next := func() {
		if w.busy.Get() {
			return
		}
		step := w.step.Get()
		if !w.validStep(step) {
			w.attempted.Set(step)
			return
		}
		w.status.Set("")
		if step < onboardingSteps {
			w.step.Set(step + 1)
		}
	}
	finish := func() {
		if w.busy.Get() {
			return
		}
		for step := 1; step <= 4; step++ {
			if !w.validStep(step) {
				w.attempted.Set(step)
				w.step.Set(step)
				return
			}
		}
		year, err := strconv.Atoi(strings.TrimSpace(w.year.Get()))
		if err != nil {
			w.status.Set(locales.OnboardingRequired(cx))
			return
		}
		w.busy.Set(true)
		_, _, _, err = s.db.CompleteOnboarding(context.Background(), store.OnboardingInput{
			Organization: store.OrganizationInput{
				NameZH: w.nameZH.Get(), NameEN: w.nameEN.Get(), Industry: w.industry.Get(),
				CountryCode: w.country.Get(), BoundaryKind: w.boundary.Get(),
			},
			Site: store.SiteInput{
				NameZH: w.siteZH.Get(), NameEN: w.siteEN.Get(), Address: w.address.Get(),
				CountryCode: w.siteCC.Get(),
			},
			Year: year,
		})
		if err != nil {
			w.busy.Set(false)
			w.status.Set(locales.OnboardingCompleteFailed(cx) + ": " + err.Error())
			return
		}
		s.justOnboarded = true
		if s.onboarded != nil {
			s.onboarded.Set(true)
		}
		if err := dataRefresh(s, s.dataRev); err != nil {
			w.busy.Set(false)
			w.status.Set(err.Error())
		}
	}

	card := core.View{
		Style: core.Style{BorderWidth: 1, CornerRadius: 8,
			Background:  ui.ColorsOf(cx).Surface(),
			BorderColor: ui.ColorsOf(cx).Border()},
		Children: []core.Node{
			core.Dynamic(func(cx *core.Scope) core.Node {
				_ = i18n.Language(cx)
				step := w.step.Get()
				title, subtitle := onboardingStepCopy(cx, step)
				return core.View{
					Style: core.Style{Padding: core.Edges{Left: 32, Right: 32, Top: 32, Bottom: 24},
						Gap: 8},
					Children: []core.Node{
						core.Text{Content: locales.OnboardingEyebrow(cx,
							strconv.Itoa(step), strconv.Itoa(onboardingSteps)),
							Style: core.Style{FontSize: 12, FontWeight: ui.Medium,
								LetterSpacingEm: 0.05, TextTransform: core.TextTransformUppercase},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
						core.Text{Content: title, Style: core.Style{FontSize: 24,
							FontWeight: ui.Semibold, LetterSpacingEm: -0.01}},
						core.Text{Content: subtitle, Style: core.Style{FontSize: 14,
							LineHeightEm: 1.5}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
							MaxLines: 3},
					}}
			}),
			core.View{Style: core.Style{Padding: core.Edges{Left: 32, Right: 32, Bottom: 24}},
				Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
					_ = i18n.Language(cx)
					return w.body(cx, finish)
				})}},
			core.View{
				Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					JustifyContent: core.JustifySpaceBetween, Gap: 12,
					Padding: core.Symmetric(16, 32), Borders: core.Edges{Top: 1},
					BorderColor: ui.ColorsOf(cx).Border()},
				Children: []core.Node{
					core.Dynamic(func(cx *core.Scope) core.Node {
						if w.step.Get() == 1 {
							return core.View{}
						}
						return ui.Button{Text: locales.OnboardingBack(cx),
							Variant: ui.ButtonSecondary, OnPress: back,
							Disabled: w.busy.Get, TestID: "onboarding-back"}
					}),
					core.Dynamic(func(cx *core.Scope) core.Node {
						if w.step.Get() == onboardingSteps {
							return core.View{}
						}
						label := locales.OnboardingNext(cx)
						testID := "onboarding-next"
						onPress := next
						if w.step.Get() == 4 {
							testID = "onboarding-next"
						}
						if w.step.Get() == onboardingSteps-1 {
							testID = "onboarding-next"
						}
						return ui.Button{Text: label, OnPress: onPress,
							Disabled: w.busy.Get, TestID: testID}
					}),
				}},
		},
	}

	return core.View{
		TestID: "onboarding",
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
			AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter,
			Padding: core.All(24), Background: ui.ColorsOf(cx).Background()},
		Children: []core.Node{core.View{
			Style: core.Style{Width: core.Pct(100), MaxWidth: core.Pt(576), Gap: 24},
			Children: []core.Node{
				chrome,
				card,
				core.Show{When: func() bool { return w.status.Get() != "" },
					Then: func(cx *core.Scope) core.Node {
						return core.Text{ContentFunc: func() string { return w.status.Get() },
							Style:     core.Style{FontSize: 12, TextAlign: core.TextAlignCenter},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger), MaxLines: 3}
					}},
			},
		}},
	}
}

func onboardingProgress(cx *core.Scope, step func() int) core.Node {
	segments := make([]core.Node, 0, onboardingSteps)
	for i := 1; i <= onboardingSteps; i++ {
		i := i
		width := core.Points(24)
		if i == 1 {
			width = 32
		}
		segments = append(segments, core.View{
			Style: core.Style{Width: core.Pt(width), Height: core.Pt(6), CornerRadius: 3},
			StyleFunc: func() core.Style {
				current := step()
				switch {
				case i == current:
					return core.Style{Background: ui.ColorsOf(cx).Accent()}
				case i < current:
					return core.Style{Background: ui.Alpha(ui.ColorsOf(cx).Accent(), 0.6)}
				default:
					return core.Style{Background: ui.ColorsOf(cx).Border()}
				}
			},
		})
	}
	return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
		Gap: 6}, Children: segments}
}

func onboardingLocaleButton(cx *core.Scope, value string, label func(*core.Scope) string,
	onChange func(string)) core.Node {
	active := func() bool {
		return strings.HasPrefix(strings.ToLower(i18n.Language(cx)), strings.ToLower(value))
	}
	return core.View{TestID: "onboarding-locale-" + value, Role: core.RoleButton,
		OnPress: func(core.PressEvent) { onChange(value) },
		Style:   core.Style{Padding: core.Symmetric(4, 10), CornerRadius: 4},
		StyleFunc: func() core.Style {
			if active() {
				return core.Style{Background: ui.ColorsOf(cx).Text()}
			}
			return core.Style{}
		},
		Children: []core.Node{core.Text{ContentFunc: func() string { return label(cx) },
			Style: core.Style{FontSize: 12, FontWeight: ui.Medium},
			StyleFunc: func() core.Style {
				if active() {
					return core.Style{Color: ui.ColorsOf(cx).Background()}
				}
				return ui.Colored(ui.ColorsOf(cx).Muted)()
			}}}}
}

func onboardingStepCopy(cx *core.Scope, step int) (string, string) {
	switch step {
	case 2:
		return locales.OnboardingStepYearTitle(cx), locales.OnboardingStepYearSubtitle(cx)
	case 3:
		return locales.OnboardingStepBoundaryTitle(cx), locales.OnboardingStepBoundarySubtitle(cx)
	case 4:
		return locales.OnboardingStepSiteTitle(cx), locales.OnboardingStepSiteSubtitle(cx)
	case 5:
		return locales.OnboardingStepAiTitle(cx), locales.OnboardingStepAiSubtitle(cx)
	default:
		return locales.OnboardingStepCompanyTitle(cx), locales.OnboardingStepCompanySubtitle(cx)
	}
}

func (w *onboardingWizard) validStep(step int) bool {
	switch step {
	case 1:
		return strings.TrimSpace(w.nameZH.Get()+w.nameEN.Get()) != ""
	case 2:
		year, err := strconv.Atoi(strings.TrimSpace(w.year.Get()))
		return err == nil && year >= 2020 && year <= 2030
	case 4:
		return strings.TrimSpace(w.siteZH.Get()+w.siteEN.Get()) != ""
	}
	return true
}

func (w *onboardingWizard) body(cx *core.Scope, finish func()) core.Node {
	switch w.step.Get() {
	case 2:
		return w.yearBody(cx)
	case 3:
		return w.boundaryBody(cx)
	case 4:
		return w.siteBody(cx)
	case 5:
		return w.aiBody(cx, finish)
	default:
		return w.companyBody(cx)
	}
}

func onboardingField(cx *core.Scope, label string, input core.Node) core.Node {
	return core.View{Style: core.Style{Gap: 6, FlexGrow: 1, FlexShrink: 1,
		MinWidth: core.Pt(0)}, Children: []core.Node{
		core.Text{Content: label, Style: core.Style{FontSize: 14, FontWeight: ui.Medium}},
		input,
	}}
}

func (w *onboardingWizard) requiredNameHint(cx *core.Scope, zh, en *core.Signal[string],
	minAttempt int) core.Node {
	return core.Text{ContentFunc: func() string { return locales.OnboardingNameHint(cx) },
		Style: core.Style{FontSize: 12},
		StyleFunc: func() core.Style {
			missing := strings.TrimSpace(zh.Get()+en.Get()) == ""
			if missing && w.attempted.Get() >= minAttempt {
				return ui.Colored(ui.ColorsOf(cx).Danger)()
			}
			return ui.Colored(ui.ColorsOf(cx).Muted)()
		}}
}

func (w *onboardingWizard) companyBody(cx *core.Scope) core.Node {
	return core.View{Style: core.Style{Gap: 24}, Children: []core.Node{
		core.View{Style: core.Style{Gap: 12}, Children: []core.Node{
			dataColumns(cx, 16,
				onboardingField(cx, locales.OnboardingStepCompanyNameZh(cx),
					ui.Input{Value: w.nameZH.Get, OnChange: w.nameZH.Set,
						Placeholder: "碳墨示例有限公司", TestID: "onboarding-org-zh",
						Style: core.Style{Height: core.Pt(36)}}),
				onboardingField(cx, locales.OnboardingStepCompanyNameEn(cx),
					ui.Input{Value: w.nameEN.Get, OnChange: w.nameEN.Set,
						Placeholder: "CarbonInk Demo Co.", TestID: "onboarding-org-en",
						Style: core.Style{Height: core.Pt(36)}}),
			),
			w.requiredNameHint(cx, w.nameZH, w.nameEN, 1),
		}},
		dataColumns(cx, 16,
			onboardingField(cx, locales.OnboardingStepCompanyIndustry(cx),
				appSelect[string]{Options: lookupOptions(onboardingIndustries),
					Value: w.industry.Get, OnChange: w.industry.Set,
					Placeholder: locales.OnboardingStepCompanyIndustryPlaceholder(cx),
					Label:       locales.OnboardingStepCompanyIndustry(cx),
					TestID:      "onboarding-org-industry",
					Style:       core.Style{Width: core.Pct(100)}}),
			onboardingField(cx, locales.OnboardingStepCompanyCountry(cx),
				appSelect[string]{Options: lookupOptions(onboardingCountries),
					Value: w.country.Get, OnChange: w.country.Set,
					Label:  locales.OnboardingStepCompanyCountry(cx),
					TestID: "onboarding-org-country",
					Style:  core.Style{Width: core.Pct(100)}}),
		),
	}}
}

func (w *onboardingWizard) yearBody(cx *core.Scope) core.Node {
	current := time.Now().Year()
	quick := []int{current - 2, current - 1, current}
	chips := make([]core.Node, 0, len(quick))
	for _, year := range quick {
		year := year
		chips = append(chips, core.View{
			TestID: "onboarding-year-quick-" + strconv.Itoa(year),
			Role:   core.RoleButton,
			OnPress: func(core.PressEvent) {
				w.year.Set(strconv.Itoa(year))
			},
			Style: core.Style{Height: core.Pt(32), Padding: core.Symmetric(0, 16),
				CornerRadius: 16, BorderWidth: 1},
			StyleFunc: func() core.Style {
				if w.year.Get() == strconv.Itoa(year) {
					return core.Style{Background: ui.ColorsOf(cx).Accent(),
						BorderColor: ui.ColorsOf(cx).Accent()}
				}
				return core.Style{Background: ui.ColorsOf(cx).Surface(),
					BorderColor: ui.ColorsOf(cx).Border()}
			},
			Children: []core.Node{core.Text{Content: strconv.Itoa(year),
				Style: core.Style{FontSize: 14, FontWeight: ui.Medium},
				StyleFunc: func() core.Style {
					if w.year.Get() == strconv.Itoa(year) {
						return core.Style{Color: ui.ColorsOf(cx).OnAccent()}
					}
					return core.Style{}
				}}},
		})
	}
	return core.View{Style: core.Style{Gap: 20}, Children: []core.Node{
		core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 8},
			Children: chips},
		core.View{Style: core.Style{Gap: 6, Width: core.Pt(140)}, Children: []core.Node{
			core.Text{Content: locales.OnboardingStepYearTitle(cx),
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			ui.Input{Value: w.year.Get, OnChange: w.year.Set, TestID: "onboarding-year",
				Style: core.Style{Height: core.Pt(36)}},
		}},
	}}
}

func (w *onboardingWizard) boundaryBody(cx *core.Scope) core.Node {
	options := []struct {
		Value string
		Label string
		Body  func(*core.Scope) string
	}{
		{"operational_control", "Operational Control", locales.OnboardingStepBoundaryOperationalControl},
		{"equity_share", "Equity Share", locales.OnboardingStepBoundaryEquityShare},
	}
	cards := make([]core.Node, 0, len(options))
	for _, option := range options {
		option := option
		body := option.Body(cx)
		selected := func() bool { return w.boundary.Get() == option.Value }
		cards = append(cards, core.View{
			TestID: "onboarding-boundary-" + option.Value,
			Role:   core.RoleButton,
			OnPress: func(core.PressEvent) {
				w.boundary.Set(option.Value)
			},
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 12,
				Padding: core.All(16), CornerRadius: 8, BorderWidth: 1},
			StyleFunc: func() core.Style {
				if selected() {
					return core.Style{Background: ui.Alpha(ui.ColorsOf(cx).Accent(), 0.06),
						BorderColor: ui.ColorsOf(cx).Accent()}
				}
				return core.Style{Background: ui.ColorsOf(cx).Surface(),
					BorderColor: ui.ColorsOf(cx).Border()}
			},
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 4, FlexGrow: 1, FlexShrink: 1,
					MinWidth: core.Pt(0)}, Children: []core.Node{
					core.Text{Content: option.Label, Style: core.Style{FontSize: 14,
						FontWeight: ui.Medium}},
					core.Text{Content: body, Style: core.Style{FontSize: 14, LineHeightEm: 1.5},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
				}},
				core.View{Style: core.Style{Width: core.Pt(20), Height: core.Pt(20),
					CornerRadius: 10, AlignItems: core.AlignCenter,
					JustifyContent: core.JustifyCenter, BorderWidth: 1},
					StyleFunc: func() core.Style {
						if selected() {
							return core.Style{Background: ui.ColorsOf(cx).Accent(),
								BorderColor: ui.ColorsOf(cx).Accent()}
						}
						return core.Style{Background: ui.ColorsOf(cx).Background(),
							BorderColor: ui.ColorsOf(cx).Border()}
					},
					Children: []core.Node{core.Show{When: selected,
						Then: func(cx *core.Scope) core.Node {
							return ui.Icon(lucide.Check, 12, ui.ColorsOf(cx).OnAccent)
						}}}},
			},
		})
	}
	return core.View{Style: core.Style{Gap: 12}, Children: cards}
}

func (w *onboardingWizard) siteBody(cx *core.Scope) core.Node {
	return core.View{Style: core.Style{Gap: 20}, Children: []core.Node{
		core.View{Style: core.Style{Gap: 12}, Children: []core.Node{
			dataColumns(cx, 16,
				onboardingField(cx, locales.OnboardingStepSiteNameZh(cx),
					ui.Input{Value: w.siteZH.Get, OnChange: w.siteZH.Set,
						Placeholder: "北京总部", TestID: "onboarding-site-zh",
						Style: core.Style{Height: core.Pt(36)}}),
				onboardingField(cx, locales.OnboardingStepSiteNameEn(cx),
					ui.Input{Value: w.siteEN.Get, OnChange: w.siteEN.Set,
						Placeholder: "Beijing HQ", TestID: "onboarding-site-en",
						Style: core.Style{Height: core.Pt(36)}}),
			),
			w.requiredNameHint(cx, w.siteZH, w.siteEN, 4),
		}},
		onboardingField(cx, locales.OnboardingStepSiteAddress(cx),
			ui.Input{Value: w.address.Get, OnChange: w.address.Set,
				Placeholder: "北京市朝阳区某某路 1 号", TestID: "onboarding-site-address",
				Style: core.Style{Height: core.Pt(36)}}),
		core.View{Style: core.Style{Width: core.Pct(50), MinWidth: core.Pt(200),
			MaxWidth: core.Pt(260)}, Children: []core.Node{
			onboardingField(cx, locales.OnboardingStepSiteCountry(cx),
				appSelect[string]{Options: lookupOptions(onboardingCountries),
					Value: w.siteCC.Get, OnChange: w.siteCC.Set,
					Label:  locales.OnboardingStepSiteCountry(cx),
					TestID: "onboarding-site-country",
					Style:  core.Style{Width: core.Pct(100)}}),
		}},
	}}
}

func (w *onboardingWizard) aiBody(cx *core.Scope, finish func()) core.Node {
	action := func(label string, primary bool, testID string, onPress func()) core.Node {
		style := core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Width: core.Pct(100), Height: core.Pt(44), Padding: core.Symmetric(0, 16),
			CornerRadius: 8, BorderWidth: 1}
		textStyle := core.Style{FontSize: 14, FontWeight: ui.Medium}
		if primary {
			style.Background = ui.ColorsOf(cx).Accent()
			style.BorderColor = ui.ColorsOf(cx).Accent()
			textStyle.Color = ui.ColorsOf(cx).OnAccent()
		} else {
			style.Background = ui.ColorsOf(cx).Surface()
			style.BorderColor = ui.ColorsOf(cx).Border()
		}
		return core.View{TestID: testID, Role: core.RoleButton,
			Disabled: w.busy.Get,
			OnPress:  func(core.PressEvent) { onPress() },
			Style:    style,
			Children: []core.Node{core.Text{Content: label, Style: textStyle, MaxLines: 2}}}
	}
	return core.View{Style: core.Style{Gap: 12}, Children: []core.Node{
		action(locales.OnboardingStepAiByot(cx), true, "onboarding-byot", finish),
		action(locales.OnboardingStepAiSkip(cx), false, "onboarding-skip", finish),
		core.Show{When: w.busy.Get, Then: func(cx *core.Scope) core.Node {
			return core.Text{ContentFunc: func() string { return locales.OnboardingCreating(cx) },
				Style:     core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
		}},
	}}
}
