package app

import (
	"context"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

const (
	importOutlierRatioKey     = "import.outlier_ratio"
	defaultImportOutlierRatio = 10.0
	minImportOutlierRatio     = 2.0
	maxImportOutlierRatio     = 1000.0
)

// importOutlierRatio reads the per-workspace batch-import multiplier. A
// missing or garbage row falls back to the default, as 1.x does, so a
// hand-edited database cannot disable the warning rule by accident.
func importOutlierRatio(ctx context.Context, db *store.Store) float64 {
	value, ok, err := db.Setting(ctx, importOutlierRatioKey)
	if err != nil || !ok {
		return defaultImportOutlierRatio
	}
	ratio, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || ratio < minImportOutlierRatio || ratio > maxImportOutlierRatio {
		return defaultImportOutlierRatio
	}
	return ratio
}

// organizationProfileCard edits the identity from onboarding plus the ISO
// 14064-1 reporting profile: consolidation boundary, the person responsible
// for the inventory and the base year. Basic and reporting fields save
// separately, each preserving the other group, exactly as 1.x did.
func (s *Session) organizationProfileCard(cx *core.Scope) core.Node {
	if s.organization == nil {
		return core.View{}
	}
	ctx := context.Background()
	org := s.organization

	zh := core.NewSignal(cx, org.NameZH)
	en := core.NewSignal(cx, org.NameEN)
	industry := core.NewSignal(cx, org.Industry)
	country := core.NewSignal(cx, org.CountryCode)
	basicStatus := core.NewSignal(cx, "")
	basicFailed := core.NewSignal(cx, false)

	boundary := core.NewSignal(cx, org.BoundaryKind)
	responsible := core.NewSignal(cx, org.Responsible)
	role := core.NewSignal(cx, org.ResponsibleRole)
	baseYear := core.NewSignal(cx, org.BaseYearPeriodID)
	reportStatus := core.NewSignal(cx, "")
	reportFailed := core.NewSignal(cx, false)

	saveBasic := func() {
		if s.organization == nil {
			return
		}
		current := s.organization
		err := s.db.UpdateOrganization(ctx, current.ID, store.OrganizationInput{
			NameZH: zh.Get(), NameEN: en.Get(), Industry: industry.Get(), CountryCode: country.Get(),
			BoundaryKind: current.BoundaryKind, Responsible: current.Responsible,
			ResponsibleRole: current.ResponsibleRole, BaseYearPeriodID: current.BaseYearPeriodID,
		})
		if err != nil {
			basicFailed.Set(true)
			basicStatus.Set(err.Error())
			return
		}
		basicFailed.Set(false)
		basicStatus.Set(locales.SettingsReportingProfileSaved(cx))
		if err := s.reload(ctx); err != nil {
			basicFailed.Set(true)
			basicStatus.Set(err.Error())
		}
	}
	saveReporting := func() {
		if s.organization == nil {
			return
		}
		current := s.organization
		err := s.db.UpdateOrganization(ctx, current.ID, store.OrganizationInput{
			NameZH: current.NameZH, NameEN: current.NameEN, Industry: current.Industry,
			CountryCode: current.CountryCode, BoundaryKind: boundary.Get(),
			Responsible: responsible.Get(), ResponsibleRole: role.Get(),
			BaseYearPeriodID: baseYear.Get(),
		})
		if err != nil {
			reportFailed.Set(true)
			reportStatus.Set(err.Error())
			return
		}
		reportFailed.Set(false)
		reportStatus.Set(locales.SettingsReportingProfileSaved(cx))
		if err := s.reload(ctx); err != nil {
			reportFailed.Set(true)
			reportStatus.Set(err.Error())
		}
	}
	baseOptions := []ui.Option[string]{{Value: "", Label: locales.SettingsBaseYearNone(cx)}}
	for _, period := range s.periods {
		baseOptions = append(baseOptions, ui.Option[string]{
			Value: period.ID, Label: strconv.Itoa(period.Year),
		})
	}
	statusLine := func(message *core.Signal[string], failed *core.Signal[bool]) core.Node {
		return core.Show{When: func() bool { return message.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return message.Get() },
					Style: core.Style{FontSize: 11}, StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}}
	}
	sectionHeading := func(label func(*core.Scope) string) core.Node {
		return core.Text{ContentFunc: func() string { return label(cx) },
			Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}}
	}
	field := func(label func(*core.Scope) string, input core.Node) core.Node {
		return core.View{Style: core.Style{Gap: 4}, Children: []core.Node{
			core.Text{ContentFunc: func() string { return label(cx) },
				Style: core.Style{FontSize: 14, FontWeight: ui.Medium}},
			namedNode(input, func() string { return label(cx) }),
		}}
	}

	return dataCardFlat(cx,
		sectionHeading(locales.SettingsOrgBasicHeading),
		dataColumns(cx, 8,
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
				field(locales.OnboardingStepCompanyNameZh,
					ui.Input{Value: zh.Get, OnChange: zh.Set, TestID: "org-profile-zh"}),
			}},
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
				field(locales.OnboardingStepCompanyNameEn,
					ui.Input{Value: en.Get, OnChange: en.Set, TestID: "org-profile-en"}),
			}},
		),
		dataColumns(cx, 8,
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
				field(locales.OnboardingStepCompanyIndustry,
					ui.Input{Value: industry.Get, OnChange: industry.Set, TestID: "org-profile-industry"}),
			}},
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
				field(locales.OnboardingStepCompanyCountry,
					ui.Input{Value: country.Get, OnChange: country.Set, TestID: "org-profile-country"}),
			}},
		),
		core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd}, Children: []core.Node{
			ui.Button{Text: locales.SettingsOrgBasicSave(cx), OnPress: saveBasic,
				TestID: "org-profile-save-basic"},
		}},
		statusLine(basicStatus, basicFailed),

		sectionHeading(locales.SettingsOrgReportingHeading),
		field(locales.SettingsBoundaryLabel,
			appSelect[string]{Options: dataBoundaryOptions(cx), Value: boundary.Get,
				OnChange: boundary.Set, Label: locales.SettingsBoundaryLabel(cx),
				TestID: "org-profile-boundary", Style: core.Style{Width: core.Pct(100)}}),
		dataColumns(cx, 8,
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
				field(locales.SettingsResponsibleNameLabel,
					ui.Input{Value: responsible.Get, OnChange: responsible.Set,
						TestID: "org-profile-resp-name"}),
			}},
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
				field(locales.SettingsResponsibleRoleLabel,
					ui.Input{Value: role.Get, OnChange: role.Set, TestID: "org-profile-resp-role"}),
			}},
		),
		field(locales.SettingsBaseYearLabel,
			appSelect[string]{Options: baseOptions, Value: baseYear.Get, OnChange: baseYear.Set,
				Label: locales.SettingsBaseYearLabel(cx), TestID: "org-profile-base-year",
				Style: core.Style{Width: core.Pct(100)}}),
		core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd}, Children: []core.Node{
			ui.Button{Text: locales.SettingsOrgReportingSave(cx), OnPress: saveReporting,
				TestID: "org-profile-save-reporting"},
		}},
		statusLine(reportStatus, reportFailed),
	)
}

// importSettingsCard tunes how batch imports flag suspicious rows. It sits
// in Settings → Organization after the report logo, alongside the other
// per-client calculation rules (matching 1.x).
func (s *Session) importSettingsCard(cx *core.Scope) core.Node {
	ctx := context.Background()
	ratio := core.NewSignal(cx,
		strconv.FormatFloat(importOutlierRatio(ctx, s.db), 'f', -1, 64))
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	valid := func() bool {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(ratio.Get()), 64)
		return err == nil && parsed >= minImportOutlierRatio && parsed <= maxImportOutlierRatio
	}
	save := func() {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(ratio.Get()), 64)
		if err != nil || parsed < minImportOutlierRatio || parsed > maxImportOutlierRatio {
			failed.Set(true)
			status.Set(locales.SettingsImportOutlierInvalid(cx))
			return
		}
		if err := s.db.SetSetting(ctx, importOutlierRatioKey,
			strconv.FormatFloat(parsed, 'f', -1, 64)); err != nil {
			failed.Set(true)
			status.Set(locales.SettingsSaveFailed(cx))
			return
		}
		failed.Set(false)
		status.Set(locales.SettingsImportOutlierSaved(cx))
	}

	return settingsCard(cx, lucide.SlidersHorizontal,
		locales.SettingsImportOutlierHeading, locales.SettingsImportOutlierBody,
		dataHeaderRow(cx,
			dataField(cx, locales.SettingsImportOutlierLabel(cx),
				ui.Input{Value: ratio.Get, OnChange: ratio.Set, MaxLength: 6,
					TestID: "import-outlier-ratio"}),
			ui.Button{Text: locales.SettingsImportOutlierSave(cx),
				Disabled: func() bool { return !valid() },
				OnPress:  save, TestID: "import-outlier-save"}),
		core.Show{When: func() bool { return ratio.Get() != "" && !valid() },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{Content: locales.SettingsImportOutlierInvalid(cx),
					Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
			}},
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: 11}, StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	)
}
