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
	return core.View{
		Style:     core.Style{Gap: 12, Padding: core.All(16), AlignSelf: core.AlignStretch},
		StyleFunc: cardSurface(cx),
		Children:  children,
	}
}

// dataCardFlat groups settings content the way 1.x did: controls sit
// directly on the page, separated by headings and space rather than a card
// border. Screens that read as a dashboard still use dataCard.
func dataCardFlat(cx *core.Scope, children ...core.Node) core.Node {
	return core.View{
		Style:    core.Style{Gap: 16, AlignSelf: core.AlignStretch},
		Children: children,
	}
}

func dataHeading(cx *core.Scope, title string, detail string) core.Node {
	children := []core.Node{core.Text{Content: title, Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}}}
	if detail != "" {
		children = append(children, core.Text{Content: detail, Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	return core.View{Style: core.Style{Gap: 2, FlexShrink: 1, MinWidth: core.Pt(0)}, Children: children}
}

// dataHeaderRow places a card's heading beside its actions, and stacks them
// when the window is too narrow for both.
func dataHeaderRow(cx *core.Scope, heading core.Node, actions ...core.Node) core.Node {
	children := []core.Node{core.View{
		Style:    core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
		Children: []core.Node{heading},
	}}
	if len(actions) > 0 {
		children = append(children, core.View{
			Style:    core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Wrap: core.Wrap, Gap: 8},
			Children: actions,
		})
	}
	return core.View{
		StyleFunc: func() core.Style {
			if cx.Env().Window().Width < 900 {
				return core.Style{Gap: 10}
			}
			return core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}
		},
		Children: children,
	}
}

// dataColumns places fields side by side, and stacks them when the window
// is too narrow for two readable columns.
func dataColumns(cx *core.Scope, gap core.Points, children ...core.Node) core.Node {
	columns := make([]core.Node, 0, len(children))
	for _, child := range children {
		columns = append(columns, core.View{
			StyleFunc: func() core.Style {
				if cx.Env().Window().Width < 900 {
					return core.Style{}
				}
				return core.Style{FlexGrow: 1, FlexShrink: 1, FlexBasis: core.Pt(0), MinWidth: core.Pt(0)}
			},
			Children: []core.Node{child},
		})
	}
	return core.View{
		StyleFunc: func() core.Style {
			if cx.Env().Window().Width < 900 {
				return core.Style{Gap: gap}
			}
			return core.Style{Direction: core.Row, Gap: gap}
		},
		Children: columns,
	}
}

// dataEmptyState is the centered title, explanation and optional next step
// a list or card shows before it has content.
func dataEmptyState(cx *core.Scope, title, body string, actions ...core.Node) core.Node {
	children := []core.Node{
		core.Text{Content: title, Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
	}
	if body != "" {
		children = append(children, core.Text{Content: body,
			Style:     core.Style{FontSize: 12, TextAlign: core.TextAlignCenter},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	if len(actions) > 0 {
		children = append(children, core.View{
			Style:    core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Wrap: core.Wrap, Gap: 8, Padding: core.Edges{Top: 6}},
			Children: actions,
		})
	}
	return core.View{Style: core.Style{Padding: core.All(24), Gap: 6,
		AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter},
		Children: children}
}

// countPhrase picks singular wording when n is one, since the catalogs
// have no plural forms.
func countPhrase(n int, one, many func() string) string {
	if n == 1 {
		return one()
	}
	return many()
}

// dataField stacks a label over a control. A submit function makes a text
// field submit the form on Return.
func dataField(cx *core.Scope, label string, input core.Node, onSubmit ...func()) core.Node {
	if len(onSubmit) > 0 {
		input = dataEnterToSubmit(input, onSubmit[0])
	}
	return core.View{Style: core.Style{Gap: 4}, Children: []core.Node{
		core.Text{Content: label, Style: core.Style{FontSize: 12, FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		namedNode(input, func() string { return label }),
	}}
}

// dataEnterToSubmit makes Return in a text field run the dialog's default
// action instead of blurring the field.
func dataEnterToSubmit(input core.Node, submit func()) core.Node {
	if submit == nil {
		return input
	}
	in, ok := input.(ui.Input)
	if !ok {
		return input
	}
	in.OnSubmit = func(string) { submit() }
	in.SubmitBehavior = core.SubmitBehaviorSubmit
	return in
}

func dataError(cx *core.Scope, message *core.Signal[string]) core.Node {
	return core.Show{When: func() bool { return message.Get() != "" },
		Then: func(cx *core.Scope) core.Node {
			return core.Text{ContentFunc: func() string { return message.Get() },
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		}}
}

func dataDialog(cx *core.Scope, open *core.Signal[bool], title string, children []core.Node,
	footer []core.Node, testID string, onConfirm ...func()) core.Node {
	return dataDialogSized(cx, open, title, children, footer, testID, 520, onConfirm...)
}

func dataDialogSized(cx *core.Scope, open *core.Signal[bool], title string, children []core.Node,
	footer []core.Node, testID string, width core.Points, onConfirm ...func()) core.Node {
	var confirm func()
	if len(onConfirm) > 0 {
		confirm = onConfirm[0]
	}
	return ui.Dialog{
		Open: open.Get,
		OnOpenChange: func(v bool, _ base.Reason) {
			open.Set(v)
		},
		Title: title,
		// The popup is capped to the window. Keeping the form in its own
		// scroll view lets the title and footer stay put while it scrolls.
		Children: []core.Node{core.Scroll{
			Style:    core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
			Children: children,
		}},
		Footer:    footer,
		OnConfirm: confirm,
		TestID:    testID,
		Style:     core.Style{Width: core.Pt(width)},
	}
}

// dataPath shows a filesystem path as a code block, so the eye can tell it
// apart from the prose that explains it.
func dataPath(cx *core.Scope, label, value string) core.Node {
	return core.View{Style: core.Style{Gap: 3}, Children: []core.Node{
		core.Text{Content: label, Style: core.Style{FontSize: 11, FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.View{
			Style: core.Style{Padding: core.Symmetric(6, 8), CornerRadius: 6, BorderWidth: 1},
			StyleFunc: func() core.Style {
				return core.Style{Background: ui.ColorsOf(cx).Inset(),
					BorderColor: ui.ColorsOf(cx).Line()}
			},
			Children: []core.Node{core.Text{Content: value,
				Style:     core.Style{FontSize: 11, FontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}},
		},
	}}
}

// dataFormSection groups related onboarding fields under a numbered heading.
func dataFormSection(cx *core.Scope, step, title, body string, children ...core.Node) core.Node {
	heading := []core.Node{
		core.Text{Content: step, Style: core.Style{FontSize: 10, FontWeight: ui.Bold,
			FontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
		core.Text{Content: title, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
	}
	head := []core.Node{core.View{Style: core.Style{Direction: core.Row,
		AlignItems: core.AlignCenter, Gap: 8}, Children: heading}}
	if body != "" {
		head = append(head, core.Text{Content: body, Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
	}
	return core.View{Style: core.Style{Gap: 10, Padding: core.Edges{Top: 12},
		Borders: core.Edges{Top: 1}, BorderColor: ui.ColorsOf(cx).Line()},
		Children: append(head, children...)}
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
				return appSelect[string]{
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
					Style:  core.Style{Width: core.Pct(100)},
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
	nav *screenNav) core.Node {
	if s.organization == nil {
		return s.onboardingScreen(cx, dataRev)
	}
	return appPage(core.Dynamic(func(cx *core.Scope) core.Node {
		_ = dataRev.Get()
		return s.dashboardBody(cx, dataRev, nav)
	}))
}

func (s *Session) dashboardBody(cx *core.Scope, dataRev *core.Signal[int],
	nav *screenNav) core.Node {
	unit := locales.UnitKgCo2e(cx)
	co2e := func(testID, label string, value float64) core.Node {
		return core.View{TestID: testID,
			Style: core.Style{FlexGrow: 1, FlexBasis: core.Pt(0), MinWidth: core.Pt(150),
				Padding: core.All(20), CornerRadius: 8, BorderWidth: 1},
			StyleFunc: func() core.Style {
				return core.Style{Background: ui.ColorsOf(cx).Surface(),
					BorderColor: ui.ColorsOf(cx).Line()}
			},
			Children: []core.Node{
				core.Text{Content: label, Style: core.Style{FontSize: 12, FontWeight: ui.Medium,
					TextTransform: core.TextTransformUppercase, LetterSpacingEm: 0.025},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.Text{Content: commaFloat(value),
					Style: core.Style{FontSize: 24, FontWeight: ui.Semibold,
						Margin: core.Edges{Top: 8}}},
				core.Text{Content: unit, Style: core.Style{FontSize: 12,
					Margin: core.Edges{Top: 2}},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}}
	}

	return core.View{Style: core.Style{Gap: 24}, Children: []core.Node{
		pageHeading(cx, locales.DashboardInventoryTitle),
		core.View{TestID: "dashboard-totals", Style: core.Style{Direction: core.Row,
			Wrap: core.Wrap, AlignItems: core.AlignStretch, Gap: 16}, Children: []core.Node{
			co2e("dashboard-total", locales.DashboardTotalCo2e(cx), s.totals.TotalKg),
			co2e("dashboard-scope1", locales.DashboardScope1(cx), s.totals.Scope1Kg),
			co2e("dashboard-scope2", locales.DashboardScope2(cx), s.totals.Scope2Kg),
			co2e("dashboard-scope3", locales.DashboardScope3(cx), s.totals.Scope3Kg),
		}},
		s.gettingStartedCard(cx, nav),
		s.dashboardWidgets(cx, nav),
		s.readinessHomeCard(cx, nav),
	}}
}

// gettingStartedCard is the zero-state path from an empty inventory to a
// report. It mirrors the dependency chain — source, activity, report — and
// reads live state, so the only button is the next unfinished step.
func (s *Session) gettingStartedCard(cx *core.Scope, nav *screenNav) core.Node {
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
		var marker core.Node
		if step.done {
			marker = core.View{Style: core.Style{Width: core.Pt(20), Height: core.Pt(20),
				CornerRadius: 10, AlignItems: core.AlignCenter,
				JustifyContent: core.JustifyCenter, FlexShrink: 0},
				StyleFunc: func() core.Style {
					return core.Style{Background: ui.Alpha(colors.Accent(), 0.10)}
				},
				Children: []core.Node{ui.Icon(lucide.Check, 12, colors.Accent)}}
		} else if i == current {
			marker = core.View{Style: core.Style{Width: core.Pt(20), Height: core.Pt(20),
				CornerRadius: 10, AlignItems: core.AlignCenter,
				JustifyContent: core.JustifyCenter, FlexShrink: 0},
				StyleFunc: func() core.Style {
					return core.Style{Background: colors.Accent()}
				},
				Children: []core.Node{core.Text{Content: strconv.Itoa(i + 1),
					Style: core.Style{FontSize: 11, FontWeight: ui.Semibold},
					StyleFunc: func() core.Style {
						return core.Style{Color: colors.OnAccent()}
					}}}}
		} else {
			marker = core.View{Style: core.Style{Width: core.Pt(20), Height: core.Pt(20),
				CornerRadius: 10, AlignItems: core.AlignCenter,
				JustifyContent: core.JustifyCenter, FlexShrink: 0, BorderWidth: 1},
				StyleFunc: func() core.Style {
					return core.Style{BorderColor: colors.Border()}
				},
				Children: []core.Node{core.Text{Content: strconv.Itoa(i + 1),
					Style:     core.Style{FontSize: 11, FontWeight: ui.Medium},
					StyleFunc: ui.Colored(colors.Muted)}}}
		}
		titleStyle := core.Style{FontSize: 14, FontWeight: ui.Medium}
		if step.done {
			titleStyle = core.Style{FontSize: 14}
		}
		title := core.Text{Content: step.title(cx), Style: titleStyle, StyleFunc: func() core.Style {
			if step.done {
				return ui.Colored(colors.Muted)()
			}
			return core.Style{}
		}}
		text := []core.Node{title}
		if i == current {
			text = append(text,
				core.Text{Content: step.body(cx), Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(colors.Muted), MaxLines: 3})
		}
		rowChildren := []core.Node{marker, core.View{Style: core.Style{Gap: 6,
			FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, Children: text}}
		if i == current {
			rowChildren = append(rowChildren,
				ui.Button{Text: step.cta(cx), Size: ui.SizeSmall, OnPress: func() {
					switch step.key {
					case "sources":
						s.pendingSourceCatalog = true
					case "activities":
						s.pendingNewActivity = true
					}
					nav.Set(step.screen)
				}, TestID: "dashboard-start-" + step.key,
					Style: core.Style{FlexShrink: 0}})
		}
		borders := core.Edges{}
		if i < len(steps)-1 {
			borders.Bottom = 1
		}
		rows = append(rows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 12,
				Padding: core.Symmetric(12, 0),
				Borders: borders},
			StyleFunc: func() core.Style { return core.Style{BorderColor: colors.Line()} },
			Children:  rowChildren,
		})
	}

	return core.View{Style: core.Style{Padding: core.All(24), Gap: 0,
		CornerRadius: 8, BorderWidth: 1, AlignSelf: core.AlignStretch},
		StyleFunc: func() core.Style {
			return core.Style{BorderColor: colors.Line()}
		},
		Children: []core.Node{
			core.Text{Content: locales.DashboardStartTitle(cx),
				Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
			core.Text{Content: locales.DashboardStartSubtitle(cx),
				Style:     core.Style{FontSize: 14, Margin: core.Edges{Top: 4}},
				StyleFunc: ui.Colored(colors.Muted)},
			core.View{Style: core.Style{Gap: 0, Margin: core.Edges{Top: 16}},
				Children: rows},
		}}
}

func dataActiveLabel(cx *core.Scope, active bool) string {
	if active {
		return locales.SourcesTableActive(cx)
	}
	return locales.SourcesInactiveChip(cx)
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
		orgName := strings.TrimSpace(nameZH.Get() + nameEN.Get())
		siteName := strings.TrimSpace(siteZH.Get() + siteEN.Get())
		if orgName == "" || siteName == "" || err != nil || y < 2020 || y > 2030 {
			status.Set(locales.OnboardingRequired(cx))
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

	canFinish := func() bool {
		y, err := strconv.Atoi(strings.TrimSpace(year.Get()))
		return strings.TrimSpace(nameZH.Get()+nameEN.Get()) != "" &&
			strings.TrimSpace(siteZH.Get()+siteEN.Get()) != "" &&
			err == nil && y >= 2020 && y <= 2030
	}
	required := func(label string) string { return label + " *" }

	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, Width: core.Pct(100),
				MaxWidth: core.Pt(680), AlignSelf: core.AlignCenter},
			Children: []core.Node{dataCard(cx,
				core.Text{Content: locales.DataOnboardingTitle(cx), Style: core.Style{FontSize: 20, FontWeight: ui.Bold}},
				core.Text{Content: locales.DataOnboardingBody(cx), Style: core.Style{FontSize: 13},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.Text{Content: locales.OnboardingRequiredNote(cx), Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
				dataFormSection(cx, "01", locales.OnboardingStepCompanyTitle(cx),
					locales.OnboardingStepCompanySubtitle(cx),
					dataColumns(cx, 10,
						dataField(cx, required(locales.OnboardingStepCompanyNameZh(cx)),
							ui.Input{Value: nameZH.Get, OnChange: nameZH.Set, TestID: "onboarding-org-zh"}, submit),
						dataField(cx, locales.OnboardingStepCompanyNameEn(cx),
							ui.Input{Value: nameEN.Get, OnChange: nameEN.Set, TestID: "onboarding-org-en"}, submit)),
					core.Text{Content: locales.OnboardingNameHint(cx), Style: core.Style{FontSize: 11},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
					dataColumns(cx, 10,
						dataField(cx, locales.OnboardingStepCompanyIndustry(cx),
							ui.Input{Value: industry.Get, OnChange: industry.Set,
								Placeholder: locales.OnboardingStepCompanyIndustryPlaceholder(cx),
								TestID:      "onboarding-org-industry"}, submit),
						dataField(cx, locales.OnboardingStepCompanyCountry(cx),
							ui.Input{Value: country.Get, OnChange: country.Set, TestID: "onboarding-org-country"}, submit)),
					dataField(cx, locales.OnboardingStepBoundaryTitle(cx),
						appSelect[string]{Options: dataBoundaryOptions(cx), Value: boundary.Get, OnChange: boundary.Set,
							Label: locales.OnboardingStepBoundaryTitle(cx), TestID: "onboarding-boundary",
							Style: core.Style{Width: core.Pct(100)}})),
				dataFormSection(cx, "02", locales.OnboardingStepSiteTitle(cx),
					locales.OnboardingStepSiteSubtitle(cx),
					dataColumns(cx, 10,
						dataField(cx, required(locales.OnboardingStepSiteNameZh(cx)),
							ui.Input{Value: siteZH.Get, OnChange: siteZH.Set, TestID: "onboarding-site-zh"}, submit),
						dataField(cx, locales.OnboardingStepSiteNameEn(cx),
							ui.Input{Value: siteEN.Get, OnChange: siteEN.Set, TestID: "onboarding-site-en"}, submit)),
					core.Text{Content: locales.OnboardingNameHint(cx), Style: core.Style{FontSize: 11},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
					dataColumns(cx, 10,
						dataField(cx, locales.OnboardingStepSiteAddress(cx),
							ui.Input{Value: siteAddress.Get, OnChange: siteAddress.Set, TestID: "onboarding-site-address"}, submit),
						dataField(cx, locales.OnboardingStepSiteCountry(cx),
							ui.Input{Value: siteCountry.Get, OnChange: siteCountry.Set, TestID: "onboarding-site-country"}, submit))),
				dataFormSection(cx, "03", locales.OnboardingStepYearTitle(cx),
					locales.OnboardingStepYearSubtitle(cx),
					dataField(cx, required(locales.OnboardingStepYearTitle(cx)),
						ui.Input{Value: year.Get, OnChange: year.Set, TestID: "onboarding-year"}, submit)),
				dataError(cx, status),
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Wrap: core.Wrap, Gap: 10},
					Children: []core.Node{
						core.Show{When: func() bool { return !canFinish() }, Then: func(cx *core.Scope) core.Node {
							return core.Text{Content: locales.OnboardingRequired(cx), Style: core.Style{FontSize: 11},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2}
						}},
						core.View{Style: core.Style{FlexGrow: 1}},
						ui.Button{Text: locales.OnboardingFinish(cx), Busy: busy.Get, Disabled: func() bool { return !canFinish() },
							OnPress: submit, TestID: "onboarding-submit"},
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
		if busy.Get() {
			return
		}
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
				ui.Input{Value: zh.Get, OnChange: zh.Set, TestID: "organization-zh"}, save),
			dataField(cx, locales.OnboardingStepCompanyNameEn(cx),
				ui.Input{Value: en.Get, OnChange: en.Set, TestID: "organization-en"}, save),
			dataField(cx, locales.OnboardingStepCompanyIndustry(cx),
				ui.Input{Value: industry.Get, OnChange: industry.Set, TestID: "organization-industry"}, save),
			dataField(cx, locales.OnboardingStepCompanyCountry(cx),
				ui.Input{Value: country.Get, OnChange: country.Set, TestID: "organization-country"}, save),
			dataField(cx, locales.OnboardingStepBoundaryTitle(cx),
				appSelect[string]{Options: dataBoundaryOptions(cx), Value: boundary.Get, OnChange: boundary.Set,
					Label: locales.OnboardingStepBoundaryTitle(cx), TestID: "organization-boundary",
					Style: core.Style{Width: core.Pct(100)}}),
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "organization-cancel"),
			ui.Button{Text: locales.DataSave(cx), Busy: busy.Get, OnPress: save, TestID: "organization-save"},
		}, "organization-dialog", save),
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
		if busy.Get() {
			return
		}
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
				ui.Input{Value: zh.Get, OnChange: zh.Set, TestID: "site-zh"}, save),
			dataField(cx, locales.OnboardingStepSiteNameEn(cx),
				ui.Input{Value: en.Get, OnChange: en.Set, TestID: "site-en"}, save),
			dataField(cx, locales.OnboardingStepSiteAddress(cx),
				ui.Input{Value: address.Get, OnChange: address.Set, TestID: "site-address"}, save),
			dataField(cx, locales.OnboardingStepSiteCountry(cx),
				ui.Input{Value: country.Get, OnChange: country.Set, TestID: "site-country"}, save),
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "site-cancel"),
			ui.Button{Text: locales.DataCreate(cx), Busy: busy.Get, OnPress: save, TestID: "site-save"},
		}, "site-dialog", save),
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
		if busy.Get() {
			return
		}
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
				ui.Input{Value: year.Get, OnChange: year.Set, TestID: "period-year"}, save),
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "period-cancel"),
			ui.Button{Text: locales.DataCreate(cx), Busy: busy.Get, OnPress: save, TestID: "period-save"},
		}, "period-dialog", save),
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
	editDrawer, showEdit := s.sourceEditDrawer(cx, dataRev)
	body := core.Dynamic(func(cx *core.Scope) core.Node {
		_ = dataRev.Get()
		return s.sourcesBody(cx, dataRev, search, scope, category, showEdit)
	})
	return appFixedPage(body, editDrawer)
}

func (s *Session) sourcesBody(cx *core.Scope, dataRev *core.Signal[int],
	search *core.Signal[string], scope *core.Signal[int], category *core.Signal[string],
	showEdit func(string)) core.Node {
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
		unused := src.ActivityCount == 0
		if src.ActivityCount > 0 {
			stats = countPhrase(src.ActivityCount,
				func() string { return locales.SourcesStatsActivityCountOne(cx, strconv.Itoa(src.ActivityCount)) },
				func() string { return locales.SourcesStatsActivityCount(cx, strconv.Itoa(src.ActivityCount)) }) + " · " +
				locales.SourcesStatsTotal(cx, co2eWithUnit(src.TotalCO2eKg))
			if src.LastActivityAt != "" {
				last := src.LastActivityAt
				if len(last) >= 10 {
					last = last[:10]
				}
				stats += " · " + locales.SourcesStatsLast(cx, last)
			}
		}
		categoryLabel := categoryName(categoryKey(src))
		pathLabel := ""
		if src.GHGProtocolPath != "" {
			if _, standard := categories.ByCode(src.GHGProtocolPath); !standard {
				stripped := src.GHGProtocolPath
				if dot := strings.Index(stripped, "."); dot >= 0 {
					stripped = stripped[dot+1:]
				}
				if !strings.EqualFold(strings.ReplaceAll(stripped, " ", "_"),
					strings.ReplaceAll(src.Category, " ", "_")) {
					pathLabel = src.GHGProtocolPath
				}
			}
		}
		nameLine := []core.Node{
			core.Text{Content: src.Name, Style: core.Style{FontSize: 16,
				FontWeight: ui.Medium, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
		}
		if !src.IsActive {
			nameLine = append(nameLine, ui.Badge{Text: locales.SourcesInactiveChip(cx),
				Variant: ui.BadgeNeutral})
		}
		scopeShort := func(scope int) string {
			switch scope {
			case 1:
				return locales.SourcesCatalogScope1Short(cx)
			case 2:
				return locales.SourcesCatalogScope2Short(cx)
			default:
				return locales.SourcesCatalogScope3Short(cx)
			}
		}
		mutedMeta := func(text string) core.Node {
			return core.Text{Content: text, Style: core.Style{FontSize: 12,
				FlexShrink: 1, MinWidth: core.Pt(0)},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1}
		}
		metaLine := []core.Node{
			ui.Badge{Text: scopeShort(src.Scope), Variant: ui.BadgeNeutral},
			mutedMeta("·"),
			mutedMeta(categoryLabel),
		}
		if pathLabel != "" {
			metaLine = append(metaLine, mutedMeta("·"), mutedMeta(pathLabel))
		}
		statsStyle := core.FontStyleNormal
		if unused {
			statsStyle = core.FontStyleItalic
		}
		texts := []core.Node{
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6},
				Children: nameLine},
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Wrap: core.Wrap, Gap: 8}, Children: metaLine},
			core.Text{Content: stats,
				Style: core.Style{FontSize: 12, FlexShrink: 1, MinWidth: core.Pt(0),
					FontStyle: statsStyle},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
		}
		if preset, ok := presets.ByID(src.TemplateOrigin); ok {
			origin := strings.Join([]string{preset.Source, preset.Region, strconv.Itoa(preset.Year)}, " · ")
			texts = append(texts, core.Text{Content: locales.SourcesFromCatalog(cx, origin),
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint), MaxLines: 1})
		}
		id := src.ID
		active := src.IsActive
		rows = append(rows, core.View{
			TestID: "source-row-" + id,
			Role:   core.RoleButton,
			OnPress: func(core.PressEvent) {
				showEdit(id)
			},
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 12,
				Padding: core.Symmetric(12, 16), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				style := core.Style{BorderColor: colors.Line(),
					Hover:        &core.Style{Background: colors.Hover()},
					FocusVisible: ui.FocusRing(cx, -2)}
				if !active {
					style.Opacity = core.Alpha(0.6)
				}
				return style
			},
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 4, FlexGrow: 1, FlexShrink: 1,
					MinWidth: core.Pt(0)}, Children: texts},
			},
		})
	}

	var actions []core.Node
	pendingCatalog := s.pendingSourceCatalog
	s.pendingSourceCatalog = false
	if len(s.sites) == 0 {
		actions = append(actions, core.Text{Content: locales.SourcesCatalogNoSite(cx), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	} else {
		if len(s.sources) > 0 {
			catalog, _ := s.sourceCatalogDialogWithShow(cx, dataRev, pendingCatalog)
			actions = append(actions, catalog)
			actions = append(actions, s.sourceAddDialog(cx, dataRev, "source-add"))
		}
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
	chip := func(value string, label string, count int, testID string) core.Node {
		selected := func() bool { return category.Get() == value }
		return core.View{TestID: testID, Role: core.RoleButton,
			OnPress: func(core.PressEvent) {
				if selected() && value != "" {
					category.Set("")
					return
				}
				category.Set(value)
			},
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6,
				Padding: core.Symmetric(2, 10), CornerRadius: 999,
				BorderWidth: 1, FlexShrink: 0},
			StyleFunc: func() core.Style {
				if selected() {
					return core.Style{Background: selectionTint(cx),
						BorderColor: ui.Alpha(ui.ColorsOf(cx).Text(), 0.30)}
				}
				return core.Style{Background: ui.ColorsOf(cx).Background(),
					BorderColor: ui.ColorsOf(cx).Border()}
			},
			Children: []core.Node{
				core.Text{Content: label, Style: core.Style{FontSize: 12}, MaxLines: 1},
				core.Text{Content: strconv.Itoa(count), Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}}
	}
	chips := []core.Node{chip("", locales.SourcesCatalogCategoryAll(cx), len(scoped),
		"sources-category-all")}
	for _, key := range categoryOrder {
		chips = append(chips, chip(key, categoryLabels[key], categoryCounts[key],
			"sources-category-"+key))
	}

	filterNode := core.View{Style: core.Style{Gap: 12}, Children: []core.Node{
		searchField(cx, search.Get, locales.SourcesSearchPlaceholder(cx), search.Set,
			"sources-search"),
		segmentedControl(cx, func() []segment {
			segments := make([]segment, 0, len(scopeOptions))
			for _, option := range scopeOptions {
				option := option
				segments = append(segments, segment{Value: option.Value,
					Label:  func(cx *core.Scope) string { return option.Label },
					Count:  func() int { return scopeCounts[option.Value] },
					TestID: option.TestID})
			}
			return segments
		}(), scope.Get, func(value int) {
			category.Set("")
			scope.Set(value)
		}, true),
		core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 6},
			Children: chips},
		core.Show{When: filtersActive, Then: func(*core.Scope) core.Node {
			return ui.Button{Text: locales.SourcesFilterClear(cx), Variant: ui.ButtonGhost,
				OnPress: clearFilters, TestID: "sources-filter-clear"}
		}},
	}}

	if len(s.sources) == 0 {
		catalog, _ := s.sourceCatalogDialogWithShow(cx, dataRev, pendingCatalog)
		add := s.sourceAddDialog(cx, dataRev, "source-add")
		empty := core.View{
			Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
				BorderWidth: 1, BorderStyle: core.BorderDashed, CornerRadius: 8,
				Padding: core.All(32), Gap: 12,
				AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter},
			StyleFunc: func() core.Style {
				return core.Style{BorderColor: ui.ColorsOf(cx).Border()}
			},
			Children: []core.Node{
				ui.Icon(lucide.SlidersHorizontal, 44, ui.ColorsOf(cx).Faint),
				core.Text{Content: locales.SourcesEmptyTitle(cx),
					Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
				core.Text{Content: locales.SourcesEmptyBody(cx),
					Style: core.Style{FontSize: 13, MaxWidth: core.Pt(520),
						TextAlign: core.TextAlignCenter},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Gap: 8}, Children: []core.Node{catalog, add}},
			},
		}
		return appFixedPage(pageHeading(cx, locales.NavSources), empty)
	}
	list := core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
		CornerRadius: 8, BorderWidth: 1, Overflow: core.Hidden},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Surface(),
				BorderColor: ui.ColorsOf(cx).Border()}
		},
		Children: []core.Node{core.Scroll{
			Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
			Children: func() []core.Node {
				if len(visible) == 0 {
					return []core.Node{core.View{Style: core.Style{Padding: core.All(24), Gap: 8,
						AlignItems: core.AlignCenter}, Children: []core.Node{
						core.Text{Content: locales.SourcesFilterEmpty(cx), Style: core.Style{FontSize: 13},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
						ui.Button{Text: locales.SourcesFilterClear(cx), Variant: ui.ButtonGhost,
							OnPress: clearFilters, TestID: "sources-filter-empty-clear"},
					}}}
				}
				return rows
			}(),
		}},
	}
	return appFixedPage(pageHeading(cx, locales.NavSources, actions...), filterNode, list)
}

// sourceForm holds the add/edit source draft. One instance backs the add
// drawer; one backs the single edit drawer that every row opens, as 1.x did.
type sourceForm struct {
	open           *core.Signal[bool]
	name           *core.Signal[string]
	siteID         *core.Signal[string]
	scope          *core.Signal[int]
	categoryCode   *core.Signal[string]
	customCategory *core.Signal[bool]
	category       *core.Signal[string]
	path           *core.Signal[string]
	active         *core.Signal[bool]
	status         *core.Signal[string]
	busy           *core.Signal[bool]
	editingID      *core.Signal[string]
}

func newSourceForm(cx *core.Scope) *sourceForm {
	return &sourceForm{
		open:           core.NewSignal(cx, false),
		name:           core.NewSignal(cx, ""),
		siteID:         core.NewSignal(cx, ""),
		scope:          core.NewSignal(cx, 1),
		categoryCode:   core.NewSignal(cx, ""),
		customCategory: core.NewSignal(cx, false),
		category:       core.NewSignal(cx, ""),
		path:           core.NewSignal(cx, ""),
		active:         core.NewSignal(cx, true),
		status:         core.NewSignal(cx, ""),
		busy:           core.NewSignal(cx, false),
		editingID:      core.NewSignal(cx, ""),
	}
}

func (f *sourceForm) reset(s *Session, src *store.EmissionSource) {
	f.editingID.Set("")
	f.name.Set("")
	f.scope.Set(1)
	f.categoryCode.Set("")
	f.customCategory.Set(false)
	f.category.Set("")
	f.path.Set("")
	f.active.Set(true)
	f.siteID.Set("")
	if len(s.sites) > 0 {
		f.siteID.Set(s.sites[0].ID)
	}
	if src != nil {
		f.editingID.Set(src.ID)
		f.name.Set(src.Name)
		f.siteID.Set(src.SiteID)
		f.scope.Set(src.Scope)
		f.category.Set(src.Category)
		f.path.Set(src.GHGProtocolPath)
		if _, ok := categories.ByCode(src.GHGProtocolPath); ok {
			f.categoryCode.Set(src.GHGProtocolPath)
		} else if src.GHGProtocolPath != "" || src.Category != "" {
			f.customCategory.Set(true)
		}
		f.active.Set(src.IsActive)
	}
	f.status.Set("")
}

func (f *sourceForm) showNew(s *Session) {
	f.reset(s, nil)
	f.open.Set(true)
}

func (f *sourceForm) showEdit(s *Session, id string) {
	src := s.sourceByID(id)
	if src == nil {
		return
	}
	f.reset(s, src)
	f.open.Set(true)
}

func (f *sourceForm) save(cx *core.Scope, s *Session, dataRev *core.Signal[int]) {
	if f.busy.Get() {
		return
	}
	if f.siteID.Get() == "" {
		f.status.Set(locales.SourcesCatalogNoSite(cx))
		return
	}
	sourceCategory, sourcePath := sourceCategoryValues(f.categoryCode, f.category, f.path,
		f.customCategory)
	f.busy.Set(true)
	var err error
	if f.editingID.Get() == "" {
		var created *store.EmissionSource
		created, err = s.db.CreateSource(context.Background(), store.SourceInput{
			SiteID: f.siteID.Get(), Name: f.name.Get(), Scope: f.scope.Get(),
			Category: sourceCategory, GHGProtocolPath: sourcePath,
		})
		if err == nil {
			s.recordSourceCreate(created, dataRev)
		}
	} else {
		before := store.EmissionSource{}
		if current := s.sourceByID(f.editingID.Get()); current != nil {
			before = *current
		}
		err = s.db.UpdateSource(context.Background(), f.editingID.Get(), store.SourcePatch{
			Name: f.name.Get(), Scope: f.scope.Get(), Category: sourceCategory,
			GHGProtocolPath: sourcePath, IsActive: f.active.Get(),
		})
		if err == nil {
			after := before
			after.Name = f.name.Get()
			after.Scope = f.scope.Get()
			after.Category = sourceCategory
			after.GHGProtocolPath = sourcePath
			after.IsActive = f.active.Get()
			s.recordSourceUpdate(before, after, dataRev)
		}
	}
	f.busy.Set(false)
	if err != nil {
		f.status.Set(err.Error())
		return
	}
	f.open.Set(false)
	_ = dataRefresh(s, dataRev)
}

func (f *sourceForm) body(cx *core.Scope, s *Session, testID string,
	save func()) []core.Node {
	siteOptions := make([]ui.Option[string], 0, len(s.sites))
	for _, site := range s.sites {
		siteOptions = append(siteOptions, ui.Option[string]{Value: site.ID, Label: dataSiteName(site)})
	}
	return []core.Node{
		dataField(cx, locales.SourcesFormName(cx),
			ui.Input{Value: f.name.Get, OnChange: f.name.Set, TestID: testID + "-name"}, save),
		dataField(cx, locales.SourcesFormSite(cx),
			appSelect[string]{Options: siteOptions, Value: f.siteID.Get, OnChange: f.siteID.Set,
				Label: locales.SourcesFormSite(cx), TestID: testID + "-site",
				Style: core.Style{Width: core.Pct(100)}}),
		dataField(cx, locales.SourcesFormScope(cx),
			appSelect[int]{Options: dataScopeOptions(cx), Value: f.scope.Get,
				OnChange: f.scope.Set, Label: locales.SourcesFormScope(cx),
				TestID: testID + "-scope", Style: core.Style{Width: core.Pct(100)}}),
		sourceCategoryFields(cx, testID, f.scope, f.categoryCode, f.category, f.path,
			f.customCategory),
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Gap: 8}, Children: []core.Node{
			ui.Switch{Checked: f.active.Get, OnChange: f.active.Set,
				Label: locales.SourceEditActiveLabel(cx), TestID: testID + "-active"},
			core.Text{Content: locales.SourceEditActiveLabel(cx),
				Style: core.Style{FontSize: 13}},
		}},
		dataError(cx, f.status),
	}
}

func (f *sourceForm) footer(cx *core.Scope, testID string, save func()) []core.Node {
	return []core.Node{
		dataCancelButton(cx, f.open, testID+"-cancel"),
		ui.Button{Text: locales.DataSave(cx), Busy: f.busy.Get, OnPress: save,
			TestID: testID + "-save"},
	}
}

// sourceAddDialog pairs the header's Add source trigger with 1.x's 480 pt
// right-side drawer.
func (s *Session) sourceAddDialog(cx *core.Scope, dataRev *core.Signal[int],
	testID string) core.Node {
	form := newSourceForm(cx)
	save := func() { form.save(cx, s, dataRev) }
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.DataAddSource(cx), Variant: ui.ButtonPrimary,
			OnPress: func() { form.showNew(s) }, TestID: testID},
		sideDrawer(cx, form.open, locales.DataNewSource(cx), 480,
			form.body(cx, s, testID, save), form.footer(cx, testID, save),
			testID+"-dialog", locales.DataCancel(cx)),
	}}
}

// sourceEditDrawer is the one 420 pt editor every /sources row opens.
func (s *Session) sourceEditDrawer(cx *core.Scope,
	dataRev *core.Signal[int]) (core.Node, func(string)) {
	form := newSourceForm(cx)
	save := func() { form.save(cx, s, dataRev) }
	return sideDrawer(cx, form.open, locales.DataEditSource(cx), 420,
			form.body(cx, s, "source-edit", save), form.footer(cx, "source-edit", save),
			"source-edit-dialog", locales.DataCancel(cx)), func(id string) {
			form.showEdit(s, id)
		}
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

// editableActivityDialog also returns the form's open function, so the list's
// selection actions can open the same editor without duplicating the dialog.
func (s *Session) editableActivityDialog(cx *core.Scope, selectedID *core.Signal[string],
	dataRev *core.Signal[int]) (core.Node, func()) {
	form := s.newActivityForm(cx, dataRev, func() *store.Activity {
		return s.activityByID(selectedID.Get())
	}, nil, locales.DataEditActivity, locales.DataSave, "activity-edit", nil, false)
	return form.dialog, form.show
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
	trigger := ui.Button{Text: triggerLabel(cx), Variant: ui.ButtonPrimary, OnPress: form.show,
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
		if busy.Get() {
			return
		}
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
	sourceWideOptions := make([]wideOption, 0, len(sourceOptions))
	for _, option := range sourceOptions {
		sourceWideOptions = append(sourceWideOptions, wideOption{Value: option.Value, Label: option.Label})
	}
	periodWideOptions := make([]wideOption, 0, len(periodOptions))
	for _, option := range periodOptions {
		periodWideOptions = append(periodWideOptions, wideOption{Value: option.Value, Label: option.Label})
	}
	efSelect := func(cx *core.Scope) core.Node {
		options := make([]wideOption, 0, len(efOptions.Get()))
		for _, ef := range efOptions.Get() {
			options = append(options, wideOption{Value: dataEFKey(ef),
				Label: dataEFName(cx, ef), Detail: dataEFDetail(ef)})
		}
		if len(options) == 0 {
			return core.Text{Content: locales.ActivitiesFormEfNone(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		}
		return wideSelect{Options: options, Value: efKey.Get, OnChange: efKey.Set,
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
					colors := ui.ColorsOf(cx)
					return core.Style{Background: colors.Raised(),
						Hover:        &core.Style{Background: colors.Hover()},
						FocusVisible: ui.FocusRing(cx, -2)}
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
		dropDone := core.NewSignal(cx, "")
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
			dropDone.Set("")
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
					dropStatus.Set("")
					dropDone.Set(document.Filename)
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
		idle := core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10},
			Children: []core.Node{
				ui.Icon(lucide.CloudUpload, 16, ui.ColorsOf(cx).Muted),
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: []core.Node{
						core.Text{ContentFunc: func() string { return locales.ActivitiesDropHint(cx) },
							Style: core.Style{FontSize: 12, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 2},
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
					Busy: dropBusy.Get, OnPress: pick, TestID: "activity-drop-pick",
					Style: core.Style{FlexShrink: 0}},
			},
		}
		done := core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
			Children: []core.Node{
				ui.Icon(lucide.FileText, 16, ui.ColorsOf(cx).Accent),
				core.Text{ContentFunc: func() string { return dropDone.Get() },
					Style: core.Style{FontSize: 13, FlexGrow: 1, FlexShrink: 1,
						MinWidth: core.Pt(0)}, MaxLines: 1},
				core.Text{ContentFunc: func() string { return "· " + locales.ActivityDocRecognized(cx) },
					Style:     core.Style{FontSize: 11, FlexShrink: 0},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Accent)},
				ui.Button{Text: locales.ActivityDocReupload(cx), Icon: lucide.RotateCcw,
					Variant: ui.ButtonGhost, Size: ui.SizeSmall, TestID: "activity-drop-reset",
					OnPress: func() { dropDone.Set("") }, Style: core.Style{FlexShrink: 0}},
			},
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
				CornerRadius: 8, BorderWidth: 1},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				if dropDone.Get() != "" {
					return core.Style{Padding: core.Symmetric(8, 12),
						Background:  ui.Alpha(colors.Accent(), 0.05),
						BorderColor: ui.Alpha(colors.Accent(), 0.30)}
				}
				style := core.Style{Padding: core.All(12), BorderStyle: core.BorderDashed,
					Background: colors.Inset(), BorderColor: colors.Border()}
				if dropHover.Get() {
					style.BorderColor = colors.Accent()
				}
				return style
			},
			Children: []core.Node{
				core.Dynamic(func(cx *core.Scope) core.Node {
					if dropDone.Get() != "" {
						return done
					}
					return idle
				}),
			},
		}
	}

	form := &activityForm{open: open, show: show, applySeed: applySeed}
	body := []core.Node{
		dropzone,
		dataField(cx, locales.ActivitiesFormSource(cx),
			wideSelect{Options: sourceWideOptions, Value: sourceID.Get,
				OnChange:    func(v string) { sourceID.Set(v); loadEFs(v) },
				Placeholder: locales.ActivitiesFormSourcePlaceholder(cx),
				Label:       locales.ActivitiesFormSource(cx), TestID: prefix + "-source"}),
		dataField(cx, locales.ActivitiesFormPeriod(cx),
			wideSelect{Options: periodWideOptions, Value: periodID.Get, OnChange: periodID.Set,
				Placeholder: locales.ActivitiesFormPeriodPlaceholder(cx),
				Label:       locales.ActivitiesFormPeriod(cx), TestID: prefix + "-period"}),
		dataColumns(cx, 8,
			dataField(cx, locales.ActivitiesFormOccurredStart(cx),
				ui.Input{Value: start.Get, OnChange: start.Set, TestID: prefix + "-start"}, save),
			dataField(cx, locales.ActivitiesFormOccurredEnd(cx),
				ui.Input{Value: end.Get, OnChange: end.Set, TestID: prefix + "-end"}, save)),
		dataColumns(cx, 8,
			dataField(cx, locales.ActivitiesFormAmount(cx),
				ui.Input{Value: amount.Get, OnChange: amount.Set, TestID: prefix + "-amount"}, save),
			dataField(cx, locales.ActivitiesFormUnit(cx),
				ui.Input{Value: unit.Get, OnChange: unit.Set,
					Placeholder: locales.ActivitiesFormUnitPlaceholder(cx), TestID: prefix + "-unit"}, save)),
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
		dataField(cx, locales.ActivitiesFormEf(cx), core.Dynamic(efSelect)),
		dataColumns(cx, 8,
			dataField(cx, locales.ActivitiesFormFuel(cx),
				ui.Input{Value: fuel.Get, OnChange: fuel.Set,
					Placeholder: locales.ActivitiesFormFuelNone(cx), TestID: prefix + "-fuel"}, save),
			dataField(cx, locales.ActivitiesFormNotes(cx),
				ui.Input{Value: notes.Get, OnChange: notes.Set, TestID: prefix + "-notes"}, save)),
		core.Text{Content: locales.ActivitiesFormFuelHint(cx), Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		dataError(cx, status),
	}
	footer := []core.Node{
		dataCancelButton(cx, open, prefix+"-cancel"),
		ui.Button{Text: saveLabel(cx), Busy: busy.Get, OnPress: save, TestID: prefix + "-save"},
	}
	form.dialog = sideDrawer(cx, open, title(cx), 720, body, footer,
		prefix+"-dialog", locales.DataCancel(cx))
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

func dataEFName(cx *core.Scope, ef store.EmissionFactor) string {
	preferred, fallback := ef.NameEN, ef.NameZH
	if strings.HasPrefix(strings.ToLower(i18n.Language(cx)), "zh") {
		preferred, fallback = ef.NameZH, ef.NameEN
	}
	if preferred != "" {
		return preferred
	}
	if fallback != "" {
		return fallback
	}
	return ef.FactorCode
}

func dataEFDetail(ef store.EmissionFactor) string {
	return fmt.Sprintf("%s · %s %d · %s · %s kgCO2e/%s · %s", ef.FactorCode,
		ef.Source, ef.Year, ef.Geography, commaFloat(ef.CO2eKgPerUnit), ef.InputUnit,
		ef.DatasetVersion)
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
	selected := core.NewSignal(cx, "")
	rawRev := core.NewSignal(cx, 0)
	rawOpen := map[string]bool{}
	return core.Dynamic(func(cx *core.Scope) core.Node {
		_ = dataRev.Get()
		_ = rawRev.Get()
		return s.auditBody(cx, kind, since, until, limit, status, oldestFirst,
			selected, rawOpen, rawRev, openActivity)
	})
}

func (s *Session) auditBody(cx *core.Scope, kind *core.Signal[string], since *core.Signal[string],
	until *core.Signal[string], limit *core.Signal[int], status *core.Signal[string],
	oldestFirst *core.Signal[bool], selected *core.Signal[string],
	rawOpen map[string]bool, rawRev *core.Signal[int],
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
		event := event
		isSelected := func() bool { return selected.Get() == event.ID }
		rows = append(rows, core.View{
			TestID: "audit-row-" + event.ID,
			Role:   core.RoleButton,
			OnPress: func(core.PressEvent) {
				selected.Set(event.ID)
			},
			Style: core.Style{Gap: 2, Padding: core.Symmetric(10, 16),
				Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style {
				style := core.Style{BorderColor: ui.ColorsOf(cx).Line()}
				if isSelected() {
					style.Background = selectionTint(cx)
				}
				return style
			},
			Children: []core.Node{
				core.Text{Content: dataAuditKind(cx, event.Kind),
					Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}, MaxLines: 1},
				core.Text{Content: event.OccurredAt, Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			},
		})
	}
	if len(events) == 0 && err == nil && datesOK {
		rows = append(rows, dataEmptyState(cx, locales.AuditEmptyStateHeading(cx),
			locales.AuditEmptyStateBody(cx)))
	}
	if selected.Get() == "" && len(events) > 0 {
		selected.Set(events[0].ID)
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
	sortOptions := []ui.Option[bool]{
		{Value: false, Label: locales.AuditSortRecent(cx)},
		{Value: true, Label: locales.AuditSortOldest(cx)},
	}
	dateField := func(label string, value *core.Signal[string], testID string) core.Node {
		return core.View{Style: core.Style{FlexGrow: 1, FlexBasis: core.Pt(0),
			MinWidth: core.Pt(0), Gap: 4}, Children: []core.Node{
			core.Text{Content: label, Style: core.Style{FontSize: 12, FontWeight: ui.Medium}},
			ui.Input{Value: value.Get, OnChange: func(v string) { value.Set(v); limit.Set(100) },
				Placeholder: "YYYY-MM-DD", TestID: testID,
				Style: core.Style{Height: core.Pt(28),
					Padding: core.Symmetric(0, 8)}},
		}}
	}
	rebindActive := func() bool { return kind.Get() == "activity_rebind_ef" }
	rebindChip := core.View{
		TestID: "audit-kind", Role: core.RoleButton,
		OnPress: func(core.PressEvent) {
			if rebindActive() {
				kind.Set("")
			} else {
				kind.Set("activity_rebind_ef")
			}
			limit.Set(100)
		},
		Style: core.Style{Padding: core.Symmetric(2, 10), CornerRadius: 999,
			BorderWidth: 1, AlignSelf: core.AlignStart},
		StyleFunc: func() core.Style {
			if rebindActive() {
				return core.Style{Background: ui.Alpha(ui.ColorsOf(cx).Accent(), 0.15),
					BorderColor: ui.Alpha(ui.ColorsOf(cx).Accent(), 0.4)}
			}
			return core.Style{Background: ui.ColorsOf(cx).Background(),
				BorderColor: ui.ColorsOf(cx).Border()}
		},
		Children: []core.Node{core.Text{Content: dataAuditKind(cx, "activity_rebind_ef"),
			Style: core.Style{FontSize: 12, FontWeight: ui.Medium},
			StyleFunc: func() core.Style {
				if rebindActive() {
					return core.Style{Color: ui.ColorsOf(cx).Accent()}
				}
				return core.Style{}
			}}},
	}
	filters := core.View{Style: core.Style{Gap: 10}, Children: []core.Node{
		core.View{Style: core.Style{Gap: 6}, Children: []core.Node{
			core.Text{Content: locales.AuditFilterEventKindLabel(cx),
				Style: core.Style{FontSize: 12, FontWeight: ui.Medium}},
			rebindChip,
		}},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignEnd,
			Gap: 8}, Children: []core.Node{
			dateField(locales.AuditFilterSinceLabel(cx), since, "audit-since"),
			dateField(locales.AuditFilterUntilLabel(cx), until, "audit-until"),
		}},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12},
			Children: []core.Node{
				sortMenu(cx, sortOptions, oldestFirst.Get, oldestFirst.Set, "audit-sort"),
				core.View{Style: core.Style{FlexGrow: 1}},
				ui.Button{Text: locales.AuditExportCsvButton(cx), Icon: lucide.Download,
					Variant: ui.ButtonGhost, Size: ui.SizeSmall, OnPress: export,
					TestID: "audit-export"},
				ui.Button{Text: locales.AuditFilterResetButton(cx), Variant: ui.ButtonGhost,
					Size: ui.SizeSmall, OnPress: resetFilters, TestID: "audit-reset"},
			}},
	}}
	left := []core.Node{filters}
	if !datesOK {
		left = append(left, core.Text{Content: locales.AuditFilterInvalidDate(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	} else if status.Get() != "" {
		left = append(left, core.Text{Content: status.Get(), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	left = append(left, core.View{Style: core.Style{Gap: 0}, Children: rows})
	if datesOK && len(events) == page && page < 10_000 {
		left = append(left, ui.Button{Text: locales.AuditLoadOlderButton(cx),
			Variant: ui.ButtonSecondary, TestID: "audit-older",
			OnPress: func() { limit.Set(page + 100) }})
	}
	detail := core.Node(core.View{Style: core.Style{FlexGrow: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{detailEmpty(cx, locales.AuditSelectEvent)}})
	for _, event := range events {
		if event.ID != selected.Get() {
			continue
		}
		detail = core.Scroll{
			Style: core.Style{FlexGrow: 1, MinHeight: core.Pt(0)},
			Children: []core.Node{core.View{
				Style: core.Style{Padding: core.All(24), Gap: 12,
					Width: core.Pct(100), MaxWidth: core.Pt(980)},
				Children: []core.Node{
					core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
						Gap: 8}, Children: []core.Node{
						ui.Badge{Text: dataAuditKind(cx, event.Kind), Variant: ui.BadgeNeutral},
						core.View{Style: core.Style{FlexGrow: 1}},
						core.Text{Content: event.OccurredAt, Style: core.Style{FontSize: 12},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					}},
					s.auditEventBody(cx, event, rawOpen, rawRev, openActivity),
				},
			}},
		}
	}
	list := core.View{Style: core.Style{FlexGrow: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{
			listPaneHeader(cx, locales.AuditNav, locales.AuditSubheading),
			core.Scroll{Style: core.Style{FlexGrow: 1, MinHeight: core.Pt(0)},
				Children: []core.Node{core.View{
					Style:    core.Style{Padding: core.Symmetric(12, 16), Gap: 10},
					Children: left}},
			},
		}}
	return splitPage(cx, 36, list, detail)
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
