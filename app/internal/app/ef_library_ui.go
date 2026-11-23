package app

import (
	"bytes"
	"context"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/activityimport"
	"app.carbonink.desktop/internal/efimport"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
	"github.com/xuri/excelize/v2"
)

// efLibraryBody lists user-imported factor libraries and their import entry.
func (s *Session) efLibraryBody(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	return dataCard(cx,
		dataHeaderRow(cx,
			dataHeading(cx, locales.EfLibraryGroupHeading(cx), locales.EfLibraryGroupBody(cx)),
			s.efImportDialog(cx, dataRev)),
		core.Dynamic(func(cx *core.Scope) core.Node {
			_ = dataRev.Get()
			return s.efLibraryList(cx, dataRev)
		}),
	)
}

func (s *Session) efLibraryList(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	libraries, err := s.db.ListEFLibraries(context.Background())
	rows := make([]core.Node, 0, len(libraries)+1)
	if err != nil {
		rows = append(rows, core.Text{Content: err.Error(), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
	}
	for i := range libraries {
		library := libraries[i]
		rows = append(rows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.Symmetric(9, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1}, Children: []core.Node{
					core.Text{Content: library.Name, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold},
						MaxLines: 1},
					core.Text{Content: locales.EfLibraryRowMeta(cx, library.Version,
						strconv.Itoa(library.FactorCount), dateOnly(library.ImportedAt)),
						Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				}},
				s.efLibraryBrowseButton(cx, library),
				s.efLibraryDeleteButton(cx, library, dataRev),
			},
		})
	}
	if len(libraries) == 0 && err == nil {
		rows = append(rows, core.View{Style: core.Style{Padding: core.All(16)}, Children: []core.Node{
			core.Text{Content: locales.EfLibraryEmpty(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}})
	}
	return core.View{Style: core.Style{Gap: 0}, Children: []core.Node{
		core.Text{Content: locales.EfLibraryListHeading(cx), Style: core.Style{FontSize: 11, FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.View{Style: core.Style{Gap: 0}, Children: rows},
	}}
}

func (s *Session) efLibraryDeleteButton(cx *core.Scope, library store.EFLibrary,
	dataRev *core.Signal[int]) core.Node {
	open := core.NewSignal(cx, false)
	status := core.NewSignal(cx, "")
	busy := core.NewSignal(cx, false)
	confirm := func() {
		busy.Set(true)
		_, err := s.db.DeleteEFLibrary(context.Background(), library.ID)
		busy.Set(false)
		if err != nil {
			status.Set(locales.EfLibraryDeleteFailed(cx))
			return
		}
		open.Set(false)
		_ = dataRefresh(s, dataRev)
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.EfLibraryDeleteButton(cx), Variant: ui.ButtonSecondary,
			OnPress: func() { status.Set(""); open.Set(true) },
			TestID:  "ef-library-delete-" + library.Name},
		dataDialog(cx, open, locales.EfLibraryDeleteButton(cx), []core.Node{
			core.Text{Content: locales.EfLibraryDeleteConfirm(cx, library.Name),
				Style: core.Style{FontSize: 13}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			dataError(cx, status),
		}, []core.Node{
			dataCancelButton(cx, open, "ef-library-delete-cancel"),
			ui.Button{Text: locales.EfLibraryDeleteButton(cx), Busy: busy.Get, OnPress: confirm,
				TestID: "ef-library-delete-confirm"},
		}, "ef-library-delete-dialog"),
	}}
}

type efBrowser struct {
	open   *core.Signal[bool]
	rev    *core.Signal[int]
	query  *core.Signal[string]
	status *core.Signal[string]

	factors []store.EmissionFactor
	total   int
	offset  int
}

func (s *Session) efLibraryBrowseButton(cx *core.Scope, library store.EFLibrary) core.Node {
	b := &efBrowser{
		open:   core.NewSignal(cx, false),
		rev:    core.NewSignal(cx, 0),
		query:  core.NewSignal(cx, ""),
		status: core.NewSignal(cx, ""),
	}
	load := func(reset bool) {
		if reset {
			b.factors = nil
			b.offset = 0
		}
		page, total, err := s.db.BrowseEFLibrary(context.Background(), library.ID,
			b.query.Get(), 50, b.offset)
		if err != nil {
			b.status.Set(err.Error())
			b.rev.Set(b.rev.Get() + 1)
			return
		}
		b.factors = append(b.factors, page...)
		b.total = total
		b.offset += len(page)
		b.status.Set("")
		b.rev.Set(b.rev.Get() + 1)
	}
	show := func() {
		b.query.Set("")
		b.factors = nil
		b.total = 0
		b.offset = 0
		b.status.Set("")
		load(true)
		b.open.Set(true)
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.EfLibraryBrowseOpen(cx), Variant: ui.ButtonSecondary,
			OnPress: show, TestID: "ef-library-browse-" + library.Name},
		dataDialogSized(cx, b.open, library.Name, []core.Node{
			dataField(cx, locales.EfLibraryBrowseSearchPlaceholder(cx),
				ui.Input{Value: b.query.Get, Placeholder: locales.EfLibraryBrowseSearchPlaceholder(cx),
					OnChange: func(v string) {
						b.query.Set(v)
						load(true)
					},
					TestID: "ef-browse-search"}),
			core.Scroll{Style: core.Style{MaxHeight: core.Pt(460)}, Children: []core.Node{
				core.Dynamic(func(cx *core.Scope) core.Node {
					_ = b.rev.Get()
					return efBrowseList(cx, b, load)
				}),
			}},
			dataError(cx, b.status),
		}, []core.Node{
			dataCancelButton(cx, b.open, "ef-browse-close"),
		}, "ef-library-browse-dialog", 720),
	}}
}

func efBrowseList(cx *core.Scope, b *efBrowser, load func(bool)) core.Node {
	if len(b.factors) == 0 {
		empty := locales.EfLibraryBrowseEmptyLibrary(cx)
		if strings.TrimSpace(b.query.Get()) != "" {
			empty = locales.EfLibraryBrowseEmptySearch(cx)
		}
		return core.Text{Content: empty, Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
	}
	rows := make([]core.Node, 0, len(b.factors)+2)
	rows = append(rows, core.Text{
		Content: locales.EfLibraryBrowseCount(cx, strconv.Itoa(len(b.factors)), strconv.Itoa(b.total)),
		Style:   core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	for i := range b.factors {
		factor := b.factors[i]
		name := factor.NameEN
		if name == "" {
			name = factor.NameZH
		}
		rows = append(rows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.Symmetric(7, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: []core.Node{
						core.Text{Content: name, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold},
							MaxLines: 1},
						core.Text{Content: factor.FactorCode + " · " +
							locales.EfLibraryBrowsePerUnit(cx, commaFloat(factor.CO2eKgPerUnit),
								factor.InputUnit),
							Style:     core.Style{FontSize: 11},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
					}},
				ui.Badge{Text: locales.EfLibraryBrowseScope(cx, strconv.Itoa(factor.Scope)),
					Variant: ui.BadgeNeutral},
			},
		})
	}
	if len(b.factors) < b.total {
		rows = append(rows, core.View{Style: core.Style{Padding: core.Symmetric(8, 0)},
			Children: []core.Node{
				ui.Button{Text: locales.EfLibraryBrowseLoadMore(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { load(false) }, TestID: "ef-browse-more"},
			}})
	}
	return core.View{Style: core.Style{Gap: 0}, Children: rows}
}

type efWizard struct {
	open    *core.Signal[bool]
	name    *core.Signal[string]
	version *core.Signal[string]
	status  *core.Signal[string]
	busy    *core.Signal[bool]
	rev     *core.Signal[int]

	hasFile  bool
	filename string
	headers  []string
	mapping  efimport.Mapping
	valid    efimport.Validation

	// existing holds the names of already-imported libraries so the action
	// label can say "replace" without querying the database while rendering.
	existing map[string]bool
}

func (s *Session) efImportDialog(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	w := &efWizard{
		open:    core.NewSignal(cx, false),
		name:    core.NewSignal(cx, ""),
		version: core.NewSignal(cx, ""),
		status:  core.NewSignal(cx, ""),
		busy:    core.NewSignal(cx, false),
		rev:     core.NewSignal(cx, 0),
	}
	show := func() {
		w.hasFile = false
		w.filename = ""
		w.headers = nil
		w.mapping = nil
		w.valid = efimport.Validation{}
		w.existing = map[string]bool{}
		if libraries, err := s.db.ListEFLibraries(context.Background()); err == nil {
			for _, library := range libraries {
				w.existing[library.Name] = true
			}
		}
		w.name.Set("")
		w.version.Set("")
		w.status.Set("")
		w.open.Set(true)
	}
	pick := func() {
		cx.PickFiles(core.PickFilesOptions{Types: []string{".csv", ".xlsx"},
			Title: locales.EfImportTitle(cx), Button: locales.EfImportPickButton(cx)},
			func(files []core.File, err error) {
				if err != nil || len(files) == 0 {
					w.status.Set(locales.EfImportPickFailed(cx))
					w.rev.Set(w.rev.Get() + 1)
					return
				}
				file := files[0]
				reader, err := file.Open()
				if err != nil {
					w.status.Set(locales.EfImportPickFailed(cx))
					w.rev.Set(w.rev.Get() + 1)
					return
				}
				defer reader.Close()
				grid, err := activityimport.ReadFile(reader, file.Name)
				if err != nil {
					w.status.Set(locales.EfImportPickFailed(cx) + ": " + err.Error())
					w.rev.Set(w.rev.Get() + 1)
					return
				}
				units, _ := s.db.KnownUnits(context.Background())
				w.hasFile = true
				w.filename = file.Name
				w.headers = grid.Headers
				w.mapping = efimport.AutoMap(grid.Headers)
				w.valid = efimport.Validate(grid.Rows, w.mapping, units)
				w.status.Set("")
				w.rev.Set(w.rev.Get() + 1)
			})
	}
	importLibrary := func() {
		if w.busy.Get() {
			return
		}
		name := strings.TrimSpace(w.name.Get())
		if name == "" || len([]rune(name)) > 50 || hasControlChars(name) {
			w.status.Set(locales.EfImportErrorInvalidName(cx))
			return
		}
		if len(efimport.MissingRequired(w.mapping)) > 0 || w.valid.ValidCount == 0 {
			w.status.Set(locales.EfImportErrorNothingToImport(cx))
			return
		}
		replace := w.existing[name]
		w.busy.Set(true)
		_, imported, err := s.db.ImportEFLibrary(context.Background(), store.EFLibraryImport{
			Name: name, Version: w.version.Get(), Filename: w.filename,
			Rows: w.valid.Valid, Replace: replace,
			TotalRows: w.valid.TotalRows, Skipped: w.valid.ErrorCount,
			WarningCount: w.valid.WarningCount,
		})
		w.busy.Set(false)
		if err != nil {
			w.status.Set(locales.EfImportFailed(cx) + ": " + err.Error())
			return
		}
		message := locales.EfImportSuccess(cx, strconv.Itoa(imported))
		if w.valid.ErrorCount > 0 {
			message += " · " + locales.EfImportSuccessSkipped(cx, strconv.Itoa(w.valid.ErrorCount))
		}
		w.status.Set(message)
		w.existing[name] = true
		_ = dataRefresh(s, dataRev)
		w.rev.Set(w.rev.Get() + 1)
	}
	return core.View{Children: []core.Node{
		ui.Button{Text: locales.EfLibraryImportButton(cx), Variant: ui.ButtonSecondary,
			OnPress: show, TestID: "ef-library-import"},
		dataDialogSized(cx, w.open, locales.EfImportTitle(cx), []core.Node{
			core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
				MaxHeight: core.Pt(560)}, Children: []core.Node{
				core.Dynamic(func(cx *core.Scope) core.Node {
					_ = w.rev.Get()
					return s.efImportBody(cx, w, pick, importLibrary)
				}),
			}},
		}, []core.Node{
			core.Dynamic(func(cx *core.Scope) core.Node {
				_ = w.rev.Get()
				return core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd, Gap: 8},
					Children: []core.Node{
						dataCancelButton(cx, w.open, "ef-import-cancel"),
						ui.Button{Text: efImportActionLabel(cx, w), Busy: w.busy.Get,
							OnPress: importLibrary, TestID: "ef-import-run"},
					}}
			}),
		}, "ef-import-dialog", 760, importLibrary),
	}}
}

func efImportActionLabel(cx *core.Scope, w *efWizard) string {
	name := strings.TrimSpace(w.name.Get())
	if name != "" && w.existing[name] {
		return locales.EfImportReplaceConfirmButton(cx)
	}
	return locales.EfImportImportButton(cx)
}

func (s *Session) efImportBody(cx *core.Scope, w *efWizard, pick, submit func()) core.Node {
	children := []core.Node{
		core.Text{Content: locales.EfImportDescription(cx), Style: core.Style{FontSize: 13},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		dataColumns(cx, 8,
			dataField(cx, locales.EfImportNameLabel(cx),
				ui.Input{Value: w.name.Get, OnChange: w.name.Set,
					Placeholder: locales.EfImportNamePlaceholder(cx), TestID: "ef-import-name"}, submit),
			dataField(cx, locales.EfImportVersionLabel(cx),
				ui.Input{Value: w.version.Get, OnChange: w.version.Set,
					Placeholder: locales.EfImportVersionPlaceholder(cx), TestID: "ef-import-version"}, submit),
		),
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
			ui.Button{Text: locales.EfImportPickButton(cx), Variant: ui.ButtonSecondary,
				OnPress: pick, TestID: "ef-import-pick"},
			ui.Button{Text: locales.EfLibraryTemplateButton(cx), Variant: ui.ButtonSecondary,
				OnPress: func() { s.efTemplate(cx, w) }, TestID: "ef-template"},
			core.Text{Content: locales.EfImportPickHint(cx), Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint), MaxLines: 2},
		}},
	}
	if w.hasFile {
		children = append(children,
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
				core.Text{Content: w.filename, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
				core.Text{Content: locales.EfImportRowCount(cx, strconv.Itoa(w.valid.TotalRows)),
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				ui.Button{Text: locales.EfImportRepickButton(cx), Variant: ui.ButtonSecondary,
					OnPress: pick, TestID: "ef-import-repick"},
			}},
			core.View{Style: core.Style{Direction: core.Row, Gap: 10}, Children: []core.Node{
				core.Text{Content: locales.EfImportSummaryValid(cx, strconv.Itoa(w.valid.ValidCount)),
					Style: core.Style{FontSize: 12, FontWeight: ui.Semibold}},
				core.Text{Content: locales.EfImportSummaryErrors(cx, strconv.Itoa(w.valid.ErrorCount)),
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)},
				core.Text{Content: locales.EfImportSummaryWarnings(cx, strconv.Itoa(w.valid.WarningCount)),
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}},
			efMappingCard(cx, w),
			efIssuesCard(cx, w),
			efSampleCard(cx, w),
		)
	}
	children = append(children, core.Dynamic(func(cx *core.Scope) core.Node {
		name := strings.TrimSpace(w.name.Get())
		if name == "" || !w.existing[name] {
			return core.View{}
		}
		return core.Text{Content: locales.EfImportReplaceBody(cx, name),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger), MaxLines: 3}
	}))
	children = append(children, dataError(cx, w.status))
	return core.View{Style: core.Style{Gap: 10}, Children: children}
}

func efMappingCard(cx *core.Scope, w *efWizard) core.Node {
	items := make([]core.Node, 0, len(efimport.AllFields))
	for _, field := range efimport.AllFields {
		value := locales.EfImportUnmapped(cx)
		missing := false
		if col, ok := w.mapping[field]; ok && col >= 0 {
			if col < len(w.headers) && strings.TrimSpace(w.headers[col]) != "" {
				value = w.headers[col]
			} else {
				value = columnLabel(cx, col)
			}
		} else {
			missing = containsEFField(efimport.RequiredFields, field)
		}
		children := []core.Node{
			core.Text{Content: efFieldLabel(cx, field), Style: core.Style{FontSize: 11, FontWeight: ui.Semibold},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			core.Text{Content: value, Style: core.Style{FontSize: 12}, MaxLines: 1},
		}
		if missing {
			children = append(children, core.Text{Content: locales.EfImportRequired(cx),
				Style: core.Style{FontSize: 10}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
		}
		items = append(items, core.View{Style: core.Style{Width: core.Pt(225), Gap: 1}, Children: children})
	}
	return dataCard(cx,
		dataHeading(cx, locales.EfImportMappingHeading(cx), locales.EfImportMappingBody(cx)),
		core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 8}, Children: items},
	)
}

func efIssuesCard(cx *core.Scope, w *efWizard) core.Node {
	if len(w.valid.Errors) == 0 && len(w.valid.Warnings) == 0 {
		return core.View{}
	}
	var rows []core.Node
	for i, issue := range w.valid.Errors {
		if i >= 6 {
			break
		}
		rows = append(rows, efIssueRow(cx, issue, true))
	}
	for i, issue := range w.valid.Warnings {
		if i >= 4 {
			break
		}
		rows = append(rows, efIssueRow(cx, issue, false))
	}
	if remaining := w.valid.ErrorCount + w.valid.WarningCount - len(rows); remaining > 0 {
		rows = append(rows, core.Text{Content: locales.EfImportMoreIssues(cx, strconv.Itoa(remaining)),
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)})
	}
	return dataCard(cx, dataHeading(cx, locales.EfImportErrorsHeading(cx),
		locales.EfImportWarningsHeading(cx)), core.View{Style: core.Style{Gap: 3}, Children: rows})
}

func efIssueRow(cx *core.Scope, issue efimport.Issue, isError bool) core.Node {
	text := locales.EfImportRowLabel(cx, strconv.Itoa(issue.Row)) + " · " + efIssueLabel(cx, issue.Code)
	if issue.Detail != "" {
		text += " (" + issue.Detail + ")"
	}
	style := ui.Colored(ui.ColorsOf(cx).Muted)
	if isError {
		style = ui.Colored(ui.ColorsOf(cx).Danger)
	}
	return core.Text{Content: text, Style: core.Style{FontSize: 12}, StyleFunc: style, MaxLines: 2}
}

func efSampleCard(cx *core.Scope, w *efWizard) core.Node {
	if len(w.valid.Sample) == 0 {
		return core.View{}
	}
	rows := make([]core.Node, 0, len(w.valid.Sample))
	for _, row := range w.valid.Sample {
		name := row.NameEN
		if name == "" {
			name = row.NameZH
		}
		rows = append(rows, core.Text{
			Content: row.FactorCode + " · " + name + " · " + dataScopeLabel(cx, row.Scope) + " · " +
				commaFloat(row.CO2e) + " kgCO2e/" + row.InputUnit,
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1})
	}
	return dataCard(cx, dataHeading(cx, locales.EfImportSampleHeading(cx), ""),
		core.View{Style: core.Style{Gap: 3}, Children: rows})
}

func (s *Session) efTemplate(cx *core.Scope, w *efWizard) {
	data, err := efTemplateBytes()
	if err != nil {
		w.status.Set(locales.EfLibraryTemplateFailed(cx))
		return
	}
	cx.SaveFile(core.SaveOptions{Name: "carbonink-ef-template.xlsx",
		MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Data: data},
		func(saved bool, _ string, err error) {
			if err != nil || !saved {
				w.status.Set(locales.EfLibraryTemplateFailed(cx))
				return
			}
			w.status.Set(locales.EfLibraryTemplateSaved(cx))
			w.rev.Set(w.rev.Get() + 1)
		})
}

func efTemplateBytes() ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	const sheet = "factors"
	if err := f.SetSheetName(f.GetSheetName(0), sheet); err != nil {
		return nil, err
	}
	rows := [][]any{
		{"factor_code", "name_zh", "name_en", "scope", "category", "year", "geography",
			"input_unit", "co2e_kg_per_unit", "ch4_kg_per_unit", "n2o_kg_per_unit",
			"gwp_basis", "description_zh", "description_en", "notes", "citation_url"},
		{"DIESEL-STATIONARY", "柴油-固定燃烧", "Diesel - stationary combustion", "1",
			"fuel.combustion", "2024", "CN", "L", "2.68", "0.0001", "0.00002", "AR6",
			"内部台账因子示例", "Example row — replace me", "", ""},
		{"GRID-EAST-CN", "华东电网电力", "East China grid electricity", "2",
			"electricity.grid", "2024", "CN-East", "kWh", "0.7035", "", "", "AR6", "", "", "", ""},
	}
	for i, row := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow(sheet, cell, &row); err != nil {
			return nil, err
		}
	}
	headerStyle, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}
	lastCol, err := excelize.ColumnNumberToName(len(rows[0]))
	if err != nil {
		return nil, err
	}
	if err := f.SetCellStyle(sheet, "A1", lastCol+"1", headerStyle); err != nil {
		return nil, err
	}
	for i := 1; i <= len(rows[0]); i++ {
		col, err := excelize.ColumnNumberToName(i)
		if err != nil {
			return nil, err
		}
		if err := f.SetColWidth(sheet, col, col, 22); err != nil {
			return nil, err
		}
	}

	const notes = "说明 notes"
	if _, err := f.NewSheet(notes); err != nil {
		return nil, err
	}
	lines := []string{
		"碳墨排放因子库导入模板 · CarbonInk EF library import template",
		"",
		"必填列 required: scope (1/2/3), year, input_unit, co2e_kg_per_unit;",
		"name_zh / name_en 至少填一列 at least one of name_zh / name_en.",
		"factor_code 缺省自动生成 auto-generated when blank.",
		"geography 缺省 GLOBAL when blank. gwp_basis 缺省 AR6 (allowed: AR5/AR6).",
		"",
		"category 建议使用内置点分税表以参与 AI 匹配 dotted taxonomy examples:",
		"fuel.combustion / electricity.grid / freight.road / travel.air.economy.shorthaul /",
		"purchase.material.steel / purchase.service.consulting",
		"",
		"示例行请删除后再导入 delete the example rows before importing.",
	}
	for i, line := range lines {
		cell, err := excelize.CoordinatesToCellName(1, i+1)
		if err != nil {
			return nil, err
		}
		row := []any{line}
		if err := f.SetSheetRow(notes, cell, &row); err != nil {
			return nil, err
		}
	}
	if err := f.SetColWidth(notes, "A", "A", 90); err != nil {
		return nil, err
	}
	if index, err := f.GetSheetIndex(sheet); err != nil {
		return nil, err
	} else {
		f.SetActiveSheet(index)
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func columnLabel(cx *core.Scope, col int) string {
	return locales.EfImportColumnN(cx, strconv.Itoa(col+1))
}

func efFieldLabel(cx *core.Scope, field efimport.Field) string {
	switch field {
	case efimport.FieldFactorCode:
		return locales.EfImportFieldFactorCode(cx)
	case efimport.FieldNameZH:
		return locales.EfImportFieldNameZh(cx)
	case efimport.FieldNameEN:
		return locales.EfImportFieldNameEn(cx)
	case efimport.FieldScope:
		return locales.EfImportFieldScope(cx)
	case efimport.FieldCategory:
		return locales.EfImportFieldCategory(cx)
	case efimport.FieldYear:
		return locales.EfImportFieldYear(cx)
	case efimport.FieldGeography:
		return locales.EfImportFieldGeography(cx)
	case efimport.FieldInputUnit:
		return locales.EfImportFieldInputUnit(cx)
	case efimport.FieldCO2e:
		return locales.EfImportFieldCo2eKgPerUnit(cx)
	case efimport.FieldCH4:
		return locales.EfImportFieldCh4KgPerUnit(cx)
	case efimport.FieldN2O:
		return locales.EfImportFieldN2oKgPerUnit(cx)
	case efimport.FieldHFC:
		return locales.EfImportFieldHfcKgPerUnit(cx)
	case efimport.FieldPFC:
		return locales.EfImportFieldPfcKgPerUnit(cx)
	case efimport.FieldSF6:
		return locales.EfImportFieldSf6KgPerUnit(cx)
	case efimport.FieldNF3:
		return locales.EfImportFieldNf3KgPerUnit(cx)
	case efimport.FieldBiogenic:
		return locales.EfImportFieldBiogenicCo2Factor(cx)
	case efimport.FieldGWP:
		return locales.EfImportFieldGwpBasis(cx)
	case efimport.FieldDescZH:
		return locales.EfImportFieldDescriptionZh(cx)
	case efimport.FieldDescEN:
		return locales.EfImportFieldDescriptionEn(cx)
	case efimport.FieldNotes:
		return locales.EfImportFieldNotes(cx)
	default:
		return locales.EfImportFieldCitationUrl(cx)
	}
}

func efIssueLabel(cx *core.Scope, code string) string {
	switch code {
	case "name_missing":
		return locales.EfImportIssueNameMissing(cx)
	case "scope_missing":
		return locales.EfImportIssueScopeMissing(cx)
	case "scope_invalid":
		return locales.EfImportIssueScopeInvalid(cx)
	case "year_missing":
		return locales.EfImportIssueYearMissing(cx)
	case "year_invalid":
		return locales.EfImportIssueYearInvalid(cx)
	case "unit_missing":
		return locales.EfImportIssueUnitMissing(cx)
	case "co2e_missing":
		return locales.EfImportIssueCo2eMissing(cx)
	case "value_invalid":
		return locales.EfImportIssueValueInvalid(cx)
	case "gwp_invalid":
		return locales.EfImportIssueGwpInvalid(cx)
	case "duplicate_key":
		return locales.EfImportIssueDuplicateKey(cx)
	case "category_empty":
		return locales.EfImportIssueCategoryEmpty(cx)
	case "unit_unknown":
		return locales.EfImportIssueUnitUnknown(cx)
	default:
		return code
	}
}

func containsEFField(fields []efimport.Field, want efimport.Field) bool {
	for _, field := range fields {
		if field == want {
			return true
		}
	}
	return false
}

func hasControlChars(text string) bool {
	for _, r := range text {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}
