package app

import (
	"context"
	"io"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/activityimport"
	"app.carbonink.desktop/internal/efmatch"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/i18n"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// importWizard keeps one staged ledger. Signals drive the dialog's re-render;
// the grid, groups, and factor options are plain fields because only the
// revision signal needs to notify.
type importWizard struct {
	step   *core.Signal[int]
	rev    *core.Signal[int]
	status *core.Signal[string]
	result *core.Signal[string]
	busy   *core.Signal[bool]

	periodID *core.Signal[string]
	dataRev  *core.Signal[int]
	grid     *activityimport.Grid
	data     []byte
	filename string
	mapping  activityimport.Mapping
	valid    activityimport.Validation

	sourceIDs map[string]*core.Signal[string]

	creatorName     *core.Signal[string]
	creatorScope    *core.Signal[int]
	creatorSite     *core.Signal[string]
	creatorCategory *core.Signal[string]
	creatorStatus   *core.Signal[string]
	creatorBusy     *core.Signal[bool]

	groups   []activityimport.Group
	outliers []activityimport.Issue
	// outlierRatio is the per-workspace multiplier Settings exposes; it is
	// fixed for one wizard run so a save elsewhere cannot shift warnings
	// under the user.
	outlierRatio float64
	efOptions    map[string][]store.EmissionFactor
	efKeys       map[string]*core.Signal[string]
	fuels        map[string]*core.Signal[string]
	recs         map[string][]efmatch.Recommendation
	recBusy      map[string]bool
	recStatus    map[string]string
	// recGen invalidates in-flight recommendations when the wizard restarts.
	recGen int

	failures []store.ImportFailure
}

// activityImportDialog is the Activities toolbar's batch-import entry.
func (s *Session) activityImportDialog(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	node, _ := s.activityImportDialogWithShow(cx, dataRev)
	return node
}

func (s *Session) activityImportDialogWithShow(cx *core.Scope,
	dataRev *core.Signal[int]) (core.Node, func()) {
	trigger, dialog, show := s.activityImportDialogPartsWithShow(cx, dataRev)
	return core.View{Children: []core.Node{trigger, dialog}}, show
}

// activityImportDialogPartsWithShow separates the toolbar trigger from the
// wizard so the activities empty state can open the same mounted dialog.
func (s *Session) activityImportDialogPartsWithShow(cx *core.Scope,
	dataRev *core.Signal[int]) (core.Node, core.Node, func()) {
	open := core.NewSignal(cx, false)
	w := &importWizard{
		step:            core.NewSignal(cx, 0),
		rev:             core.NewSignal(cx, 0),
		status:          core.NewSignal(cx, ""),
		result:          core.NewSignal(cx, ""),
		busy:            core.NewSignal(cx, false),
		periodID:        core.NewSignal(cx, ""),
		dataRev:         dataRev,
		outlierRatio:    importOutlierRatio(context.Background(), s.db),
		sourceIDs:       map[string]*core.Signal[string]{},
		creatorName:     core.NewSignal(cx, ""),
		creatorScope:    core.NewSignal(cx, 1),
		creatorSite:     core.NewSignal(cx, ""),
		creatorCategory: core.NewSignal(cx, ""),
		creatorStatus:   core.NewSignal(cx, ""),
		creatorBusy:     core.NewSignal(cx, false),
		efOptions:       map[string][]store.EmissionFactor{},
		efKeys:          map[string]*core.Signal[string]{},
		fuels:           map[string]*core.Signal[string]{},
		recs:            map[string][]efmatch.Recommendation{},
		recBusy:         map[string]bool{},
		recStatus:       map[string]string{},
	}
	reset := func() {
		w.grid = nil
		w.data = nil
		w.filename = ""
		w.mapping = nil
		w.valid = activityimport.Validation{}
		w.sourceIDs = map[string]*core.Signal[string]{}
		w.groups = nil
		w.outliers = nil
		w.efOptions = map[string][]store.EmissionFactor{}
		w.efKeys = map[string]*core.Signal[string]{}
		w.fuels = map[string]*core.Signal[string]{}
		w.recs = map[string][]efmatch.Recommendation{}
		w.recBusy = map[string]bool{}
		w.recStatus = map[string]string{}
		w.recGen++
		w.failures = nil
		w.creatorName.Set("")
		w.creatorStatus.Set("")
		w.creatorCategory.Set("")
		w.step.Set(0)
		w.status.Set("")
		w.result.Set("")
		if period := dataYearPeriod(s.periods); period != nil {
			w.periodID.Set(period.ID)
		} else {
			w.periodID.Set("")
		}
	}
	show := func() {
		reset()
		open.Set(true)
	}
	pick := func() {
		cx.PickFiles(core.PickFilesOptions{
			Types: []string{".csv", ".xlsx"}, Title: locales.ActivityImportTitle(cx),
			Button: locales.ActivityImportPickButton(cx),
		}, func(files []core.File, err error) {
			if err != nil || len(files) == 0 {
				w.status.Set(locales.ActivityImportPickFailed(cx))
				w.rev.Set(w.rev.Get() + 1)
				return
			}
			file := files[0]
			reader, err := file.Open()
			if err != nil {
				w.status.Set(locales.ActivityImportPickFailed(cx))
				w.rev.Set(w.rev.Get() + 1)
				return
			}
			defer reader.Close()
			data, err := io.ReadAll(io.LimitReader(reader, activityimport.MaxFileBytes+1))
			if err != nil || len(data) > activityimport.MaxFileBytes {
				w.status.Set(locales.ActivityImportPickFailed(cx))
				w.rev.Set(w.rev.Get() + 1)
				return
			}
			grid, err := activityimport.ParseFile(data, file.Name)
			if err != nil {
				w.status.Set(locales.ActivityImportPickFailed(cx) + ": " + err.Error())
				w.rev.Set(w.rev.Get() + 1)
				return
			}
			w.grid = &grid
			w.data = data
			w.filename = file.Name
			w.mapping = activityimport.AutoMap(grid.Headers)
			w.valid = activityimport.Validate(grid.Rows, w.mapping, s.importPeriodBounds(w.periodID.Get()))
			w.sourceIDs = s.importSourceSignals(cx, w.valid)
			w.status.Set("")
			w.rev.Set(w.rev.Get() + 1)
		})
	}

	title := locales.ActivityImportTitle(cx)
	trigger := ui.Button{Text: locales.ActivityImportButton(cx), Variant: ui.ButtonSecondary,
		OnPress: show, TestID: "activity-import"}
	dialog := dataDialogSized(cx, open, title, []core.Node{
		core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
			MaxHeight: core.Pt(560)}, Children: []core.Node{
			core.Dynamic(func(cx *core.Scope) core.Node {
				_ = w.rev.Get()
				return s.importBody(cx, w, pick)
			}),
		}},
	}, []core.Node{
		core.Dynamic(func(cx *core.Scope) core.Node {
			_ = w.rev.Get()
			return s.importFooter(cx, w, dataRev, open)
		}),
	}, "activity-import-dialog", 760)
	return trigger, dialog, show
}

func (s *Session) importBody(cx *core.Scope, w *importWizard, pick func()) core.Node {
	switch w.step.Get() {
	case 0:
		return s.importPickBody(cx, w, pick)
	case 1:
		return s.importGroupsBody(cx, w)
	default:
		return s.importResultBody(cx, w)
	}
}

func (s *Session) importPickBody(cx *core.Scope, w *importWizard, pick func()) core.Node {
	children := []core.Node{
		core.Text{Content: locales.ActivityImportDescription(cx), Style: core.Style{FontSize: 13},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
			ui.Button{Text: locales.ActivityImportPickButton(cx), Variant: ui.ButtonSecondary,
				OnPress: pick, TestID: "activity-import-pick"},
			core.Text{Content: locales.ActivityImportPickHint(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
		}},
		core.Text{Content: locales.ActivityImportEvidenceHint(cx), Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
	}
	if w.grid == nil {
		if w.status.Get() != "" {
			children = append(children, dataError(cx, w.status))
		}
		return core.View{Style: core.Style{Gap: 10}, Children: children}
	}

	periodOptions := make([]ui.Option[string], 0, len(s.periods))
	for _, period := range s.periods {
		periodOptions = append(periodOptions, ui.Option[string]{Value: period.ID,
			Label: strconv.Itoa(period.Year)})
	}
	children = append(children,
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
			core.Text{Content: w.filename, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
			core.Text{Content: locales.ActivityImportRowCount(cx, strconv.Itoa(w.valid.TotalRows)),
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			ui.Button{Text: locales.ActivityImportRepickButton(cx), Variant: ui.ButtonSecondary,
				OnPress: pick, TestID: "activity-import-repick"},
		}},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10}, Children: []core.Node{
			core.Text{Content: locales.ActivityImportSummaryValid(cx, strconv.Itoa(w.valid.ValidCount)),
				Style: core.Style{FontSize: 12, FontWeight: ui.Semibold}},
			core.Text{Content: locales.ActivityImportSummaryErrors(cx, strconv.Itoa(w.valid.ErrorCount)),
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)},
			core.Text{Content: locales.ActivityImportSummaryWarnings(cx, strconv.Itoa(w.valid.WarningCount)),
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}},
		dataField(cx, locales.ActivityImportPeriodLabel(cx),
			ui.Select[string]{Options: periodOptions, Value: w.periodID.Get,
				OnChange: func(v string) {
					w.periodID.Set(v)
					if w.grid != nil {
						w.valid = activityimport.Validate(w.grid.Rows, w.mapping, s.importPeriodBounds(v))
					}
					w.rev.Set(w.rev.Get() + 1)
				},
				Placeholder: locales.ActivityImportPeriodPlaceholder(cx),
				Label:       locales.ActivityImportPeriodLabel(cx), TestID: "activity-import-period"}),
		core.Text{Content: locales.ActivityImportPeriodHint(cx), Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
		s.importMappingCard(cx, w),
		importSourcesCard(cx, s, w),
		importIssuesCard(cx, w),
		dataError(cx, w.status),
	)
	return core.View{Style: core.Style{Gap: 12}, Children: children}
}

func (s *Session) importMappingCard(cx *core.Scope, w *importWizard) core.Node {
	change := func(field activityimport.Field, col int) {
		if w.grid == nil {
			return
		}
		if col < 0 {
			delete(w.mapping, field)
		} else {
			w.mapping[field] = col
		}
		w.valid = activityimport.Validate(w.grid.Rows, w.mapping,
			s.importPeriodBounds(w.periodID.Get()))
		w.sourceIDs = s.importSourceSignals(cx, w.valid)
		w.groups = nil
		w.outliers = nil
		w.efOptions = map[string][]store.EmissionFactor{}
		w.efKeys = map[string]*core.Signal[string]{}
		w.fuels = map[string]*core.Signal[string]{}
		w.rev.Set(w.rev.Get() + 1)
	}
	columnOptions := func() []ui.Option[string] {
		options := make([]ui.Option[string], 0, len(w.grid.Headers)+1)
		options = append(options, ui.Option[string]{Value: "",
			Label: locales.ActivityImportUnmapped(cx)})
		for col, header := range w.grid.Headers {
			label := header
			if strings.TrimSpace(label) == "" {
				label = locales.ActivityImportColumnN(cx, strconv.Itoa(col+1))
			}
			options = append(options, ui.Option[string]{Value: strconv.Itoa(col), Label: label})
		}
		return options
	}()
	rows := make([]core.Node, 0, len(activityimport.AllFields))
	for _, field := range activityimport.AllFields {
		value := ""
		if col, ok := w.mapping[field]; ok && col >= 0 && col < len(w.grid.Headers) {
			value = strconv.Itoa(col)
		}
		labelChildren := []core.Node{
			core.Text{Content: importFieldLabel(cx, field),
				Style: core.Style{FontSize: 12, FontWeight: ui.Semibold}},
		}
		if containsField(activityimport.RequiredFields, field) {
			labelChildren = append(labelChildren, core.Text{Content: "*",
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
		}
		children := []core.Node{
			core.View{Style: core.Style{FlexGrow: 1, Direction: core.Row, AlignItems: core.AlignCenter, Gap: 4},
				Children: labelChildren},
			core.View{Style: core.Style{Width: core.Pt(240)}, Children: []core.Node{
				ui.Select[string]{Options: columnOptions, Value: func() string { return value },
					Placeholder: locales.ActivityImportUnmapped(cx),
					Label:       importFieldLabel(cx, field),
					TestID:      "activity-import-map-" + string(field),
					OnChange: func(next string) {
						if next == "" {
							change(field, -1)
							return
						}
						col, err := strconv.Atoi(next)
						if err != nil {
							return
						}
						change(field, col)
					}},
			}},
		}
		rows = append(rows, core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
			Padding: core.Symmetric(4, 0)},
			Children: children})
	}
	return dataCard(cx,
		dataHeading(cx, locales.ActivityImportMappingHeading(cx), locales.ActivityImportMappingBody(cx)),
		core.View{Style: core.Style{Gap: 4}, Children: rows},
	)
}

func importSourcesCard(cx *core.Scope, s *Session, w *importWizard) core.Node {
	options := make([]wideOption, 0, len(s.sources)+1)
	options = append(options, wideOption{Value: "",
		Label: locales.ActivityImportSourceUnresolved(cx)})
	for _, src := range s.sources {
		if src.IsActive {
			options = append(options, wideOption{Value: src.ID,
				Label: src.Name + " · " + dataScopeLabel(cx, src.Scope)})
		}
	}
	counts := make(map[string]int)
	for _, row := range w.valid.Valid {
		counts[row.SourceName]++
	}
	names := make([]string, 0, len(w.sourceIDs))
	for _, row := range w.valid.Valid {
		if !containsString(names, row.SourceName) {
			names = append(names, row.SourceName)
		}
	}
	rows := make([]core.Node, 0, len(names))
	for _, name := range names {
		sig := w.sourceIDs[name]
		if sig == nil {
			continue
		}
		status := locales.ActivityImportSourceUnresolved(cx)
		if sig.Get() != "" {
			status = locales.ActivityImportSourceMatched(cx)
		}
		entry := core.View{Style: core.Style{Gap: 6, Padding: core.Symmetric(9, 0),
			Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10},
					Children: []core.Node{
						core.View{Style: core.Style{Gap: 2, FlexGrow: 1}, Children: []core.Node{
							core.Text{Content: name, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
							core.Text{Content: locales.ActivityImportSourceRows(cx, strconv.Itoa(counts[name])),
								Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
						}},
						core.Text{Content: status, Style: core.Style{FontSize: 11},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
						core.View{Style: core.Style{Width: core.Pt(280)}, Children: []core.Node{
							wideSelect{Options: options, Value: sig.Get, OnChange: func(next string) {
								sig.Set(next)
								s.importPrepareGroups(cx, w)
								w.rev.Set(w.rev.Get() + 1)
							},
								Placeholder: locales.ActivityImportSourceSelectPlaceholder(cx),
								Label:       name, TestID: "activity-import-source-" + name,
								Width: 280, PopupWidth: 420},
						}},
					}},
			}}
		if sig.Get() == "" {
			entry.Children = append(entry.Children, s.importSourceCreator(cx, w, name))
		}
		rows = append(rows, entry)
	}
	if len(rows) == 0 {
		rows = append(rows, core.Text{Content: locales.ActivityImportErrorNothingToImport(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	return dataCard(cx,
		dataHeading(cx, locales.ActivityImportSourcesHeading(cx), locales.ActivityImportSourcesBody(cx)),
		core.View{Style: core.Style{Gap: 6}, Children: rows},
	)
}

func (s *Session) importSourceCreator(cx *core.Scope, w *importWizard, name string) core.Node {
	if w.creatorName.Get() != name {
		return core.View{Children: []core.Node{
			ui.Button{Text: locales.ActivityImportSourceCreateButton(cx), Variant: ui.ButtonSecondary,
				OnPress: func() {
					w.creatorName.Set(name)
					w.creatorScope.Set(1)
					if len(s.sites) > 0 {
						w.creatorSite.Set(s.sites[0].ID)
					} else {
						w.creatorSite.Set("")
					}
					w.creatorCategory.Set("")
					w.creatorStatus.Set("")
					w.rev.Set(w.rev.Get() + 1)
				}, TestID: "activity-import-source-create-" + name},
		}}
	}
	siteOptions := make([]ui.Option[string], 0, len(s.sites))
	for _, site := range s.sites {
		siteOptions = append(siteOptions, ui.Option[string]{Value: site.ID, Label: dataSiteName(site)})
	}
	return core.View{Style: core.Style{Gap: 6}, Children: []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignEnd, Gap: 8},
			Children: []core.Node{
				core.View{Style: core.Style{Width: core.Pt(120)}, Children: []core.Node{
					dataField(cx, locales.ActivityImportSourceCreateScope(cx),
						ui.Select[int]{Options: dataScopeOptions(cx), Value: w.creatorScope.Get,
							OnChange: w.creatorScope.Set, Label: locales.ActivityImportSourceCreateScope(cx),
							TestID: "activity-import-create-scope"}),
				}},
				core.View{Style: core.Style{Width: core.Pt(200)}, Children: []core.Node{
					dataField(cx, locales.ActivityImportSourceCreateSite(cx),
						ui.Select[string]{Options: siteOptions, Value: w.creatorSite.Get,
							OnChange: w.creatorSite.Set, Label: locales.ActivityImportSourceCreateSite(cx),
							TestID: "activity-import-create-site"}),
				}},
				core.View{Style: core.Style{FlexGrow: 1, MinWidth: core.Pt(160)}, Children: []core.Node{
					dataField(cx, locales.ActivityImportSourceCreateCategory(cx),
						ui.Input{Value: w.creatorCategory.Get, OnChange: w.creatorCategory.Set,
							TestID: "activity-import-create-category"}),
				}},
				ui.Button{Text: locales.ActivityImportSourceCreateButton(cx), Busy: w.creatorBusy.Get,
					OnPress: func() { s.importCreateSource(cx, w, name) },
					TestID:  "activity-import-create-save"},
			}},
		dataError(cx, w.creatorStatus),
	}}
}

func (s *Session) importCreateSource(cx *core.Scope, w *importWizard, name string) {
	if w.creatorSite.Get() == "" {
		w.creatorStatus.Set(locales.SourcesCatalogNoSite(cx))
		w.rev.Set(w.rev.Get() + 1)
		return
	}
	w.creatorBusy.Set(true)
	created, err := s.db.CreateSource(context.Background(), store.SourceInput{
		SiteID: w.creatorSite.Get(), Name: name, Scope: w.creatorScope.Get(),
		Category: strings.TrimSpace(w.creatorCategory.Get()),
	})
	w.creatorBusy.Set(false)
	if err != nil {
		w.creatorStatus.Set(err.Error())
		w.rev.Set(w.rev.Get() + 1)
		return
	}
	if w.dataRev != nil {
		s.recordSourceCreate(created, w.dataRev)
	}
	if sig := w.sourceIDs[name]; sig != nil {
		sig.Set(created.ID)
	}
	w.creatorName.Set("")
	w.creatorStatus.Set("")
	if w.dataRev != nil {
		_ = dataRefresh(s, w.dataRev)
	}
	s.importPrepareGroups(cx, w)
	w.rev.Set(w.rev.Get() + 1)
}

func importIssuesCard(cx *core.Scope, w *importWizard) core.Node {
	if len(w.valid.Errors) == 0 && len(w.valid.Warnings) == 0 {
		return core.View{}
	}
	var rows []core.Node
	for i, issue := range w.valid.Errors {
		if i >= 8 {
			break
		}
		rows = append(rows, importIssueRow(cx, issue, true))
	}
	for i, issue := range w.valid.Warnings {
		if i >= 5 {
			break
		}
		rows = append(rows, importIssueRow(cx, issue, false))
	}
	remaining := w.valid.ErrorCount + w.valid.WarningCount - len(rows)
	if remaining > 0 {
		rows = append(rows, core.Text{Content: locales.ActivityImportMoreIssues(cx, strconv.Itoa(remaining)),
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)})
	}
	return dataCard(cx, dataHeading(cx, locales.ActivityImportErrorsHeading(cx), ""),
		core.View{Style: core.Style{Gap: 3}, Children: rows})
}

func importIssueRow(cx *core.Scope, issue activityimport.Issue, isError bool) core.Node {
	text := locales.ActivityImportRowLabel(cx, strconv.Itoa(issue.Row)) + " · " +
		importIssueLabel(cx, issue.Code)
	if issue.Detail != "" {
		text += " (" + issue.Detail + ")"
	}
	style := ui.Colored(ui.ColorsOf(cx).Muted)
	if isError {
		style = ui.Colored(ui.ColorsOf(cx).Danger)
	}
	return core.Text{Content: text, Style: core.Style{FontSize: 12}, StyleFunc: style, MaxLines: 2}
}

func (s *Session) importGroupsBody(cx *core.Scope, w *importWizard) core.Node {
	if len(w.groups) == 0 {
		return core.View{Style: core.Style{Gap: 8}, Children: []core.Node{
			core.Text{Content: locales.ActivityImportErrorNothingToImport(cx),
				Style: core.Style{FontSize: 13}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)},
			dataError(cx, w.status),
		}}
	}
	rows := make([]core.Node, 0, len(w.groups))
	for i, group := range w.groups {
		efSig := w.efKeys[group.Key]
		fuelSig := w.fuels[group.Key]
		value := ""
		if efSig != nil {
			value = efSig.Get()
		}
		status := locales.ActivityImportGroupStatusPending(cx)
		if value != "" {
			status = locales.ActivityImportGroupStatusConfirmed(cx)
		}
		options := make([]wideOption, 0, len(w.efOptions[group.Key]))
		for _, ef := range w.efOptions[group.Key] {
			options = append(options, wideOption{Value: dataEFKey(ef),
				Label: dataEFName(cx, ef), Detail: dataEFDetail(ef)})
		}
		var efPicker core.Node
		if len(options) == 0 {
			efPicker = core.Text{Content: locales.ActivitiesFormEfNone(cx),
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		} else {
			efPicker = wideSelect{Options: options, Value: efSig.Get, OnChange: efSig.Set,
				Label: locales.ActivitiesFormEf(cx), TestID: "activity-import-ef-" + strconv.Itoa(i),
				Searchable: true, SearchPlaceholder: locales.ActivitiesSearchPlaceholder(cx)}
		}
		selectRec := func(ef store.EmissionFactor) {
			key := dataEFKey(ef)
			found := false
			for _, item := range w.efOptions[group.Key] {
				if dataEFKey(item) == key {
					found = true
					break
				}
			}
			if !found {
				w.efOptions[group.Key] = append(w.efOptions[group.Key], ef)
			}
			if efSig != nil {
				efSig.Set(key)
			}
			w.rev.Set(w.rev.Get() + 1)
		}
		var recommendNodes []core.Node
		if w.recBusy[group.Key] {
			recommendNodes = append(recommendNodes, core.Text{
				Content: locales.ActivitiesRecommendLoading(cx), Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		}
		if recStatus := w.recStatus[group.Key]; recStatus != "" {
			recommendNodes = append(recommendNodes, core.Text{Content: recStatus,
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
		}
		if recs := w.recs[group.Key]; len(recs) > 0 {
			recommendNodes = append(recommendNodes, core.Text{
				Content: locales.ActivitiesRecommendHeading(cx),
				Style:   core.Style{FontSize: 11, FontWeight: ui.Semibold}})
			for j := range recs {
				index, at := i, j
				item := recs[j]
				name := item.EF.NameEN
				if name == "" {
					name = item.EF.NameZH
				}
				if name == "" {
					name = item.EF.FactorCode
				}
				recommendNodes = append(recommendNodes, core.View{
					Role: core.RoleButton,
					OnPress: func(core.PressEvent) {
						selectRec(item.EF)
					},
					TestID: "activity-import-ef-recommend-" + strconv.Itoa(index) + "-" + strconv.Itoa(at),
					Style: core.Style{Direction: core.Row, AlignItems: core.AlignStart, Gap: 6,
						Padding: core.All(6), CornerRadius: 6},
					StyleFunc: func() core.Style {
						return core.Style{Background: ui.ColorsOf(cx).Raised()}
					},
					Children: []core.Node{
						ui.Icon(lucide.Star, 12, ui.ColorsOf(cx).Accent),
						core.View{Style: core.Style{Gap: 1, FlexGrow: 1}, Children: []core.Node{
							core.Text{Content: name + " · " + commaFloat(item.EF.CO2eKgPerUnit) +
								" kgCO2e/" + item.EF.InputUnit, Style: core.Style{FontSize: 11}, MaxLines: 1},
							core.Text{Content: item.Reasoning, Style: core.Style{FontSize: 10},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
						}},
					},
				})
			}
		}
		rows = append(rows, core.View{Style: core.Style{Gap: 4, Padding: core.Symmetric(9, 0),
			Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
					core.Text{Content: group.Description, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold},
						MaxLines: 1},
					ui.Badge{Text: dataScopeLabel(cx, s.importScope(group.SourceID)), Variant: ui.BadgeNeutral},
					core.Text{Content: status, Style: core.Style{FontSize: 11},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
				}},
				core.Text{Content: group.SourceName + " · " +
					locales.ActivityImportGroupRowsTotal(cx, strconv.Itoa(group.RowCount),
						commaFloat(group.AmountTotal), group.Unit),
					Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				core.View{Style: core.Style{Gap: 4}, Children: recommendNodes},
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
					core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{efPicker}},
					core.View{Style: core.Style{Width: core.Pt(160)}, Children: []core.Node{
						ui.Input{Value: fuelSig.Get, OnChange: fuelSig.Set,
							Placeholder: locales.ActivitiesFormFuelNone(cx),
							TestID:      "activity-import-fuel-" + strconv.Itoa(i),
							LabelFunc: func() string {
								return locales.ActivitiesFormFuel(cx)
							}},
					}},
				}},
			}})
	}
	children := []core.Node{
		dataHeading(cx, locales.ActivityImportGroupsHeading(cx), locales.ActivityImportGroupsBody(cx)),
		core.Text{Content: locales.ActivitiesFormFuelHint(cx), Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.View{Style: core.Style{Gap: 0}, Children: rows},
		dataError(cx, w.status),
	}
	if len(w.outliers) > 0 {
		children = append(children, core.Text{
			Content: locales.ActivityImportSummaryWarnings(cx, strconv.Itoa(len(w.outliers))),
			Style:   core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	return core.View{Style: core.Style{Gap: 10}, Children: children}
}

func (s *Session) importResultBody(cx *core.Scope, w *importWizard) core.Node {
	children := []core.Node{
		core.Text{Content: locales.ActivityImportResultHeading(cx),
			Style: core.Style{FontSize: 16, FontWeight: ui.Semibold}},
		core.Text{Content: w.result.Get(), Style: core.Style{FontSize: 13},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
	}
	if len(w.failures) > 0 {
		rows := make([]core.Node, 0, 10)
		for i, failure := range w.failures {
			if i >= 10 {
				break
			}
			rows = append(rows, core.Text{Content: failure.Error, Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger), MaxLines: 2})
		}
		children = append(children, dataCard(cx,
			dataHeading(cx, locales.ActivityImportFailed(cx), ""),
			core.View{Style: core.Style{Gap: 3}, Children: rows}))
	}
	return core.View{Style: core.Style{Gap: 12}, Children: children}
}

func (s *Session) importFooter(cx *core.Scope, w *importWizard, dataRev *core.Signal[int],
	open *core.Signal[bool]) core.Node {
	switch w.step.Get() {
	case 0:
		next := ui.Button{Text: locales.ActivityImportNextButton(cx), OnPress: func() {
			if w.grid == nil {
				w.status.Set(locales.ActivityImportPickFailed(cx))
				return
			}
			if len(activityimport.MissingRequired(w.mapping)) > 0 || w.valid.ValidCount == 0 {
				w.status.Set(locales.ActivityImportErrorNothingToImport(cx))
				return
			}
			if w.periodID.Get() == "" {
				w.status.Set(locales.ActivityImportErrorPeriodMissing(cx))
				return
			}
			s.importPrepareGroups(cx, w)
			w.status.Set("")
			w.step.Set(1)
			w.rev.Set(w.rev.Get() + 1)
		}, TestID: "activity-import-next"}
		return core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd, Gap: 8},
			Children: []core.Node{
				ui.Button{Text: locales.ActivityImportCancelButton(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { open.Set(false) }, TestID: "activity-import-cancel"},
				next,
			}}
	case 1:
		return core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd, Gap: 8},
			Children: []core.Node{
				ui.Button{Text: locales.ActivityImportBackButton(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { w.step.Set(0); w.rev.Set(w.rev.Get() + 1) },
					TestID:  "activity-import-back"},
				ui.Button{Text: locales.ActivityImportImportButton(cx), Busy: w.busy.Get,
					OnPress: func() { s.importRun(cx, w, dataRev) }, TestID: "activity-import-run"},
			}}
	default:
		return core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd}, Children: []core.Node{
			ui.Button{Text: locales.ActivityImportCloseButton(cx),
				OnPress: func() { open.Set(false) }, TestID: "activity-import-done"},
		}}
	}
}

func (s *Session) importPrepareGroups(cx *core.Scope, w *importWizard) {
	var resolved []activityimport.ResolvedRow
	for _, row := range w.valid.Valid {
		sig := w.sourceIDs[row.SourceName]
		if sig == nil || sig.Get() == "" {
			continue
		}
		resolved = append(resolved, activityimport.ResolvedRow{ValidRow: row, SourceID: sig.Get()})
	}
	nameOf := func(id string) string {
		for _, src := range s.sources {
			if src.ID == id {
				return src.Name
			}
		}
		return id
	}
	w.groups = activityimport.BuildGroups(resolved, nameOf)
	w.outliers = activityimport.DetectOutliers(resolved, w.outlierRatio)
	w.efOptions = make(map[string][]store.EmissionFactor, len(w.groups))
	w.efKeys = make(map[string]*core.Signal[string], len(w.groups))
	w.fuels = make(map[string]*core.Signal[string], len(w.groups))
	w.recs = make(map[string][]efmatch.Recommendation, len(w.groups))
	w.recBusy = make(map[string]bool, len(w.groups))
	w.recStatus = make(map[string]string, len(w.groups))
	w.recGen++
	for _, group := range w.groups {
		options := s.importEFOptions(group.SourceID)
		w.efOptions[group.Key] = options
		key := core.NewSignal(cx, "")
		if len(options) == 1 {
			key.Set(dataEFKey(options[0]))
		}
		w.efKeys[group.Key] = key
		w.fuels[group.Key] = core.NewSignal(cx, "")
	}
	s.importRecommendGroups(cx, w)
}

// importRecommendGroups asks the model for each group's top factors. It runs
// once per prepared group; a group without a provider keeps the plain select.
func (s *Session) importRecommendGroups(cx *core.Scope, w *importWizard) {
	provider := s.llmProvider(cx)
	if !provider.Configured() {
		return
	}
	language := i18n.Language(cx)
	gen := w.recGen
	for _, group := range w.groups {
		sourceRow := s.sourceByID(group.SourceID)
		if sourceRow == nil {
			continue
		}
		group := group
		source := *sourceRow
		w.recBusy[group.Key] = true
		go func() {
			service := &efmatch.Service{Store: s.db, Provider: provider, Language: language,
				NewClient: newExtractor}
			result, err := service.RecommendText(context.Background(), group.Description,
				group.Unit, source)
			s.scope.Post(func() {
				if w.recGen != gen {
					return
				}
				w.recBusy[group.Key] = false
				if err != nil {
					w.recStatus[group.Key] = locales.ActivitiesRecommendFailed(cx)
					w.rev.Set(w.rev.Get() + 1)
					return
				}
				w.recs[group.Key] = result.Recommended
				if len(result.Recommended) == 0 {
					w.recStatus[group.Key] = locales.ActivitiesRecommendEmpty(cx)
				}
				w.rev.Set(w.rev.Get() + 1)
			})
		}()
	}
}

func (s *Session) importRun(cx *core.Scope, w *importWizard, dataRev *core.Signal[int]) {
	period := s.importPeriod(w.periodID.Get())
	if period == nil {
		w.status.Set(locales.ActivityImportErrorPeriodMissing(cx))
		return
	}
	var inputs []store.ActivityInput
	skippedGroups := 0
	for _, group := range w.groups {
		keySig := w.efKeys[group.Key]
		key := ""
		if keySig != nil {
			key = keySig.Get()
		}
		var ef *store.EmissionFactor
		for i := range w.efOptions[group.Key] {
			if dataEFKey(w.efOptions[group.Key][i]) == key {
				ef = &w.efOptions[group.Key][i]
				break
			}
		}
		if ef == nil {
			skippedGroups += group.RowCount
			continue
		}
		fuel := ""
		if fuelSig := w.fuels[group.Key]; fuelSig != nil {
			fuel = strings.TrimSpace(fuelSig.Get())
		}
		for _, row := range group.Rows {
			start, end := row.Start, row.End
			if start == "" {
				start = period.StartsAt
			}
			if end == "" {
				end = period.EndsAt
			}
			inputs = append(inputs, store.ActivityInput{
				EmissionSourceID: group.SourceID, ReportingPeriodID: period.ID,
				OccurredAtStart: start, OccurredAtEnd: end,
				Amount: row.Amount, Unit: row.Unit,
				EF: store.EmissionFactorKey{
					FactorCode: ef.FactorCode, Year: ef.Year, Source: ef.Source,
					Geography: ef.Geography, DatasetVersion: ef.DatasetVersion,
				},
				FuelCode: fuel, Notes: row.Notes,
			})
		}
	}
	if len(inputs) == 0 {
		w.status.Set(locales.ActivityImportErrorNothingToImport(cx))
		return
	}
	w.busy.Set(true)
	evidenceID := ""
	if len(w.data) > 0 {
		document, _, err := s.db.SaveDocument(context.Background(), store.DocumentInput{
			Filename: w.filename, MIMEType: documentMIMEForFilename(w.filename), Data: w.data,
		}, s.dataDir)
		if err != nil {
			w.busy.Set(false)
			w.status.Set(locales.ActivityImportEvidenceFailed(cx) + ": " + err.Error())
			w.rev.Set(w.rev.Get() + 1)
			return
		}
		evidenceID = document.ID
		for i := range inputs {
			inputs[i].EvidenceDocumentID = evidenceID
		}
	}
	result, err := s.db.ImportActivities(context.Background(), inputs)
	w.busy.Set(false)
	if err != nil {
		w.status.Set(locales.ActivityImportFailed(cx) + ": " + err.Error())
		w.rev.Set(w.rev.Get() + 1)
		return
	}
	parts := []string{locales.ActivityImportResultImported(cx, strconv.Itoa(result.Imported))}
	if w.valid.ErrorCount > 0 {
		parts = append(parts, locales.ActivityImportResultSkippedValidation(cx,
			strconv.Itoa(w.valid.ErrorCount)))
	}
	if unresolved := w.valid.ValidCount - countGroupRows(w.groups); unresolved > 0 {
		parts = append(parts, locales.ActivityImportResultSkippedSources(cx, strconv.Itoa(unresolved)))
	}
	if skippedGroups > 0 {
		parts = append(parts, locales.ActivityImportResultSkippedGroups(cx, strconv.Itoa(skippedGroups)))
	}
	if result.Failed > 0 {
		parts = append(parts, locales.ActivityImportFailed(cx)+": "+strconv.Itoa(result.Failed))
	}
	if evidenceID != "" {
		parts = append(parts, locales.ActivityImportResultEvidence(cx))
	}
	w.failures = result.Failures
	w.result.Set(strings.Join(parts, " · "))
	w.status.Set("")
	_ = dataRefresh(s, dataRev)
	w.step.Set(2)
	w.rev.Set(w.rev.Get() + 1)
}

func (s *Session) importSourceSignals(cx *core.Scope, valid activityimport.Validation) map[string]*core.Signal[string] {
	out := make(map[string]*core.Signal[string])
	for _, row := range valid.Valid {
		if _, ok := out[row.SourceName]; ok {
			continue
		}
		out[row.SourceName] = core.NewSignal(cx, s.importMatchSource(row.SourceName))
	}
	return out
}

func (s *Session) importMatchSource(name string) string {
	want := strings.ToLower(strings.TrimSpace(name))
	for _, src := range s.sources {
		if src.IsActive && strings.ToLower(strings.TrimSpace(src.Name)) == want {
			return src.ID
		}
	}
	return ""
}

func (s *Session) importEFOptions(sourceID string) []store.EmissionFactor {
	for _, src := range s.sources {
		if src.ID != sourceID {
			continue
		}
		factors, err := s.db.ListEmissionFactors(context.Background(), store.EFFilter{
			Scope: src.Scope, Category: src.Category, Limit: 500,
		})
		if err == nil && len(factors) == 0 {
			factors, _ = s.db.ListEmissionFactors(context.Background(), store.EFFilter{
				Scope: src.Scope, Limit: 500,
			})
		}
		return factors
	}
	return nil
}

func (s *Session) importPeriod(id string) *store.ReportingPeriod {
	for i := range s.periods {
		if s.periods[i].ID == id {
			return &s.periods[i]
		}
	}
	return nil
}

func (s *Session) importPeriodBounds(id string) *activityimport.PeriodBounds {
	period := s.importPeriod(id)
	if period == nil {
		return nil
	}
	return &activityimport.PeriodBounds{Start: dateOnly(period.StartsAt), End: dateOnly(period.EndsAt)}
}

func (s *Session) importScope(sourceID string) int {
	for _, src := range s.sources {
		if src.ID == sourceID {
			return src.Scope
		}
	}
	return 3
}

func dateOnly(value string) string {
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

func countGroupRows(groups []activityimport.Group) int {
	total := 0
	for _, group := range groups {
		total += group.RowCount
	}
	return total
}

func containsField(fields []activityimport.Field, want activityimport.Field) bool {
	for _, field := range fields {
		if field == want {
			return true
		}
	}
	return false
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func importFieldLabel(cx *core.Scope, field activityimport.Field) string {
	switch field {
	case activityimport.FieldSourceName:
		return locales.ActivityImportFieldSourceName(cx)
	case activityimport.FieldDescription:
		return locales.ActivityImportFieldDescription(cx)
	case activityimport.FieldAmount:
		return locales.ActivityImportFieldAmount(cx)
	case activityimport.FieldUnit:
		return locales.ActivityImportFieldUnit(cx)
	case activityimport.FieldStart:
		return locales.ActivityImportFieldOccurredAtStart(cx)
	case activityimport.FieldEnd:
		return locales.ActivityImportFieldOccurredAtEnd(cx)
	default:
		return locales.ActivityImportFieldNotes(cx)
	}
}

func importIssueLabel(cx *core.Scope, code string) string {
	switch code {
	case "source_name_missing":
		return locales.ActivityImportIssueSourceNameMissing(cx)
	case "description_missing":
		return locales.ActivityImportIssueDescriptionMissing(cx)
	case "amount_missing":
		return locales.ActivityImportIssueAmountMissing(cx)
	case "amount_invalid":
		return locales.ActivityImportIssueAmountInvalid(cx)
	case "amount_outlier":
		return locales.ActivityImportIssueAmountOutlier(cx)
	case "unit_missing":
		return locales.ActivityImportIssueUnitMissing(cx)
	case "date_invalid":
		return locales.ActivityImportIssueDateInvalid(cx)
	case "date_range_invalid":
		return locales.ActivityImportIssueDateRangeInvalid(cx)
	case "period_mismatch":
		return locales.ActivityImportIssuePeriodMismatch(cx)
	case "duplicate_in_file":
		return locales.ActivityImportIssueDuplicateInFile(cx)
	case "duplicate_in_db":
		return locales.ActivityImportIssueDuplicateInDb(cx)
	default:
		return code
	}
}
