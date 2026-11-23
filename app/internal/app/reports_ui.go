package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/deliverable"
	"app.carbonink.desktop/internal/readiness"
	"app.carbonink.desktop/internal/report"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/i18n"
	"github.com/nsgo-dev/nsgo/ui"
)

// reportsState is the report workbench: what to generate, the last generated
// deliverable, and the export feedback.
type reportsState struct {
	period     *core.Signal[string]
	kind       *core.Signal[string]
	language   *core.Signal[string]
	busy       *core.Signal[bool]
	status     *core.Signal[string]
	failed     *core.Signal[bool]
	exportBusy *core.Signal[bool]
	generated  *core.Signal[*report.Report]
	rev        *core.Signal[int]
}

func (s *Session) reportsScreen(cx *core.Scope, dataRev *core.Signal[int],
	active *core.Signal[Screen]) core.Node {
	if s.organization == nil {
		return s.onboardingScreen(cx, dataRev)
	}
	state := &reportsState{
		period:     core.NewSignal(cx, ""),
		kind:       core.NewSignal(cx, report.KindISO),
		language:   core.NewSignal(cx, reportLanguage(cx)),
		busy:       core.NewSignal(cx, false),
		status:     core.NewSignal(cx, ""),
		failed:     core.NewSignal(cx, false),
		exportBusy: core.NewSignal(cx, false),
		generated:  core.NewSignal[*report.Report](cx, nil),
		rev:        core.NewSignal(cx, 0),
	}
	if len(s.periods) > 0 {
		state.period.Set(s.periods[len(s.periods)-1].ID)
	}
	guide := newGuidance(cx, s, "report-export")
	readinessCard, resetReadiness := s.readinessSection(cx, state.period, active)

	// Switching the period or kind retires the preview: it belonged to the
	// previous selection, and exporting it under the new one would mislead.
	invalidate := func() {
		resetReadiness()
		if state.generated.Get() == nil {
			return
		}
		state.generated.Set(nil)
		state.failed.Set(false)
		state.status.Set("")
		state.rev.Set(state.rev.Get() + 1)
	}

	generate := func() {
		if state.busy.Get() {
			return
		}
		periodID := state.period.Get()
		if periodID == "" {
			state.failed.Set(true)
			state.status.Set(locales.ReportsNoPeriods(cx))
			return
		}
		provider := s.llmProvider(cx)
		if !provider.Configured() {
			state.failed.Set(true)
			state.status.Set(locales.ReportsNoProvider(cx))
			return
		}
		kind := state.kind.Get()
		language := state.language.Get()
		state.busy.Set(true)
		state.failed.Set(false)
		state.status.Set(locales.ReportsProgressAssembling(cx))
		go func() {
			service := &report.Service{
				Store: s.db,
				Provider: report.Provider{
					Name: provider.Name, Model: provider.Model,
					BaseURL: provider.BaseURL, APIKey: provider.APIKey,
				},
			}
			generated, err := service.Generate(context.Background(), periodID, language, kind)
			s.scope.Post(func() {
				state.busy.Set(false)
				if err != nil {
					s.log.Warn("report generation failed", "period", periodID, "kind", kind, "err", err)
					state.failed.Set(true)
					state.status.Set(reportErrorText(cx, err))
					return
				}
				state.generated.Set(generated)
				state.rev.Set(state.rev.Get() + 1)
				state.failed.Set(false)
				state.status.Set("")
			})
		}()
	}

	export := func(as string) {
		generated := state.generated.Get()
		if generated == nil || state.exportBusy.Get() {
			return
		}
		labels := reportLabels(state.language.Get())
		year := strconv.Itoa(generated.Data.Period.Year)
		base := "carbonink-" + map[string]string{
			report.KindISO: "iso", report.KindTCFD: "tcfd",
		}[generated.Kind] + "-" + year

		state.exportBusy.Set(true)
		state.failed.Set(false)
		state.status.Set(locales.ReportsProgressFinalizing(cx))
		finish := func() { state.exportBusy.Set(false) }
		go func() {
			var pdfBytes, xlsxBytes []byte
			var err error
			if as != "xlsx" {
				pdfBytes, err = generated.PDF(labels)
			}
			if err == nil && as != "pdf" {
				xlsxBytes, err = generated.XLSX(labels)
			}
			s.scope.Post(func() {
				if err != nil {
					finish()
					state.failed.Set(true)
					state.status.Set(locales.ReportsExportFailed(cx, err.Error()))
					return
				}
				saveResult := func(name, mime, kind string, data []byte, then func()) {
					cx.SaveFile(core.SaveOptions{Name: name, MIME: mime, Data: data},
						func(saved bool, path string, err error) {
							if err != nil {
								finish()
								state.failed.Set(true)
								state.status.Set(locales.ReportsExportFailed(cx, err.Error()))
								return
							}
							if !saved {
								finish()
								state.status.Set("")
								return
							}
							state.failed.Set(false)
							state.status.Set(locales.ReportsExportSuccess(cx, kind, path))
							if then != nil {
								then()
							}
						})
				}
				writePDF := func(then func()) {
					saveResult(base+".pdf", "application/pdf", "PDF", pdfBytes, then)
				}
				writeXLSX := func(then func()) {
					saveResult(base+".xlsx", report.WorkbookMIME, "Excel", xlsxBytes, then)
				}
				switch as {
				case "pdf":
					writePDF(finish)
				case "xlsx":
					writeXLSX(finish)
				default:
					// Both exports go through two save dialogs: the document,
					// then its appendix, matching the 1.x flow.
					writePDF(func() { writeXLSX(finish) })
				}
			})
		}()
	}

	exportDeliverable := func() {
		generated := state.generated.Get()
		if generated == nil || state.exportBusy.Get() {
			return
		}
		periodID := generated.Data.Period.ID
		sweep, err := readiness.Run(context.Background(), s.db, periodID, readiness.Options{
			ImportOutlierRatio: importOutlierRatio(context.Background(), s.db),
		})
		if err != nil {
			state.failed.Set(true)
			state.status.Set(locales.ReportsExportFailed(cx, err.Error()))
			return
		}
		rows := make([]deliverable.ReadinessRow, 0, len(sweep.Findings))
		for _, finding := range sweep.Findings {
			rows = append(rows, deliverable.ReadinessRow{
				Severity: readinessSeverityLabel(cx, finding.Severity),
				CheckID:  finding.CheckID, Title: readinessTitle(cx, finding),
				Detail:     readinessDetail(cx, finding),
				EntityType: finding.Entity.Type, EntityID: finding.Entity.ID,
			})
		}
		readinessSheet := &deliverable.Readiness{
			CheckedAt: sweep.CheckedAt, CheckCount: readiness.CheckCount,
			Blockers: sweep.Counts.Blocker, Warnings: sweep.Counts.Warning,
			Notes: sweep.Counts.Info, Rows: rows,
		}
		labels := reportLabels(state.language.Get())
		year := strconv.Itoa(generated.Data.Period.Year)
		base := "carbonink-" + map[string]string{
			report.KindISO: "iso", report.KindTCFD: "tcfd",
		}[generated.Kind] + "-" + year
		activities := make([]deliverable.ActivityRef, 0, len(generated.Data.Activities))
		for _, activity := range generated.Data.Activities {
			activities = append(activities, deliverable.ActivityRef{
				ID: activity.ID, SourceName: activity.Source,
			})
		}

		state.exportBusy.Set(true)
		state.failed.Set(false)
		state.status.Set(locales.ReportsProgressFinalizing(cx))
		go func() {
			pdfBytes, err := generated.PDF(labels)
			var xlsxBytes []byte
			if err == nil {
				xlsxBytes, err = generated.XLSX(labels)
			}
			var dir, path string
			var built deliverable.Result
			if err == nil {
				dir, err = os.MkdirTemp("", "carbonink-deliverable-")
			}
			if err == nil {
				path = filepath.Join(dir, "deliverable.zip")
				built, err = deliverable.Build(context.Background(), s.db, deliverable.Input{
					PeriodID: periodID, Activities: activities,
					ReportPDF: deliverable.NamedBytes{Name: base + ".pdf", Bytes: pdfBytes},
					Appendix: deliverable.NamedBytes{
						Name: base + ".xlsx", Bytes: xlsxBytes,
					},
					Readiness: readinessSheet, OutPath: path,
					DataDir: s.dataDir,
				})
			}
			s.scope.Post(func() {
				if err != nil {
					if dir != "" {
						os.RemoveAll(dir)
					}
					state.exportBusy.Set(false)
					state.failed.Set(true)
					state.status.Set(locales.ReportsExportFailed(cx, err.Error()))
					return
				}
				cx.SaveFile(core.SaveOptions{
					Name: base + "-deliverable.zip", MIME: "application/zip", Path: path,
				}, func(saved bool, savedPath string, saveErr error) {
					os.RemoveAll(dir)
					state.exportBusy.Set(false)
					if saveErr != nil {
						state.failed.Set(true)
						state.status.Set(locales.ReportsExportFailed(cx, saveErr.Error()))
						return
					}
					if !saved {
						state.status.Set("")
						return
					}
					state.failed.Set(false)
					if built.EvidenceMissing > 0 {
						state.status.Set(locales.ReportsDeliverableSuccessMissing(cx,
							savedPath, strconv.Itoa(built.EvidenceMissing),
							strconv.Itoa(built.EvidenceTotal)))
						return
					}
					state.status.Set(locales.ReportsDeliverableSuccess(cx, savedPath,
						strconv.Itoa(built.EvidenceTotal)))
				})
			})
		}()
	}

	periodOptions := make([]ui.Option[string], 0, len(s.periods))
	for _, period := range s.periods {
		periodOptions = append(periodOptions, ui.Option[string]{
			Value: period.ID, Label: strconv.Itoa(period.Year),
		})
	}
	kindOptions := []ui.Option[string]{
		{Value: report.KindISO, Label: locales.ReportsKindIso(cx)},
		{Value: report.KindTCFD, Label: locales.ReportsKindTcfd(cx)},
	}
	languageOptions := []ui.Option[string]{
		{Value: "en", Label: locales.ReportsLangEn(cx)},
		{Value: "zh-CN", Label: locales.ReportsLangZh(cx)},
	}

	controls := dataCard(cx,
		dataHeading(cx, locales.ReportsListHeading(cx), ""),
		dataColumns(cx, 12,
			core.View{StyleFunc: func() core.Style {
				if cx.Env().Window().Width < 900 {
					return core.Style{Gap: 4}
				}
				return core.Style{Gap: 4, FlexGrow: 1, FlexBasis: core.Pt(0)}
			}, Children: []core.Node{
				core.Text{Content: locales.ReportsPeriodLabel(cx),
					Style:     core.Style{FontSize: 12, FontWeight: ui.Semibold},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				ui.Select[string]{Options: periodOptions, Value: state.period.Get,
					Placeholder: locales.ReportsNoPeriods(cx),
					OnChange: func(next string) {
						state.period.Set(next)
						invalidate()
					},
					TestID: "reports-period", Style: core.Style{Width: core.Pct(100)}},
			}},
			core.View{StyleFunc: func() core.Style {
				if cx.Env().Window().Width < 900 {
					return core.Style{Gap: 4}
				}
				return core.Style{Gap: 4, FlexGrow: 2, FlexBasis: core.Pt(0)}
			}, Children: []core.Node{
				core.Text{Content: locales.ReportsKindLabel(cx),
					Style:     core.Style{FontSize: 12, FontWeight: ui.Semibold},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				ui.Select[string]{Options: kindOptions, Value: state.kind.Get,
					OnChange: func(next string) {
						state.kind.Set(next)
						invalidate()
					}, TestID: "reports-kind", Style: core.Style{Width: core.Pct(100)}},
			}},
			core.View{StyleFunc: func() core.Style {
				if cx.Env().Window().Width < 900 {
					return core.Style{Gap: 4}
				}
				return core.Style{Gap: 4, FlexGrow: 1, FlexBasis: core.Pt(0)}
			}, Children: []core.Node{
				core.Text{Content: locales.ReportsLangLabel(cx),
					Style:     core.Style{FontSize: 12, FontWeight: ui.Semibold},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				ui.Select[string]{Options: languageOptions, Value: state.language.Get,
					OnChange: state.language.Set, TestID: "reports-language",
					Style: core.Style{Width: core.Pct(100)}},
			}},
		),
		core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd}, Children: []core.Node{
			ui.Button{Text: locales.ReportsGenerateButton(cx), OnPress: generate,
				Busy: state.busy.Get, Disabled: func() bool { return len(periodOptions) == 0 },
				TestID: "reports-generate"},
		}},
		core.Show{When: func() bool { return state.status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return state.status.Get() },
					Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style {
						if state.failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	)

	preview := core.Dynamic(func(cx *core.Scope) core.Node {
		_ = state.rev.Get()
		generated := state.generated.Get()
		if generated == nil {
			return dataCard(cx,
				dataEmptyState(cx, locales.ReportsPreviewHeading(cx), locales.ReportsPreviewHint(cx)))
		}
		data := generated.Data
		stat := func(label string, value float64) core.Node {
			return core.View{Style: core.Style{FlexGrow: 1, FlexBasis: core.Pt(0), Gap: 2},
				Children: []core.Node{
					core.Text{Content: commaFloat(value), Style: core.Style{FontSize: 20, FontWeight: ui.Bold}},
					core.Text{Content: label, Style: core.Style{FontSize: 12},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				}}
		}
		sections := []core.Node{}
		add := func(title, body string) {
			sections = append(sections, dataCard(cx,
				core.Text{Content: title, Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
				core.Text{Content: body, Style: core.Style{FontSize: 13}}))
		}
		if generated.ISO != nil {
			add(locales.ReportsSectionBoundary(cx), generated.ISO.BoundaryDescription)
			add(locales.ReportsSectionReporting(cx), generated.ISO.ReportingBoundary)
			add(locales.ReportsSectionMethod(cx), generated.ISO.MethodologyDescription)
			add(locales.ReportsSectionInventory(cx), generated.ISO.EmissionsSummary)
			add(locales.ReportsSectionChanges(cx), generated.ISO.SignificantChanges)
			add(locales.ReportsSectionObservations(cx), generated.ISO.NotableObservations)
		}
		if generated.TCFD != nil {
			add(locales.ReportsPillarGovernance(cx), generated.TCFD.Governance)
			add(locales.ReportsPillarStrategy(cx), generated.TCFD.Strategy)
			add(locales.ReportsPillarRisk(cx), generated.TCFD.RiskManagement)
			add(locales.ReportsPillarMetrics(cx), generated.TCFD.MetricsTargets)
		}
		return core.View{Style: core.Style{Gap: 12}, Children: []core.Node{
			guide.node(s, func() bool { return true }),
			dataCard(cx,
				core.View{StyleFunc: func() core.Style {
					if cx.Env().Window().Width < 900 {
						return core.Style{Gap: 10}
					}
					return core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12}
				},
					Children: []core.Node{
						core.View{Children: logoPreview(generated)},
						core.View{Style: core.Style{Gap: 2, FlexGrow: 1}, Children: []core.Node{
							core.Text{Content: locales.ReportsPreviewHeading(cx),
								Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
							core.Text{Content: locales.ReportsGeneratedAt(cx, generated.GeneratedAt),
								Style:     core.Style{FontSize: 12},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
						}},
						core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
							Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
							ui.Button{Text: locales.ReportsExportPdfButton(cx), Variant: ui.ButtonSecondary,
								OnPress: func() { export("pdf") }, Busy: state.exportBusy.Get,
								TestID: "reports-export-pdf"},
							ui.Button{Text: locales.ReportsExportXlsxButton(cx), Variant: ui.ButtonSecondary,
								OnPress: func() { export("xlsx") }, Busy: state.exportBusy.Get,
								TestID: "reports-export-xlsx"},
							ui.Button{Text: locales.ReportsExportBothButton(cx),
								OnPress: func() { export("both") }, Busy: state.exportBusy.Get,
								TestID: "reports-export-both"},
							ui.Button{Text: locales.ReportsExportDeliverableButton(cx),
								Variant: ui.ButtonSecondary,
								OnPress: func() { exportDeliverable() }, Busy: state.exportBusy.Get,
								TestID: "reports-export-deliverable"},
						}},
					}},
				core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 16}, Children: []core.Node{
					stat(locales.DashboardScope1(cx), data.Totals.Scope1Kg),
					stat(locales.DashboardScope2(cx), data.Totals.Scope2Kg),
					stat(locales.DashboardScope3(cx), data.Totals.Scope3Kg),
					stat(locales.DashboardTotalCo2e(cx), data.Totals.TotalKg),
				}},
			),
			core.View{Style: core.Style{Gap: 12}, Children: sections},
		}}
	})

	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: []core.Node{
				controls,
				core.Show{When: func() bool { return state.generated.Get() == nil },
					Then: func(cx *core.Scope) core.Node { return readinessCard }},
				preview,
			},
		}},
	}
}

// reportLanguage picks the export language from the interface locale.
func reportLanguage(cx *core.Scope) string {
	if strings.HasPrefix(strings.ToLower(i18n.Language(cx)), "zh") {
		return "zh-CN"
	}
	return "en"
}

// reportErrorText localizes the generation errors the user can act on.
func reportErrorText(cx *core.Scope, err error) string {
	switch {
	case errors.Is(err, report.ErrNotConfigured):
		return locales.ReportsNoProvider(cx)
	case errors.Is(err, report.ErrEmptyInventory):
		return locales.ReportsNoActivity(cx)
	default:
		return locales.ReportsGenerateFailed(cx, err.Error())
	}
}

// reportLabels is the exported document's copy. It follows the export
// language, not the interface locale, because a Chinese report may be
// exported while the app runs in English.
func reportLabels(language string) report.Labels {
	if strings.HasPrefix(strings.ToLower(language), "zh") {
		return report.Labels{
			ISOTitle:  "ISO 14064-1 温室气体盘查报告",
			TCFDTitle: "TCFD 气候相关财务信息披露",
			Org:       "组织", Period: "报告期", Boundary: "组织边界方法",
			Responsible: "负责人", Generated: "生成日期", Sites: "场地", Site: "场地",
			SectionBoundary: "组织边界", SectionReporting: "报告范围",
			SectionMethod: "方法学", SectionInventory: "排放概要",
			SectionChanges: "重大变动", SectionObservations: "观察发现",
			PillarGovernance: "治理", PillarStrategy: "战略",
			PillarRisk: "风险管理", PillarMetrics: "指标与目标",
			TCFDIntro: "本披露遵循 TCFD 四支柱框架：治理、战略、风险管理、指标与目标。" +
				"文中数据均取自本报告期温室气体盘查清单；未量化的事项明确标注，不作推测。",
			Summary: "概览", Sources: "排放源", Factors: "排放因子",
			Activities: "活动数据", Scope: "范围", Source: "排放源", Name: "名称",
			CO2e: "CO2e（kg）", Share: "占比", Year: "年份", Amount: "数量",
			Unit: "单位", EF: "排放因子来源", Notes: "备注", Count: "使用次数",
			GWPBasis: "GWP 基准", Scope1: "范围一（kg CO2e）", Scope2: "范围二（kg CO2e）",
			Scope3: "范围三（kg CO2e）", Total: "合计（kg CO2e）",
			BaseYear: "基准年", PriorYear: "上一年度",
			Significant: "已记录重大变动", NoSignificant: "本期未报告重大变动",
			PreparedBy:     "编制工具",
			BoundaryEquity: "股权法", BoundaryFinancial: "财务控制法",
			BoundaryOperational: "运营控制法",
		}
	}
	return report.Labels{
		ISOTitle:  "ISO 14064-1 GHG Inventory Report",
		TCFDTitle: "TCFD Climate Disclosure",
		Org:       "Organization", Period: "Reporting period", Boundary: "Boundary approach",
		Responsible: "Responsible person", Generated: "Generated", Sites: "Sites", Site: "Site",
		SectionBoundary: "Organizational boundary", SectionReporting: "Reporting boundary",
		SectionMethod: "Methodology", SectionInventory: "Emissions summary",
		SectionChanges: "Significant changes", SectionObservations: "Notable observations",
		PillarGovernance: "Governance", PillarStrategy: "Strategy",
		PillarRisk: "Risk management", PillarMetrics: "Metrics and targets",
		TCFDIntro: "This disclosure follows the four TCFD pillars: governance, strategy, " +
			"risk management, and metrics and targets. Every figure comes from this period's " +
			"GHG inventory; items without data are stated as not assessed rather than inferred.",
		Summary: "Summary", Sources: "Sources", Factors: "Emission factors",
		Activities: "Activities", Scope: "Scope", Source: "Source", Name: "Name",
		CO2e: "CO2e (kg)", Share: "Share", Year: "Year", Amount: "Amount",
		Unit: "Unit", EF: "EF source", Notes: "Notes", Count: "Count",
		GWPBasis: "GWP basis", Scope1: "Scope 1 (kg CO2e)", Scope2: "Scope 2 (kg CO2e)",
		Scope3: "Scope 3 (kg CO2e)", Total: "Total (kg CO2e)",
		BaseYear: "Base year", PriorYear: "Prior year",
		Significant: "Significant changes recorded", NoSignificant: "None reported this period",
		PreparedBy:     "Prepared with",
		BoundaryEquity: "Equity share", BoundaryFinancial: "Financial control",
		BoundaryOperational: "Operational control",
	}
}

// logoPreview is the generated report's cover image, when the workspace set
// one. It reads the same bytes the PDF embeds.
func logoPreview(rep *report.Report) []core.Node {
	if rep == nil || len(rep.Logo) == 0 {
		return nil
	}
	return []core.Node{ui.Image{
		Source: core.ImageSource{Data: rep.Logo}, TestID: "reports-logo",
		ResizeMode: core.Contain,
		Style:      core.Style{Width: core.Pt(90), Height: core.Pt(36)},
	}}
}
