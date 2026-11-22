package app

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/categories"
	"app.carbonink.desktop/internal/efmatch"
	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/presets"
	"app.carbonink.desktop/internal/routing"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/i18n"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

func dataCard(cx *core.Scope, children ...core.Node) core.Node {
	style := ui.CardStyle(cx)
	style.Gap = 12
	style.Padding = core.All(16)
	style.AlignSelf = core.AlignStretch
	return core.View{Style: style, Children: children}
}

func dataHeading(cx *core.Scope, title string, detail string) core.Node {
	children := []core.Node{core.Text{Content: title, Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}}}
	if detail != "" {
		children = append(children, core.Text{Content: detail, Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	return core.View{Style: core.Style{Gap: 2}, Children: children}
}

func dataField(cx *core.Scope, label string, input core.Node) core.Node {
	return core.View{Style: core.Style{Gap: 4}, Children: []core.Node{
		core.Text{Content: label, Style: core.Style{FontSize: 12, FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		namedNode(input, func() string { return label }),
	}}
}

func dataError(cx *core.Scope, message *core.Signal[string]) core.Node {
	return core.Show{When: func() bool { return message.Get() != "" },
		Then: func(cx *core.Scope) core.Node {
			return core.Text{ContentFunc: func() string { return message.Get() },
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		}}
}

func dataDialog(cx *core.Scope, open *core.Signal[bool], title string, children []core.Node,
	footer []core.Node, testID string) core.Node {
	return dataDialogSized(cx, open, title, children, footer, testID, 520)
}

func dataDialogSized(cx *core.Scope, open *core.Signal[bool], title string, children []core.Node,
	footer []core.Node, testID string, width core.Points) core.Node {
	return ui.Dialog{
		Open: open.Get,
		OnOpenChange: func(v bool, _ base.Reason) {
			open.Set(v)
		},
		Title:    title,
		Children: children,
		Footer:   footer,
		TestID:   testID,
		Style:    core.Style{Width: core.Pt(width)},
	}
}

func dataRefresh(s *Session, rev *core.Signal[int]) error {
	if err := s.reload(context.Background()); err != nil {
		s.log.Error("reload data failed", "err", err)
		return err
	}
	rev.Set(rev.Get() + 1)
	return nil
}

func dataCancelButton(cx *core.Scope, open *core.Signal[bool], testID string) core.Node {
	return ui.Button{Text: locales.DataCancel(cx), Variant: ui.ButtonSecondary,
		OnPress: func() { open.Set(false) }, TestID: testID}
}

func dataBoundaryOptions(cx *core.Scope) []ui.Option[string] {
	return []ui.Option[string]{
		{Value: "operational_control", Label: locales.OnboardingStepBoundaryOperationalControl(cx)},
		{Value: "equity_share", Label: locales.OnboardingStepBoundaryEquityShare(cx)},
		{Value: "financial_control", Label: locales.SettingsBoundaryFinancialControl(cx)},
	}
}

func dataBoundaryLabel(cx *core.Scope, value string) string {
	switch value {
	case "equity_share":
		return locales.OnboardingStepBoundaryEquityShare(cx)
	case "financial_control":
		return locales.SettingsBoundaryFinancialControl(cx)
	}
	return locales.OnboardingStepBoundaryOperationalControl(cx)
}

func dataScopeLabel(cx *core.Scope, scope int) string {
	switch scope {
	case 1:
		return locales.SourcesFormScope1(cx)
	case 2:
		return locales.SourcesFormScope2(cx)
	default:
		return locales.SourcesFormScope3(cx)
	}
}

func dataScopeOptions(cx *core.Scope) []ui.Option[int] {
	return []ui.Option[int]{
		{Value: 1, Label: locales.SourcesFormScope1(cx)},
		{Value: 2, Label: locales.SourcesFormScope2(cx)},
		{Value: 3, Label: locales.SourcesFormScope3(cx)},
	}
}

// sourceCategoryCustom is the Select sentinel that reveals the free-text
// category fields for values outside the taxonomy.
const sourceCategoryCustom = "\x00custom"

func sourceCategoryOptions(cx *core.Scope, scope int, current string) []ui.Option[string] {
	locale := i18n.Language(cx)
	categoriesForScope := categories.ForScope(scope)
	options := make([]ui.Option[string], 0, len(categoriesForScope)+3)
	inScope := false
	for _, category := range categoriesForScope {
		if category.Code == current {
			inScope = true
		}
		options = append(options, ui.Option[string]{Value: category.Code, Label: category.Label(locale)})
	}
	if current != "" && !inScope {
		options = append([]ui.Option[string]{{Value: current,
			Label: current + " · " + locales.SourcesFormCategoryNonstandard(cx)}}, options...)
	}
	options = append(options,
		ui.Option[string]{Value: "", Label: locales.SourcesFormCategoryNone(cx)},
		ui.Option[string]{Value: sourceCategoryCustom, Label: locales.SourcesFormCategoryCustomOption(cx)},
	)
	return options
}

// sourceCategoryValues resolves the stored category and path from the picker
// signals: a taxonomy code wins, then a custom pair, else neither.
func sourceCategoryValues(categoryCode, category, path *core.Signal[string],
	custom *core.Signal[bool]) (string, string) {
	if code := categoryCode.Get(); code != "" {
		return categories.EFCategoryForCode(code), code
	}
	if custom.Get() {
		return category.Get(), path.Get()
	}
	return "", ""
}

// sourceCategoryFields is the category picker plus its custom-value escape
// hatch, shared by the Sources editor and the import wizard's inline creator.
func sourceCategoryFields(cx *core.Scope, testID string, scope *core.Signal[int],
	categoryCode, category, path *core.Signal[string], custom *core.Signal[bool]) core.Node {
	return core.View{Style: core.Style{Gap: 10}, Children: []core.Node{
		dataField(cx, locales.SourcesFormCategory(cx),
			core.Dynamic(func(cx *core.Scope) core.Node {
				value := categoryCode.Get()
				if custom.Get() {
					value = sourceCategoryCustom
				}
				return ui.Select[string]{
					Options:     sourceCategoryOptions(cx, scope.Get(), categoryCode.Get()),
					Value:       func() string { return value },
					Placeholder: locales.SourcesFormCategoryPlaceholder(cx),
					Searchable:  true, SearchPlaceholder: locales.SourcesFormCategorySearch(cx),
					Empty: locales.SourcesFormCategoryEmpty(cx),
					OnChange: func(next string) {
						switch next {
						case sourceCategoryCustom:
							custom.Set(true)
						case "":
							custom.Set(false)
							categoryCode.Set("")
							category.Set("")
							path.Set("")
						default:
							custom.Set(false)
							categoryCode.Set(next)
							if picked, ok := categories.ByCode(next); ok {
								category.Set(picked.EFCategory)
								path.Set(picked.Code)
							}
						}
					},
					Label:  locales.SourcesFormCategory(cx),
					TestID: testID + "-category-select",
				}
			})),
		core.Dynamic(func(cx *core.Scope) core.Node {
			if !custom.Get() {
				if categoryCode.Get() == "" {
					return core.View{}
				}
				return core.Text{Content: locales.SourcesFormCategoryHint(cx),
					Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2}
			}
			return core.View{Style: core.Style{Gap: 10}, Children: []core.Node{
				dataField(cx, locales.SourcesFormCategory(cx),
					ui.Input{Value: category.Get, OnChange: category.Set, TestID: testID + "-category"}),
				dataField(cx, locales.SourcesFormCategoryHint(cx),
					ui.Input{Value: path.Get, OnChange: path.Set, TestID: testID + "-path"}),
			}}
		}),
	}}
}

func dataSiteName(site store.Site) string {
	if site.NameZH != "" {
		return site.NameZH
	}
	if site.NameEN != "" {
		return site.NameEN
	}
	return site.ID
}

func dataOrgName(org *store.Organization) string {
	if org == nil {
		return ""
	}
	if org.NameZH != "" {
		return org.NameZH
	}
	if org.NameEN != "" {
		return org.NameEN
	}
	return org.ID
}

func dataYearPeriod(periods []store.ReportingPeriod) *store.ReportingPeriod {
	for i := len(periods) - 1; i >= 0; i-- {
		if periods[i].IsActive {
			return &periods[i]
		}
	}
	if len(periods) > 0 {
		return &periods[len(periods)-1]
	}
	return nil
}

// dashboardScreen is the workspace overview and the entry point for the
// organization, site, period, source, and activity setup flows.
func (s *Session) dashboardScreen(cx *core.Scope, dataRev *core.Signal[int],
	active *core.Signal[Screen]) core.Node {
	if s.organization == nil {
		return s.onboardingScreen(cx, dataRev)
	}
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: []core.Node{
				core.Dynamic(func(cx *core.Scope) core.Node {
					_ = dataRev.Get()
					return s.dashboardBody(cx, dataRev, active)
				}),
			},
		}},
	}
}

func (s *Session) dashboardBody(cx *core.Scope, dataRev *core.Signal[int],
	active *core.Signal[Screen]) core.Node {
	org := s.organization
	summary := s.summary
	orgName := dataOrgName(org)
	orgDetail := ""
	if org != nil {
		orgDetail = org.CountryCode + " · " + dataBoundaryLabel(cx, org.BoundaryKind)
		if org.Industry != "" {
			orgDetail = org.Industry + " · " + orgDetail
		}
	}
	stat := func(label string, value int) core.Node {
		return core.View{Style: core.Style{FlexGrow: 1, FlexBasis: core.Pt(0), Gap: 2}, Children: []core.Node{
			core.Text{Content: strconv.Itoa(value), Style: core.Style{FontSize: 22, FontWeight: ui.Bold}},
			core.Text{Content: label, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}}
	}
	co2e := func(testID, label string, value float64) core.Node {
		return core.View{TestID: testID, Style: core.Style{FlexGrow: 1, FlexBasis: core.Pt(0), Gap: 2},
			Children: []core.Node{
				core.Text{Content: commaFloat(value), Style: core.Style{FontSize: 22, FontWeight: ui.Bold}},
				core.Text{Content: label, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}}
	}
	totalsPeriod := ""
	if len(s.periods) > 0 {
		totalsPeriod = strconv.Itoa(s.periods[len(s.periods)-1].Year) + " · kgCO2e"
	}

	siteRows := []core.Node{}
	for _, site := range s.sites {
		siteRows = append(siteRows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(6, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				ui.Icon(lucide.Building, 14, ui.ColorsOf(cx).Muted),
				core.Text{Content: dataSiteName(site), Style: core.Style{FontSize: 13,
					FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
				core.Text{Content: site.CountryCode, Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.Text{Content: dataActiveLabel(cx, site.IsActive), Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
			},
		})
	}
	if len(siteRows) == 0 {
		siteRows = append(siteRows, core.Text{Content: locales.DataNoSites(cx), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	periodRows := []core.Node{}
	for _, period := range s.periods {
		periodRows = append(periodRows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(6, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				ui.Icon(lucide.Calendar, 14, ui.ColorsOf(cx).Muted),
				core.Text{Content: strconv.Itoa(period.Year), Style: core.Style{FontSize: 13}},
				core.Text{Content: period.Granularity, Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.View{Style: core.Style{FlexGrow: 1}},
				core.Text{Content: dataActiveLabel(cx, period.IsActive), Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
			},
		})
	}
	if len(periodRows) == 0 {
		periodRows = append(periodRows, core.Text{Content: locales.DataNoPeriods(cx), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}

	return core.View{Style: core.Style{Gap: 12}, Children: []core.Node{
		dataCard(cx,
			dataHeading(cx, locales.DashboardInventoryTitle(cx), totalsPeriod),
			core.View{TestID: "dashboard-totals", Style: core.Style{Direction: core.Row, Gap: 16},
				Children: []core.Node{
					co2e("dashboard-total", locales.DashboardTotalCo2e(cx), s.totals.TotalKg),
					co2e("dashboard-scope1", locales.DashboardScope1(cx), s.totals.Scope1Kg),
					co2e("dashboard-scope2", locales.DashboardScope2(cx), s.totals.Scope2Kg),
					co2e("dashboard-scope3", locales.DashboardScope3(cx), s.totals.Scope3Kg),
				}},
		),
		s.gettingStartedCard(cx, active),
		s.dashboardWidgets(cx, active),
		s.readinessHomeCard(cx, active),
		dataCard(cx,
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12}, Children: []core.Node{
				core.View{Style: core.Style{Gap: 3, FlexGrow: 1, FlexShrink: 1,
					MinWidth: core.Pt(0)}, Children: []core.Node{
					core.Text{Content: locales.DataOrgCard(cx), Style: core.Style{FontSize: 12, FontWeight: ui.Semibold},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					core.Text{Content: orgName, Style: core.Style{FontSize: 20, FontWeight: ui.Bold,
						FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
					core.Text{Content: orgDetail, Style: core.Style{FontSize: 12,
						FlexShrink: 1, MinWidth: core.Pt(0)},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				}},
				s.organizationDialog(cx, dataRev),
			}},
		),
		dataCard(cx,
			core.View{Style: core.Style{Direction: core.Row, Gap: 16}, Children: []core.Node{
				stat(locales.DataSites(cx), summary.Sites),
				stat(locales.DataPeriods(cx), summary.Periods),
				stat(locales.DataSources(cx), summary.Sources),
				stat(locales.DataActivities(cx), summary.Activities),
			}},
		),
		dataCard(cx,
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
				dataHeading(cx, locales.DataSites(cx), ""),
				core.View{Style: core.Style{FlexGrow: 1}},
				s.siteDialog(cx, dataRev),
			}},
			core.View{Style: core.Style{Gap: 0}, Children: siteRows},
		),
		dataCard(cx,
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
				dataHeading(cx, locales.DataPeriods(cx), ""),
				core.View{Style: core.Style{FlexGrow: 1}},
				s.periodDialog(cx, dataRev),
			}},
			core.View{Style: core.Style{Gap: 0}, Children: periodRows},
		),
		dataCard(cx,
			dataHeading(cx, locales.DataOrgReady(cx), ""),
			core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
				s.sourceDialog(cx, nil, dataRev, "dashboard-add-source"),
				s.activityDialog(cx, dataRev),
			}},
		),
	}}
}

// gettingStartedCard is the zero-state path from an empty inventory to a
// report. It mirrors the dependency chain — source, activity, report — and
// reads live state, so the only button is the next unfinished step.
func (s *Session) gettingStartedCard(cx *core.Scope, active *core.Signal[Screen]) core.Node {
	if s.totals.TotalKg != 0 {
		return core.View{}
	}
	steps := []struct {
		key    string
		done   bool
		screen Screen
		title  func(*core.Scope) string
		body   func(*core.Scope) string
		cta    func(*core.Scope) string
	}{
		{"sources", len(s.sources) > 0, ScreenSources,
			locales.DashboardStartSourcesTitle, locales.DashboardStartSourcesBody,
			locales.DashboardStartSourcesCta},
		{"activities", len(s.activities) > 0, ScreenActivities,
			locales.DashboardStartActivitiesTitle, locales.DashboardStartActivitiesBody,
			locales.DashboardStartActivitiesCta},
		{"report", false, ScreenReports,
			locales.DashboardStartReportTitle, locales.DashboardStartReportBody,
			locales.DashboardStartReportCta},
	}
	current := len(steps) - 1
	for i := range steps {
		if !steps[i].done {
			current = i
			break
		}
	}

	colors := ui.ColorsOf(cx)
	rows := make([]core.Node, 0, len(steps))
	for i := range steps {
		i := i
		step := steps[i]
		marker := core.Text{Content: strconv.Itoa(i + 1),
			Style:     core.Style{FontSize: 12, Width: core.Pt(18), FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(colors.Muted)}
		title := core.Text{Content: step.title(cx), Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}}
		if step.done {
			marker = core.Text{Content: "✓", Style: core.Style{FontSize: 13, Width: core.Pt(18)},
				StyleFunc: ui.Colored(colors.Accent)}
			title = core.Text{Content: step.title(cx), Style: core.Style{FontSize: 13},
				StyleFunc: ui.Colored(colors.Muted)}
		}
		text := []core.Node{title}
		if i == current {
			text = append(text,
				core.Text{Content: step.body(cx), Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(colors.Muted), MaxLines: 3},
				core.View{Style: core.Style{Direction: core.Row}, Children: []core.Node{
					ui.Button{Text: step.cta(cx), OnPress: func() {
						switch step.key {
						case "sources":
							s.pendingSourceCatalog = true
						case "activities":
							s.pendingNewActivity = true
						}
						active.Set(step.screen)
					},
						TestID: "dashboard-start-" + step.key},
				}})
		}
		rows = append(rows, core.View{
			Style: core.Style{Direction: core.Row, Gap: 10, Padding: core.Symmetric(9, 0),
				Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: colors.Line()} },
			Children: []core.Node{marker, core.View{Style: core.Style{Gap: 4, FlexGrow: 1},
				Children: text}},
		})
	}

	return dataCard(cx,
		dataHeading(cx, locales.DashboardStartTitle(cx), locales.DashboardStartSubtitle(cx)),
		core.View{Style: core.Style{Gap: 0}, Children: rows},
	)
}

func dataActiveLabel(cx *core.Scope, active bool) string {
	if active {
		return locales.SourcesActiveYes(cx)
	}
	return locales.SourcesActiveNo(cx)
}

// onboardingScreen creates the organization, first site, and first reporting
// period when the workspace is empty.
func (s *Session) onboardingScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	nameZH := core.NewSignal(cx, "")
	nameEN := core.NewSignal(cx, "")
	industry := core.NewSignal(cx, "")
	country := core.NewSignal(cx, "CN")
	boundary := core.NewSignal(cx, "operational_control")
	siteZH := core.NewSignal(cx, "")
	siteEN := core.NewSignal(cx, "")
	siteAddress := core.NewSignal(cx, "")
	siteCountry := core.NewSignal(cx, "CN")
	year := core.NewSignal(cx, strconv.Itoa(time.Now().Year()))
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)

	submit := func() {
		y, err := strconv.Atoi(strings.TrimSpace(year.Get()))
		if err != nil {
			status.Set(locales.OnboardingCompleteFailed(cx))
			return
		}
		busy.Set(true)
		_, _, _, err = s.db.CompleteOnboarding(context.Background(), store.OnboardingInput{
			Organization: store.OrganizationInput{
				NameZH: nameZH.Get(), NameEN: nameEN.Get(), Industry: industry.Get(),
				CountryCode: country.Get(), BoundaryKind: boundary.Get(),
			},
			Site: store.SiteInput{NameZH: siteZH.Get(), NameEN: siteEN.Get(),
				Address: siteAddress.Get(), CountryCode: siteCountry.Get()},
			Year: y,
		})
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		if err := dataRefresh(s, dataRev); err != nil {
			status.Set(err.Error())
		}
	}

	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(680), AlignSelf: core.AlignStretch},
			Children: []core.Node{dataCard(cx,
				core.Text{Content: locales.DataOnboardingTitle(cx), Style: core.Style{FontSize: 20, FontWeight: ui.Bold}},
				core.Text{Content: locales.DataOnboardingBody(cx), Style: core.Style{FontSize: 13},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				dataField(cx, locales.OnboardingStepCompanyNameZh(cx),
					ui.Input{Value: nameZH.Get, OnChange: nameZH.Set, TestID: "onboarding-org-zh"}),
				dataField(cx, locales.OnboardingStepCompanyNameEn(cx),
					ui.Input{Value: nameEN.Get, OnChange: nameEN.Set, TestID: "onboarding-org-en"}),
				dataField(cx, locales.OnboardingStepCompanyIndustry(cx),
					ui.Input{Value: industry.Get, OnChange: industry.Set,
						Placeholder: locales.OnboardingStepCompanyIndustryPlaceholder(cx),
						TestID:      "onboarding-org-industry"}),
				dataField(cx, locales.OnboardingStepCompanyCountry(cx),
					ui.Input{Value: country.Get, OnChange: country.Set, TestID: "onboarding-org-country"}),
				dataField(cx, locales.OnboardingStepBoundaryTitle(cx),
					ui.Select[string]{Options: dataBoundaryOptions(cx), Value: boundary.Get, OnChange: boundary.Set,
						Label: locales.OnboardingStepBoundaryTitle(cx), TestID: "onboarding-boundary"}),
				dataField(cx, locales.OnboardingStepSiteNameZh(cx),
					ui.Input{Value: siteZH.Get, OnChange: siteZH.Set, TestID: "onboarding-site-zh"}),
				dataField(cx, locales.OnboardingStepSiteNameEn(cx),
					ui.Input{Value: siteEN.Get, OnChange: siteEN.Set, TestID: "onboarding-site-en"}),
				dataField(cx, locales.OnboardingStepSiteAddress(cx),
					ui.Input{Value: siteAddress.Get, OnChange: siteAddress.Set, TestID: "onboarding-site-address"}),
				dataField(cx, locales.OnboardingStepSiteCountry(cx),
					ui.Input{Value: siteCountry.Get, OnChange: siteCountry.Set, TestID: "onboarding-site-country"}),
				dataField(cx, locales.OnboardingStepYearTitle(cx),
					ui.Input{Value: year.Get, OnChange: year.Set, TestID: "onboarding-year"}),
				dataError(cx, status),
				core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd}, Children: []core.Node{
					ui.Button{Text: locales.OnboardingFinish(cx), Busy: busy.Get, OnPress: submit, TestID: "onboarding-submit"},
				}},
			)},
		}},
	}
}

func (s *Session) organizationDialog(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	open := core.NewSignal(cx, false)
	zh := core.NewSignal(cx, "")
	en := core.NewSignal(cx, "")
	industry := core.NewSignal(cx, "")
	country := core.NewSignal(cx, "")
	boundary := core.NewSignal(cx, "operational_control")
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	show := func() {
		if s.organization != nil {
			zh.Set(s.organization.NameZH)
			en.Set(s.organization.NameEN)
			industry.Set(s.organization.Industry)
			country.Set(s.organization.CountryCode)
			boundary.Set(s.organization.BoundaryKind)
		}
		status.Set("")
		open.Set(true)
	}
	save := func() {
		if s.organization == nil {
			return
		}
		busy.Set(true)
		err := s.db.UpdateOrganization(context.Background(), s.organization.ID, store.OrganizationInput{
			NameZH: zh.Get(), NameEN: en.Get(), Industry: industry.Get(), CountryCode: country.Get(),
			BoundaryKind: boundary.Get(),
		})
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		open.Set(false)
		_ = dataRefresh(s, dataRev)
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.DataEditProfile(cx), Variant: ui.ButtonSecondary, OnPress: show, TestID: "organization-edit"},
		dataDialog(cx, open, locales.DataOrgProfile(cx), []core.Node{
			dataField(cx, locales.OnboardingStepCompanyNameZh(cx),
				ui.Input{Value: zh.Get, OnChange: zh.Set, TestID: "organization-zh"}),
			dataField(cx, locales.OnboardingStepCompanyNameEn(cx),
				ui.Input{Value: en.Get, OnChange: en.Set, TestID: "organization-en"}),
			dataField(cx, locales.OnboardingStepCompanyIndustry(cx),
				ui.Input{Value: industry.Get, OnChange: industry.Set, TestID: "organization-industry"}),
			dataField(cx, locales.OnboardingStepCompanyCountry(cx),
				ui.Input{Value: country.Get, OnChange: country.Set, TestID: "organization-country"}),
			dataField(cx, locales.OnboardingStepBoundaryTitle(cx),
				ui.Select[string]{Options: dataBoundaryOptions(cx), Value: boundary.Get, OnChange: boundary.Set,
					Label: locales.OnboardingStepBoundaryTitle(cx), TestID: "organization-boundary"}),
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "organization-cancel"),
			ui.Button{Text: locales.DataSave(cx), Busy: busy.Get, OnPress: save, TestID: "organization-save"},
		}, "organization-dialog"),
	}}
}

func (s *Session) siteDialog(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	open := core.NewSignal(cx, false)
	zh := core.NewSignal(cx, "")
	en := core.NewSignal(cx, "")
	address := core.NewSignal(cx, "")
	country := core.NewSignal(cx, "CN")
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	show := func() {
		zh.Set("")
		en.Set("")
		address.Set("")
		country.Set("CN")
		status.Set("")
		open.Set(true)
	}
	save := func() {
		if s.organization == nil {
			return
		}
		busy.Set(true)
		_, err := s.db.CreateSite(context.Background(), store.SiteInput{
			OrganizationID: s.organization.ID, NameZH: zh.Get(), NameEN: en.Get(),
			Address: address.Get(), CountryCode: country.Get(),
		})
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		open.Set(false)
		_ = dataRefresh(s, dataRev)
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.DataAddSite(cx), Variant: ui.ButtonSecondary, OnPress: show, TestID: "site-add"},
		dataDialog(cx, open, locales.DataNewSite(cx), []core.Node{
			dataField(cx, locales.OnboardingStepSiteNameZh(cx),
				ui.Input{Value: zh.Get, OnChange: zh.Set, TestID: "site-zh"}),
			dataField(cx, locales.OnboardingStepSiteNameEn(cx),
				ui.Input{Value: en.Get, OnChange: en.Set, TestID: "site-en"}),
			dataField(cx, locales.OnboardingStepSiteAddress(cx),
				ui.Input{Value: address.Get, OnChange: address.Set, TestID: "site-address"}),
			dataField(cx, locales.OnboardingStepSiteCountry(cx),
				ui.Input{Value: country.Get, OnChange: country.Set, TestID: "site-country"}),
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "site-cancel"),
			ui.Button{Text: locales.DataCreate(cx), Busy: busy.Get, OnPress: save, TestID: "site-save"},
		}, "site-dialog"),
	}}
}

func (s *Session) periodDialog(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	open := core.NewSignal(cx, false)
	year := core.NewSignal(cx, strconv.Itoa(time.Now().Year()))
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	show := func() {
		year.Set(strconv.Itoa(time.Now().Year()))
		status.Set("")
		open.Set(true)
	}
	save := func() {
		if s.organization == nil {
			return
		}
		y, err := strconv.Atoi(strings.TrimSpace(year.Get()))
		if err != nil {
			status.Set(locales.DataRequired(cx))
			return
		}
		busy.Set(true)
		_, err = s.db.CreatePeriod(context.Background(), store.PeriodInput{
			OrganizationID: s.organization.ID, Year: y,
		})
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		open.Set(false)
		_ = dataRefresh(s, dataRev)
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.DataAddPeriod(cx), Variant: ui.ButtonSecondary, OnPress: show, TestID: "period-add"},
		dataDialog(cx, open, locales.DataNewPeriod(cx), []core.Node{
			dataField(cx, locales.OnboardingStepYearTitle(cx),
				ui.Input{Value: year.Get, OnChange: year.Set, TestID: "period-year"}),
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "period-cancel"),
			ui.Button{Text: locales.DataCreate(cx), Busy: busy.Get, OnPress: save, TestID: "period-save"},
		}, "period-dialog"),
	}}
}

// sourcesScreen lists emission sources and opens the source editor.
func (s *Session) sourcesScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	if s.organization == nil {
		return s.onboardingScreen(cx, dataRev)
	}
	search := core.NewSignal(cx, "")
	scope := core.NewSignal(cx, 0)
	category := core.NewSignal(cx, "")
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
				_ = dataRev.Get()
				return s.sourcesBody(cx, dataRev, search, scope, category)
			}), s.efLibraryBody(cx, dataRev)},
		}},
	}
}

func (s *Session) sourcesBody(cx *core.Scope, dataRev *core.Signal[int],
	search *core.Signal[string], scope *core.Signal[int], category *core.Signal[string]) core.Node {
	lang := i18n.Language(cx)
	categoryKey := func(src store.EmissionSource) string {
		if src.GHGProtocolPath != "" {
			if _, ok := categories.ByCode(src.GHGProtocolPath); ok {
				return src.GHGProtocolPath
			}
		}
		return src.Category
	}
	categoryName := func(key string) string {
		if category, ok := categories.ByCode(key); ok {
			return category.Label(lang)
		}
		return categories.LegacyLabel(lang, key)
	}
	query := strings.ToLower(strings.TrimSpace(search.Get()))
	selectedScope := scope.Get()
	selectedCategory := category.Get()
	searched := make([]store.EmissionSource, 0, len(s.sources))
	for _, src := range s.sources {
		if query != "" {
			haystack := strings.ToLower(strings.Join([]string{src.Name, src.SiteName, src.Category,
				src.GHGProtocolPath, src.TemplateOrigin, categoryName(categoryKey(src))}, "\x1f"))
			if !strings.Contains(haystack, query) {
				continue
			}
		}
		searched = append(searched, src)
	}
	var scopeCounts [4]int
	for _, src := range searched {
		scopeCounts[0]++
		if src.Scope >= 1 && src.Scope <= 3 {
			scopeCounts[src.Scope]++
		}
	}
	scoped := make([]store.EmissionSource, 0, len(searched))
	for _, src := range searched {
		if selectedScope != 0 && src.Scope != selectedScope {
			continue
		}
		scoped = append(scoped, src)
	}
	categoryLabels := map[string]string{}
	categoryCounts := map[string]int{}
	var categoryOrder []string
	for _, src := range scoped {
		key := categoryKey(src)
		if key == "" {
			continue
		}
		categoryCounts[key]++
		if _, ok := categoryLabels[key]; !ok {
			categoryLabels[key] = categoryName(key)
			categoryOrder = append(categoryOrder, key)
		}
	}
	if selectedCategory != "" && categoryCounts[selectedCategory] == 0 {
		for _, src := range s.sources {
			if categoryKey(src) == selectedCategory {
				categoryLabels[selectedCategory] = categoryName(selectedCategory)
				categoryOrder = append([]string{selectedCategory}, categoryOrder...)
				break
			}
		}
	}
	visible := make([]store.EmissionSource, 0, len(scoped))
	for _, src := range scoped {
		if selectedCategory != "" && categoryKey(src) != selectedCategory {
			continue
		}
		visible = append(visible, src)
	}
	filtersActive := func() bool {
		return strings.TrimSpace(search.Get()) != "" || scope.Get() != 0 || category.Get() != ""
	}
	clearFilters := func() {
		search.Set("")
		scope.Set(0)
		category.Set("")
	}

	var rows []core.Node
	for i := range visible {
		src := visible[i]
		stats := locales.SourcesStatsUnused(cx)
		if src.ActivityCount > 0 {
			stats = locales.SourcesStatsActivityCount(cx, strconv.Itoa(src.ActivityCount)) + " · " +
				locales.SourcesStatsTotal(cx, commaFloat(src.TotalCO2eKg))
			if src.LastActivityAt != "" {
				last := src.LastActivityAt
				if len(last) >= 10 {
					last = last[:10]
				}
				stats += " · " + locales.SourcesStatsLast(cx, last)
			}
		}
		categoryLabel := categoryName(categoryKey(src))
		meta := src.SiteName
		for _, part := range []string{categoryLabel, stats} {
			if part != "" {
				meta += " · " + part
			}
		}
		nameRow := []core.Node{
			core.Text{Content: src.Name, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold,
				FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
			ui.Badge{Text: dataScopeLabel(cx, src.Scope), Variant: ui.BadgeNeutral},
		}
		if !src.IsActive {
			nameRow = append(nameRow, ui.Badge{Text: locales.SourcesInactiveChip(cx),
				Variant: ui.BadgeNeutral})
		}
		texts := []core.Node{
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6},
				Children: nameRow},
			core.Text{Content: meta,
				Style:     core.Style{FontSize: 11, FlexShrink: 1, MinWidth: core.Pt(0)},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
		}
		if preset, ok := presets.ByID(src.TemplateOrigin); ok {
			origin := strings.Join([]string{preset.Source, preset.Region, strconv.Itoa(preset.Year)}, " · ")
			texts = append(texts, core.Text{Content: locales.SourcesFromCatalog(cx, origin),
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint), MaxLines: 1})
		}
		rows = append(rows, core.View{
			TestID: "source-row-" + src.ID,
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.Symmetric(9, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				ui.Icon(lucide.Factory, 15, ui.ColorsOf(cx).Muted),
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: texts},
				s.sourceDialog(cx, &visible[i], dataRev, "source-edit-"+src.ID),
			},
		})
	}

	header := []core.Node{
		dataHeading(cx, locales.DataSources(cx), locales.DataSourcesCount(cx, strconv.Itoa(len(s.sources)))),
		core.View{Style: core.Style{FlexGrow: 1}},
	}
	pendingCatalog := s.pendingSourceCatalog
	s.pendingSourceCatalog = false
	if len(s.sites) == 0 {
		header = append(header, core.Text{Content: locales.SourcesCatalogNoSite(cx), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	} else {
		catalog, showCatalog := s.sourceCatalogDialogWithShow(cx, dataRev)
		if pendingCatalog {
			s.scope.Post(showCatalog)
		}
		header = append(header, catalog)
		header = append(header, s.sourceDialog(cx, nil, dataRev, "source-add"))
	}

	scopeLabel := func(value int) string {
		switch value {
		case 1:
			return locales.SourcesCatalogScope1Short(cx)
		case 2:
			return locales.SourcesCatalogScope2Short(cx)
		case 3:
			return locales.SourcesCatalogScope3Short(cx)
		}
		return locales.SourcesCatalogScopeAll(cx)
	}
	scopeOptions := make([]ui.Option[int], 0, 4)
	for _, value := range []int{0, 1, 2, 3} {
		value := value
		label := scopeLabel(value)
		scopeOptions = append(scopeOptions, ui.Option[int]{
			Value: value, Label: label, TestID: "sources-scope-" + strconv.Itoa(value),
			Content: core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6},
				Children: []core.Node{
					core.Text{Content: label, Style: core.Style{FontSize: 12}},
					ui.Badge{Text: strconv.Itoa(scopeCounts[value])},
				}},
		})
	}
	categoryOptions := []ui.Option[string]{
		{Value: "", Label: locales.SourcesCatalogCategoryAll(cx), TestID: "sources-category-all"},
	}
	for _, key := range categoryOrder {
		categoryOptions = append(categoryOptions, ui.Option[string]{
			Value: key, Label: categoryLabels[key] + " (" + strconv.Itoa(categoryCounts[key]) + ")",
			TestID: "sources-category-" + key,
		})
	}

	filterNode := core.View{Style: core.Style{Gap: 8}, Children: []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Wrap: core.Wrap, Gap: 8},
			Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(180)},
					Children: []core.Node{
						ui.Input{Value: search.Get, Placeholder: locales.SourcesSearchPlaceholder(cx),
							OnChange: search.Set, TestID: "sources-search", Role: core.RoleSearchField,
							LabelFunc: func() string { return locales.SourcesSearchPlaceholder(cx) }},
					}},
				ui.Select[string]{Options: categoryOptions, Value: category.Get, OnChange: category.Set,
					Label: locales.SourcesFormCategory(cx), TestID: "sources-category-filter", Searchable: true,
					SearchPlaceholder: locales.SourcesFormCategorySearch(cx),
					Empty:             locales.SourcesFormCategoryEmpty(cx),
					Style:             core.Style{Width: core.Pt(220)}},
				core.Show{When: filtersActive, Then: func(*core.Scope) core.Node {
					return ui.Button{Text: locales.SourcesFilterClear(cx), Variant: ui.ButtonGhost,
						OnPress: clearFilters, TestID: "sources-filter-clear"}
				}},
			}},
		ui.Tabs[int]{Options: scopeOptions, Value: scope.Get, Size: ui.SizeSmall,
			Label: locales.SourcesFormScope(cx), OnChange: func(value int) {
				category.Set("")
				scope.Set(value)
			}, TestID: "sources-scope-filter"},
	}}

	children := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: header},
	}
	switch {
	case len(s.sources) == 0:
		children = append(children, core.View{Style: core.Style{Padding: core.All(24), Gap: 6,
			AlignItems: core.AlignCenter}, Children: []core.Node{
			core.Text{Content: locales.SourcesEmptyTitle(cx), Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
			core.Text{Content: locales.SourcesEmptyBody(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
		}})
	case len(visible) == 0:
		children = append(children, filterNode, core.View{Style: core.Style{Padding: core.All(24), Gap: 8,
			AlignItems: core.AlignCenter}, Children: []core.Node{
			core.Text{Content: locales.SourcesFilterEmpty(cx), Style: core.Style{FontSize: 13},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
			ui.Button{Text: locales.SourcesFilterClear(cx), Variant: ui.ButtonGhost,
				OnPress: clearFilters, TestID: "sources-filter-empty-clear"},
		}})
	default:
		children = append(children, filterNode, core.View{Style: core.Style{Gap: 0}, Children: rows})
	}
	return dataCard(cx, children...)
}

// sourceDialog returns an add/edit trigger and its dialog. A nil src creates a
// source; a non-nil src edits it in place.
func (s *Session) sourceDialog(cx *core.Scope, src *store.EmissionSource, dataRev *core.Signal[int], testID string) core.Node {
	open := core.NewSignal(cx, false)
	name := core.NewSignal(cx, "")
	siteID := core.NewSignal(cx, "")
	scope := core.NewSignal(cx, 1)
	categoryCode := core.NewSignal(cx, "")
	customCategory := core.NewSignal(cx, false)
	category := core.NewSignal(cx, "")
	path := core.NewSignal(cx, "")
	active := core.NewSignal(cx, true)
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	editingID := core.NewSignal(cx, "")
	show := func() {
		editingID.Set("")
		name.Set("")
		scope.Set(1)
		categoryCode.Set("")
		customCategory.Set(false)
		category.Set("")
		path.Set("")
		active.Set(true)
		if len(s.sites) > 0 {
			siteID.Set(s.sites[0].ID)
		} else {
			siteID.Set("")
		}
		if src != nil {
			editingID.Set(src.ID)
			name.Set(src.Name)
			siteID.Set(src.SiteID)
			scope.Set(src.Scope)
			category.Set(src.Category)
			path.Set(src.GHGProtocolPath)
			if _, ok := categories.ByCode(src.GHGProtocolPath); ok {
				categoryCode.Set(src.GHGProtocolPath)
			} else if src.GHGProtocolPath != "" || src.Category != "" {
				customCategory.Set(true)
			}
			active.Set(src.IsActive)
		}
		status.Set("")
		open.Set(true)
	}
	save := func() {
		if siteID.Get() == "" {
			status.Set(locales.SourcesCatalogNoSite(cx))
			return
		}
		sourceCategory, sourcePath := sourceCategoryValues(categoryCode, category, path, customCategory)
		busy.Set(true)
		var err error
		if editingID.Get() == "" {
			var created *store.EmissionSource
			created, err = s.db.CreateSource(context.Background(), store.SourceInput{
				SiteID: siteID.Get(), Name: name.Get(), Scope: scope.Get(), Category: sourceCategory,
				GHGProtocolPath: sourcePath,
			})
			if err == nil {
				s.recordSourceCreate(created, dataRev)
			}
		} else {
			before := store.EmissionSource{}
			if src != nil {
				before = *src
			}
			err = s.db.UpdateSource(context.Background(), editingID.Get(), store.SourcePatch{
				Name: name.Get(), Scope: scope.Get(), Category: sourceCategory,
				GHGProtocolPath: sourcePath, IsActive: active.Get(),
			})
			if err == nil {
				after := before
				after.Name = name.Get()
				after.Scope = scope.Get()
				after.Category = sourceCategory
				after.GHGProtocolPath = sourcePath
				after.IsActive = active.Get()
				s.recordSourceUpdate(before, after, dataRev)
			}
		}
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		open.Set(false)
		_ = dataRefresh(s, dataRev)
	}
	siteOptions := make([]ui.Option[string], 0, len(s.sites))
	for _, site := range s.sites {
		siteOptions = append(siteOptions, ui.Option[string]{Value: site.ID, Label: dataSiteName(site)})
	}
	label := locales.DataAddSource
	title := locales.DataNewSource
	if src != nil {
		label = locales.DataEditSource
		title = locales.DataEditSource
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: label(cx), Variant: ui.ButtonSecondary, OnPress: show, TestID: testID},
		dataDialog(cx, open, title(cx), []core.Node{
			dataField(cx, locales.SourcesFormName(cx),
				ui.Input{Value: name.Get, OnChange: name.Set, TestID: testID + "-name"}),
			dataField(cx, locales.SourcesFormSite(cx),
				ui.Select[string]{Options: siteOptions, Value: siteID.Get, OnChange: siteID.Set,
					Label: locales.SourcesFormSite(cx), TestID: testID + "-site"}),
			dataField(cx, locales.SourcesFormScope(cx),
				ui.Select[int]{Options: dataScopeOptions(cx), Value: scope.Get, OnChange: scope.Set,
					Label: locales.SourcesFormScope(cx), TestID: testID + "-scope"}),
			sourceCategoryFields(cx, testID, scope, categoryCode, category, path, customCategory),
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
				ui.Switch{Checked: active.Get, OnChange: active.Set, Label: locales.SourceEditActiveLabel(cx),
					TestID: testID + "-active"},
				core.Text{Content: locales.SourceEditActiveLabel(cx), Style: core.Style{FontSize: 13}},
			}},
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, testID+"-cancel"),
			ui.Button{Text: locales.DataSave(cx), Busy: busy.Get, OnPress: save, TestID: testID + "-save"},
		}, testID+"-dialog"),
	}}
}

// activityDialog returns the activity form trigger and dialog. It loads EF
// candidates from the selected source's scope and category.
func (s *Session) activityDialog(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	node, _ := s.activityDialogWithShow(cx, dataRev)
	return node
}

func (s *Session) activityDialogWithShow(cx *core.Scope,
	dataRev *core.Signal[int]) (core.Node, func()) {
	trigger, dialog, show := s.activityDialogPartsWithShow(cx, dataRev)
	return core.View{Children: []core.Node{trigger, dialog}}, show
}

// activityDialogPartsWithShow separates the trigger from the dialog so a
// screen can hide the toolbar button while keeping the dialog mounted for an
// empty-state action.
func (s *Session) activityDialogPartsWithShow(cx *core.Scope,
	dataRev *core.Signal[int]) (core.Node, core.Node, func()) {
	return s.activityFormDialogPartsWithShow(cx, dataRev, func() *store.Activity { return nil },
		locales.DataAddActivity, locales.DataCreate, "activity-add", "activity", nil)
}

func (s *Session) editActivityDialog(cx *core.Scope, selectedID *core.Signal[string],
	dataRev *core.Signal[int]) core.Node {
	node, _ := s.editableActivityDialog(cx, selectedID, dataRev)
	return node
}

// editableActivityDialog also returns the form's open function, so a list row
// can select itself and open the same editor without duplicating the dialog.
func (s *Session) editableActivityDialog(cx *core.Scope, selectedID *core.Signal[string],
	dataRev *core.Signal[int]) (core.Node, func()) {
	form := s.newActivityForm(cx, dataRev, func() *store.Activity {
		return s.activityByID(selectedID.Get())
	}, nil, locales.DataEditActivity, locales.DataSave, "activity-edit", nil, false)
	form.guide = newGuidance(cx, s, "ef-rebind")
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.DataEditActivity(cx), Variant: ui.ButtonSecondary, OnPress: form.show,
			Disabled: func() bool { return selectedID.Get() == "" }, TestID: "activity-edit"},
		form.dialog,
	}}, form.show
}

// activityPrefill is a one-shot seed for a new activity, used when confirming
// an extraction. The ids bind the row to its provenance and evidence.
type activityPrefill struct {
	SourceID           string
	PeriodID           string
	Start              string
	End                string
	Amount             float64
	Unit               string
	FuelCode           string
	Notes              string
	ExtractionID       string
	EvidenceDocumentID string
	// Routing feeds the distance lookup: a freight or travel stage plus the
	// two endpoints the document stated. Travel mode only affects the lookup
	// mode (air / rail / road).
	RoutingStage       string
	RoutingOrigin      string
	RoutingDestination string
	TravelMode         string
}

// activityForm is a form dialog that the caller can open without a trigger.
type activityForm struct {
	open   *core.Signal[bool]
	show   func()
	dialog core.Node
	// applySeed fills the open form from an extraction, as the dropzone does.
	applySeed func(*activityPrefill)
	// guide is the rebind tour; only the edit dialog sets it.
	guide *guidance
}

func (s *Session) activityFormDialogWithShow(cx *core.Scope, dataRev *core.Signal[int],
	initial func() *store.Activity, triggerLabel func(*core.Scope) string,
	saveLabel func(*core.Scope) string, triggerID string, prefix string,
	disabled func() bool) (core.Node, func()) {
	trigger, dialog, show := s.activityFormDialogPartsWithShow(cx, dataRev, initial,
		triggerLabel, saveLabel, triggerID, prefix, disabled)
	return core.View{Children: []core.Node{trigger, dialog}}, show
}

func (s *Session) activityFormDialogPartsWithShow(cx *core.Scope, dataRev *core.Signal[int],
	initial func() *store.Activity, triggerLabel func(*core.Scope) string,
	saveLabel func(*core.Scope) string, triggerID string, prefix string,
	disabled func() bool) (core.Node, core.Node, func()) {
	form := s.newActivityForm(cx, dataRev, initial, nil, triggerLabel, saveLabel, prefix, nil,
		initial() == nil)
	trigger := ui.Button{Text: triggerLabel(cx), Variant: ui.ButtonSecondary, OnPress: form.show,
		Disabled: disabled, TestID: triggerID}
	return trigger, form.dialog, form.show
}

// newActivityForm builds the form and returns its open handle so a screen can
// present it from another dialog. prefill, when non-nil, seeds a new row;
// onSaved replaces the default data refresh. withDropzone adds the 1.x
// upload-and-extract affordance to a plain add form.
func (s *Session) newActivityForm(cx *core.Scope, dataRev *core.Signal[int],
	initial func() *store.Activity, prefill func() *activityPrefill,
	title func(*core.Scope) string, saveLabel func(*core.Scope) string,
	prefix string, onSaved func(), withDropzone bool) *activityForm {
	open := core.NewSignal(cx, false)
	sourceID := core.NewSignal(cx, "")
	periodID := core.NewSignal(cx, "")
	start := core.NewSignal(cx, "")
	end := core.NewSignal(cx, "")
	amount := core.NewSignal(cx, "")
	unit := core.NewSignal(cx, "")
	fuel := core.NewSignal(cx, "")
	notes := core.NewSignal(cx, "")
	efKey := core.NewSignal(cx, "")
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	efOptions := core.NewSignalFunc(cx, []store.EmissionFactor(nil), nil)
	recs := core.NewSignalFunc(cx, []efmatch.Recommendation(nil), nil)
	recBusy := core.NewSignal(cx, false)
	recStatus := core.NewSignal(cx, "")
	recKey := core.NewSignal(cx, "")
	routingOrigin := core.NewSignal(cx, "")
	routingDestination := core.NewSignal(cx, "")
	routingStage := core.NewSignal(cx, "")
	travelMode := core.NewSignal(cx, "")
	routingResult := core.NewSignal(cx, "")
	routingFailed := core.NewSignal(cx, false)
	routingBusy := core.NewSignal(cx, false)

	loadEFs := func(source string) {
		efOptions.Set(nil)
		efKey.Set("")
		for _, src := range s.sources {
			if src.ID != source {
				continue
			}
			factors, err := s.db.ListEmissionFactors(context.Background(), store.EFFilter{
				Scope: src.Scope, Category: src.Category, Limit: 500,
			})
			if err != nil {
				status.Set(err.Error())
				return
			}
			current := initial()
			if current != nil {
				want := dataEFKeyFromActivity(*current)
				found := false
				for i := range factors {
					if dataEFKey(factors[i]) == want {
						found = true
						break
					}
				}
				if !found {
					ef, err := s.db.EmissionFactorByKey(context.Background(), store.EmissionFactorKey{
						FactorCode: current.EFFactorCode, Year: current.EFYear, Source: current.EFSource,
						Geography: current.EFGeography, DatasetVersion: current.EFDatasetVersion,
					})
					if err == nil && ef != nil {
						factors = append(factors, *ef)
					}
				}
				efOptions.Set(factors)
				efKey.Set(want)
				return
			}
			efOptions.Set(factors)
			if len(factors) > 0 {
				efKey.Set(dataEFKey(factors[0]))
			}
			return
		}
	}
	loadRecs := func(seed *activityPrefill) {
		if seed == nil || seed.ExtractionID == "" {
			recs.Set(nil)
			recStatus.Set("")
			recKey.Set("")
			recBusy.Set(false)
			return
		}
		source := s.sourceByID(seed.SourceID)
		provider := s.llmProvider(cx)
		if source == nil || !provider.Configured() {
			recs.Set(nil)
			recStatus.Set("")
			recKey.Set("")
			return
		}
		key := seed.ExtractionID + "\x1f" + seed.SourceID
		if recKey.Get() == key {
			return
		}
		recs.Set(nil)
		recStatus.Set("")
		recKey.Set(key)
		recBusy.Set(true)
		language := i18n.Language(cx)
		go func() {
			service := &efmatch.Service{Store: s.db, Provider: provider, Language: language,
				NewClient: newExtractor}
			result, err := service.Recommend(context.Background(), seed.ExtractionID, *source)
			s.scope.Post(func() {
				if recKey.Get() != key {
					return
				}
				recBusy.Set(false)
				if err != nil {
					recStatus.Set(locales.ActivitiesRecommendFailed(cx))
					return
				}
				recs.Set(result.Recommended)
				if len(result.Recommended) == 0 {
					recStatus.Set(locales.ActivitiesRecommendEmpty(cx))
				}
			})
		}()
	}
	var dropped *activityPrefill
	seedFn := prefill
	if seedFn == nil {
		seedFn = func() *activityPrefill { return dropped }
	}
	applySeed := func(seed *activityPrefill) {
		if seed == nil {
			return
		}
		sourceID.Set(seed.SourceID)
		periodID.Set(seed.PeriodID)
		start.Set(seed.Start)
		end.Set(seed.End)
		amount.Set(strconv.FormatFloat(seed.Amount, 'f', -1, 64))
		unit.Set(seed.Unit)
		fuel.Set(seed.FuelCode)
		notes.Set(seed.Notes)
		routingOrigin.Set(seed.RoutingOrigin)
		routingDestination.Set(seed.RoutingDestination)
		routingStage.Set(seed.RoutingStage)
		travelMode.Set(seed.TravelMode)
		routingResult.Set("")
		routingFailed.Set(false)
		loadEFs(seed.SourceID)
		loadRecs(seed)
		open.Set(true)
	}
	show := func() {
		status.Set("")
		recs.Set(nil)
		recStatus.Set("")
		recBusy.Set(false)
		recKey.Set("")
		current := initial()
		if current != nil {
			sourceID.Set(current.EmissionSourceID)
			periodID.Set(current.ReportingPeriodID)
			start.Set(current.OccurredAt)
			end.Set(current.OccurredAtEnd)
			amount.Set(strconv.FormatFloat(current.Amount, 'f', -1, 64))
			unit.Set(current.Unit)
			fuel.Set(current.FuelCode)
			notes.Set(current.Notes)
			routingOrigin.Set("")
			routingDestination.Set("")
			routingStage.Set("")
			travelMode.Set("")
			routingResult.Set("")
			routingFailed.Set(false)
			loadEFs(current.EmissionSourceID)
			open.Set(true)
			return
		}
		if prefill != nil {
			if seed := prefill(); seed != nil {
				applySeed(seed)
				return
			}
		}
		sourceID.Set("")
		for _, src := range s.sources {
			if src.IsActive {
				sourceID.Set(src.ID)
				break
			}
		}
		period := dataYearPeriod(s.periods)
		periodID.Set("")
		start.Set("")
		end.Set("")
		if period != nil {
			periodID.Set(period.ID)
			start.Set(fmt.Sprintf("%04d-01-01", period.Year))
			end.Set(fmt.Sprintf("%04d-12-31", period.Year))
		}
		amount.Set("")
		unit.Set("")
		fuel.Set("")
		notes.Set("")
		routingOrigin.Set("")
		routingDestination.Set("")
		routingStage.Set("")
		travelMode.Set("")
		routingResult.Set("")
		routingFailed.Set(false)
		loadEFs(sourceID.Get())
		open.Set(true)
	}
	save := func() {
		if sourceID.Get() == "" || periodID.Get() == "" {
			status.Set(locales.DataRequired(cx))
			return
		}
		value, err := strconv.ParseFloat(strings.TrimSpace(amount.Get()), 64)
		if err != nil || value <= 0 {
			status.Set(locales.DataRequired(cx))
			return
		}
		var selected *store.EmissionFactor
		for i := range efOptions.Get() {
			if dataEFKey(efOptions.Get()[i]) == efKey.Get() {
				selected = &efOptions.Get()[i]
				break
			}
		}
		if selected == nil {
			status.Set(locales.ActivitiesFormEfNone(cx))
			return
		}
		busy.Set(true)
		input := store.ActivityInput{
			EmissionSourceID: sourceID.Get(), ReportingPeriodID: periodID.Get(),
			OccurredAtStart: start.Get(), OccurredAtEnd: end.Get(), Amount: value, Unit: unit.Get(),
			EF: store.EmissionFactorKey{
				FactorCode: selected.FactorCode, Year: selected.Year, Source: selected.Source,
				Geography: selected.Geography, DatasetVersion: selected.DatasetVersion,
			},
			FuelCode: fuel.Get(), Notes: notes.Get(),
		}
		current := initial()
		var before *store.Activity
		if current != nil {
			copied := *current
			before = &copied
		}
		var extractionBefore *store.Extraction
		if current == nil {
			seed := seedFn()
			if seed != nil {
				input.ExtractionID = seed.ExtractionID
				input.EvidenceDocumentID = seed.EvidenceDocumentID
			}
			if seed != nil && seed.ExtractionID != "" {
				extractionBefore, _ = s.db.ExtractionByID(context.Background(), seed.ExtractionID)
				var created *store.Activity
				created, err = s.db.CreateActivityFromExtraction(context.Background(), input)
				if err == nil {
					s.recordActivityCreate(created, extractionBefore, onSaved, dataRev)
				}
			} else {
				var created *store.Activity
				created, err = s.db.CreateActivity(context.Background(), input)
				if err == nil {
					s.recordActivityCreate(created, nil, onSaved, dataRev)
				}
			}
		} else {
			input.ExtractionID = current.ExtractionID
			var updated *store.Activity
			updated, err = s.db.UpdateActivity(context.Background(), current.ID, input)
			if err == nil {
				s.recordActivityUpdate(before, updated, onSaved, dataRev)
			}
		}
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		open.Set(false)
		if onSaved != nil {
			onSaved()
			return
		}
		_ = dataRefresh(s, dataRev)
	}

	sourceOptions := make([]ui.Option[string], 0, len(s.sources))
	for _, src := range s.sources {
		if src.IsActive {
			sourceOptions = append(sourceOptions, ui.Option[string]{Value: src.ID,
				Label: src.Name + " · " + dataScopeLabel(cx, src.Scope)})
		}
	}
	periodOptions := make([]ui.Option[string], 0, len(s.periods))
	for _, period := range s.periods {
		if period.IsActive {
			periodOptions = append(periodOptions, ui.Option[string]{Value: period.ID,
				Label: strconv.Itoa(period.Year)})
		}
	}
	efSelect := func(cx *core.Scope) core.Node {
		options := make([]ui.Option[string], 0, len(efOptions.Get()))
		for _, ef := range efOptions.Get() {
			options = append(options, ui.Option[string]{Value: dataEFKey(ef),
				Label: dataEFLabel(ef)})
		}
		if len(options) == 0 {
			return core.Text{Content: locales.ActivitiesFormEfNone(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		}
		return ui.Select[string]{Options: options, Value: efKey.Get, OnChange: efKey.Set,
			Label: locales.ActivitiesFormEf(cx), TestID: prefix + "-ef", Searchable: true,
			SearchPlaceholder: locales.ActivitiesSearchPlaceholder(cx)}
	}
	selectRec := func(ef store.EmissionFactor) {
		key := dataEFKey(ef)
		found := false
		for _, item := range efOptions.Get() {
			if dataEFKey(item) == key {
				found = true
				break
			}
		}
		if !found {
			next := append(append([]store.EmissionFactor(nil), efOptions.Get()...), ef)
			efOptions.Set(next)
		}
		efKey.Set(key)
	}
	recommendations := core.Dynamic(func(cx *core.Scope) core.Node {
		list := recs.Get()
		if !recBusy.Get() && len(list) == 0 && recStatus.Get() == "" {
			return core.View{}
		}
		children := []core.Node{
			core.Text{Content: locales.ActivitiesRecommendHeading(cx),
				Style: core.Style{FontSize: 12, FontWeight: ui.Semibold}},
		}
		if recBusy.Get() {
			children = append(children, core.Text{Content: locales.ActivitiesRecommendLoading(cx),
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2})
		}
		if recStatus.Get() != "" {
			children = append(children, core.Text{Content: recStatus.Get(),
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
		}
		for i := range list {
			index := i
			item := list[i]
			name := item.EF.NameEN
			if name == "" {
				name = item.EF.NameZH
			}
			if name == "" {
				name = item.EF.FactorCode
			}
			children = append(children, core.View{
				Role: core.RoleButton,
				OnPress: func(core.PressEvent) {
					selectRec(item.EF)
				},
				TestID: fmt.Sprintf("%s-ef-recommend-%d", prefix, index),
				Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 8,
					Padding: core.All(8), CornerRadius: 6},
				StyleFunc: func() core.Style {
					return core.Style{Background: ui.ColorsOf(cx).Raised()}
				},
				Children: []core.Node{
					ui.Icon(lucide.Star, 13, ui.ColorsOf(cx).Accent),
					core.View{Style: core.Style{Gap: 2, FlexGrow: 1}, Children: []core.Node{
						core.Text{Content: name + " · " + commaFloat(item.EF.CO2eKgPerUnit) + " kgCO2e/" +
							item.EF.InputUnit, Style: core.Style{FontSize: 12}, MaxLines: 1},
						core.Text{Content: item.Reasoning, Style: core.Style{FontSize: 11},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
					}},
				},
			})
		}
		return core.View{Style: core.Style{Gap: 6, Padding: core.All(10), CornerRadius: 8,
			BorderWidth: 1}, StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Inset(),
				BorderColor: ui.ColorsOf(cx).Accent()}
		}, Children: children}
	})

	dropzone := core.Node(core.View{})
	if withDropzone {
		dropStatus := core.NewSignal(cx, "")
		dropFailed := core.NewSignal(cx, false)
		dropBusy := core.NewSignal(cx, false)
		dropHover := core.NewSignal(cx, false)
		runFile := func(file core.File) {
			if dropBusy.Get() {
				return
			}
			if !strings.HasSuffix(strings.ToLower(file.Name), ".pdf") {
				dropFailed.Set(true)
				dropStatus.Set(locales.ActivitiesDropPdfOnly(cx))
				return
			}
			provider := s.llmProvider(cx)
			if !provider.Configured() {
				dropFailed.Set(true)
				dropStatus.Set(locales.DocumentsExtractionNotConfigured(cx))
				return
			}
			dropBusy.Set(true)
			dropFailed.Set(false)
			dropStatus.Set(locales.ActivitiesDropWorking(cx))
			go func() {
				document, err := s.saveUploadedDocument(file)
				var row *store.Extraction
				if err == nil {
					service := &extraction.Service{Store: s.db, DataDir: s.dataDir,
						Provider: provider, NewClient: newExtractor}
					row, _, err = service.ClassifyAndRun(context.Background(), document.ID)
				}
				s.scope.Post(func() {
					dropBusy.Set(false)
					if document != nil {
						_ = dataRefresh(s, dataRev)
					}
					if err != nil {
						dropFailed.Set(true)
						dropStatus.Set(extractionErrorText(cx, err))
						return
					}
					seed := s.extractionPrefill(*document, row)
					if seed == nil {
						dropFailed.Set(true)
						dropStatus.Set(locales.ActivitiesDropUnsupported(cx))
						return
					}
					dropped = seed
					applySeed(seed)
					dropFailed.Set(false)
					dropStatus.Set(locales.ActivitiesDropDone(cx, document.Filename))
				})
			}()
		}
		pick := func() {
			cx.PickFiles(core.PickFilesOptions{
				Types:  []string{".pdf"},
				Title:  locales.ActivitiesDropPick(cx),
				Button: locales.ActivitiesDropPick(cx),
			}, func(files []core.File, err error) {
				if err != nil {
					dropFailed.Set(true)
					dropStatus.Set(err.Error())
					return
				}
				if len(files) == 0 {
					return
				}
				runFile(files[0])
			})
		}
		dropzone = core.View{
			TestID: "activity-dropzone",
			OnFileDrop: func(uris []string) {
				if len(uris) == 0 {
					return
				}
				file, err := core.FileFromURL(uris[0])
				if err != nil {
					dropFailed.Set(true)
					dropStatus.Set(err.Error())
					return
				}
				runFile(file)
			},
			OnFileDragEnter: func() { dropHover.Set(true) },
			OnFileDragLeave: func() { dropHover.Set(false) },
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.All(12), CornerRadius: 8, BorderWidth: 1, BorderStyle: core.BorderDashed},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				style := core.Style{Background: colors.Inset(), BorderColor: colors.Border()}
				if dropHover.Get() {
					style.BorderColor = colors.Accent()
				}
				return style
			},
			Children: []core.Node{
				ui.Icon(lucide.CloudUpload, 16, ui.ColorsOf(cx).Muted),
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1}, Children: []core.Node{
					core.Text{ContentFunc: func() string { return locales.ActivitiesDropHint(cx) },
						Style: core.Style{FontSize: 12}},
					core.Show{When: func() bool { return dropStatus.Get() != "" },
						Then: func(cx *core.Scope) core.Node {
							return core.Text{ContentFunc: func() string { return dropStatus.Get() },
								Style: core.Style{FontSize: 11}, MaxLines: 2, StyleFunc: func() core.Style {
									if dropFailed.Get() {
										return ui.Colored(ui.ColorsOf(cx).Danger)()
									}
									return ui.Colored(ui.ColorsOf(cx).Muted)()
								}}
						}},
				}},
				ui.Button{Text: locales.ActivitiesDropPick(cx), Variant: ui.ButtonSecondary,
					Busy: dropBusy.Get, OnPress: pick, TestID: "activity-drop-pick"},
			},
		}
	}

	form := &activityForm{open: open, show: show, applySeed: applySeed}
	form.dialog = dataDialog(cx, open, title(cx), []core.Node{
		core.Dynamic(func(cx *core.Scope) core.Node {
			if form.guide == nil {
				return core.View{}
			}
			return form.guide.node(s, func() bool { return true })
		}),
		dropzone,
		dataField(cx, locales.ActivitiesFormSource(cx),
			ui.Select[string]{Options: sourceOptions, Value: sourceID.Get,
				OnChange:    func(v string) { sourceID.Set(v); loadEFs(v) },
				Placeholder: locales.ActivitiesFormSourcePlaceholder(cx),
				Label:       locales.ActivitiesFormSource(cx), TestID: prefix + "-source"}),
		dataField(cx, locales.ActivitiesFormPeriod(cx),
			ui.Select[string]{Options: periodOptions, Value: periodID.Get, OnChange: periodID.Set,
				Placeholder: locales.ActivitiesFormPeriodPlaceholder(cx),
				Label:       locales.ActivitiesFormPeriod(cx), TestID: prefix + "-period"}),
		core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{dataField(cx,
				locales.ActivitiesFormOccurredStart(cx),
				ui.Input{Value: start.Get, OnChange: start.Set, TestID: prefix + "-start"})}},
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{dataField(cx,
				locales.ActivitiesFormOccurredEnd(cx),
				ui.Input{Value: end.Get, OnChange: end.Set, TestID: prefix + "-end"})}},
		}},
		core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{dataField(cx,
				locales.ActivitiesFormAmount(cx),
				ui.Input{Value: amount.Get, OnChange: amount.Set, TestID: prefix + "-amount"})}},
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{dataField(cx,
				locales.ActivitiesFormUnit(cx),
				ui.Input{Value: unit.Get, OnChange: unit.Set,
					Placeholder: locales.ActivitiesFormUnitPlaceholder(cx), TestID: prefix + "-unit"})}},
		}},
		core.Show{When: func() bool {
			return routingStage.Get() != "" && routingOrigin.Get() != "" && routingDestination.Get() != ""
		}, Then: func(cx *core.Scope) core.Node {
			return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
				Children: []core.Node{
					ui.Button{Text: locales.RoutingLookupButton(cx), Variant: ui.ButtonSecondary,
						Busy: routingBusy.Get, OnPress: func() {
							if routingBusy.Get() {
								return
							}
							mode := routing.InferMode(routingStage.Get(), travelMode.Get())
							origin, destination := routingOrigin.Get(), routingDestination.Get()
							routingBusy.Set(true)
							routingFailed.Set(false)
							routingResult.Set(locales.RoutingLookupRunning(cx))
							go func() {
								result, err := routing.Lookup(context.Background(), s.db, mode,
									origin, destination)
								s.scope.Post(func() {
									routingBusy.Set(false)
									if err != nil {
										routingFailed.Set(true)
										routingResult.Set(routingErrorMessage(cx, err))
										return
									}
									km := strconv.Itoa(result.DistanceKM)
									if result.Source == routing.SourceHaversine {
										routingResult.Set(locales.RoutingLookupDoneHaversine(cx, km))
									} else {
										routingResult.Set(locales.RoutingLookupDoneAmap(cx, km))
									}
									if routingStage.Get() == "travel" {
										amount.Set(km)
									}
								})
							}()
						}, TestID: prefix + "-routing-lookup"},
					core.Show{When: func() bool { return routingResult.Get() != "" },
						Then: func(cx *core.Scope) core.Node {
							return core.Text{ContentFunc: func() string { return routingResult.Get() },
								Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
									if routingFailed.Get() {
										return ui.Colored(ui.ColorsOf(cx).Danger)()
									}
									return ui.Colored(ui.ColorsOf(cx).Muted)()
								}}
						}},
				}}
		}},
		recommendations,
		core.Dynamic(efSelect),
		core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{dataField(cx,
				locales.ActivitiesFormFuel(cx),
				ui.Input{Value: fuel.Get, OnChange: fuel.Set,
					Placeholder: locales.ActivitiesFormFuelNone(cx), TestID: prefix + "-fuel"})}},
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{dataField(cx,
				locales.ActivitiesFormNotes(cx),
				ui.Input{Value: notes.Get, OnChange: notes.Set, TestID: prefix + "-notes"})}},
		}},
		core.Text{Content: locales.ActivitiesFormFuelHint(cx), Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		dataError(cx, status),
	}, []core.Node{
		dataCancelButton(cx, open, prefix+"-cancel"),
		ui.Button{Text: saveLabel(cx), Busy: busy.Get, OnPress: save, TestID: prefix + "-save"},
	}, prefix+"-dialog")
	return form
}

// routingErrorMessage maps a routing failure onto the localized message shown
// beside the lookup button.
func routingErrorMessage(cx *core.Scope, err error) string {
	var detail *routing.Error
	if errors.As(err, &detail) {
		switch detail.Kind {
		case routing.KindKeyMissing:
			return locales.RoutingErrorKeyMissing(cx)
		case routing.KindRateLimited:
			return locales.RoutingErrorRateLimited(cx)
		case routing.KindRouteNotFound:
			return locales.RoutingErrorRouteNotFound(cx)
		case routing.KindAirportUnknown:
			return locales.RoutingErrorAirportUnknown(cx, detail.Airport)
		}
	}
	return locales.RoutingErrorApi(cx)
}

func (s *Session) activityByID(id string) *store.Activity {
	if id == "" {
		return nil
	}
	for i := range s.activities {
		if s.activities[i].ID == id {
			return &s.activities[i]
		}
	}
	return nil
}

func (s *Session) sourceByID(id string) *store.EmissionSource {
	if id == "" {
		return nil
	}
	for i := range s.sources {
		if s.sources[i].ID == id {
			return &s.sources[i]
		}
	}
	return nil
}

func (s *Session) deleteActivityButton(cx *core.Scope, selectedID *core.Signal[string],
	dataRev *core.Signal[int]) core.Node {
	open := core.NewSignal(cx, false)
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	confirm := func() {
		if selectedID.Get() == "" {
			return
		}
		id := selectedID.Get()
		row := s.activityByID(id)
		if row == nil {
			return
		}
		snapshot := *row
		evidence, _ := s.db.ListEvidence(context.Background(),
			store.EvidenceTarget{ActivityDataID: id})
		busy.Set(true)
		err := s.db.DeleteActivity(context.Background(), id)
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
		s.pushUndoAction("activity.delete",
			func(ctx context.Context) error {
				if err := s.db.RestoreActivity(ctx, snapshot, evidence); err != nil {
					return err
				}
				_ = dataRefresh(s, dataRev)
				return nil
			},
			func(ctx context.Context) error {
				if err := s.db.DeleteActivity(ctx, snapshot.ID); err != nil {
					return err
				}
				_ = dataRefresh(s, dataRev)
				return nil
			})
		open.Set(false)
		selectedID.Set("")
		_ = dataRefresh(s, dataRev)
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.DataDeleteActivity(cx), Variant: ui.ButtonSecondary,
			Disabled: func() bool { return selectedID.Get() == "" },
			OnPress:  func() { status.Set(""); open.Set(true) }, TestID: "activity-delete"},
		dataDialog(cx, open, locales.DataDeleteActivityTitle(cx), []core.Node{
			core.Text{Content: locales.DataDeleteActivityBody(cx), Style: core.Style{FontSize: 13},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "activity-delete-cancel"),
			ui.Button{Text: locales.DataDeleteActivity(cx), Busy: busy.Get, OnPress: confirm,
				TestID: "activity-delete-confirm"},
		}, "activity-delete-dialog"),
	}}
}

func dataEFKey(ef store.EmissionFactor) string {
	return fmt.Sprintf("%s\x1f%d\x1f%s\x1f%s\x1f%s", ef.FactorCode, ef.Year, ef.Source, ef.Geography, ef.DatasetVersion)
}

func dataEFKeyFromActivity(a store.Activity) string {
	return dataEFKey(store.EmissionFactor{
		FactorCode: a.EFFactorCode, Year: a.EFYear, Source: a.EFSource,
		Geography: a.EFGeography, DatasetVersion: a.EFDatasetVersion,
	})
}

func dataEFLabel(ef store.EmissionFactor) string {
	name := ef.NameEN
	if name == "" {
		name = ef.NameZH
	}
	return fmt.Sprintf("%s · %s · %s", name, ef.InputUnit, ef.FactorCode)
}

// auditScreen lists the append-only audit trail. Payloads are formatted for
// reading but never interpreted as instructions; the store already keeps
// free-text notes out of them.
func (s *Session) auditScreen(cx *core.Scope, dataRev *core.Signal[int],
	openActivity func(string)) core.Node {
	if s.organization == nil {
		return s.onboardingScreen(cx, dataRev)
	}
	kind := core.NewSignal(cx, "")
	since := core.NewSignal(cx, "")
	until := core.NewSignal(cx, "")
	limit := core.NewSignal(cx, 100)
	status := core.NewSignal(cx, "")
	oldestFirst := core.NewSignal(cx, false)
	rawRev := core.NewSignal(cx, 0)
	rawOpen := map[string]bool{}
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
				_ = dataRev.Get()
				_ = rawRev.Get()
				return s.auditBody(cx, kind, since, until, limit, status, oldestFirst,
					rawOpen, rawRev, openActivity)
			})},
		}},
	}
}

func (s *Session) auditBody(cx *core.Scope, kind *core.Signal[string], since *core.Signal[string],
	until *core.Signal[string], limit *core.Signal[int], status *core.Signal[string],
	oldestFirst *core.Signal[bool], rawOpen map[string]bool, rawRev *core.Signal[int],
	openActivity func(string)) core.Node {
	page := limit.Get()
	datesOK := auditDatesOK(since.Get(), until.Get())
	var events []store.AuditEvent
	var err error
	if datesOK {
		events, err = s.db.QueryAuditEvents(context.Background(), store.AuditQuery{
			Kind: kind.Get(), Since: since.Get(), Until: until.Get(), Limit: page,
		})
	}
	if oldestFirst.Get() {
		for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
			events[i], events[j] = events[j], events[i]
		}
	}
	rows := make([]core.Node, 0, len(events)+1)
	if err != nil {
		rows = append(rows, core.Text{Content: err.Error(), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	}
	for _, event := range events {
		children := []core.Node{s.auditEventBody(cx, event, rawOpen, rawRev, openActivity)}
		rows = append(rows, core.View{
			Style: core.Style{Gap: 4, Padding: core.Symmetric(9, 0),
				Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children:  children,
		})
	}
	if len(events) == 0 && err == nil && datesOK {
		rows = append(rows, core.View{Style: core.Style{Padding: core.All(24), Gap: 6, AlignItems: core.AlignCenter},
			Children: []core.Node{
				core.Text{Content: locales.AuditEmptyStateHeading(cx),
					Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
				core.Text{Content: locales.AuditEmptyStateBody(cx), Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
			}})
	}
	kindOptions := []ui.Option[string]{{Value: "", Label: locales.AuditFilterAllKinds(cx)}}
	for _, value := range []string{"activity_data.created", "activity_data.updated",
		"activity_rebind_ef", "activity_data.deleted", "evidence.attached", "evidence.removed"} {
		kindOptions = append(kindOptions, ui.Option[string]{Value: value, Label: dataAuditKind(cx, value)})
	}
	resetFilters := func() {
		kind.Set("")
		since.Set("")
		until.Set("")
		limit.Set(100)
		oldestFirst.Set(false)
		status.Set("")
	}
	export := func() {
		if !auditDatesOK(since.Get(), until.Get()) {
			status.Set(locales.AuditFilterInvalidDate(cx))
			return
		}
		exported, err := s.db.QueryAuditEvents(context.Background(), store.AuditQuery{
			Kind: kind.Get(), Since: since.Get(), Until: until.Get(), Limit: 10_000,
		})
		if err != nil {
			status.Set(locales.AuditExportCsvFailed(cx))
			return
		}
		data, err := auditCSV(exported)
		if err != nil {
			status.Set(locales.AuditExportCsvFailed(cx))
			return
		}
		cx.SaveFile(core.SaveOptions{Name: "carbonink-audit.csv", MIME: "text/csv", Data: data},
			func(saved bool, _ string, err error) {
				if err != nil {
					status.Set(locales.AuditExportCsvFailed(cx))
					return
				}
				if saved {
					status.Set(locales.AuditExportCsvSuccess(cx, strconv.Itoa(len(exported))))
				}
			})
	}
	filters := core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignEnd, Gap: 8,
		Wrap: core.Wrap}, Children: []core.Node{
		core.View{Style: core.Style{Width: core.Pt(200)}, Children: []core.Node{
			dataField(cx, locales.AuditFilterEventKindLabel(cx),
				ui.Select[string]{Options: kindOptions, Value: kind.Get,
					OnChange: func(v string) { kind.Set(v); limit.Set(100) },
					Label:    locales.AuditFilterEventKindLabel(cx), TestID: "audit-kind"}),
		}},
		core.View{Style: core.Style{Width: core.Pt(130)}, Children: []core.Node{
			dataField(cx, locales.AuditFilterSinceLabel(cx),
				ui.Input{Value: since.Get, OnChange: func(v string) { since.Set(v); limit.Set(100) },
					Placeholder: "YYYY-MM-DD", TestID: "audit-since"}),
		}},
		core.View{Style: core.Style{Width: core.Pt(130)}, Children: []core.Node{
			dataField(cx, locales.AuditFilterUntilLabel(cx),
				ui.Input{Value: until.Get, OnChange: func(v string) { until.Set(v); limit.Set(100) },
					Placeholder: "YYYY-MM-DD", TestID: "audit-until"}),
		}},
		core.Show{When: func() bool { return !oldestFirst.Get() },
			Then: func(cx *core.Scope) core.Node {
				return ui.Button{Text: locales.AuditSortRecent(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { oldestFirst.Set(true) }, TestID: "audit-sort"}
			},
			Else: func(cx *core.Scope) core.Node {
				return ui.Button{Text: locales.AuditSortOldest(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { oldestFirst.Set(false) }, TestID: "audit-sort"}
			}},
		ui.Button{Text: locales.AuditFilterResetButton(cx), Variant: ui.ButtonSecondary,
			OnPress: resetFilters, TestID: "audit-reset"},
		ui.Button{Text: locales.AuditExportCsvButton(cx), Variant: ui.ButtonSecondary,
			OnPress: export, TestID: "audit-export"},
	}}
	children := []core.Node{
		dataHeading(cx, locales.AuditHeading(cx), locales.AuditSubheading(cx)),
		filters,
	}
	if !datesOK {
		children = append(children, core.Text{Content: locales.AuditFilterInvalidDate(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	} else if status.Get() != "" {
		children = append(children, core.Text{Content: status.Get(), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	children = append(children, core.View{Style: core.Style{Gap: 0}, Children: rows})
	if datesOK && len(events) == page && page < 10_000 {
		children = append(children, ui.Button{Text: locales.AuditLoadOlderButton(cx),
			Variant: ui.ButtonSecondary, TestID: "audit-older",
			OnPress: func() { limit.Set(page + 100) }})
	}
	return dataCard(cx,
		children...,
	)
}

func auditDatesOK(since, until string) bool {
	for _, value := range []string{since, until} {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", value); err != nil {
			return false
		}
	}
	return true
}

// auditEventBody renders one audit row. Rebind events get a structured card;
// every other kind keeps the pretty-printed payload visible.
func (s *Session) auditEventBody(cx *core.Scope, event store.AuditEvent,
	rawOpen map[string]bool, rawRev *core.Signal[int], openActivity func(string)) core.Node {
	header := core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
		Children: []core.Node{
			ui.Badge{Text: dataAuditKind(cx, event.Kind), Variant: ui.BadgeNeutral},
			core.Text{Content: event.OccurredAt, Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
		}}
	payload := dataAuditPayload(event.Payload)
	if event.Kind != "activity_rebind_ef" {
		children := []core.Node{header}
		if payload != "" {
			children = append(children, core.Text{Content: payload,
				Style:     core.Style{FontSize: 11, FontFamily: core.FontMonospace},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 12})
		}
		return core.View{Style: core.Style{Gap: 4}, Children: children}
	}

	var rebind auditRebindPayload
	if err := json.Unmarshal([]byte(event.Payload), &rebind); err != nil || rebind.ActivityID == "" {
		return core.View{Style: core.Style{Gap: 4}, Children: []core.Node{
			header,
			core.Text{Content: locales.AuditMalformedPayload(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)},
			core.Text{Content: payload, Style: core.Style{FontSize: 11, FontFamily: core.FontMonospace},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 12},
		}}
	}

	short := rebind.ActivityID
	if len(short) > 8 {
		short = short[:8]
	}
	delta := rebind.NewCO2e - rebind.OldCO2e
	percent := 0.0
	if rebind.OldCO2e != 0 {
		percent = delta / rebind.OldCO2e * 100
	}
	toggle := func() {
		rawOpen[event.ID] = !rawOpen[event.ID]
		rawRev.Set(rawRev.Get() + 1)
	}
	details := []core.Node{
		header,
		ui.Button{Text: locales.AuditRebindActivityLabel(cx) + " #" + short,
			Variant: ui.ButtonSecondary, TestID: "audit-rebind-activity-" + event.ID,
			OnPress: func() { openActivity(rebind.ActivityID) }},
		core.Text{Content: s.auditEFName(rebind.OldEF) + " → " +
			s.auditEFName(rebind.NewEF), Style: core.Style{FontSize: 12, FontWeight: ui.Semibold}},
		core.Text{Content: locales.AuditRebindDelta(cx, auditNumber(rebind.OldCO2e),
			auditNumber(rebind.NewCO2e), auditSigned(delta), auditSigned(percent)),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.Show{When: func() bool { return rawOpen[event.ID] },
			Then: func(cx *core.Scope) core.Node {
				return ui.Button{Text: locales.AuditHideRaw(cx), Variant: ui.ButtonSecondary,
					TestID: "audit-raw-" + event.ID, OnPress: toggle}
			},
			Else: func(cx *core.Scope) core.Node {
				return ui.Button{Text: locales.AuditShowRaw(cx), Variant: ui.ButtonSecondary,
					TestID: "audit-raw-" + event.ID, OnPress: toggle}
			}},
	}
	if rawOpen[event.ID] {
		details = append(details, core.Text{Content: payload,
			Style:     core.Style{FontSize: 11, FontFamily: core.FontMonospace},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 12})
	}
	return core.View{
		TestID: "audit-rebind-" + event.ID,
		Style:  core.Style{Gap: 6, Padding: core.All(10), CornerRadius: 8, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Inset(), BorderColor: ui.ColorsOf(cx).Line()}
		},
		Children: details,
	}
}

// auditRebindPayload mirrors the JSON written by the activity update path.
type auditRebindPayload struct {
	ActivityID string     `json:"activity_id"`
	OldEF      auditEFRef `json:"old_ef"`
	NewEF      auditEFRef `json:"new_ef"`
	OldCO2e    float64    `json:"old_computed_co2e_kg"`
	NewCO2e    float64    `json:"new_computed_co2e_kg"`
}

type auditEFRef struct {
	FactorCode     string `json:"factor_code"`
	Year           int    `json:"year"`
	Source         string `json:"source"`
	Geography      string `json:"geography"`
	DatasetVersion string `json:"dataset_version"`
}

func (r auditEFRef) key() store.EmissionFactorKey {
	return store.EmissionFactorKey{
		FactorCode: r.FactorCode, Year: r.Year, Source: r.Source,
		Geography: r.Geography, DatasetVersion: r.DatasetVersion,
	}
}

// auditEFName resolves a composite key to the user-facing factor name.
func (s *Session) auditEFName(ref auditEFRef) string {
	name := ref.FactorCode
	if ef, err := s.db.EmissionFactorByKey(context.Background(), ref.key()); err == nil && ef != nil {
		switch {
		case ef.NameZH != "":
			name = ef.NameZH
		case ef.NameEN != "":
			name = ef.NameEN
		case ef.FactorCode != "":
			name = ef.FactorCode
		}
	}
	return fmt.Sprintf("%s (%d)", name, ref.Year)
}

// auditNumber formats a CO2e value with at most one decimal, grouped.
func auditNumber(v float64) string {
	s := commaFloat(v)
	s = strings.TrimSuffix(s, "0")
	s = strings.TrimSuffix(s, "0")
	return strings.TrimSuffix(s, ".")
}

// auditSigned formats a delta with an explicit sign, grouped.
func auditSigned(v float64) string {
	sign := "+"
	if v < 0 {
		sign = "-"
		v = -v
	}
	return sign + auditNumber(v)
}

func auditCSV(events []store.AuditEvent) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	if err := writer.Write([]string{"occurred_at", "event_kind", "payload"}); err != nil {
		return nil, err
	}
	for _, event := range events {
		if err := writer.Write([]string{event.OccurredAt, event.Kind, event.Payload}); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	return buf.Bytes(), writer.Error()
}

func dataAuditKind(cx *core.Scope, kind string) string {
	switch kind {
	case "activity_data.created":
		return locales.AuditEventKindActivityDataCreated(cx)
	case "activity_data.updated":
		return locales.AuditEventKindActivityDataUpdated(cx)
	case "activity_data.deleted":
		return locales.AuditEventKindActivityDataDeleted(cx)
	case "activity_rebind_ef":
		return locales.AuditEventKindActivityRebindEf(cx)
	case "evidence.attached":
		return locales.AuditEventKindEvidenceAttached(cx)
	case "evidence.removed":
		return locales.AuditEventKindEvidenceRemoved(cx)
	default:
		return locales.AuditUnknownEventKind(cx, kind)
	}
}

// dataAuditPayload pretty-prints a stored JSON payload and caps its length so
// one large event cannot push the rest of the log off screen.
func dataAuditPayload(payload string) string {
	trimmed := strings.TrimSpace(payload)
	if trimmed == "" {
		return ""
	}
	var value any
	if err := json.Unmarshal([]byte(trimmed), &value); err != nil {
		return dataTruncate(trimmed, 700)
	}
	pretty, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return dataTruncate(trimmed, 700)
	}
	return dataTruncate(string(pretty), 700)
}

func dataTruncate(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}
