package app

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/categories"
	"app.carbonink.desktop/internal/presets"
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
		input,
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
	}
}

func dataBoundaryLabel(cx *core.Scope, value string) string {
	if value == "equity_share" {
		return locales.OnboardingStepBoundaryEquityShare(cx)
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
	for i := range periods {
		if periods[i].IsActive {
			return &periods[i]
		}
	}
	if len(periods) > 0 {
		return &periods[0]
	}
	return nil
}

// dashboardScreen is the workspace overview and the entry point for the
// organization, site, period, source, and activity setup flows.
func (s *Session) dashboardScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
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
					return s.dashboardBody(cx, dataRev)
				}),
			},
		}},
	}
}

func (s *Session) dashboardBody(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
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

	siteRows := []core.Node{}
	for _, site := range s.sites {
		siteRows = append(siteRows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(6, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				ui.Icon(lucide.Building, 14, ui.ColorsOf(cx).Muted),
				core.Text{Content: dataSiteName(site), Style: core.Style{FontSize: 13}, MaxLines: 1},
				core.Text{Content: site.CountryCode, Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.View{Style: core.Style{FlexGrow: 1}},
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
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12}, Children: []core.Node{
				core.View{Style: core.Style{Gap: 3, FlexGrow: 1}, Children: []core.Node{
					core.Text{Content: locales.DataOrgCard(cx), Style: core.Style{FontSize: 12, FontWeight: ui.Semibold},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					core.Text{Content: orgName, Style: core.Style{FontSize: 20, FontWeight: ui.Bold}},
					core.Text{Content: orgDetail, Style: core.Style{FontSize: 12},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
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
	country := core.NewSignal(cx, "CN")
	boundary := core.NewSignal(cx, "operational_control")
	siteZH := core.NewSignal(cx, "")
	siteEN := core.NewSignal(cx, "")
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
				NameZH: nameZH.Get(), NameEN: nameEN.Get(), CountryCode: country.Get(), BoundaryKind: boundary.Get(),
			},
			Site: store.SiteInput{NameZH: siteZH.Get(), NameEN: siteEN.Get(), CountryCode: siteCountry.Get()},
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
				dataField(cx, locales.OnboardingStepCompanyCountry(cx),
					ui.Input{Value: country.Get, OnChange: country.Set, TestID: "onboarding-org-country"}),
				dataField(cx, locales.OnboardingStepBoundaryTitle(cx),
					ui.Select[string]{Options: dataBoundaryOptions(cx), Value: boundary.Get, OnChange: boundary.Set,
						Label: locales.OnboardingStepBoundaryTitle(cx), TestID: "onboarding-boundary"}),
				dataField(cx, locales.OnboardingStepSiteNameZh(cx),
					ui.Input{Value: siteZH.Get, OnChange: siteZH.Set, TestID: "onboarding-site-zh"}),
				dataField(cx, locales.OnboardingStepSiteNameEn(cx),
					ui.Input{Value: siteEN.Get, OnChange: siteEN.Set, TestID: "onboarding-site-en"}),
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
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
				_ = dataRev.Get()
				return s.sourcesBody(cx, dataRev)
			}), s.efLibraryBody(cx, dataRev)},
		}},
	}
}

func (s *Session) sourcesBody(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	var rows []core.Node
	for i := range s.sources {
		src := s.sources[i]
		active := dataActiveLabel(cx, src.IsActive)
		stats := locales.SourcesStatsUnused(cx)
		if src.ActivityCount > 0 {
			stats = locales.SourcesStatsActivityCount(cx, strconv.Itoa(src.ActivityCount)) + " · " +
				locales.SourcesStatsTotal(cx, commaFloat(src.TotalCO2eKg))
		}
		categoryLabel := src.Category
		if category, ok := categories.ByCode(src.GHGProtocolPath); ok {
			categoryLabel = category.Label(i18n.Language(cx))
		}
		meta := src.SiteName
		for _, part := range []string{categoryLabel, stats} {
			if part != "" {
				meta += " · " + part
			}
		}
		texts := []core.Node{
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6}, Children: []core.Node{
				core.Text{Content: src.Name, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}, MaxLines: 1},
				ui.Badge{Text: dataScopeLabel(cx, src.Scope), Variant: ui.BadgeNeutral},
				core.Text{Content: active, Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
			}},
			core.Text{Content: meta,
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
		}
		if preset, ok := presets.ByID(src.TemplateOrigin); ok {
			origin := strings.Join([]string{preset.Source, preset.Region, strconv.Itoa(preset.Year)}, " · ")
			texts = append(texts, core.Text{Content: locales.SourcesFromCatalog(cx, origin),
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint), MaxLines: 1})
		}
		rows = append(rows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.Symmetric(9, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				ui.Icon(lucide.Factory, 15, ui.ColorsOf(cx).Muted),
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: texts},
				s.sourceDialog(cx, &s.sources[i], dataRev, "source-edit-"+src.ID),
			},
		})
	}
	if len(rows) == 0 {
		rows = append(rows, core.View{Style: core.Style{Padding: core.All(24), Gap: 6, AlignItems: core.AlignCenter}, Children: []core.Node{
			core.Text{Content: locales.SourcesEmptyTitle(cx), Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
			core.Text{Content: locales.SourcesEmptyBody(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
		}})
	}
	header := []core.Node{
		dataHeading(cx, locales.DataSources(cx), locales.DataSourcesCount(cx, strconv.Itoa(len(s.sources)))),
		core.View{Style: core.Style{FlexGrow: 1}},
	}
	if len(s.sites) == 0 {
		header = append(header, core.Text{Content: locales.SourcesCatalogNoSite(cx), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	} else {
		header = append(header, s.sourceCatalogDialog(cx, dataRev))
		header = append(header, s.sourceDialog(cx, nil, dataRev, "source-add"))
	}
	return dataCard(cx,
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: header},
		core.View{Style: core.Style{Gap: 0}, Children: rows},
	)
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
			_, err = s.db.CreateSource(context.Background(), store.SourceInput{
				SiteID: siteID.Get(), Name: name.Get(), Scope: scope.Get(), Category: sourceCategory,
				GHGProtocolPath: sourcePath,
			})
		} else {
			err = s.db.UpdateSource(context.Background(), editingID.Get(), store.SourcePatch{
				Name: name.Get(), Scope: scope.Get(), Category: sourceCategory,
				GHGProtocolPath: sourcePath, IsActive: active.Get(),
			})
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
	return s.activityFormDialog(cx, dataRev, func() *store.Activity { return nil },
		locales.DataAddActivity, locales.DataCreate, "activity-add", "activity", nil)
}

func (s *Session) editActivityDialog(cx *core.Scope, selectedID *core.Signal[string],
	dataRev *core.Signal[int]) core.Node {
	return s.activityFormDialog(cx, dataRev, func() *store.Activity {
		return s.activityByID(selectedID.Get())
	}, locales.DataEditActivity, locales.DataSave, "activity-edit", "activity-edit",
		func() bool { return selectedID.Get() == "" })
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
}

// activityForm is a form dialog that the caller can open without a trigger.
type activityForm struct {
	open   *core.Signal[bool]
	show   func()
	dialog core.Node
}

func (s *Session) activityFormDialog(cx *core.Scope, dataRev *core.Signal[int],
	initial func() *store.Activity, triggerLabel func(*core.Scope) string,
	saveLabel func(*core.Scope) string, triggerID string, prefix string,
	disabled func() bool) core.Node {
	form := s.newActivityForm(cx, dataRev, initial, nil, triggerLabel, saveLabel, prefix, nil)
	return core.View{Children: []core.Node{
		ui.Button{Text: triggerLabel(cx), Variant: ui.ButtonSecondary, OnPress: form.show,
			Disabled: disabled, TestID: triggerID},
		form.dialog,
	}}
}

// newActivityForm builds the form and returns its open handle so a screen can
// present it from another dialog. prefill, when non-nil, seeds a new row;
// onSaved replaces the default data refresh.
func (s *Session) newActivityForm(cx *core.Scope, dataRev *core.Signal[int],
	initial func() *store.Activity, prefill func() *activityPrefill,
	title func(*core.Scope) string, saveLabel func(*core.Scope) string,
	prefix string, onSaved func()) *activityForm {
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

	loadEFs := func(source string) {
		efOptions.Set(nil)
		efKey.Set("")
		for _, src := range s.sources {
			if src.ID != source {
				continue
			}
			factors, err := s.db.ListEmissionFactors(context.Background(), store.EFFilter{
				Scope: src.Scope, Category: src.Category, Limit: 100,
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
	show := func() {
		status.Set("")
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
			loadEFs(current.EmissionSourceID)
			open.Set(true)
			return
		}
		if prefill != nil {
			if seed := prefill(); seed != nil {
				sourceID.Set(seed.SourceID)
				periodID.Set(seed.PeriodID)
				start.Set(seed.Start)
				end.Set(seed.End)
				amount.Set(strconv.FormatFloat(seed.Amount, 'f', -1, 64))
				unit.Set(seed.Unit)
				fuel.Set(seed.FuelCode)
				notes.Set(seed.Notes)
				loadEFs(seed.SourceID)
				open.Set(true)
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
		if current == nil {
			var seed *activityPrefill
			if prefill != nil {
				seed = prefill()
			}
			if seed != nil {
				input.ExtractionID = seed.ExtractionID
				input.EvidenceDocumentID = seed.EvidenceDocumentID
			}
			if seed != nil && seed.ExtractionID != "" {
				_, err = s.db.CreateActivityFromExtraction(context.Background(), input)
			} else {
				_, err = s.db.CreateActivity(context.Background(), input)
			}
		} else {
			input.ExtractionID = current.ExtractionID
			_, err = s.db.UpdateActivity(context.Background(), current.ID, input)
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

	return &activityForm{
		open: open,
		show: show,
		dialog: dataDialog(cx, open, title(cx), []core.Node{
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
		}, prefix+"-dialog"),
	}
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

func (s *Session) deleteActivityButton(cx *core.Scope, selectedID *core.Signal[string],
	dataRev *core.Signal[int]) core.Node {
	open := core.NewSignal(cx, false)
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	confirm := func() {
		if selectedID.Get() == "" {
			return
		}
		busy.Set(true)
		err := s.db.DeleteActivity(context.Background(), selectedID.Get())
		busy.Set(false)
		if err != nil {
			status.Set(err.Error())
			return
		}
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
func (s *Session) auditScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	if s.organization == nil {
		return s.onboardingScreen(cx, dataRev)
	}
	kind := core.NewSignal(cx, "")
	since := core.NewSignal(cx, "")
	until := core.NewSignal(cx, "")
	limit := core.NewSignal(cx, 100)
	status := core.NewSignal(cx, "")
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
				_ = dataRev.Get()
				return s.auditBody(cx, kind, since, until, limit, status)
			})},
		}},
	}
}

func (s *Session) auditBody(cx *core.Scope, kind *core.Signal[string], since *core.Signal[string],
	until *core.Signal[string], limit *core.Signal[int], status *core.Signal[string]) core.Node {
	page := limit.Get()
	datesOK := auditDatesOK(since.Get(), until.Get())
	var events []store.AuditEvent
	var err error
	if datesOK {
		events, err = s.db.QueryAuditEvents(context.Background(), store.AuditQuery{
			Kind: kind.Get(), Since: since.Get(), Until: until.Get(), Limit: page,
		})
	}
	rows := make([]core.Node, 0, len(events)+1)
	if err != nil {
		rows = append(rows, core.Text{Content: err.Error(), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	}
	for _, event := range events {
		payload := dataAuditPayload(event.Payload)
		children := []core.Node{
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
				ui.Badge{Text: dataAuditKind(cx, event.Kind), Variant: ui.BadgeNeutral},
				core.Text{Content: event.OccurredAt, Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
			}},
		}
		if payload != "" {
			children = append(children, core.Text{Content: payload,
				Style:     core.Style{FontSize: 11, FontFamily: core.FontMonospace},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 12})
		}
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
