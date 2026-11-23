package app

import (
	"context"
	"slices"
	"sort"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

type activitySort string

const (
	activitySortRecent  activitySort = "recent"
	activitySortOldest  activitySort = "oldest"
	activitySortCO2eAsc activitySort = "co2e_asc"
	activitySortCO2eDsc activitySort = "co2e_desc"
	activitySortSource  activitySort = "source"
)

func activitySortOptions(cx *core.Scope) []ui.Option[activitySort] {
	return []ui.Option[activitySort]{
		{Value: activitySortRecent, Label: locales.ActivitiesSortRecent(cx)},
		{Value: activitySortOldest, Label: locales.ActivitiesSortOldest(cx)},
		{Value: activitySortCO2eDsc, Label: locales.ActivitiesSortCo2eDesc(cx)},
		{Value: activitySortCO2eAsc, Label: locales.ActivitiesSortCo2eAsc(cx)},
		{Value: activitySortSource, Label: locales.ActivitiesSortSource(cx)},
	}
}

// activitiesScreen is the ledger list from 1.x: search, scope chips, sort,
// row-level provenance, and actions. The list virtualizes rows, so a large
// workspace does not build every activity up front.
func (s *Session) activitiesScreen(cx *core.Scope, dataRev *core.Signal[int],
	active *core.Signal[Screen]) core.Node {
	search := core.NewSignal(cx, "")
	scope := core.NewSignal(cx, 0)
	defaultPeriod := ""
	if len(s.periods) > 0 {
		defaultPeriod = s.periods[len(s.periods)-1].ID
	}
	period := core.NewSignal(cx, defaultPeriod)
	order := core.NewSignal(cx, activitySortRecent)
	selection := ui.NewSelection(cx, false)
	selectedID := core.NewSignal(cx, "")
	highlightID := core.NewSignal(cx, "")
	if jump := s.pendingActivity; jump != "" {
		s.pendingActivity = ""
		for _, activity := range s.activities {
			if activity.ID == jump {
				period.Set(activity.ReportingPeriodID)
				break
			}
		}
		highlightID.Set(jump)
		selectedID.Set(jump)
		selection.Set(jump)
	}
	clearSelection := func() {
		selection.Clear()
		selectedID.Set("")
	}

	searched := core.NewMemoFunc(cx, func() []store.Activity {
		_ = dataRev.Get()
		rows := s.activities
		if selected := period.Get(); selected != "" {
			rows = make([]store.Activity, 0, len(s.activities))
			for _, activity := range s.activities {
				if activity.ReportingPeriodID == selected {
					rows = append(rows, activity)
				}
			}
		}
		query := strings.ToLower(strings.TrimSpace(search.Get()))
		if query == "" {
			return rows
		}
		visible := make([]store.Activity, 0, len(rows))
		for _, activity := range rows {
			haystack := strings.ToLower(activity.Source + "\x1f" + activity.Unit + "\x1f" + activity.EFFactorCode)
			if strings.Contains(haystack, query) {
				visible = append(visible, activity)
			}
		}
		return visible
	}, slices.Equal)
	scopeCounts := core.NewMemo(cx, func() [4]int {
		var counts [4]int
		for _, activity := range searched.Get() {
			counts[0]++
			if activity.Scope >= 1 && activity.Scope <= 3 {
				counts[activity.Scope]++
			}
		}
		return counts
	})
	visible := core.NewMemoFunc(cx, func() []store.Activity {
		rows := searched.Get()
		if scope.Get() == 0 {
			rows = append([]store.Activity(nil), rows...)
		} else {
			filtered := make([]store.Activity, 0, len(rows))
			for _, activity := range rows {
				if activity.Scope == scope.Get() {
					filtered = append(filtered, activity)
				}
			}
			rows = filtered
		}
		sort.SliceStable(rows, func(i, j int) bool {
			a, b := rows[i], rows[j]
			switch order.Get() {
			case activitySortOldest:
				if a.OccurredAt != b.OccurredAt {
					return a.OccurredAt < b.OccurredAt
				}
			case activitySortCO2eAsc:
				if a.CO2eKg != b.CO2eKg {
					return a.CO2eKg < b.CO2eKg
				}
			case activitySortCO2eDsc:
				if a.CO2eKg != b.CO2eKg {
					return a.CO2eKg > b.CO2eKg
				}
			case activitySortSource:
				an, bn := strings.ToLower(a.Source), strings.ToLower(b.Source)
				if an != bn {
					return an < bn
				}
			default:
				if a.OccurredAtEnd != b.OccurredAtEnd {
					return a.OccurredAtEnd > b.OccurredAtEnd
				}
			}
			return a.ID < b.ID
		})
		return rows
	}, slices.Equal)

	filtersActive := func() bool {
		return strings.TrimSpace(search.Get()) != "" || scope.Get() != 0
	}
	emptyBecauseOfFilters := func() bool {
		if filtersActive() {
			return true
		}
		// A period with no rows is still a filter when other periods do have
		// data; without this the screen says "no activities yet" and hides the
		// way back to "All periods".
		return len(s.activities) > 0 && period.Get() != "" && len(visible.Get()) == 0
	}
	clearFilters := func() {
		search.Set("")
		scope.Set(0)
		period.Set("")
		clearSelection()
	}
	selectedActivity := func() string {
		id := selectedID.Get()
		for _, activity := range visible.Get() {
			if activity.ID == id {
				return id
			}
		}
		return ""
	}
	selectActivity := func(id string) {
		selection.Set(id)
		selectedID.Set(id)
	}

	lineagePanel := newLineagePanel(cx)
	rebindPanel := newRebindPanel(cx, s, dataRev)
	editDialog, _ := s.editableActivityDialog(cx, selectedID, dataRev)
	addTrigger, addDialog, showAdd := s.activityDialogPartsWithShow(cx, dataRev)
	importTrigger, importDialog, showImport := s.activityImportDialogPartsWithShow(cx, dataRev)
	if s.pendingNewActivity {
		s.pendingNewActivity = false
		s.scope.Post(showAdd)
	}
	preview := newDocumentPreview(cx)
	listRef := &core.Ref{}
	openPreview := func(id string) {
		if id == "" {
			return
		}
		document, err := s.db.DocumentByID(context.Background(), id)
		if err != nil || document == nil {
			return
		}
		s.openDocumentPreview(cx, preview, *document)
	}
	if highlight := highlightID.Get(); highlight != "" {
		cx.Effect(func() {
			index := slices.IndexFunc(visible.Get(), func(activity store.Activity) bool {
				return activity.ID == highlight
			})
			if index < 0 {
				return
			}
			listRef.Measure(func(_ core.Bounds, _ core.Bounds, ok bool) {
				if ok {
					listRef.ScrollToIndexAt(index, 0.5, 0, false)
				}
			})
		})
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
			Value: value, Label: label, TestID: "activities-scope-" + strconv.Itoa(value),
			Content: core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6},
				Children: []core.Node{
					core.Text{Content: label, Style: core.Style{FontSize: 12}},
					ui.Badge{TextFunc: func() string {
						return strconv.Itoa(scopeCounts.Get()[value])
					}},
				}},
		})
	}
	periodOptions := []ui.Option[string]{
		{Value: "", Label: locales.ActivitiesPeriodAll(cx), TestID: "activities-period-all"},
	}
	for i := len(s.periods) - 1; i >= 0; i-- {
		row := s.periods[i]
		periodOptions = append(periodOptions, ui.Option[string]{
			Value: row.ID, Label: strconv.Itoa(row.Year), TestID: "activities-period-" + row.ID,
		})
	}

	headerActions := []core.Node{
		core.Show{When: func() bool { return len(s.activities) > 0 }, Then: func(*core.Scope) core.Node {
			return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
				Children: []core.Node{addTrigger, importTrigger}}
		}},
		addDialog,
		importDialog,
		editDialog,
		rebindPanel.drawer(cx, s),
		s.deleteActivityButton(cx, selectedID, dataRev),
		ui.Button{Text: locales.LineageOpenButton(cx), Variant: ui.ButtonSecondary,
			Disabled: func() bool { return selectedActivity() == "" },
			OnPress: func() {
				id := selectedActivity()
				if id != "" {
					lineagePanel.show(cx, s, "activity_data", id)
				}
			}, TestID: "activity-lineage"},
	}

	listEmpty := core.Dynamic(func(cx *core.Scope) core.Node {
		children := []core.Node{}
		switch {
		case emptyBecauseOfFilters():
			children = append(children,
				core.Text{Content: locales.ActivitiesFilterEmpty(cx),
					Style: core.Style{FontSize: 13}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
			children = append(children, ui.Button{Text: locales.ActivitiesFilterClear(cx),
				Variant: ui.ButtonGhost, TestID: "activities-filter-clear",
				OnPress: clearFilters})
		case len(s.sources) == 0:
			children = append(children,
				core.Text{Content: locales.ActivitiesEmptyNoSourcesTitle(cx),
					Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
				core.Text{Content: locales.ActivitiesEmptyNoSourcesBody(cx),
					Style:     core.Style{FontSize: 12, TextAlign: core.TextAlignCenter},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
			children = append(children, ui.Button{Text: locales.ActivitiesEmptyNoSourcesCta(cx),
				OnPress: func() {
					s.pendingSourceCatalog = true
					active.Set(ScreenSources)
				}, TestID: "activities-empty-sources"})
		default:
			children = append(children,
				core.Text{Content: locales.ActivitiesEmptyTitle(cx),
					Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
				core.Text{Content: locales.ActivitiesEmptyBody(cx),
					Style:     core.Style{FontSize: 12, TextAlign: core.TextAlignCenter},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
			children = append(children, core.View{Style: core.Style{Direction: core.Row,
				AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
				ui.Button{Text: locales.ActivitiesAddButton(cx), OnPress: showAdd,
					TestID: "activities-empty-add"},
				ui.Button{Text: locales.ActivityImportButton(cx), Variant: ui.ButtonSecondary,
					OnPress: showImport, TestID: "activities-empty-import"},
			}})
		}
		return core.View{Style: core.Style{Padding: core.All(28), Gap: 8, AlignItems: core.AlignCenter,
			JustifyContent: core.JustifyCenter}, Children: children}
	})

	rowNode := func(cx *core.Scope, row core.ListRow) core.Node {
		activity := func() (store.Activity, bool) {
			rows := visible.Get()
			index := row.Index()
			if index < 0 || index >= len(rows) {
				return store.Activity{}, false
			}
			return rows[index], true
		}
		text := func(value func(store.Activity) string) func() string {
			return func() string {
				if current, ok := activity(); ok {
					return value(current)
				}
				return ""
			}
		}
		provenance := func(cx *core.Scope) core.Node {
			current, ok := activity()
			if !ok {
				return core.View{}
			}
			children := []core.Node{}
			switch {
			case current.SourceDocumentFilename != "" && current.SourceDocumentID != "":
				children = append(children, activityProvenanceLink(cx, lucide.FileText,
					locales.ActivitiesFromDocument(cx, current.SourceDocumentFilename),
					"activity-document-"+current.ID, func() { openPreview(current.SourceDocumentID) }))
			case current.InboundQuestionnaireID != "":
				label := locales.ActivitiesFromSupplierDisclosure(cx)
				if current.InboundSupplierName != "" {
					label += " · " + current.InboundSupplierName
				}
				children = append(children, activityProvenanceLink(cx, lucide.Download, label,
					"activity-supplier-"+current.ID, func() {
						s.pendingSupplierDisclosure = current.InboundQuestionnaireID
						active.Set(ScreenSupplierDisclosures)
					}))
			case current.FromLedgerImport:
				children = append(children, ui.Icon(lucide.FileSpreadsheet, 12, ui.ColorsOf(cx).Muted),
					core.Text{Content: locales.ActivitiesFromLedgerImport(cx),
						Style:     core.Style{FontSize: 11, FlexShrink: 1, MinWidth: core.Pt(0)},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1})
			default:
				children = append(children, ui.Icon(lucide.PenLine, 12, ui.ColorsOf(cx).Muted),
					core.Text{Content: locales.ActivitiesSourceManual(cx),
						Style:     core.Style{FontSize: 11, FlexShrink: 1, MinWidth: core.Pt(0)},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1})
			}
			return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 4},
				Children: children}
		}
		rowAction := func(show func()) {
			rows := visible.Get()
			index := row.Index()
			if index < 0 || index >= len(rows) {
				return
			}
			selectActivity(rows[index].ID)
			show()
		}

		children := []core.Node{
			core.View{Style: core.Style{Gap: 3, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
						Children: []core.Node{
							core.Text{ContentFunc: text(func(a store.Activity) string { return a.Source }),
								Style: core.Style{FontSize: 13, FontWeight: ui.Semibold,
									FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
							core.Text{ContentFunc: text(func(a store.Activity) string { return dataActivityDate(a) }),
								Style:     core.Style{FontSize: 11, FlexShrink: 0},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
						}},
					core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 4},
						Children: []core.Node{
							core.Text{ContentFunc: text(func(a store.Activity) string {
								return commaFloat(a.Amount) + " " + a.Unit
							}), Style: core.Style{FontSize: 12, FlexShrink: 1, MinWidth: core.Pt(0)},
								MaxLines: 1},
							core.Text{Content: "→", Style: core.Style{FontSize: 12},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
							core.Text{ContentFunc: text(func(a store.Activity) string {
								return commaFloat(a.CO2eKg) + " " + locales.UnitKgCo2e(cx)
							}), Style: core.Style{FontSize: 12, FontWeight: ui.Medium,
								FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
						}},
					core.Text{ContentFunc: text(func(a store.Activity) string {
						return a.EFFactorCode + " (" + a.EFSource + " · " + strconv.Itoa(a.EFYear) +
							" · " + a.EFGeography + ")"
					}), Style: core.Style{FontSize: 11, FontFamily: ui.Mono, FlexShrink: 1,
						MinWidth: core.Pt(0)},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
					provenance(cx),
				}},
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 2,
				FlexShrink: 0}, Children: []core.Node{
				ui.Button{Text: locales.LineageOpenButton(cx), Variant: ui.ButtonGhost, Size: ui.SizeSmall,
					OnPress: func() {
						rowAction(func() {
							lineagePanel.show(cx, s, "activity_data", selectedActivity())
						})
					}},
				ui.Button{Text: locales.RebindButton(cx), Variant: ui.ButtonGhost, Size: ui.SizeSmall,
					OnPress: func() {
						rowAction(func() {
							rebindPanel.show(cx, s, selectedActivity())
						})
					}, TestID: "activity-rebind"},
			}},
		}
		return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 10,
			FlexGrow: 1, MinWidth: core.Pt(0), CornerRadius: 6}, StyleFunc: func() core.Style {
			if current, ok := activity(); ok && current.ID == highlightID.Get() {
				return core.Style{Background: ui.Alpha(ui.ColorsOf(cx).Warn(), 0.12)}
			}
			return core.Style{}
		}, Children: children}
	}

	return core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
		Padding: core.All(16), Gap: 10}, Children: []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Wrap: core.Wrap,
			Gap: 8}, Children: append([]core.Node{
			dataHeading(cx, locales.NavActivities(cx), ""),
			core.Text{ContentFunc: func() string {
				rows := visible.Get()
				if filtersActive() {
					return locales.ActivitiesCount(cx, len(rows)) + " / " +
						locales.ActivitiesCount(cx, len(s.activities))
				}
				return locales.ActivitiesCount(cx, len(rows))
			}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			core.View{Style: core.Style{FlexGrow: 1}},
		}, headerActions...)},
		core.Show{When: func() bool {
			_ = dataRev.Get()
			return len(s.activities) > 0
		}, Then: func(cx *core.Scope) core.Node {
			return core.View{Style: core.Style{Gap: 8}, Children: []core.Node{
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
					core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(180)},
						Children: []core.Node{
							ui.Input{Value: search.Get,
								Placeholder: locales.ActivitiesSearchPlaceholder(cx),
								OnChange: func(value string) {
									search.Set(value)
									clearSelection()
								}, TestID: "activities-search", Role: core.RoleSearchField,
								LabelFunc: func() string {
									return locales.ActivitiesSearchPlaceholder(cx)
								}},
						}},
					ui.Select[activitySort]{Options: activitySortOptions(cx), Value: order.Get,
						OnChange: order.Set, Label: locales.SortLabel(cx), TestID: "activities-sort",
						Style: core.Style{Width: core.Pt(180)}},
					core.Show{When: func() bool { return len(s.periods) > 1 },
						Then: func(cx *core.Scope) core.Node {
							return ui.Select[string]{Options: periodOptions, Value: period.Get,
								OnChange: func(value string) {
									period.Set(value)
									clearSelection()
								}, Label: locales.ActivitiesFormPeriod(cx), TestID: "activities-period",
								Style: core.Style{Width: core.Pt(130)}}
						}},
					core.Show{When: filtersActive, Then: func(*core.Scope) core.Node {
						return ui.Button{Text: locales.ActivitiesFilterClear(cx),
							Variant: ui.ButtonGhost, TestID: "activities-filter-clear",
							OnPress: clearFilters}
					}},
				}},
				ui.Tabs[int]{Options: scopeOptions, Value: scope.Get, Size: ui.SizeSmall,
					Label: locales.SourcesFormScope(cx),
					OnChange: func(value int) {
						scope.Set(value)
						clearSelection()
					}, TestID: "activities-scope-filter"},
			}}
		}},
		ui.List{
			TestID: "activities-table", Label: locales.ActivitiesTitle(cx),
			Ref:   listRef,
			Count: func() int { return len(visible.Get()) },
			Key:   func(index int) any { return visible.Get()[index].ID },
			Row:   rowNode,
			RowLabel: func(index int) string {
				rows := visible.Get()
				if index < 0 || index >= len(rows) {
					return ""
				}
				return rows[index].Source + " · " + dataActivityDate(rows[index])
			},
			Selection: selection,
			OnSelectionChange: func(chosen *ui.Selection) {
				keys := chosen.Keys()
				if len(keys) == 0 {
					selectedID.Set("")
					return
				}
				if id, ok := keys[len(keys)-1].(string); ok {
					selectedID.Set(id)
				}
			},
			Empty:         listEmpty,
			EstimatedSize: 96,
			Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
				CornerRadius: 8, BorderWidth: 1, BorderColor: ui.ColorsOf(cx).Border(),
				Background: ui.ColorsOf(cx).Surface()},
			ListStyle: core.Style{Padding: core.All(0)},
			RowStyle: core.Style{Padding: core.Symmetric(10, 12), AlignItems: core.AlignStart,
				CornerRadius: 0},
			RowStyleFunc: func() core.Style {
				return core.Style{Borders: core.Edges{Bottom: 1}, BorderColor: ui.ColorsOf(cx).Line()}
			},
		},
		lineagePanel.drawer(cx, s),
		s.documentPreviewDialog(cx, preview),
	}}
}

func dataActivityDate(activity store.Activity) string {
	if len(activity.OccurredAt) >= 10 {
		return activity.OccurredAt[:10]
	}
	return activity.OccurredAt
}

// activityProvenanceLink is ui.Link with one-line text. ui.Link renders its
// label without MaxLines, so a long filename or supplier name would grow the
// row instead of truncating.
func activityProvenanceLink(cx *core.Scope, icon func() *core.SVG, label, testID string,
	onPress func()) core.Node {
	return base.Link{
		TestID: testID, Label: label,
		OnPress: func(core.PressEvent) { onPress() },
		Style: core.Style{Group: "activity-provenance", Direction: core.Row,
			AlignItems: core.AlignCenter, Gap: 4, FlexShrink: 1, MinWidth: core.Pt(0),
			CornerRadius: 4},
		StyleFunc: func() core.Style { return core.Style{FocusVisible: ui.FocusRing(cx, 2)} },
		Children: []core.Node{
			ui.Icon(icon, 12, ui.ColorsOf(cx).Muted),
			core.Text{Content: label, MaxLines: 1,
				Style: core.Style{FontSize: 11, FlexShrink: 1, MinWidth: core.Pt(0),
					GroupStyle: &core.GroupStyle{Name: "activity-provenance",
						Hover: &core.Style{TextDecoration: core.TextDecorationUnderline}}},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Accent)},
		},
	}
}
