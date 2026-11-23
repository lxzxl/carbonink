package app

import (
	"context"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/inbound"
	"app.carbonink.desktop/internal/questionnaire"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

const (
	overdueNotificationID  = "carbonink:overdue-inbound"
	overdueNotifySetting   = "overdue_notify.last_notified_date"
	supplierDisclosureDate = "2006-01-02"
)

// supplierFilters mirrors the outbound list: supplier search and the inbound
// status vocabulary.
type supplierFilters struct {
	search *core.Signal[string]
	status *core.Signal[string]
}

type supplierCheck struct {
	position string
	on       *core.Signal[bool]
}

// supplierWizard is the new-disclosure form: pick an existing supplier or
// name a new one, choose the year, and include a subset of the template.
type supplierWizard struct {
	open     *core.Signal[bool]
	supplier *core.Signal[string]
	name     *core.Signal[string]
	email    *core.Signal[string]
	year     *core.Signal[string]
	checks   []supplierCheck
	status   *core.Signal[string]
	failed   *core.Signal[bool]
	busy     *core.Signal[bool]
}

// supplierDetail is one disclosure: its read-only answers, the export/import
// actions, and the review state of a supplier reply.
type supplierDetail struct {
	open     *core.Signal[bool]
	rev      *core.Signal[int]
	supplier *core.Signal[string]
	year     *core.Signal[int]
	status   *core.Signal[string]
	due      *core.Signal[string]
	email    *core.Signal[string]
	message  *core.Signal[string]
	failed   *core.Signal[bool]
	busy     *core.Signal[bool]

	reviewOpen    *core.Signal[bool]
	reviewRev     *core.Signal[int]
	reviewBusy    *core.Signal[bool]
	reviewMessage *core.Signal[string]
	reviewFailed  *core.Signal[bool]
	tierOverride  *core.Signal[string]
	tier1Quantity *core.Signal[string]
	deleteOpen    *core.Signal[bool]
	remindOpen    *core.Signal[bool]

	id        string
	db        *store.Store
	questions []store.Question

	reviewAnswers  []inbound.PreviewAnswer
	reviewWarnings []inbound.Warning
	reviewPlan     inbound.IngestPlan
	accepted       map[string]bool
}

func (s *Session) supplierDisclosuresScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	filters := &supplierFilters{
		search: core.NewSignal(cx, ""),
		status: core.NewSignal(cx, ""),
	}
	screenStatus := core.NewSignal(cx, "")
	screenFailed := core.NewSignal(cx, false)
	wizard := newSupplierWizard(cx, s)
	detail := newSupplierDetail(cx, s.db)
	if id := s.pendingSupplierDisclosure; id != "" {
		s.pendingSupplierDisclosure = ""
		for _, q := range s.questionnaires {
			if q.ID != id {
				continue
			}
			s.scope.Post(func() { detail.show(cx, s, dataRev, q) })
			break
		}
	}

	rows := func() []store.Questionnaire {
		_ = dataRev.Get()
		query := strings.ToLower(strings.TrimSpace(filters.search.Get()))
		status := filters.status.Get()
		out := make([]store.Questionnaire, 0, len(s.questionnaires))
		for _, q := range s.questionnaires {
			if q.Direction != "inbound" {
				continue
			}
			if status != "" && q.Status != status {
				continue
			}
			if query != "" && !strings.Contains(strings.ToLower(q.CustomerName), query) {
				continue
			}
			out = append(out, q)
		}
		return out
	}

	statusOptions := []ui.Option[string]{
		{Value: "", Label: locales.SupplierDisclosuresStatusAll(cx)},
		{Value: store.QuestionnaireDraft, Label: locales.SupplierDisclosuresStatusDraft(cx)},
		{Value: store.QuestionnaireSent, Label: locales.SupplierDisclosuresStatusSent(cx)},
		{Value: store.QuestionnaireReceived, Label: locales.SupplierDisclosuresStatusReceived(cx)},
		{Value: store.QuestionnaireIngested, Label: locales.SupplierDisclosuresStatusIngested(cx)},
	}

	today := time.Now().Format(supplierDisclosureDate)
	list := core.Dynamic(func(cx *core.Scope) core.Node {
		_ = dataRev.Get()
		_ = filters.search.Get()
		_ = filters.status.Get()
		visible := rows()
		total := 0
		for _, q := range s.questionnaires {
			if q.Direction == "inbound" {
				total++
			}
		}
		if len(visible) == 0 {
			empty := dataEmptyState(cx, locales.SupplierDisclosuresEmpty(cx),
				locales.SupplierDisclosuresEmptyBody(cx),
				ui.Button{Text: locales.SupplierDisclosuresNewButton(cx), OnPress: wizard.show,
					TestID: "supplier-disclosures-empty-new"})
			if total > 0 {
				empty = dataEmptyState(cx, locales.InboundListNoMatch(cx), "",
					ui.Button{Text: locales.InboundClearFilters(cx), Variant: ui.ButtonGhost,
						OnPress: func() {
							filters.search.Set("")
							filters.status.Set("")
						}, TestID: "supplier-disclosures-filter-clear"})
			}
			return core.View{Style: core.Style{FlexGrow: 1, JustifyContent: core.JustifyCenter},
				Children: []core.Node{empty}}
		}
		nodes := make([]core.Node, 0, len(visible))
		for _, q := range visible {
			q := q
			overdue := q.Status == store.QuestionnaireSent && q.DueDate != "" && q.DueDate < today
			nodes = append(nodes, supplierDisclosureRow(cx, q, overdue,
				func() { detail.show(cx, s, dataRev, q) }))
		}
		return core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
			Children: []core.Node{core.View{Style: core.Style{Gap: 0}, Children: nodes}}}
	})

	return core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
		Padding: core.All(16), Gap: 10}, Children: []core.Node{
		dataHeaderRow(cx,
			core.Text{ContentFunc: func() string {
				n := len(rows())
				return countPhrase(n,
					func() string {
						return locales.SupplierDisclosuresCountOne(cx, strconv.Itoa(n))
					},
					func() string {
						return locales.SupplierDisclosuresCount(cx, strconv.Itoa(n))
					})
			}, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
			[]core.Node{
				ui.Input{Value: filters.search.Get, Placeholder: locales.SupplierDisclosuresSearchPlaceholder(cx),
					OnChange: func(v string) { filters.search.Set(v) },
					TestID:   "supplier-disclosures-search", Style: core.Style{Width: core.Pt(220)}},
				ui.Select[string]{Options: statusOptions, Value: filters.status.Get,
					OnChange: func(v string) { filters.status.Set(v) },
					Label:    locales.SupplierDisclosuresStatusFilter(cx),
					TestID:   "supplier-disclosures-filter-status",
					Style:    core.Style{Width: core.Pt(150)}},
				ui.Button{Text: locales.SupplierDisclosuresNewButton(cx), OnPress: wizard.show,
					TestID: "supplier-disclosures-new"},
			}...),
		core.Show{When: func() bool { return screenStatus.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return screenStatus.Get() },
					Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
						if screenFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
			CornerRadius: 8, BorderWidth: 1, BorderColor: ui.ColorsOf(cx).Border(),
			Background: ui.ColorsOf(cx).Surface()}, Children: []core.Node{list}},
		wizard.dialog(cx, s, dataRev, func(count int) {
			screenFailed.Set(false)
			screenStatus.Set(locales.SupplierDisclosuresWizardCreated(cx, strconv.Itoa(count)))
		}, func(message string) {
			screenFailed.Set(true)
			screenStatus.Set(message)
		}),
		detail.dialog(cx, s, dataRev),
		detail.reviewDialog(cx, s, dataRev),
		detail.deleteDialog(cx, s, dataRev),
		detail.remindDialog(cx, s, dataRev),
	}}
}

func supplierDisclosureRow(cx *core.Scope, q store.Questionnaire, overdue bool,
	onPress func()) core.Node {
	meta := strconv.Itoa(q.ReportingYear) + " · " +
		locales.QuestionnairesQuestionCount(cx, strconv.Itoa(q.QuestionCount))
	if q.DueDate != "" {
		meta = meta + " · " + locales.SupplierDisclosuresDue(cx, q.DueDate)
	}
	children := []core.Node{
		core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
			Children: []core.Node{
				core.Text{Content: q.CustomerName, Style: core.Style{FontSize: 13,
					FontWeight: ui.Semibold, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
				core.Text{Content: meta, Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
			}},
		ui.Badge{Text: supplierStatusLabel(cx, q.Status), Variant: supplierStatusVariant(q.Status)},
	}
	if overdue {
		children = append(children, ui.Badge{Text: locales.SupplierDisclosuresOverdue(cx),
			Variant: ui.BadgeDanger})
	}
	return dataClickableRow(cx, "supplier-disclosures-row-"+q.ID, onPress, children...)
}

func supplierStatusLabel(cx *core.Scope, status string) string {
	switch status {
	case store.QuestionnaireDraft:
		return locales.SupplierDisclosuresStatusDraft(cx)
	case store.QuestionnaireSent:
		return locales.SupplierDisclosuresStatusSent(cx)
	case store.QuestionnaireReceived:
		return locales.SupplierDisclosuresStatusReceived(cx)
	case store.QuestionnaireIngested:
		return locales.SupplierDisclosuresStatusIngested(cx)
	}
	return status
}

func supplierStatusVariant(status string) ui.BadgeVariant {
	switch status {
	case store.QuestionnaireIngested:
		return ui.BadgeAccent
	case store.QuestionnaireReceived:
		return ui.BadgeInfo
	case store.QuestionnaireSent:
		return ui.BadgeWarn
	}
	return ui.BadgeNeutral
}

func newSupplierWizard(cx *core.Scope, s *Session) *supplierWizard {
	w := &supplierWizard{
		open:     core.NewSignal(cx, false),
		supplier: core.NewSignal(cx, ""),
		name:     core.NewSignal(cx, ""),
		email:    core.NewSignal(cx, ""),
		year:     core.NewSignal(cx, ""),
		status:   core.NewSignal(cx, ""),
		failed:   core.NewSignal(cx, false),
		busy:     core.NewSignal(cx, false),
	}
	if len(s.periods) > 0 {
		w.year.Set(strconv.Itoa(s.periods[0].Year))
	} else {
		w.year.Set(strconv.Itoa(time.Now().UTC().Year()))
	}
	for _, q := range inbound.Cat1.Questions {
		w.checks = append(w.checks, supplierCheck{
			position: q.Position, on: core.NewSignal(cx, true),
		})
	}
	return w
}

func (w *supplierWizard) show() {
	w.status.Set("")
	w.failed.Set(false)
	w.busy.Set(false)
	w.name.Set("")
	w.email.Set("")
	w.open.Set(true)
}

func (w *supplierWizard) dialog(cx *core.Scope, s *Session, dataRev *core.Signal[int],
	onDone func(int), onFailed func(string)) core.Node {
	supplierOptions := []ui.Option[string]{{Value: "", Label: locales.SupplierDisclosuresWizardSupplierNone(cx)}}
	for _, supplier := range s.suppliers {
		supplierOptions = append(supplierOptions,
			ui.Option[string]{Value: supplier.ID, Label: supplier.Name})
	}
	yearOptions := make([]ui.Option[string], 0, len(s.periods))
	for _, period := range s.periods {
		yearOptions = append(yearOptions, ui.Option[string]{
			Value: strconv.Itoa(period.Year), Label: strconv.Itoa(period.Year)})
	}

	submit := func() {
		if w.busy.Get() {
			return
		}
		year, err := strconv.Atoi(strings.TrimSpace(w.year.Get()))
		if err != nil {
			w.failed.Set(true)
			w.status.Set(locales.SupplierDisclosuresWizardRequired(cx))
			return
		}
		positions := make([]string, 0, len(w.checks))
		for _, check := range w.checks {
			if check.on.Get() {
				positions = append(positions, check.position)
			}
		}
		supplierID := w.supplier.Get()
		name := strings.TrimSpace(w.name.Get())
		if (supplierID == "" && name == "") || len(positions) == 0 {
			w.failed.Set(true)
			w.status.Set(locales.SupplierDisclosuresWizardRequired(cx))
			return
		}
		email := strings.TrimSpace(w.email.Get())
		w.busy.Set(true)
		w.failed.Set(false)
		w.status.Set("")
		go func() {
			ctx := context.Background()
			id := supplierID
			if name != "" {
				created, err := s.db.CreateSupplier(ctx, name, "", email)
				if err != nil {
					s.scope.Post(func() {
						w.busy.Set(false)
						w.failed.Set(true)
						w.status.Set(locales.SupplierDisclosuresWizardFailed(cx) + ": " + err.Error())
					})
					return
				}
				id = created.ID
			} else if email != "" {
				if _, err := s.db.SetSupplierEmail(ctx, id, email); err != nil {
					s.log.Warn("set supplier email failed", "supplier", id, "err", err)
				}
			}
			service := &inbound.Service{Store: s.db}
			_, count, err := service.CreateDraft(ctx, inbound.CreateRequest{
				SupplierID: id, ReportingYear: year, Positions: positions,
			})
			s.scope.Post(func() {
				w.busy.Set(false)
				if err != nil {
					s.log.Warn("create inbound draft failed", "supplier", id, "err", err)
					w.failed.Set(true)
					w.status.Set(locales.SupplierDisclosuresWizardFailed(cx) + ": " + err.Error())
					return
				}
				if err := dataRefresh(s, dataRev); err != nil {
					w.failed.Set(true)
					w.status.Set(err.Error())
					return
				}
				s.requestNotificationPermission(cx)
				w.open.Set(false)
				onDone(count)
			})
		}()
	}

	checkRows := make([]core.Node, 0, len(w.checks))
	for index, check := range w.checks {
		index, check := index, check
		tq := inbound.Cat1.Questions[index]
		checkRows = append(checkRows, ui.Checkbox{
			Text:     supplierQuestionLabel(cx, tq, w.year.Get()),
			Checked:  check.on.Get,
			OnChange: func(on bool) { check.on.Set(on) },
			TestID:   "supplier-disclosures-wizard-check-" + tq.Position,
		})
	}

	body := []core.Node{
		dataField(cx, locales.SupplierDisclosuresWizardSupplier(cx),
			ui.Select[string]{Options: supplierOptions, Value: w.supplier.Get,
				OnChange: func(v string) {
					w.supplier.Set(v)
					for _, supplier := range s.suppliers {
						if supplier.ID == v {
							w.email.Set(supplier.Email)
						}
					}
				},
				Label:  locales.SupplierDisclosuresWizardSupplier(cx),
				TestID: "supplier-disclosures-wizard-supplier",
				Style:  core.Style{Width: core.Pct(100)}}),
		dataColumns(cx, 8,
			dataField(cx, locales.SupplierDisclosuresWizardNewSupplier(cx),
				ui.Input{Value: w.name.Get,
					Placeholder: locales.SupplierDisclosuresWizardNewSupplierPlaceholder(cx),
					OnChange:    w.name.Set, TestID: "supplier-disclosures-wizard-name"}, submit),
			dataField(cx, locales.SupplierDisclosuresWizardEmail(cx),
				ui.Input{Value: w.email.Get, Placeholder: "buyer@example.com",
					OnChange: w.email.Set, TestID: "supplier-disclosures-wizard-email"}, submit)),
		dataField(cx, locales.SupplierDisclosuresWizardYear(cx),
			supplierYearInput(cx, w, yearOptions), submit),
		dataField(cx, locales.SupplierDisclosuresWizardQuestions(cx),
			core.View{Style: core.Style{Gap: 4}, Children: checkRows}),
		core.Show{When: func() bool { return w.status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return w.status.Get() },
					Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
						if w.failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	}
	footer := []core.Node{
		dataCancelButton(cx, w.open, "supplier-disclosures-wizard-cancel"),
		ui.Button{Text: locales.SupplierDisclosuresWizardSubmit(cx), OnPress: submit,
			Busy: w.busy.Get, TestID: "supplier-disclosures-wizard-submit"},
	}
	return dataDialogSized(cx, w.open, locales.SupplierDisclosuresWizardTitle(cx), body, footer,
		"supplier-disclosures-wizard-dialog", 640, submit)
}

func supplierYearInput(cx *core.Scope, w *supplierWizard,
	options []ui.Option[string]) core.Node {
	if len(options) == 0 {
		return ui.Input{Value: w.year.Get, OnChange: w.year.Set,
			TestID: "supplier-disclosures-wizard-year"}
	}
	return ui.Select[string]{Options: options, Value: w.year.Get,
		OnChange: w.year.Set, Label: locales.SupplierDisclosuresWizardYear(cx),
		TestID: "supplier-disclosures-wizard-year", Style: core.Style{Width: core.Pct(100)}}
}

// supplierQuestionLabel shows the question in the reader's language and
// fills the period placeholder with the year this wizard will record.
func supplierQuestionLabel(cx *core.Scope, q inbound.Question, year string) string {
	prefix := q.Position + " · "
	if q.Tier > 0 {
		prefix += locales.SupplierDisclosuresDetailTier(cx, strconv.Itoa(q.Tier)) + " · "
	}
	return prefix + supplierQuestionText(cx.Env().Locale(), q, year)
}

// supplierQuestionText picks the question in the reader's language and fills
// the period placeholder with the year this wizard will record.
func supplierQuestionText(locale string, q inbound.Question, year string) string {
	text := q.RawEN
	if strings.HasPrefix(strings.ToLower(locale), "zh") && q.RawZH != "" {
		text = q.RawZH
	}
	if year != "" {
		text = strings.ReplaceAll(text, "{{period_year}}", year)
	}
	return text
}

func newSupplierDetail(cx *core.Scope, db *store.Store) *supplierDetail {
	return &supplierDetail{
		open:          core.NewSignal(cx, false),
		rev:           core.NewSignal(cx, 0),
		supplier:      core.NewSignal(cx, ""),
		year:          core.NewSignal(cx, 0),
		status:        core.NewSignal(cx, ""),
		due:           core.NewSignal(cx, ""),
		email:         core.NewSignal(cx, ""),
		message:       core.NewSignal(cx, ""),
		failed:        core.NewSignal(cx, false),
		busy:          core.NewSignal(cx, false),
		reviewOpen:    core.NewSignal(cx, false),
		reviewRev:     core.NewSignal(cx, 0),
		reviewBusy:    core.NewSignal(cx, false),
		reviewMessage: core.NewSignal(cx, ""),
		reviewFailed:  core.NewSignal(cx, false),
		tierOverride:  core.NewSignal(cx, ""),
		tier1Quantity: core.NewSignal(cx, ""),
		deleteOpen:    core.NewSignal(cx, false),
		remindOpen:    core.NewSignal(cx, false),
		accepted:      map[string]bool{},
		db:            db,
	}
}

// show loads one disclosure and opens its detail dialog.
func (d *supplierDetail) show(cx *core.Scope, s *Session, dataRev *core.Signal[int],
	q store.Questionnaire) {
	d.id = q.ID
	d.message.Set("")
	d.failed.Set(false)
	d.busy.Set(false)
	d.open.Set(true)
	d.load(cx, s)
}

// load refreshes the detail's cached rows and signals from the store.
func (d *supplierDetail) load(cx *core.Scope, s *Session) {
	if d.id == "" {
		return
	}
	ctx := context.Background()
	q, err := d.db.QuestionnaireByID(ctx, d.id)
	if err != nil || q == nil {
		d.open.Set(false)
		return
	}
	questions, err := d.db.ListQuestions(ctx, d.id)
	if err != nil {
		d.failed.Set(true)
		d.message.Set(err.Error())
		return
	}
	d.questions = questions
	d.supplier.Set(q.CustomerName)
	d.year.Set(q.ReportingYear)
	d.status.Set(q.Status)
	d.due.Set(q.DueDate)
	email := ""
	if supplier, err := s.db.SupplierByID(ctx, q.CustomerID); err == nil && supplier != nil {
		email = supplier.Email
	}
	d.email.Set(email)
	d.rev.Set(d.rev.Get() + 1)
}

func (d *supplierDetail) dialog(cx *core.Scope, s *Session, dataRev *core.Signal[int]) core.Node {
	export := func() {
		id := d.id
		d.busy.Set(true)
		d.failed.Set(false)
		d.message.Set(locales.SupplierDisclosuresDetailExporting(cx))
		go func() {
			service := &inbound.Service{Store: s.db}
			data, name, err := service.ExportBlank(context.Background(), id)
			s.scope.Post(func() {
				d.busy.Set(false)
				if err != nil {
					d.failed.Set(true)
					d.message.Set(locales.SupplierDisclosuresDetailExportFailed(cx, err.Error()))
					return
				}
				cx.SaveFile(core.SaveOptions{Name: name, MIME: questionnaire.WorkbookMIME,
					Data: data}, func(saved bool, path string, err error) {
					if err != nil {
						d.failed.Set(true)
						d.message.Set(locales.SupplierDisclosuresDetailExportFailed(cx, err.Error()))
						return
					}
					if !saved {
						d.message.Set("")
						return
					}
					d.failed.Set(false)
					d.message.Set(locales.SupplierDisclosuresDetailExportSuccess(cx, path))
					d.load(cx, s)
					_ = dataRefresh(s, dataRev)
				})
			})
		}()
	}
	importFilled := func() {
		cx.PickFiles(core.PickFilesOptions{
			Multiple: false, Types: []string{".xlsx"},
			Title:  locales.SupplierDisclosuresDetailImport(cx),
			Button: locales.SupplierDisclosuresDetailImportChoose(cx),
		}, func(files []core.File, err error) {
			if err != nil || len(files) == 0 {
				if err != nil {
					d.failed.Set(true)
					d.message.Set(err.Error())
				}
				return
			}
			file := files[0]
			if file.Size > questionnaire.MaxWorkbookBytes {
				d.failed.Set(true)
				d.message.Set(locales.SupplierDisclosuresDetailImportFailed(cx,
					locales.SupplierDisclosuresFileTooLarge(cx)))
				return
			}
			reader, err := file.Open()
			if err != nil {
				d.failed.Set(true)
				d.message.Set(err.Error())
				return
			}
			data, readErr := io.ReadAll(io.LimitReader(reader, questionnaire.MaxWorkbookBytes+1))
			_ = reader.Close()
			if readErr != nil {
				d.failed.Set(true)
				d.message.Set(readErr.Error())
				return
			}
			id := d.id
			d.busy.Set(true)
			d.failed.Set(false)
			d.message.Set(locales.SupplierDisclosuresDetailImporting(cx))
			go func() {
				service := &inbound.Service{Store: s.db}
				preview, err := service.ImportFilled(context.Background(), id, data)
				s.scope.Post(func() {
					d.busy.Set(false)
					if err != nil {
						d.failed.Set(true)
						d.message.Set(locales.SupplierDisclosuresDetailImportFailed(cx,
							importErrorText(cx, err)))
						return
					}
					d.load(cx, s)
					_ = dataRefresh(s, dataRev)
					d.setPreview(cx, preview)
					d.failed.Set(false)
					d.message.Set(locales.SupplierDisclosuresDetailImportSuccess(cx,
						strconv.Itoa(len(preview.Answers))))
					d.reviewOpen.Set(true)
				})
			}()
		})
	}
	openReview := func() {
		service := &inbound.Service{Store: s.db}
		preview, err := service.Preview(context.Background(), d.id)
		if err != nil {
			d.failed.Set(true)
			d.message.Set(locales.SupplierDisclosuresDetailImportFailed(cx, err.Error()))
			return
		}
		d.setPreview(cx, preview)
		d.reviewOpen.Set(true)
	}

	footer := core.Dynamic(func(cx *core.Scope) core.Node {
		var actions []core.Node
		switch d.status.Get() {
		case store.QuestionnaireDraft, store.QuestionnaireSent:
			actions = append(actions,
				ui.Button{Text: locales.SupplierDisclosuresDetailExport(cx), Variant: ui.ButtonSecondary,
					OnPress: export, Busy: d.busy.Get, TestID: "supplier-disclosures-export"},
				ui.Button{Text: locales.SupplierDisclosuresDetailImport(cx), Variant: ui.ButtonSecondary,
					OnPress: importFilled, Busy: d.busy.Get, TestID: "supplier-disclosures-import"})
		case store.QuestionnaireReceived:
			actions = append(actions,
				ui.Button{Text: locales.SupplierDisclosuresDetailReview(cx),
					OnPress: openReview, TestID: "supplier-disclosures-review"},
				ui.Button{Text: locales.SupplierDisclosuresDetailImport(cx), Variant: ui.ButtonSecondary,
					OnPress: importFilled, Busy: d.busy.Get, TestID: "supplier-disclosures-import"})
		}
		actions = append(actions,
			ui.Button{Text: locales.SupplierDisclosuresDetailRemind(cx), Variant: ui.ButtonSecondary,
				OnPress: func() {
					d.message.Set("")
					d.remindOpen.Set(true)
				}, TestID: "supplier-disclosures-remind"},
			ui.Button{Text: locales.SupplierDisclosuresDetailDelete(cx), Variant: ui.ButtonOutline,
				OnPress: func() { d.deleteOpen.Set(true) }, TestID: "supplier-disclosures-delete"},
			ui.Button{Text: locales.SupplierDisclosuresDetailClose(cx), Variant: ui.ButtonSecondary,
				OnPress: func() { d.open.Set(false) }, TestID: "supplier-disclosures-detail-close"})
		return core.View{Style: core.Style{Direction: core.Row, Gap: 8,
			JustifyContent: core.JustifyEnd, Wrap: core.Wrap}, Children: actions}
	})

	body := []core.Node{
		core.Text{ContentFunc: func() string {
			return d.supplier.Get() + " · " + strconv.Itoa(d.year.Get())
		}, Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
		core.View{Style: core.Style{Direction: core.Row, Gap: 8, AlignItems: core.AlignCenter},
			Children: []core.Node{
				ui.Badge{
					TextFunc:    func() string { return supplierStatusLabel(cx, d.status.Get()) },
					VariantFunc: func() ui.BadgeVariant { return supplierStatusVariant(d.status.Get()) },
				},
				core.Text{ContentFunc: func() string {
					if d.due.Get() == "" {
						return ""
					}
					return locales.SupplierDisclosuresDue(cx, d.due.Get())
				}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}},
		core.Show{When: func() bool { return d.message.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return d.message.Get() },
					Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
						if d.failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		core.Dynamic(func(cx *core.Scope) core.Node {
			_ = d.rev.Get()
			nodes := make([]core.Node, 0, len(d.questions))
			for index, question := range d.questions {
				nodes = append(nodes, supplierQuestionRow(cx, index, question))
			}
			return core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1,
				MinHeight: core.Pt(0), MaxHeight: core.Pt(360)},
				Children: []core.Node{core.View{Style: core.Style{Gap: 6}, Children: nodes}}}
		}),
	}
	return dataDialogSized(cx, d.open, locales.SupplierDisclosuresDetailTitle(cx), body, []core.Node{footer},
		"supplier-disclosures-detail-dialog", 780)
}

func supplierQuestionRow(cx *core.Scope, index int, q store.Question) core.Node {
	text := q.RawText
	if strings.TrimSpace(text) == "" {
		text = q.NormalizedText
	}
	answer := locales.SupplierDisclosuresDetailUnanswered(cx)
	if q.Answered() {
		answer = q.AnswerValue
		if q.AnswerUnit != "" {
			answer += " " + q.AnswerUnit
		}
	}
	meta := q.Position
	if q.Tier > 0 {
		meta += " · " + locales.SupplierDisclosuresDetailTier(cx, strconv.Itoa(q.Tier))
	}
	finalized := q.AnswerFinalizedAt != ""
	return core.View{TestID: "supplier-disclosures-question-" + strconv.Itoa(index),
		Style: core.Style{Gap: 2, Padding: core.Symmetric(8, 6), CornerRadius: 6,
			Background: ui.ColorsOf(cx).Surface()},
		Children: []core.Node{
			core.Text{Content: meta, Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
			core.Text{Content: text, Style: core.Style{FontSize: 12}, MaxLines: 3},
			core.View{Style: core.Style{Direction: core.Row, Gap: 6, AlignItems: core.AlignCenter},
				Children: []core.Node{
					core.Text{Content: answer, Style: core.Style{FontSize: 12, FontWeight: ui.Semibold}},
					core.Show{When: func() bool { return finalized },
						Then: func(cx *core.Scope) core.Node {
							return ui.Badge{Text: locales.SupplierDisclosuresDetailFinalized(cx),
								Variant: ui.BadgeAccent}
						}},
				}},
		}}
}

func (d *supplierDetail) setPreview(cx *core.Scope, preview inbound.Preview) {
	d.reviewAnswers = preview.Answers
	d.reviewWarnings = preview.Warnings
	d.reviewPlan = preview.Plan
	d.accepted = make(map[string]bool, len(preview.Answers))
	for _, answer := range preview.Answers {
		d.accepted[answer.QuestionID] = !answer.IsBlank
	}
	d.tierOverride.Set("")
	d.tier1Quantity.Set("")
	d.reviewMessage.Set("")
	d.reviewFailed.Set(false)
	d.reviewRev.Set(d.reviewRev.Get() + 1)
}

func (d *supplierDetail) reviewDialog(cx *core.Scope, s *Session,
	dataRev *core.Signal[int]) core.Node {
	ingest := func() {
		accepted := make([]string, 0, len(d.accepted))
		for id, on := range d.accepted {
			if on {
				accepted = append(accepted, id)
			}
		}
		var quantity *float64
		if raw := strings.TrimSpace(d.tier1Quantity.Get()); raw != "" {
			value, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				d.reviewFailed.Set(true)
				d.reviewMessage.Set(locales.SupplierDisclosuresReviewQuantityInvalid(cx))
				return
			}
			quantity = &value
		}
		override := 0
		switch d.tierOverride.Get() {
		case "1":
			override = 1
		case "2":
			override = 2
		}
		id := d.id
		_, estimated := d.estimatedPlan()
		d.reviewBusy.Set(true)
		d.reviewFailed.Set(false)
		d.reviewMessage.Set(locales.SupplierDisclosuresReviewIngesting(cx))
		go func() {
			service := &inbound.Service{Store: s.db}
			result, err := service.Ingest(context.Background(), inbound.IngestRequest{
				QuestionnaireID: id, Accepted: accepted, Tier1Quantity: quantity,
				TierOverride: override,
			})
			s.scope.Post(func() {
				d.reviewBusy.Set(false)
				if err != nil {
					d.reviewFailed.Set(true)
					d.reviewMessage.Set(locales.SupplierDisclosuresDetailIngestFailed(cx,
						ingestErrorText(cx, err)))
					return
				}
				if !result.Ingested {
					d.reviewFailed.Set(true)
					d.reviewMessage.Set(locales.SupplierDisclosuresDetailIngestNoData(cx))
					return
				}
				d.reviewOpen.Set(false)
				d.failed.Set(false)
				d.message.Set(locales.SupplierDisclosuresDetailIngestSuccess(cx,
					formatCO2e(estimated)))
				d.load(cx, s)
				_ = dataRefresh(s, dataRev)
			})
		}()
	}

	tierOptions := []ui.Option[string]{
		{Value: "", Label: locales.SupplierDisclosuresReviewTierAuto(cx)},
		{Value: "1", Label: locales.SupplierDisclosuresReviewTierOne(cx)},
		{Value: "2", Label: locales.SupplierDisclosuresReviewTierTwo(cx)},
	}
	body := []core.Node{
		core.Text{Content: locales.SupplierDisclosuresReviewHint(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.View{Style: core.Style{Direction: core.Row, Gap: 8, AlignItems: core.AlignEnd},
			Children: []core.Node{
				dataField(cx, locales.SupplierDisclosuresReviewTier(cx),
					ui.Select[string]{Options: tierOptions, Value: d.tierOverride.Get,
						OnChange: d.tierOverride.Set, Label: locales.SupplierDisclosuresReviewTier(cx),
						TestID: "supplier-disclosures-review-tier"}),
				dataField(cx, locales.SupplierDisclosuresReviewQuantity(cx),
					ui.Input{Value: d.tier1Quantity.Get,
						Placeholder: locales.SupplierDisclosuresReviewQuantityHint(cx),
						OnChange:    d.tier1Quantity.Set,
						TestID:      "supplier-disclosures-review-quantity"}),
				ui.Button{Text: locales.SupplierDisclosuresReviewAcceptAll(cx),
					Variant: ui.ButtonSecondary, OnPress: func() {
						for _, answer := range d.reviewAnswers {
							d.accepted[answer.QuestionID] = !answer.IsBlank
						}
						d.reviewRev.Set(d.reviewRev.Get() + 1)
					}, TestID: "supplier-disclosures-review-accept-all"},
			}},
		core.Dynamic(func(cx *core.Scope) core.Node {
			_ = d.reviewRev.Get()
			nodes := make([]core.Node, 0, len(d.reviewAnswers))
			for index, answer := range d.reviewAnswers {
				answer := answer
				nodes = append(nodes, supplierReviewRow(cx, index, answer, d.accepted,
					func(on bool) {
						d.accepted[answer.QuestionID] = on
						d.reviewRev.Set(d.reviewRev.Get() + 1)
					}, strconv.Itoa(d.year.Get())))
			}
			return core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1,
				MinHeight: core.Pt(0), MaxHeight: core.Pt(340)},
				Children: []core.Node{core.View{Style: core.Style{Gap: 4}, Children: nodes}}}
		}),
		core.Text{ContentFunc: func() string {
			_ = d.reviewRev.Get()
			_ = d.tierOverride.Get()
			_ = d.tier1Quantity.Get()
			rows, total := d.estimatedPlan()
			return locales.SupplierDisclosuresReviewPlan(cx, strconv.Itoa(rows),
				formatCO2e(total))
		}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.Show{When: func() bool { return len(d.reviewWarnings) > 0 },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string {
					return locales.SupplierDisclosuresReviewWarnings(cx,
						strconv.Itoa(len(d.reviewWarnings)))
				}, Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Warn)}
			}},
		core.Show{When: func() bool { return d.reviewMessage.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return d.reviewMessage.Get() },
					Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
						if d.reviewFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	}
	footer := []core.Node{
		ui.Button{Text: locales.SupplierDisclosuresReviewCancel(cx), Variant: ui.ButtonSecondary,
			OnPress: func() { d.reviewOpen.Set(false) }, TestID: "supplier-disclosures-review-cancel"},
		ui.Button{Text: locales.SupplierDisclosuresReviewIngest(cx), OnPress: ingest,
			Busy: d.reviewBusy.Get, TestID: "supplier-disclosures-review-ingest"},
	}
	return dataDialogSized(cx, d.reviewOpen, locales.SupplierDisclosuresReviewTitle(cx), body,
		footer, "supplier-disclosures-review-dialog", 760)
}

// estimatedPlan materializes the rows and total the current selection would
// ingest, so the review summary follows the checkboxes and quantity.
func (d *supplierDetail) estimatedPlan() (int, float64) {
	byPosition := make(map[string]inbound.PreviewAnswer, len(d.reviewAnswers))
	for _, answer := range d.reviewAnswers {
		byPosition[answer.Position] = answer
	}
	tier := d.reviewPlan.Tier
	switch d.tierOverride.Get() {
	case "1":
		if d.tierOneReady(byPosition) {
			tier = 1
		}
	case "2":
		if d.tierTwoReady(byPosition) {
			tier = 2
		}
	}
	switch tier {
	case 1:
		answer := byPosition["tier1.1"]
		if !d.tierOneReady(byPosition) {
			return 0, 0
		}
		quantity, err := strconv.ParseFloat(strings.TrimSpace(d.tier1Quantity.Get()), 64)
		if err != nil || quantity <= 0 {
			return 0, 0
		}
		return 1, answer.Number * quantity
	case 2:
		answer, ok := byPosition["tier2.3"]
		if !ok || !d.accepted[answer.QuestionID] || !answer.IsNumeric {
			return 0, 0
		}
		return 1, answer.Number
	}
	return 0, 0
}

func (d *supplierDetail) tierOneReady(byPosition map[string]inbound.PreviewAnswer) bool {
	answer, ok := byPosition["tier1.1"]
	if !ok || !d.accepted[answer.QuestionID] || !answer.IsNumeric {
		return false
	}
	quantity, err := strconv.ParseFloat(strings.TrimSpace(d.tier1Quantity.Get()), 64)
	return err == nil && quantity > 0
}

func (d *supplierDetail) tierTwoReady(byPosition map[string]inbound.PreviewAnswer) bool {
	for _, position := range []string{"tier2.1", "tier2.2", "tier2.3"} {
		answer, ok := byPosition[position]
		if !ok || !d.accepted[answer.QuestionID] || answer.IsBlank {
			return false
		}
	}
	return true
}

func supplierReviewRow(cx *core.Scope, index int, answer inbound.PreviewAnswer,
	accepted map[string]bool, onToggle func(bool), year string) core.Node {
	value := answer.Raw
	if answer.IsNumeric {
		value = strconv.FormatFloat(answer.Number, 'f', -1, 64)
	}
	if strings.TrimSpace(value) == "" {
		value = locales.SupplierDisclosuresDetailUnanswered(cx)
	}
	if answer.Note != "" {
		value += " · " + answer.Note
	}
	text := answer.Position
	if q, ok := inbound.Cat1.QuestionByPosition(answer.Position); ok {
		text = supplierQuestionLabel(cx, q, year)
	}
	return core.View{TestID: "supplier-disclosures-review-row-" + strconv.Itoa(index),
		Style: core.Style{Direction: core.Row, Gap: 8, AlignItems: core.AlignCenter,
			Padding: core.Symmetric(6, 6), CornerRadius: 6,
			Background: ui.ColorsOf(cx).Surface()},
		Children: []core.Node{
			ui.Checkbox{Checked: func() bool { return accepted[answer.QuestionID] },
				OnChange: onToggle, TestID: "supplier-disclosures-review-accept-" + answer.Position},
			core.View{Style: core.Style{Gap: 1, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.Text{Content: text, Style: core.Style{FontSize: 12}, MaxLines: 2},
					core.Text{Content: value, Style: core.Style{FontSize: 12,
						FontWeight: ui.Semibold}, MaxLines: 1},
				}},
		}}
}

func (d *supplierDetail) deleteDialog(cx *core.Scope, s *Session,
	dataRev *core.Signal[int]) core.Node {
	confirm := func() {
		id := d.id
		d.deleteOpen.Set(false)
		d.busy.Set(true)
		go func() {
			service := &inbound.Service{Store: s.db}
			removed, err := service.Delete(context.Background(), id)
			s.scope.Post(func() {
				d.busy.Set(false)
				if err != nil {
					d.failed.Set(true)
					d.message.Set(err.Error())
					return
				}
				d.open.Set(false)
				_ = dataRefresh(s, dataRev)
				s.log.Info("inbound disclosure deleted", "questionnaire", id, "rows", removed)
			})
		}()
	}
	body := []core.Node{
		core.Text{Content: locales.SupplierDisclosuresDetailDeleteBody(cx),
			Style: core.Style{FontSize: 13}},
	}
	footer := []core.Node{
		ui.Button{Text: locales.SupplierDisclosuresDetailDeleteCancel(cx),
			Variant: ui.ButtonSecondary, OnPress: func() { d.deleteOpen.Set(false) },
			TestID: "supplier-disclosures-delete-cancel"},
		ui.Button{Text: locales.SupplierDisclosuresDetailDeleteConfirm(cx),
			Variant: ui.ButtonOutline, OnPress: confirm,
			TestID: "supplier-disclosures-delete-confirm"},
	}
	return dataDialog(cx, d.deleteOpen, locales.SupplierDisclosuresDetailDelete(cx), body, footer,
		"supplier-disclosures-delete-dialog")
}

func (d *supplierDetail) remindDialog(cx *core.Scope, s *Session,
	dataRev *core.Signal[int]) core.Node {
	send := func() {
		email := strings.TrimSpace(d.email.Get())
		if email == "" {
			d.failed.Set(true)
			d.message.Set(locales.SupplierDisclosuresDetailEmailMissing(cx))
			d.remindOpen.Set(false)
			return
		}
		link := reminderMailto(cx, s, email, d.supplier.Get(), d.year.Get(), d.due.Get())
		cx.OpenURL(link, nil)
		d.remindOpen.Set(false)
	}
	save := func() {
		current, err := d.db.QuestionnaireByID(context.Background(), d.id)
		if err != nil || current == nil {
			d.failed.Set(true)
			d.message.Set(locales.SupplierDisclosuresDetailEmailSaveFailed(cx))
			return
		}
		if _, err := d.db.SetSupplierEmail(context.Background(), current.CustomerID,
			d.email.Get()); err != nil {
			d.failed.Set(true)
			d.message.Set(locales.SupplierDisclosuresDetailEmailSaveFailed(cx))
			return
		}
		d.failed.Set(false)
		d.message.Set(locales.SupplierDisclosuresDetailEmailSaved(cx))
		d.remindOpen.Set(false)
		_ = dataRefresh(s, dataRev)
	}
	body := []core.Node{
		dataField(cx, locales.SupplierDisclosuresDetailEmail(cx),
			ui.Input{Value: d.email.Get, Placeholder: "buyer@example.com",
				OnChange: d.email.Set, TestID: "supplier-disclosures-remind-email"}, send),
		core.Text{Content: locales.SupplierDisclosuresDetailRemindBody(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
	}
	footer := []core.Node{
		ui.Button{Text: locales.SupplierDisclosuresDetailEmailSave(cx),
			Variant: ui.ButtonSecondary, OnPress: save,
			TestID: "supplier-disclosures-remind-save"},
		ui.Button{Text: locales.SupplierDisclosuresDetailOpenMail(cx), OnPress: send,
			TestID: "supplier-disclosures-remind-send"},
	}
	return dataDialog(cx, d.remindOpen, locales.SupplierDisclosuresDetailRemind(cx), body, footer,
		"supplier-disclosures-remind-dialog", send)
}

func reminderMailto(cx *core.Scope, s *Session, email, supplier string, year int,
	due string) string {
	subject := locales.SupplierDisclosuresRemindSubject(cx, strconv.Itoa(year))
	lines := []string{
		locales.SupplierDisclosuresRemindGreeting(cx, supplier),
		locales.SupplierDisclosuresRemindBody(cx, strconv.Itoa(year)),
	}
	if due != "" {
		lines = append(lines, locales.SupplierDisclosuresRemindOverdue(cx, due))
	}
	if s.organization != nil {
		name := s.organization.NameZH
		if name == "" {
			name = s.organization.NameEN
		}
		if name != "" {
			lines = append(lines, locales.SupplierDisclosuresRemindSignoff(cx, name))
		}
	}
	body := strings.Join(lines, "\n\n")
	return "mailto:" + url.PathEscape(email) + "?subject=" + url.QueryEscape(subject) +
		"&body=" + url.QueryEscape(body)
}

func importErrorText(cx *core.Scope, err error) string {
	switch {
	case errors.Is(err, inbound.ErrNotTemplate):
		return locales.SupplierDisclosuresImportNotTemplate(cx)
	case errors.Is(err, inbound.ErrWrongQuestionnaire):
		return locales.SupplierDisclosuresImportWrongQuestionnaire(cx)
	case errors.Is(err, inbound.ErrWrongPeriod):
		return locales.SupplierDisclosuresImportWrongPeriod(cx)
	}
	return err.Error()
}

func ingestErrorText(cx *core.Scope, err error) string {
	if errors.Is(err, inbound.ErrQuantityRequired) {
		return locales.SupplierDisclosuresReviewQuantityRequired(cx)
	}
	return err.Error()
}

func formatCO2e(kg float64) string {
	if kg >= 1000 {
		return strconv.FormatFloat(kg/1000, 'f', 2, 64) + " tCO2e"
	}
	return strconv.FormatFloat(kg, 'f', 2, 64) + " kgCO2e"
}

func (s *Session) inboundQuestionnaires() int {
	count := 0
	for _, q := range s.questionnaires {
		if q.Direction == "inbound" {
			count++
		}
	}
	return count
}

// requestNotificationPermission asks once, from a user action, so the overdue
// reminder can reach the notification center.
func (s *Session) requestNotificationPermission(cx *core.Scope) {
	cx.NotificationPermission(func(permission core.NotificationPermission) {
		if permission == core.NotificationsNotAsked {
			cx.RequestNotificationPermission(nil)
		}
	})
}

// notifyOverdueInbound raises one aggregate notification per local day when
// sent disclosures are past their due date. It never asks for permission:
// the app asks when the user first creates a disclosure.
func notifyOverdueInbound(cx *core.Scope, s *Session) {
	ctx := context.Background()
	today := time.Now().Format(supplierDisclosureDate)
	last, ok, err := s.db.Setting(ctx, overdueNotifySetting)
	if err != nil || (ok && last == today) {
		return
	}
	rows, err := s.db.OverdueInbound(ctx, today)
	if err != nil || len(rows) == 0 {
		return
	}
	cx.NotificationPermission(func(permission core.NotificationPermission) {
		if permission != core.NotificationsGranted && permission != core.NotificationsNotAsked {
			return
		}
		body := locales.SupplierDisclosuresNotifyMany(cx, strconv.Itoa(len(rows)))
		if len(rows) == 1 {
			body = locales.SupplierDisclosuresNotifyOne(cx, rows[0].SupplierName)
		}
		if err := cx.ShowNotification(core.Notification{
			ID: overdueNotificationID, Title: locales.SupplierDisclosuresNotifyTitle(cx),
			Body: body,
		}, func(shown bool) {
			if shown {
				_ = s.db.SetSetting(context.Background(), overdueNotifySetting, today)
			}
		}); err != nil {
			s.log.Warn("overdue notification failed", "err", err)
		}
	})
}
