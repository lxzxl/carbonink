package app

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// rebindPanel is 1.x's RebindEfDrawer: the current pinned factor, a
// searchable factor list, an optional cross-family amount override, and a
// live preview before the swap is committed.
type rebindPanel struct {
	open       *core.Signal[bool]
	activityID *core.Signal[string]
	selectedEF *core.Signal[string]
	override   *core.Signal[string]
	search     *core.Signal[string]
	status     *core.Signal[string]
	busy       *core.Signal[bool]
	factors    *core.Signal[[]store.EmissionFactor]
	filtered   *core.Signal[[]store.EmissionFactor]
	guide      *guidance
	dataRev    *core.Signal[int]
}

type rebindPreview struct {
	ef            store.EmissionFactor
	amount        float64
	unit          string
	co2e          float64
	converted     bool
	cross         bool
	needsOverride bool
}

func newRebindPanel(cx *core.Scope, s *Session, dataRev *core.Signal[int]) *rebindPanel {
	return &rebindPanel{
		open:       core.NewSignal(cx, false),
		activityID: core.NewSignal(cx, ""),
		selectedEF: core.NewSignal(cx, ""),
		override:   core.NewSignal(cx, ""),
		search:     core.NewSignal(cx, ""),
		status:     core.NewSignal(cx, ""),
		busy:       core.NewSignal(cx, false),
		factors:    core.NewSignalFunc(cx, []store.EmissionFactor(nil), nil),
		filtered:   core.NewSignalFunc(cx, []store.EmissionFactor(nil), nil),
		guide:      newGuidance(cx, s, "ef-rebind"),
		dataRev:    dataRev,
	}
}

func (p *rebindPanel) show(cx *core.Scope, s *Session, id string) {
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	p.activityID.Set(id)
	p.selectedEF.Set("")
	p.override.Set("")
	p.search.Set("")
	p.status.Set("")
	p.busy.Set(false)
	p.factors.Set(nil)
	p.filtered.Set(nil)
	activity := s.activityByID(id)
	if activity == nil {
		p.status.Set(locales.RebindErrorToast(s.scope, "activity not found"))
		p.open.Set(true)
		return
	}
	factors, err := s.db.ListEmissionFactors(context.Background(), store.EFFilter{Limit: 500})
	if err != nil {
		p.status.Set(locales.RebindErrorToast(s.scope, err.Error()))
		p.open.Set(true)
		return
	}
	current := dataEFKeyFromActivity(*activity)
	found := false
	for _, factor := range factors {
		if dataEFKey(factor) == current {
			found = true
			break
		}
	}
	if !found {
		ef, err := s.db.EmissionFactorByKey(context.Background(), store.EmissionFactorKey{
			FactorCode: activity.EFFactorCode, Year: activity.EFYear, Source: activity.EFSource,
			Geography: activity.EFGeography, DatasetVersion: activity.EFDatasetVersion,
		})
		if err == nil && ef != nil {
			factors = append(factors, *ef)
		}
	}
	p.factors.Set(factors)
	p.filtered.Set(factors)
	p.open.Set(true)
}

// preview resolves the selected factor against the activity. A conversion
// failure outside the fuel's binding is the cross-family case: the user must
// enter the amount in the new factor's unit.
func (p *rebindPanel) preview(s *Session, activity *store.Activity) *rebindPreview {
	out := p.basis(s, activity)
	if out == nil || !out.cross {
		return out
	}
	if value, ok := positiveNumber(p.override.Get()); ok {
		out.amount = value
		out.needsOverride = false
		out.co2e = store.EmissionCO2eKg(out.amount, out.ef)
	}
	return out
}

// basis is the conversion the factors dictate, before the cross-family
// override: it reads no text field, so typing an amount does not rebuild the
// panel that holds it.
func (p *rebindPanel) basis(s *Session, activity *store.Activity) *rebindPreview {
	if activity == nil {
		return nil
	}
	key := p.selectedEF.Get()
	if key == "" {
		return nil
	}
	var selected *store.EmissionFactor
	factors := p.factors.Get()
	for i := range factors {
		if dataEFKey(factors[i]) == key {
			selected = &factors[i]
			break
		}
	}
	if selected == nil {
		return nil
	}
	out := &rebindPreview{ef: *selected, unit: selected.InputUnit}
	if activity.Unit == selected.InputUnit {
		out.amount = activity.Amount
	} else {
		amount, err := s.db.ConvertAmount(context.Background(), activity.Amount,
			activity.Unit, selected.InputUnit, activity.FuelCode)
		if err != nil {
			out.cross = true
			out.needsOverride = true
			return out
		} else {
			out.amount = amount
			out.converted = true
		}
	}
	out.co2e = store.EmissionCO2eKg(out.amount, *selected)
	return out
}

func positiveNumber(text string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil || value <= 0 {
		return 0, false
	}
	return value, true
}

func (p *rebindPanel) drawer(cx *core.Scope, s *Session) core.Node {
	previewOf := core.NewMemoFunc(cx, func() *rebindPreview {
		return p.preview(s, s.activityByID(p.activityID.Get()))
	}, nil)
	basisOf := core.NewMemoFunc(cx, func() *rebindPreview {
		return p.basis(s, s.activityByID(p.activityID.Get()))
	}, nil)
	body := []core.Node{core.Show{When: p.open.Get, Then: func(cx *core.Scope) core.Node {
		activity := s.activityByID(p.activityID.Get())
		if activity == nil {
			return core.Text{ContentFunc: p.status.Get, Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		}
		return core.View{Style: core.Style{Gap: 16}, Children: []core.Node{
			p.guide.node(s, func() bool { return p.open.Get() }),
			p.currentCard(cx, *activity),
			p.pickerSection(cx),
			core.Dynamic(func(cx *core.Scope) core.Node {
				basis := basisOf.Get()
				if basis == nil || !basis.cross {
					return core.View{}
				}
				return p.overrideCard(cx, *activity, basis, previewOf.Get)
			}),
			core.Dynamic(func(cx *core.Scope) core.Node {
				selected := previewOf.Get()
				if selected == nil || selected.cross {
					return core.View{}
				}
				return p.previewCard(cx, *activity, selected)
			}),
			core.Show{When: func() bool { return p.status.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: p.status.Get, Style: core.Style{FontSize: 12},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
				}},
		}}
	}}}
	return sideDrawer(cx, p.open, locales.RebindDrawerHeading(cx), 480, body, []core.Node{
		ui.Button{Text: locales.RebindCancel(cx), Variant: ui.ButtonSecondary, Flex: 1,
			OnPress: func() { p.open.Set(false) }, TestID: "rebind-cancel"},
		ui.Button{Text: locales.RebindConfirm(cx), Busy: p.busy.Get, Flex: 1,
			Disabled: func() bool {
				selected := previewOf.Get()
				return selected == nil || selected.needsOverride || p.busy.Get()
			},
			OnPress: func() { p.save(cx, s) }, TestID: "rebind-confirm"},
	}, "rebind-drawer", locales.RebindCancel(cx))
}

func (p *rebindPanel) currentCard(cx *core.Scope, activity store.Activity) core.Node {
	colors := ui.ColorsOf(cx)
	return core.View{
		Style: core.Style{Gap: 5, Padding: core.All(12), CornerRadius: 8, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: colors.Inset(), BorderColor: colors.Line()}
		},
		Children: []core.Node{
			core.Text{Content: locales.RebindCurrentLabel(cx),
				Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
			core.Text{Content: activity.Source + " · " + activity.OccurredAt,
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(colors.Muted)},
			core.Text{Content: commaFloat(activity.Amount) + " " + activity.Unit,
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(colors.Muted)},
			core.Text{Content: activity.EFFactorCode + " @ " + activity.EFSource + " " +
				strconv.Itoa(activity.EFYear), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(colors.Muted)},
			core.Text{Content: locales.RebindCurrentCo2e(cx) + ": " +
				commaFloat(activity.CO2eKg) + " " + locales.UnitKgCo2e(cx),
				Style: core.Style{FontSize: 13, FontWeight: ui.Medium}},
		},
	}
}

func (p *rebindPanel) pickerSection(cx *core.Scope) core.Node {
	colors := ui.ColorsOf(cx)
	search := func(text string) {
		p.search.Set(text)
		p.filtered.Set(filterFactors(p.factors.Get(), text))
	}
	selectEF := func(key string) {
		p.selectedEF.Set(key)
		p.override.Set("")
		p.status.Set("")
	}
	list := core.Dynamic(func(cx *core.Scope) core.Node {
		rows := p.filtered.Get()
		children := make([]core.Node, 0, len(rows))
		for index, factor := range rows {
			key := dataEFKey(factor)
			children = append(children, ui.Radio{
				Checked:  func() bool { return p.selectedEF.Get() == key },
				OnChange: func(bool) { selectEF(key) },
				Label:    dataEFName(cx, factor),
				TestID:   "rebind-ef-" + strconv.Itoa(index),
				Style:    core.Style{AlignItems: core.AlignStart, Padding: core.Symmetric(7, 8)},
				Children: []core.Node{core.View{Style: core.Style{Gap: 2, FlexGrow: 1,
					FlexShrink: 1, MinWidth: core.Pt(0)}, Children: []core.Node{
					core.Text{Content: dataEFName(cx, factor),
						Style: core.Style{FontSize: 13, FlexShrink: 1, MinWidth: core.Pt(0)}},
					core.Text{Content: dataEFDetail(factor),
						Style:     core.Style{FontSize: 11, FlexShrink: 1, MinWidth: core.Pt(0)},
						StyleFunc: ui.Colored(colors.Muted)},
				}}},
			})
		}
		return core.Scroll{
			TestID: "rebind-ef-list",
			Style:  core.Style{Height: core.Pt(300), BorderWidth: 1, CornerRadius: 8, Gap: 0},
			StyleFunc: func() core.Style {
				return core.Style{BorderColor: colors.Line(), Background: colors.Surface()}
			},
			Children: []core.Node{core.View{Style: core.Style{Gap: 0}, Children: children}},
		}
	})
	return core.View{Style: core.Style{Gap: 8}, Children: []core.Node{
		core.Text{Content: locales.RebindPickerHeading(cx),
			Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
		ui.Input{Value: p.search.Get, OnChange: search,
			Placeholder: locales.ActivitiesSearchPlaceholder(cx),
			TestID:      "rebind-ef-search", LabelFunc: func() string {
				return locales.ActivitiesSearchPlaceholder(cx)
			}},
		core.Show{When: func() bool { return len(p.filtered.Get()) == 0 },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{Content: locales.ActivitiesFormEfNone(cx),
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(colors.Danger)}
			}},
		core.Show{When: func() bool { return len(p.filtered.Get()) > 0 }, Then: func(*core.Scope) core.Node {
			return list
		}},
	}}
}

func filterFactors(all []store.EmissionFactor, text string) []store.EmissionFactor {
	query := strings.ToLower(strings.TrimSpace(text))
	if query == "" {
		return all
	}
	out := make([]store.EmissionFactor, 0, len(all))
	for _, factor := range all {
		haystack := strings.ToLower(factor.NameZH + "\x1f" + factor.NameEN + "\x1f" +
			dataEFDetail(factor))
		if strings.Contains(haystack, query) {
			out = append(out, factor)
		}
	}
	return out
}

func (p *rebindPanel) overrideCard(cx *core.Scope, activity store.Activity,
	basis *rebindPreview, current func() *rebindPreview) core.Node {
	colors := ui.ColorsOf(cx)
	children := []core.Node{
		core.Text{Content: locales.RebindUnitCrossFamily(cx, activity.Unit, basis.ef.InputUnit),
			Style: core.Style{FontSize: 12}},
		core.Text{Content: locales.RebindOverrideAmountLabel(cx, basis.ef.InputUnit),
			Style: core.Style{FontSize: 11, FontWeight: ui.Medium}},
		ui.Input{Value: p.override.Get, OnChange: p.override.Set,
			Placeholder: locales.RebindOverrideAmountPlaceholder(cx, basis.ef.InputUnit),
			TestID:      "rebind-override",
			LabelFunc: func() string {
				return locales.RebindOverrideAmountLabel(cx, basis.ef.InputUnit)
			}},
		core.Dynamic(func(cx *core.Scope) core.Node {
			selected := current()
			if selected == nil || selected.needsOverride {
				return core.View{}
			}
			return core.Text{
				Content: locales.RebindNewCo2e(cx) + ": " +
					commaFloat(store.EmissionCO2eKg(selected.amount, selected.ef)) + " " +
					locales.UnitKgCo2e(cx),
				Style: core.Style{FontSize: 13, FontWeight: ui.Medium},
			}
		}),
	}
	return core.View{
		Style: core.Style{Gap: 7, Padding: core.All(12), CornerRadius: 8, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.Alpha(colors.Warn(), 0.12),
				BorderColor: ui.Alpha(colors.Warn(), 0.4)}
		},
		Children: children,
	}
}

func (p *rebindPanel) previewCard(cx *core.Scope, activity store.Activity,
	selected *rebindPreview) core.Node {
	colors := ui.ColorsOf(cx)
	children := []core.Node{
		core.Text{Content: locales.RebindPreviewHeading(cx),
			Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
	}
	if selected.converted {
		children = append(children, core.Text{
			Content: locales.RebindUnitConversion(cx, commaFloat(activity.Amount), activity.Unit,
				commaFloat(selected.amount), selected.unit),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(colors.Muted),
		})
	}
	delta := selected.co2e - activity.CO2eKg
	pct := 0.0
	if activity.CO2eKg != 0 {
		pct = delta / activity.CO2eKg * 100
	}
	children = append(children,
		core.Text{Content: locales.RebindNewCo2e(cx) + ": " + commaFloat(selected.co2e) + " " +
			locales.UnitKgCo2e(cx), Style: core.Style{FontSize: 13, FontWeight: ui.Medium}},
		core.Text{Content: locales.RebindDelta(cx, fmt.Sprintf("%+.0f", delta),
			fmt.Sprintf("%+.1f", pct)), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(colors.Muted)})
	return core.View{
		Style: core.Style{Gap: 5, Padding: core.All(12), CornerRadius: 8, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: colors.Inset(), BorderColor: colors.Line()}
		},
		Children: children,
	}
}

func (p *rebindPanel) save(cx *core.Scope, s *Session) {
	if p.busy.Get() {
		return
	}
	activity := s.activityByID(p.activityID.Get())
	selected := p.preview(s, activity)
	if activity == nil || selected == nil || selected.needsOverride {
		return
	}
	p.busy.Set(true)
	p.status.Set("")
	_, err := s.db.UpdateActivity(context.Background(), activity.ID, store.ActivityInput{
		EmissionSourceID:  activity.EmissionSourceID,
		ReportingPeriodID: activity.ReportingPeriodID,
		OccurredAtStart:   activity.OccurredAt,
		OccurredAtEnd:     activity.OccurredAtEnd,
		Amount:            selected.amount,
		Unit:              selected.unit,
		EF: store.EmissionFactorKey{
			FactorCode: selected.ef.FactorCode, Year: selected.ef.Year, Source: selected.ef.Source,
			Geography: selected.ef.Geography, DatasetVersion: selected.ef.DatasetVersion,
		},
		FuelCode:     activity.FuelCode,
		Notes:        activity.Notes,
		ExtractionID: activity.ExtractionID,
	})
	p.busy.Set(false)
	if err != nil {
		p.status.Set(locales.RebindErrorToast(cx, err.Error()))
		return
	}
	p.open.Set(false)
	if p.dataRev != nil {
		_ = dataRefresh(s, p.dataRev)
	}
}
