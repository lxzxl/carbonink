package app

import (
	"context"
	"errors"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/inbound"
	"app.carbonink.desktop/internal/questionnaire"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
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
	order  *core.Signal[string]
}

// supplierWizard is the new-disclosure form: pick an existing supplier or
// name a new one, choose the template and year, and include a subset of the
// template.
type supplierWizard struct {
	open     *core.Signal[bool]
	supplier *core.Signal[string]
	name     *core.Signal[string]
	email    *core.Signal[string]
	template *core.Signal[string]
	year     *core.Signal[string]
	checks   map[string]*core.Signal[bool]
	status   *core.Signal[string]
	failed   *core.Signal[bool]
	busy     *core.Signal[bool]
}

// supplierDetail is one disclosure: its read-only answers, the export/import
// actions, and the review state of a supplier reply.
type supplierDetail struct {
	open         *core.Signal[bool]
	rev          *core.Signal[int]
	supplier     *core.Signal[string]
	templateKind *core.Signal[string]
	year         *core.Signal[int]
	status       *core.Signal[string]
	due          *core.Signal[string]
	email        *core.Signal[string]
	message      *core.Signal[string]
	failed       *core.Signal[bool]
	busy         *core.Signal[bool]

	reviewOpen    *core.Signal[bool]
	reviewRev     *core.Signal[int]
	reviewBusy    *core.Signal[bool]
	reviewMessage *core.Signal[string]
	reviewFailed  *core.Signal[bool]
	tierOverride  *core.Signal[string]
	tier1Quantity *core.Signal[string]
	tier3EFKey    *core.Signal[string]
	deleteOpen    *core.Signal[bool]
	remindOpen    *core.Signal[bool]

	id        string
	db        *store.Store
	questions []store.Question

	reviewAnswers   []inbound.PreviewAnswer
	reviewWarnings  []inbound.Warning
	reviewPlan      inbound.IngestPlan
	reviewInference store.QuantityInference
	reviewTier3     inbound.Tier3Preview
	reviewTier1Unit string
	accepted        map[string]bool
}

func (s *Session) supplierDisclosuresScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	filters := &supplierFilters{
		search: core.NewSignal(cx, ""),
		status: core.NewSignal(cx, ""),
		order:  core.NewSignal(cx, "recent"),
	}
	screenStatus := core.NewSignal(cx, "")
	screenFailed := core.NewSignal(cx, false)
	wizard := newSupplierWizard(cx, s)
	detail := newSupplierDetail(cx, s.db)
	templatesEditor := newSupplierTemplatesEditor(cx)
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
		today := time.Now().Format(supplierDisclosureDate)
		out := make([]store.Questionnaire, 0, len(s.questionnaires))
		for _, q := range s.questionnaires {
			if q.Direction != "inbound" {
				continue
			}
			if status != "" {
				if status == "overdue" {
					if !(q.Status == store.QuestionnaireSent && q.DueDate != "" && q.DueDate < today) {
						continue
					}
				} else if q.Status != status {
					continue
				}
			}
			if query != "" && !strings.Contains(strings.ToLower(q.CustomerName), query) {
				continue
			}
			out = append(out, q)
		}
		switch filters.order.Get() {
		case "oldest":
			sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
		case "supplier":
			sort.SliceStable(out, func(i, j int) bool {
				return strings.ToLower(out[i].CustomerName) < strings.ToLower(out[j].CustomerName)
			})
		case "due":
			sort.SliceStable(out, func(i, j int) bool {
				if out[i].DueDate == "" {
					return false
				}
				if out[j].DueDate == "" {
					return true
				}
				return out[i].DueDate < out[j].DueDate
			})
		case "questions":
			sort.SliceStable(out, func(i, j int) bool { return out[i].QuestionCount > out[j].QuestionCount })
		default:
			sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
		}
		return out
	}

	orderOptions := []ui.Option[string]{
		{Value: "recent", Label: locales.InboundSortRecent(cx)},
		{Value: "oldest", Label: locales.InboundSortOldest(cx)},
		{Value: "supplier", Label: locales.InboundSortSupplier(cx)},
		{Value: "due", Label: locales.InboundSortDue(cx)},
		{Value: "questions", Label: locales.InboundSortQuestions(cx)},
	}
	list := core.Dynamic(func(cx *core.Scope) core.Node {
		_ = dataRev.Get()
		_ = filters.search.Get()
		_ = filters.status.Get()
		_ = filters.order.Get()
		visible := rows()
		query := strings.ToLower(strings.TrimSpace(filters.search.Get()))
		today := time.Now().Format(supplierDisclosureDate)
		total := 0
		counts := map[string]int{}
		allInbound := 0
		for _, q := range s.questionnaires {
			if q.Direction != "inbound" {
				continue
			}
			allInbound++
			if query != "" && !strings.Contains(strings.ToLower(q.CustomerName), query) {
				continue
			}
			total++
			counts[q.Status]++
			if q.Status == store.QuestionnaireSent && q.DueDate != "" && q.DueDate < today {
				counts["overdue"]++
			}
		}
		nodes := make([]core.Node, 0, len(visible))
		for _, q := range visible {
			q := q
			overdue := q.Status == store.QuestionnaireSent && q.DueDate != "" && q.DueDate < today
			nodes = append(nodes, supplierDisclosureRow(cx, q, overdue, func() bool {
				return detail.open.Get() && detail.id == q.ID
			},
				func() { detail.show(cx, s, dataRev, q) }))
		}
		label := func(value string) string {
			switch value {
			case "":
				return locales.SupplierDisclosuresStatusAll(cx)
			case "overdue":
				return locales.InboundFilterOverdue(cx)
			default:
				return supplierStatusLabel(cx, value)
			}
		}
		chip := func(value string, count int) core.Node {
			var color []func(*core.Scope) core.Color
			if value == "overdue" {
				color = append(color, func(cx *core.Scope) core.Color {
					return ui.ColorsOf(cx).Danger()
				})
			}
			return filterChip(cx, true, "supplier-disclosures-filter-"+firstNonEmpty(value, "all"),
				label(value), func() int { return count },
				func() bool { return filters.status.Get() == value },
				func() { filters.status.Set(value) }, color...)
		}
		chips := []core.Node{chip("", total)}
		for _, status := range []string{store.QuestionnaireDraft, store.QuestionnaireSent,
			store.QuestionnaireReceived, store.QuestionnaireIngested, "overdue"} {
			chips = append(chips, chip(status, counts[status]))
		}
		content := []core.Node{}
		if allInbound == 0 {
			content = append(content, core.Text{Content: locales.SupplierDisclosuresEmpty(cx),
				Style:     core.Style{FontSize: 14, Padding: core.Symmetric(24, 16)},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
		} else if len(visible) == 0 {
			content = append(content, core.View{Style: core.Style{Padding: core.Symmetric(48, 16),
				Gap: 8, AlignItems: core.AlignCenter}, Children: []core.Node{
				core.Text{Content: locales.InboundListNoMatch(cx), Style: core.Style{FontSize: 14,
					TextAlign: core.TextAlignCenter}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
					MaxLines: 2},
				core.Show{When: func() bool {
					return filters.search.Get() != "" || filters.status.Get() != ""
				}, Then: func(*core.Scope) core.Node {
					return ui.Button{Text: locales.InboundClearFilters(cx),
						Variant: ui.ButtonGhost, OnPress: func() {
							filters.search.Set("")
							filters.status.Set("")
						}, TestID: "supplier-disclosures-filter-clear"}
				}},
			}})
		} else {
			content = append(content, core.View{Style: core.Style{Gap: 0}, Children: nodes})
		}
		filtersNode := core.View{Style: core.Style{Padding: core.Symmetric(12, 16),
			Gap: 8, Borders: core.Edges{Bottom: 1}}, StyleFunc: func() core.Style {
			return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
		}, Children: []core.Node{
			searchField(cx, filters.search.Get,
				locales.SupplierDisclosuresSearchPlaceholder(cx),
				filters.search.Set, "supplier-disclosures-search"),
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Wrap: core.Wrap, Gap: 4}, Children: []core.Node{
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Wrap: core.Wrap, Gap: 4}, Children: chips},
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					Gap: 8, AutoMargin: core.SideLeft}, Children: []core.Node{
					sortMenu(cx, orderOptions, filters.order.Get, filters.order.Set,
						"supplier-disclosures-sort"),
				}},
			}},
		}}
		scroll := core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1,
			MinHeight: core.Pt(0)}, Children: []core.Node{core.View{
			Style: core.Style{Gap: 0}, Children: content}}}
		children := []core.Node{scroll}
		if allInbound > 0 {
			children = []core.Node{filtersNode, scroll}
		}
		return core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
			Children: children}
	})

	left := core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{
			listPaneHeader(cx, locales.NavSupplierDisclosures, nil,
				ui.Button{Text: locales.SupplierTemplatesButton(cx), Icon: lucide.SlidersHorizontal,
					Variant: ui.ButtonGhost, Size: ui.SizeSmall, OnPress: templatesEditor.show,
					TestID: "supplier-disclosures-templates"},
				ui.Button{Text: locales.SupplierDisclosuresNewButton(cx), Icon: lucide.Plus,
					Variant: ui.ButtonOutline, Size: ui.SizeSmall, OnPress: wizard.show,
					TestID: "supplier-disclosures-new"}),
			core.Show{When: func() bool { return screenStatus.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string { return screenStatus.Get() },
						Style: core.Style{FontSize: 12, Padding: core.Symmetric(4, 16)},
						StyleFunc: func() core.Style {
							if screenFailed.Get() {
								return ui.Colored(ui.ColorsOf(cx).Danger)()
							}
							return ui.Colored(ui.ColorsOf(cx).Muted)()
						}}
				}},
			list,
		}}
	return core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{
			splitPage(cx, 32, left, detail.dialog(cx, s, dataRev)),
			wizard.dialog(cx, s, dataRev, func(count int) {
				screenFailed.Set(false)
				screenStatus.Set(locales.SupplierDisclosuresWizardCreated(cx, strconv.Itoa(count)))
			}, func(message string) {
				screenFailed.Set(true)
				screenStatus.Set(message)
			}),
			detail.reviewDialog(cx, s, dataRev),
			detail.deleteDialog(cx, s, dataRev),
			detail.remindDialog(cx, s, dataRev),
			templatesEditor.dialog(cx, s, dataRev),
		}}
}

func supplierDisclosureRow(cx *core.Scope, q store.Questionnaire, overdue bool,
	selected func() bool, onPress func()) core.Node {
	meta := strconv.Itoa(q.ReportingYear) + " · " + supplierStatusLabel(cx, q.Status) +
		" · " + locales.QuestionnairesQuestionCount(cx, strconv.Itoa(q.QuestionCount))
	metaColor := func() core.Color { return ui.ColorsOf(cx).Muted() }
	if q.DueDate != "" {
		if overdue {
			meta += " · " + locales.InboundOverdueDays(cx, strconv.Itoa(supplierOverdueDays(q.DueDate)))
			metaColor = func() core.Color { return ui.ColorsOf(cx).Danger() }
		} else {
			meta += " · " + locales.SupplierDisclosuresDue(cx, q.DueDate)
		}
	}
	return dataClickableRowSelected(cx, "supplier-disclosures-row-"+q.ID, onPress, selected,
		core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
			Children: []core.Node{
				core.Text{Content: q.CustomerName, Style: core.Style{FontSize: 14,
					FontWeight: ui.Medium, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
				core.Text{Content: meta, Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style { return core.Style{Color: metaColor()} },
					MaxLines:  2},
			}})
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
		return ui.BadgeWarn
	case store.QuestionnaireSent:
		return ui.BadgeNeutral
	}
	return ui.BadgeNeutral
}

func newSupplierWizard(cx *core.Scope, s *Session) *supplierWizard {
	w := &supplierWizard{
		open:     core.NewSignal(cx, false),
		supplier: core.NewSignal(cx, ""),
		name:     core.NewSignal(cx, ""),
		email:    core.NewSignal(cx, ""),
		template: core.NewSignal(cx, inbound.TemplateCat1),
		year:     core.NewSignal(cx, ""),
		checks:   map[string]*core.Signal[bool]{},
		status:   core.NewSignal(cx, ""),
		failed:   core.NewSignal(cx, false),
		busy:     core.NewSignal(cx, false),
	}
	if len(s.periods) > 0 {
		w.year.Set(strconv.Itoa(s.periods[0].Year))
	} else {
		w.year.Set(strconv.Itoa(time.Now().UTC().Year()))
	}
	for _, tmpl := range inbound.Templates() {
		for _, q := range tmpl.Questions {
			if _, ok := w.checks[q.Position]; !ok {
				w.checks[q.Position] = core.NewSignal(cx, true)
			}
		}
	}
	return w
}

func (w *supplierWizard) show() {
	w.status.Set("")
	w.failed.Set(false)
	w.busy.Set(false)
	w.name.Set("")
	w.email.Set("")
	w.template.Set(inbound.TemplateCat1)
	w.open.Set(true)
}

func (w *supplierWizard) checkSignal(cx *core.Scope, position string) *core.Signal[bool] {
	if sig, ok := w.checks[position]; ok {
		return sig
	}
	sig := core.NewSignal(cx, true)
	w.checks[position] = sig
	return sig
}

func (w *supplierWizard) dialog(cx *core.Scope, s *Session, dataRev *core.Signal[int],
	onDone func(int), onFailed func(string)) core.Node {
	return core.Dynamic(func(cx *core.Scope) core.Node {
		if !w.open.Get() {
			return core.View{}
		}
		_ = dataRev.Get()
		templates := s.allInboundTemplates()
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
		templateOptions := make([]ui.Option[string], 0, len(templates))
		for _, tmpl := range templates {
			templateOptions = append(templateOptions, ui.Option[string]{
				Value: tmpl.Kind, Label: supplierTemplateLabel(cx.Env().Locale(), tmpl),
			})
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
			tmpl := s.inboundTemplateByKind(w.template.Get())
			positions := make([]string, 0, len(tmpl.Questions))
			for _, q := range tmpl.Questions {
				if w.checkSignal(cx, q.Position).Get() {
					positions = append(positions, q.Position)
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
			templateKind := tmpl.Kind
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
					SupplierID: id, TemplateKind: templateKind,
					ReportingYear: year, Positions: positions,
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

		questionsList := core.Dynamic(func(cx *core.Scope) core.Node {
			tmpl := s.inboundTemplateByKind(w.template.Get())
			year := w.year.Get()
			checkRows := make([]core.Node, 0, len(tmpl.Questions))
			for _, tq := range tmpl.Questions {
				tq := tq
				sig := w.checkSignal(cx, tq.Position)
				checkRows = append(checkRows, ui.Checkbox{
					Text:     supplierQuestionLabel(cx, tq, year),
					Checked:  sig.Get,
					OnChange: func(on bool) { sig.Set(on) },
					TestID:   "supplier-disclosures-wizard-check-" + tq.Position,
				})
			}
			return core.Scroll{
				Style:    core.Style{MaxHeight: core.Pt(240)},
				Children: []core.Node{core.View{Style: core.Style{Gap: 4}, Children: checkRows}},
			}
		})

		body := []core.Node{
			dataField(cx, locales.SupplierDisclosuresWizardSupplier(cx),
				appSelect[string]{Options: supplierOptions, Value: w.supplier.Get,
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
			dataColumns(cx, 8,
				dataField(cx, locales.SupplierDisclosuresWizardTemplate(cx),
					appSelect[string]{Options: templateOptions, Value: w.template.Get,
						OnChange: w.template.Set,
						Label:    locales.SupplierDisclosuresWizardTemplate(cx),
						TestID:   "supplier-disclosures-wizard-template",
						Style:    core.Style{Width: core.Pct(100)}}),
				dataField(cx, locales.SupplierDisclosuresWizardYear(cx),
					supplierYearInput(cx, w, yearOptions), submit)),
			dataField(cx, locales.SupplierDisclosuresWizardQuestions(cx), questionsList),
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
			"supplier-disclosures-wizard-dialog", 660, submit)
	})
}

func supplierYearInput(cx *core.Scope, w *supplierWizard,
	options []ui.Option[string]) core.Node {
	if len(options) == 0 {
		return ui.Input{Value: w.year.Get, OnChange: w.year.Set,
			TestID: "supplier-disclosures-wizard-year"}
	}
	return appSelect[string]{Options: options, Value: w.year.Get,
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

func supplierTemplateLabel(locale string, t inbound.Template) string {
	if strings.HasPrefix(strings.ToLower(locale), "zh") && t.LabelZH != "" {
		return t.LabelZH
	}
	if t.LabelEN != "" {
		return t.LabelEN
	}
	return t.Kind
}

func newSupplierDetail(cx *core.Scope, db *store.Store) *supplierDetail {
	return &supplierDetail{
		open:          core.NewSignal(cx, false),
		rev:           core.NewSignal(cx, 0),
		supplier:      core.NewSignal(cx, ""),
		templateKind:  core.NewSignal(cx, inbound.TemplateCat1),
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
		tier3EFKey:    core.NewSignal(cx, ""),
		deleteOpen:    core.NewSignal(cx, false),
		remindOpen:    core.NewSignal(cx, false),
		accepted:      map[string]bool{},
		db:            db,
	}
}

func supplierOverdueDays(due string) int {
	parsed, err := time.Parse(supplierDisclosureDate, due)
	if err != nil {
		return 0
	}
	days := int(time.Since(parsed).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
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
	kind := q.TemplateKind
	if kind == "" {
		kind = inbound.TemplateCat1
	}
	d.templateKind.Set(kind)
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
	return core.Dynamic(func(cx *core.Scope) core.Node {
		if !d.open.Get() {
			_ = dataRev.Get()
			for _, q := range s.questionnaires {
				if q.Direction == "inbound" {
					return detailEmptyIcon(cx, lucide.Download, locales.SupplierDisclosuresSelectDetail)
				}
			}
			return detailEmptyIcon(cx, lucide.Download, locales.SupplierDisclosuresEmpty)
		}
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
			)
			return core.View{
				Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
					JustifyContent: core.JustifySpaceBetween, Wrap: core.Wrap, Gap: 8,
					FlexGrow: 1, Width: core.Pct(100)},
				Children: []core.Node{
					ui.Button{Text: locales.SupplierDisclosuresDetailDelete(cx),
						Variant: ui.ButtonOutline, Tint: ui.ColorsOf(cx).Danger,
						OnPress: func() { d.deleteOpen.Set(true) },
						TestID:  "supplier-disclosures-delete"},
					core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
						Wrap: core.Wrap, Gap: 8}, Children: actions},
				},
			}
		})

		body := []core.Node{
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
					}, Style: core.Style{FontSize: typeCaption, FontVariant: core.FontTabularNums},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				}},
			core.Show{When: func() bool { return d.message.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string { return d.message.Get() },
						Style: core.Style{FontSize: typeCaption}, StyleFunc: func() core.Style {
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
					nodes = append(nodes, supplierQuestionRow(cx, index, index < len(d.questions)-1, question))
				}
				return core.View{Style: core.Style{Gap: 0, Overflow: core.Hidden},
					StyleFunc: cardSurface(cx), Children: nodes}
			}),
		}
		header := []core.Node{
			ui.Button{Text: locales.SupplierDisclosuresDetailClose(cx), Variant: ui.ButtonSecondary,
				OnPress: func() { d.open.Set(false) }, TestID: "supplier-disclosures-detail-close"},
		}
		title := d.supplier.Get()
		if d.year.Get() > 0 {
			title += " · " + strconv.Itoa(d.year.Get())
		}
		return detailPaneShell(cx, "supplier-disclosures-detail-dialog", title,
			header, body, []core.Node{footer})
	})
}

func supplierQuestionRow(cx *core.Scope, index int, bottomBorder bool, q store.Question) core.Node {
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
	borders := core.Edges{}
	if bottomBorder {
		borders.Bottom = 1
	}
	return core.View{TestID: "supplier-disclosures-question-" + strconv.Itoa(index),
		Style: core.Style{Gap: 3, Padding: core.Symmetric(10, 14), Borders: borders},
		StyleFunc: func() core.Style {
			return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
		},
		Children: []core.Node{
			core.Text{Content: meta, Style: core.Style{FontSize: typeMicro, FontFamily: core.FontMonospace},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
			core.Text{Content: text, Style: core.Style{FontSize: typeCaption}, MaxLines: 3},
			core.View{Style: core.Style{Direction: core.Row, Gap: 6, AlignItems: core.AlignCenter},
				Children: []core.Node{
					core.Text{Content: answer, Style: core.Style{FontSize: typeCaption,
						FontWeight: ui.Semibold, FontVariant: core.FontTabularNums}},
					core.Show{When: func() bool { return finalized },
						Then: func(cx *core.Scope) core.Node {
							return ui.Badge{Text: locales.SupplierDisclosuresDetailFinalized(cx),
								Variant: ui.BadgeAccent}
						}},
				}},
		}}
}

func encodeEFKey(ef store.EmissionFactor) string {
	return ef.FactorCode + "\x1f" + strconv.Itoa(ef.Year) + "\x1f" + ef.Source + "\x1f" +
		ef.Geography + "\x1f" + ef.DatasetVersion
}

func (d *supplierDetail) selectedTier3Candidate() (inbound.Tier3Candidate, bool) {
	selected := d.tier3EFKey.Get()
	for _, cand := range d.reviewTier3.Candidates {
		if cand.Compatible && encodeEFKey(cand.EF) == selected {
			return cand, true
		}
	}
	for _, cand := range d.reviewTier3.Candidates {
		if cand.Compatible {
			return cand, true
		}
	}
	return inbound.Tier3Candidate{}, false
}

func (d *supplierDetail) selectedTier3EF() *store.EmissionFactorKey {
	cand, ok := d.selectedTier3Candidate()
	if !ok {
		return nil
	}
	return &store.EmissionFactorKey{
		FactorCode: cand.EF.FactorCode, Year: cand.EF.Year,
		Source: cand.EF.Source, Geography: cand.EF.Geography,
		DatasetVersion: cand.EF.DatasetVersion,
	}
}

func (d *supplierDetail) setPreview(cx *core.Scope, preview inbound.Preview) {
	d.reviewAnswers = preview.Answers
	d.reviewWarnings = preview.Warnings
	d.reviewPlan = preview.Plan
	d.reviewInference = preview.QuantityInference
	d.reviewTier3 = preview.Tier3
	d.reviewTier1Unit = preview.Tier1Unit
	if d.reviewTier1Unit == "" {
		d.reviewTier1Unit = "kg"
	}
	d.accepted = make(map[string]bool, len(preview.Answers))
	for _, answer := range preview.Answers {
		d.accepted[answer.QuestionID] = !answer.IsBlank
	}
	d.tierOverride.Set("")
	if preview.QuantityInference.MatchedRows > 0 && preview.QuantityInference.MatchedAmount > 0 {
		d.tier1Quantity.Set(strconv.FormatFloat(preview.QuantityInference.MatchedAmount, 'f', -1, 64))
	} else {
		d.tier1Quantity.Set("")
	}
	defaultEF := ""
	for _, cand := range preview.Tier3.Candidates {
		if cand.Compatible {
			defaultEF = encodeEFKey(cand.EF)
			break
		}
	}
	d.tier3EFKey.Set(defaultEF)
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
		case "3":
			override = 3
		}
		id := d.id
		_, estimated := d.estimatedPlan()
		tier3EF := d.selectedTier3EF()
		d.reviewBusy.Set(true)
		d.reviewFailed.Set(false)
		d.reviewMessage.Set(locales.SupplierDisclosuresReviewIngesting(cx))
		go func() {
			service := &inbound.Service{Store: s.db}
			result, err := service.Ingest(context.Background(), inbound.IngestRequest{
				QuestionnaireID: id, Accepted: accepted, Tier1Quantity: quantity,
				TierOverride: override, Tier3EF: tier3EF,
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
				total := estimated
				if result.CO2eKg > 0 {
					total = result.CO2eKg
				}
				d.reviewOpen.Set(false)
				d.failed.Set(false)
				d.message.Set(locales.SupplierDisclosuresDetailIngestSuccess(cx,
					formatCO2e(total)))
				d.load(cx, s)
				_ = dataRefresh(s, dataRev)
			})
		}()
	}

	tierOptions := []ui.Option[string]{
		{Value: "", Label: locales.SupplierDisclosuresReviewTierAuto(cx)},
		{Value: "1", Label: locales.SupplierDisclosuresReviewTierOne(cx)},
		{Value: "2", Label: locales.SupplierDisclosuresReviewTierTwo(cx)},
		{Value: "3", Label: locales.SupplierDisclosuresReviewTierThree(cx)},
	}
	body := []core.Node{
		core.Text{Content: locales.SupplierDisclosuresReviewHint(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.Dynamic(func(cx *core.Scope) core.Node {
			_ = d.reviewRev.Get()
			unit := d.reviewTier1Unit
			if unit == "" {
				unit = "kg"
			}
			qtyLabel := locales.SupplierDisclosuresReviewQuantityUnit(cx, unit)
			controls := []core.Node{
				dataField(cx, locales.SupplierDisclosuresReviewTier(cx),
					appSelect[string]{Options: tierOptions, Value: d.tierOverride.Get,
						OnChange: d.tierOverride.Set, Label: locales.SupplierDisclosuresReviewTier(cx),
						TestID: "supplier-disclosures-review-tier"}),
				dataField(cx, qtyLabel,
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
			}
			nodes := []core.Node{
				core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 8,
					AlignItems: core.AlignEnd}, Children: controls},
			}
			if d.reviewInference.MatchedRows > 0 {
				nodes = append(nodes, core.Text{
					Content: locales.SupplierDisclosuresReviewInferredMatched(cx,
						strconv.Itoa(d.reviewInference.MatchedRows),
						strconv.FormatFloat(d.reviewInference.MatchedAmount, 'f', -1, 64),
						d.reviewInference.Unit),
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Accent),
				})
			} else if d.reviewInference.CategoryRows > 0 {
				amountText := strconv.FormatFloat(d.reviewInference.CategoryAmount, 'f', -1, 64)
				nodes = append(nodes, ui.Button{
					Text: locales.SupplierDisclosuresReviewInferredCategory(cx,
						amountText, d.reviewInference.Unit, strconv.Itoa(d.reviewInference.CategoryRows)),
					Variant: ui.ButtonGhost, Size: ui.SizeSmall,
					OnPress: func() { d.tier1Quantity.Set(amountText) },
					TestID:  "supplier-disclosures-review-apply-inferred",
				})
			}
			if d.reviewTier3.Available {
				efOptions := make([]ui.Option[string], 0, len(d.reviewTier3.Candidates))
				for _, cand := range d.reviewTier3.Candidates {
					if !cand.Compatible {
						continue
					}
					name := cand.EF.NameEN
					if strings.HasPrefix(strings.ToLower(cx.Env().Locale()), "zh") && cand.EF.NameZH != "" {
						name = cand.EF.NameZH
					}
					if name == "" {
						name = cand.EF.FactorCode
					}
					label := name + " · " + strconv.FormatFloat(cand.EF.CO2eKgPerUnit, 'f', -1, 64) +
						" kgCO2e/" + cand.EF.InputUnit + " → " + formatCO2e(cand.CO2eKg)
					efOptions = append(efOptions, ui.Option[string]{
						Value: encodeEFKey(cand.EF), Label: label,
					})
				}
				if len(efOptions) > 0 {
					nodes = append(nodes, dataField(cx, locales.SupplierDisclosuresReviewEF(cx),
						appSelect[string]{Options: efOptions, Value: d.tier3EFKey.Get,
							OnChange: d.tier3EFKey.Set,
							Label:    locales.SupplierDisclosuresReviewEF(cx),
							TestID:   "supplier-disclosures-review-tier3-ef",
							Style:    core.Style{Width: core.Pct(100)}}))
				} else {
					nodes = append(nodes, core.Text{
						Content:   locales.SupplierDisclosuresReviewEFNone(cx),
						Style:     core.Style{FontSize: 12},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Warn),
					})
				}
			}
			return core.View{Style: core.Style{Gap: 6}, Children: nodes}
		}),
		core.Dynamic(func(cx *core.Scope) core.Node {
			_ = d.reviewRev.Get()
			tmpl := s.inboundTemplateByKind(d.templateKind.Get())
			nodes := make([]core.Node, 0, len(d.reviewAnswers))
			for index, answer := range d.reviewAnswers {
				answer := answer
				nodes = append(nodes, supplierReviewRow(cx, index, tmpl, answer, d.accepted,
					func(on bool) {
						d.accepted[answer.QuestionID] = on
						d.reviewRev.Set(d.reviewRev.Get() + 1)
					}, strconv.Itoa(d.year.Get())))
			}
			return core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1,
				MinHeight: core.Pt(0), MaxHeight: core.Pt(320)},
				Children: []core.Node{core.View{Style: core.Style{Gap: 4}, Children: nodes}}}
		}),
		core.Text{ContentFunc: func() string {
			_ = d.reviewRev.Get()
			_ = d.tierOverride.Get()
			_ = d.tier1Quantity.Get()
			_ = d.tier3EFKey.Get()
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
// ingest, so the review summary follows the checkboxes, quantity, and Tier 3 EF.
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
	case "3":
		if d.tierThreeReady(byPosition) {
			tier = 3
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
	case 3:
		if !d.tierThreeReady(byPosition) {
			return 0, 0
		}
		cand, ok := d.selectedTier3Candidate()
		if !ok {
			return 0, 0
		}
		return 1, cand.CO2eKg
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

func (d *supplierDetail) tierThreeReady(byPosition map[string]inbound.PreviewAnswer) bool {
	answer, ok := byPosition["tier3.2"]
	if !ok || !d.accepted[answer.QuestionID] || !answer.IsNumeric || answer.Number <= 0 {
		return false
	}
	_, hasEF := d.selectedTier3Candidate()
	return hasEF
}

func supplierReviewRow(cx *core.Scope, index int, tmpl inbound.Template, answer inbound.PreviewAnswer,
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
	if q, ok := tmpl.QuestionByPosition(answer.Position); ok {
		text = supplierQuestionLabel(cx, q, year)
	}
	return core.View{TestID: "supplier-disclosures-review-row-" + strconv.Itoa(index),
		Style: core.Style{Direction: core.Row, Gap: 8, AlignItems: core.AlignCenter,
			Padding: core.Symmetric(6, 6), CornerRadius: radiusItem},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Surface()}
		},
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
			Color: ui.ColorsOf(cx).Danger, OnPress: confirm,
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
			Style: core.Style{FontSize: typeCaption}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
	}
	footer := []core.Node{
		dataCancelButton(cx, d.remindOpen, "supplier-disclosures-remind-cancel"),
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
	switch {
	case errors.Is(err, inbound.ErrQuantityRequired):
		return locales.SupplierDisclosuresReviewQuantityRequired(cx)
	case errors.Is(err, inbound.ErrTier3EFRequired):
		return locales.SupplierDisclosuresReviewEFRequired(cx)
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
