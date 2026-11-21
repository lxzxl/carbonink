package app

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/readiness"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// readinessSection is the report page's on-demand checklist. The sweep is
// deliberately manual: it writes a `readiness.reviewed` audit event, and an
// event per page visit would turn the audit log into navigation history.
func (s *Session) readinessSection(cx *core.Scope, period *core.Signal[string],
	active *core.Signal[Screen]) (core.Node, func()) {
	report := core.NewSignal[*readiness.Report](cx, nil)
	busy := core.NewSignal(cx, false)
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	agentFindings := core.NewSignal[*[]readiness.Finding](cx, nil)
	agentBusy := core.NewSignal(cx, false)

	reset := func() {
		report.Set(nil)
		busy.Set(false)
		agentBusy.Set(false)
		agentFindings.Set(nil)
		status.Set("")
		failed.Set(false)
	}
	run := func() {
		if busy.Get() {
			return
		}
		periodID := period.Get()
		if periodID == "" {
			failed.Set(true)
			status.Set(locales.ReadinessNoPeriod(cx))
			return
		}
		busy.Set(true)
		failed.Set(false)
		status.Set(locales.ReadinessRunning(cx))
		ratio := importOutlierRatio(context.Background(), s.db)
		go func() {
			result, err := readiness.Run(context.Background(), s.db, periodID, readiness.Options{
				ImportOutlierRatio: ratio,
			})
			s.scope.Post(func() {
				busy.Set(false)
				if err != nil {
					failed.Set(true)
					status.Set(err.Error())
					return
				}
				report.Set(&result)
				failed.Set(false)
				status.Set("")
			})
		}()
	}
	dismiss := func(key string) {
		if err := readiness.Dismiss(context.Background(), s.db, key); err != nil {
			failed.Set(true)
			status.Set(err.Error())
			return
		}
		if current := agentFindings.Get(); current != nil {
			kept := make([]readiness.Finding, 0, len(*current))
			for _, finding := range *current {
				if finding.Key() != key {
					kept = append(kept, finding)
				}
			}
			agentFindings.Set(&kept)
		}
		run()
	}
	review := func() {
		if agentBusy.Get() {
			return
		}
		if report.Get() == nil {
			failed.Set(true)
			status.Set(locales.ReadinessRun(cx))
			return
		}
		provider := s.llmProvider(cx)
		if !provider.Configured() {
			failed.Set(false)
			status.Set(locales.ReadinessAgentUnavailable(cx))
			return
		}
		periodID := period.Get()
		agentBusy.Set(true)
		failed.Set(false)
		status.Set(locales.ReadinessReviewingAgent(cx))
		go func() {
			findings, err := readiness.Review(context.Background(), s.db, periodID,
				newAgentRunner(provider))
			s.scope.Post(func() {
				agentBusy.Set(false)
				if err != nil {
					failed.Set(true)
					status.Set(err.Error())
					return
				}
				agentFindings.Set(&findings)
				failed.Set(false)
				if len(findings) == 0 {
					status.Set(locales.ReadinessAgentUnavailable(cx))
					return
				}
				status.Set("")
			})
		}()
	}
	open := func(finding readiness.Finding) {
		switch finding.Entity.Type {
		case "activity_data":
			active.Set(ScreenActivities)
		case "emission_source":
			active.Set(ScreenSources)
		case "question":
			active.Set(ScreenQuestionnaires)
		case "questionnaire":
			active.Set(ScreenSupplierDisclosures)
		case "organization":
			active.Set(ScreenSettings)
		}
	}

	body := core.Dynamic(func(cx *core.Scope) core.Node {
		current := report.Get()
		if current == nil {
			return core.View{}
		}
		shown := append([]readiness.Finding{}, current.Findings...)
		if extra := agentFindings.Get(); extra != nil {
			shown = append(shown, *extra...)
		}
		if len(shown) == 0 {
			return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.All(12), CornerRadius: 8}, StyleFunc: func() core.Style {
				return core.Style{Background: ui.ColorsOf(cx).Surface(), BorderColor: ui.ColorsOf(cx).Border(),
					BorderWidth: 1}
			}, Children: []core.Node{
				core.View{Style: core.Style{Width: core.Pt(8), Height: core.Pt(8), CornerRadius: 4},
					StyleFunc: func() core.Style { return core.Style{Background: ui.ColorsOf(cx).Up()} }},
				core.View{Style: core.Style{Gap: 2}, Children: []core.Node{
					core.Text{Content: locales.ReadinessAllClearTitle(cx),
						Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
					core.Text{Content: locales.ReadinessAllClearBody(cx,
						strconv.Itoa(readiness.CheckCount)),
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				}},
			}}
		}
		summary := locales.ReadinessCounts(cx, strconv.Itoa(current.Counts.Blocker),
			strconv.Itoa(current.Counts.Warning), strconv.Itoa(current.Counts.Info))
		if current.DismissedCount > 0 {
			summary += " · " + locales.ReadinessDismissedNote(cx,
				strconv.Itoa(current.DismissedCount))
		}
		rows := make([]core.Node, 0, len(shown))
		for _, finding := range shown {
			finding := finding
			rows = append(rows, core.View{
				Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 10,
					Padding: core.Symmetric(9, 0), Borders: core.Edges{Bottom: 1}},
				StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
				Children: []core.Node{
					ui.Badge{TextFunc: func() string { return readinessSeverityLabel(cx, finding.Severity) },
						VariantFunc: func() ui.BadgeVariant {
							switch finding.Severity {
							case readiness.SeverityBlocker:
								return ui.BadgeDanger
							case readiness.SeverityWarning:
								return ui.BadgeWarn
							default:
								return ui.BadgeNeutral
							}
						}},
					core.View{Style: core.Style{FlexGrow: 1, FlexBasis: core.Pt(0), Gap: 2},
						Children: []core.Node{
							core.Text{Content: readinessTitle(cx, finding),
								Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
							core.Text{Content: readinessDetail(cx, finding),
								Style:     core.Style{FontSize: 12},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
						}},
					core.View{Style: core.Style{Direction: core.Row, Gap: 6}, Children: []core.Node{
						ui.Button{Text: locales.ReadinessOpen(cx), Variant: ui.ButtonSecondary,
							Disabled: func() bool { return finding.Entity.Type == "period" },
							OnPress:  func() { open(finding) },
							TestID:   "readiness-open-" + finding.Key()},
						ui.Button{Text: locales.ReadinessDismiss(cx), Variant: ui.ButtonGhost,
							OnPress: func() { dismiss(finding.Key()) },
							TestID:  "readiness-dismiss-" + finding.Key()},
					}},
				},
			})
		}
		return core.View{Style: core.Style{Gap: 6}, Children: append([]core.Node{
			core.Text{Content: summary, Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}, rows...)}
	})

	button := func(label func(*core.Scope) string) core.Node {
		return ui.Button{Text: label(cx), Busy: busy.Get, OnPress: run, TestID: "readiness-run"}
	}

	node := dataCard(cx,
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 12},
			Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 1, FlexBasis: core.Pt(0), Gap: 2}, Children: []core.Node{
					core.Text{Content: locales.ReadinessTitle(cx),
						Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
					core.Text{Content: locales.ReadinessDescription(cx),
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
						MaxLines: 2},
				}},
				core.Show{When: func() bool { return report.Get() == nil },
					Then: func(cx *core.Scope) core.Node {
						return button(locales.ReadinessRun)
					}},
				core.Show{When: func() bool { return report.Get() != nil },
					Then: func(cx *core.Scope) core.Node {
						return button(locales.ReadinessRerun)
					}},
				ui.Button{Text: locales.ReadinessReviewAgent(cx), Variant: ui.ButtonGhost,
					Busy:     agentBusy.Get,
					Disabled: func() bool { return report.Get() == nil || agentBusy.Get() },
					OnPress:  review, TestID: "readiness-review-agent"},
			}},
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		body,
	)
	return node, reset
}

func readinessSeverityLabel(cx *core.Scope, severity readiness.Severity) string {
	switch severity {
	case readiness.SeverityBlocker:
		return locales.ReadinessSeverityBlocker(cx)
	case readiness.SeverityWarning:
		return locales.ReadinessSeverityWarning(cx)
	default:
		return locales.ReadinessSeverityInfo(cx)
	}
}

func readinessTitle(cx *core.Scope, finding readiness.Finding) string {
	switch finding.CheckID {
	case "C1":
		return locales.ReadinessCheckC1Title(cx)
	case "C3":
		return locales.ReadinessCheckC3Title(cx)
	case "C5":
		return locales.ReadinessCheckC5Title(cx)
	case "C6":
		return locales.ReadinessCheckC6Title(cx)
	case "N1":
		return locales.ReadinessCheckN1Title(cx)
	case "N2":
		return locales.ReadinessCheckN2Title(cx)
	case "N3":
		return locales.ReadinessCheckN3Title(cx)
	case "N5":
		return locales.ReadinessCheckN5Title(cx)
	case "N6":
		return locales.ReadinessCheckN6Title(cx)
	case "T1":
		return locales.ReadinessCheckT1Title(cx)
	case "T2":
		return locales.ReadinessCheckT2Title(cx)
	case "T3":
		return locales.ReadinessCheckT3Title(cx)
	case "T4":
		return locales.ReadinessCheckT4Title(cx)
	case "D1":
		return locales.ReadinessCheckD1Title(cx)
	case "D2":
		return locales.ReadinessCheckD2Title(cx)
	case "D3":
		return locales.ReadinessCheckD3Title(cx)
	default:
		return finding.CheckID
	}
}

func readinessDetail(cx *core.Scope, finding readiness.Finding) string {
	fact := func(key string) string {
		value, ok := finding.Facts[key]
		if !ok {
			return ""
		}
		return fmt.Sprint(value)
	}
	switch finding.CheckID {
	case "C1":
		return locales.ReadinessCheckC1Detail(cx, fact("source_name"),
			fact("scope"), fact("year"))
	case "C3":
		return locales.ReadinessCheckC3Detail(cx, fact("source_name"),
			fact("occurred"), fact("period"))
	case "C5":
		return locales.ReadinessCheckC5Detail(cx, fact("customer_name"),
			fact("question_text"))
	case "C6":
		return locales.ReadinessCheckC6Detail(cx, fact("observation"))
	case "N1":
		return locales.ReadinessCheckN1Detail(cx, fact("source_name"),
			fact("amount"), fact("unit"), fact("ef_input_unit"))
	case "N2":
		return locales.ReadinessCheckN2Detail(cx, fact("source_name"),
			fact("amount"), fact("unit"), fact("detail"), fact("ratio"))
	case "N3":
		return locales.ReadinessCheckN3Detail(cx, fact("source_name"),
			fact("amount"), fact("unit"), fact("occurred"))
	case "N5":
		return locales.ReadinessCheckN5Detail(cx, fact("year"), fact("bases"))
	case "N6":
		return locales.ReadinessCheckN6Detail(cx, fact("observation"))
	case "T1":
		return locales.ReadinessCheckT1Detail(cx, fact("unevidenced_count"),
			fact("total_count"), fact("co2e_share_pct"))
	case "T2":
		return locales.ReadinessCheckT2Detail(cx, fact("source_name"),
			fact("created_at"))
	case "T3":
		return locales.ReadinessCheckT3Detail(cx, fact("source_name"),
			fact("factor_code"), fact("ef_year"), fact("reporting_year"))
	case "T4":
		return locales.ReadinessCheckT4Detail(cx, fact("source_name"),
			fact("factor_code"), fact("ef_source"))
	case "D1":
		return locales.ReadinessCheckD1Detail(cx)
	case "D2":
		if fact("reason") == "deleted" {
			return locales.ReadinessCheckD2DetailDeleted(cx, fact("source_name"),
				fact("frozen_co2e_kg"))
		}
		return locales.ReadinessCheckD2DetailEdited(cx, fact("source_name"),
			fact("frozen_co2e_kg"), fact("live_co2e_kg"))
	case "D3":
		return locales.ReadinessCheckD3Detail(cx, fact("supplier_name"), fact("due_date"))
	default:
		return strings.TrimSpace(fact("observation"))
	}
}
