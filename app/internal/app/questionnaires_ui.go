package app

import (
	"context"
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/answer"
	"app.carbonink.desktop/internal/pdfgen"
	"app.carbonink.desktop/internal/questionnaire"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/i18n"
	"github.com/nsgo-dev/nsgo/ui"
)

// questionnaireFilters mirrors the 1.x outbound list: newest first, customer
// search, and the outbound status vocabulary.
type questionnaireFilters struct {
	search *core.Signal[string]
	status *core.Signal[string]
}

type questionnaireWizard struct {
	open     *core.Signal[bool]
	customer *core.Signal[string]
	year     *core.Signal[string]
	due      *core.Signal[string]
	filename *core.Signal[string]
	status   *core.Signal[string]
	failed   *core.Signal[bool]
	busy     *core.Signal[bool]
	data     []byte
}

// questionnaireDetail is the answer-editing state for one questionnaire. The
// question slice is plain data guarded by rev; the editor keeps one selected
// question so the signal set stays fixed regardless of question count.
type questionnaireDetail struct {
	open     *core.Signal[bool]
	rev      *core.Signal[int]
	customer *core.Signal[string]
	year     *core.Signal[int]
	status   *core.Signal[string]
	due      *core.Signal[string]
	message  *core.Signal[string]
	failed   *core.Signal[bool]
	busy     *core.Signal[bool]

	selectedID        *core.Signal[string]
	selectedAnswerID  *core.Signal[string]
	selectedTitle     *core.Signal[string]
	selectedFinalized *core.Signal[bool]
	selectedAnswered  *core.Signal[bool]
	value             *core.Signal[string]
	unit              *core.Signal[string]
	pdfOpen           *core.Signal[bool]
	pdfLang           *core.Signal[string]
	pdfBusy           *core.Signal[bool]
	pdfStatus         *core.Signal[string]
	pdfFailed         *core.Signal[bool]
	lineage           *lineagePanel

	id        string
	db        *store.Store
	questions []store.Question
	// guide is the answer-review tour, set by the screen that hosts the dialog.
	guide *guidance
}

func (s *Session) questionnairesScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	filters := &questionnaireFilters{
		search: core.NewSignal(cx, ""),
		status: core.NewSignal(cx, ""),
	}
	screenStatus := core.NewSignal(cx, "")
	screenFailed := core.NewSignal(cx, false)
	wizard := newQuestionnaireWizard(cx, s)
	detail := newQuestionnaireDetail(cx, s.db)
	listGuide := newGuidance(cx, s, "questionnaires")
	detail.guide = newGuidance(cx, s, "answer-review")

	rows := func() []store.Questionnaire {
		_ = dataRev.Get()
		query := strings.ToLower(strings.TrimSpace(filters.search.Get()))
		status := filters.status.Get()
		out := make([]store.Questionnaire, 0, len(s.questionnaires))
		for _, q := range s.questionnaires {
			if q.Direction != "outbound" {
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
		{Value: "", Label: locales.QuestionnairesFilterStatusAll(cx)},
		{Value: store.QuestionnaireParsing, Label: locales.QuestionnairesStatusParsing(cx)},
		{Value: store.QuestionnaireMapping, Label: locales.QuestionnairesStatusMapping(cx)},
		{Value: store.QuestionnaireAnswering, Label: locales.QuestionnairesStatusAnswering(cx)},
		{Value: store.QuestionnaireFinalized, Label: locales.QuestionnairesStatusFinalized(cx)},
		{Value: store.QuestionnaireExported, Label: locales.QuestionnairesStatusExported(cx)},
	}

	list := core.Dynamic(func(cx *core.Scope) core.Node {
		_ = dataRev.Get()
		_ = filters.search.Get()
		_ = filters.status.Get()
		visible := rows()
		if len(visible) == 0 {
			return core.View{Style: core.Style{FlexGrow: 1, AlignItems: core.AlignCenter,
				JustifyContent: core.JustifyCenter, Padding: core.All(24)},
				Children: []core.Node{
					core.Text{Content: locales.QuestionnairesEmpty(cx),
						Style: core.Style{FontSize: 13}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				}}
		}
		nodes := make([]core.Node, 0, len(visible))
		for _, q := range visible {
			q := q
			nodes = append(nodes, questionnaireListRow(cx, q, func() { detail.show(cx, q) }))
		}
		return core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
			Children: []core.Node{core.View{Style: core.Style{Gap: 0}, Children: nodes}}}
	})

	return core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
		Padding: core.All(16), Gap: 10}, Children: []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
			Children: []core.Node{
				core.Text{ContentFunc: func() string {
					return locales.QuestionnairesListCount(cx, strconv.Itoa(len(rows())))
				}, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
				core.View{Style: core.Style{FlexGrow: 1}},
				ui.Input{Value: filters.search.Get, Placeholder: locales.QuestionnairesSearchPlaceholder(cx),
					OnChange: func(v string) { filters.search.Set(v) },
					TestID:   "questionnaires-search", Style: core.Style{Width: core.Pt(220)},
					Role: core.RoleSearchField,
					LabelFunc: func() string {
						return locales.QuestionnairesSearchPlaceholder(cx)
					}},
				ui.Select[string]{Options: statusOptions, Value: filters.status.Get,
					OnChange: func(v string) { filters.status.Set(v) },
					Label:    locales.QuestionnairesTableStatus(cx),
					TestID:   "questionnaires-filter-status",
					Style:    core.Style{Width: core.Pt(150)}},
				ui.Button{Text: locales.QuestionnairesNewButton(cx), OnPress: wizard.show,
					TestID: "questionnaires-new"},
			}},
		listGuide.node(s, func() bool { return true }),
		core.Show{When: func() bool { return screenStatus.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return screenStatus.Get() },
					Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style {
						if screenFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		list,
		wizard.dialog(cx, s, dataRev, func(r *questionnaire.CreateResult) {
			screenFailed.Set(false)
			screenStatus.Set(locales.QuestionnairesWizardSuccessWithReused(cx,
				strconv.Itoa(r.QuestionCount), strconv.Itoa(r.ReusedCount)))
		}, func(message string) {
			screenFailed.Set(true)
			screenStatus.Set(message)
		}),
		detail.dialog(cx, s, dataRev),
		detail.pdfDialog(cx, s),
	}}
}

func newQuestionnaireWizard(cx *core.Scope, s *Session) *questionnaireWizard {
	year := time.Now().UTC().Year()
	if len(s.periods) > 0 {
		year = s.periods[0].Year
	}
	return &questionnaireWizard{
		open:     core.NewSignal(cx, false),
		customer: core.NewSignal(cx, ""),
		year:     core.NewSignal(cx, strconv.Itoa(year)),
		due:      core.NewSignal(cx, ""),
		filename: core.NewSignal(cx, ""),
		status:   core.NewSignal(cx, ""),
		failed:   core.NewSignal(cx, false),
		busy:     core.NewSignal(cx, false),
	}
}

func newQuestionnaireDetail(cx *core.Scope, db *store.Store) *questionnaireDetail {
	return &questionnaireDetail{
		open:              core.NewSignal(cx, false),
		rev:               core.NewSignal(cx, 0),
		customer:          core.NewSignal(cx, ""),
		year:              core.NewSignal(cx, 0),
		status:            core.NewSignal(cx, ""),
		due:               core.NewSignal(cx, ""),
		message:           core.NewSignal(cx, ""),
		failed:            core.NewSignal(cx, false),
		busy:              core.NewSignal(cx, false),
		selectedID:        core.NewSignal(cx, ""),
		selectedAnswerID:  core.NewSignal(cx, ""),
		selectedTitle:     core.NewSignal(cx, ""),
		selectedFinalized: core.NewSignal(cx, false),
		selectedAnswered:  core.NewSignal(cx, false),
		value:             core.NewSignal(cx, ""),
		unit:              core.NewSignal(cx, ""),
		pdfOpen:           core.NewSignal(cx, false),
		pdfLang:           core.NewSignal(cx, "en"),
		pdfBusy:           core.NewSignal(cx, false),
		pdfStatus:         core.NewSignal(cx, ""),
		pdfFailed:         core.NewSignal(cx, false),
		lineage:           newLineagePanel(cx),
		db:                db,
	}
}

func questionnaireListRow(cx *core.Scope, q store.Questionnaire, onPress func()) core.Node {
	return core.View{TestID: "questionnaires-row-" + q.ID, Role: core.RoleButton,
		OnPress: func(core.PressEvent) { onPress() },
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12,
			Padding: core.Symmetric(10, 8), CornerRadius: 6, Borders: core.Edges{Bottom: 1}},
		StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
		Children: []core.Node{
			core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.Text{Content: q.CustomerName, Style: core.Style{FontSize: 13,
						FontWeight: ui.Semibold, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
					core.Text{Content: strconv.Itoa(q.ReportingYear) + " · " +
						locales.QuestionnairesQuestionCount(cx, strconv.Itoa(q.QuestionCount)),
						Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
						MaxLines: 1},
				}},
			ui.Badge{Text: questionnaireStatusLabel(cx, q.Status),
				Variant: questionnaireStatusVariant(q.Status)},
			core.Text{Content: q.DueDate, Style: core.Style{FontSize: 11},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint), MaxLines: 1},
		}}
}

func questionnaireStatusLabel(cx *core.Scope, status string) string {
	switch status {
	case store.QuestionnaireParsing:
		return locales.QuestionnairesStatusParsing(cx)
	case store.QuestionnaireAnswering:
		return locales.QuestionnairesStatusAnswering(cx)
	case store.QuestionnaireFinalized:
		return locales.QuestionnairesStatusFinalized(cx)
	case store.QuestionnaireExported:
		return locales.QuestionnairesStatusExported(cx)
	default:
		return locales.QuestionnairesStatusMapping(cx)
	}
}

func questionnaireStatusVariant(status string) ui.BadgeVariant {
	switch status {
	case store.QuestionnaireFinalized, store.QuestionnaireExported:
		return ui.BadgeAccent
	case store.QuestionnaireAnswering:
		return ui.BadgeInfo
	default:
		return ui.BadgeNeutral
	}
}

func (w *questionnaireWizard) show() {
	w.status.Set("")
	w.failed.Set(false)
	w.busy.Set(false)
	w.filename.Set("")
	w.data = nil
	w.open.Set(true)
}

func (w *questionnaireWizard) dialog(cx *core.Scope, s *Session, dataRev *core.Signal[int],
	onDone func(*questionnaire.CreateResult), onFailed func(string)) core.Node {
	pick := func() {
		cx.PickFiles(core.PickFilesOptions{
			Multiple: false,
			Types:    []string{".xlsx"},
			Title:    locales.QuestionnairesNewButton(cx),
			Button:   locales.QuestionnairesWizardFileChoose(cx),
		}, func(files []core.File, err error) {
			if err != nil {
				w.failed.Set(true)
				w.status.Set(err.Error())
				return
			}
			if len(files) == 0 {
				return
			}
			file := files[0]
			if file.Size > questionnaire.MaxWorkbookBytes {
				w.failed.Set(true)
				w.status.Set(locales.QuestionnairesWizardFailed(cx))
				return
			}
			reader, err := file.Open()
			if err != nil {
				w.failed.Set(true)
				w.status.Set(err.Error())
				return
			}
			data, err := io.ReadAll(io.LimitReader(reader, questionnaire.MaxWorkbookBytes+1))
			_ = reader.Close()
			if err != nil {
				w.failed.Set(true)
				w.status.Set(err.Error())
				return
			}
			w.data = data
			w.filename.Set(file.Name)
			w.failed.Set(false)
			w.status.Set("")
		})
	}

	submit := func() {
		name := strings.TrimSpace(w.customer.Get())
		year, err := strconv.Atoi(strings.TrimSpace(w.year.Get()))
		if name == "" || len(w.data) == 0 || err != nil {
			w.failed.Set(true)
			w.status.Set(locales.QuestionnairesWizardHintRequired(cx))
			return
		}
		provider := s.llmProvider(cx)
		if !provider.Configured() {
			w.failed.Set(true)
			w.status.Set(locales.QuestionnairesWizardFailed(cx) + ": " +
				questionnaire.ErrNotConfigured.Error())
			return
		}
		data := w.data
		filename := w.filename.Get()
		due := strings.TrimSpace(w.due.Get())
		w.busy.Set(true)
		w.failed.Set(false)
		w.status.Set(locales.QuestionnairesWizardParsing(cx))
		go func() {
			service := &questionnaire.Service{Store: s.db, DataDir: s.dataDir,
				Provider: provider, NewClient: newExtractor}
			result, err := service.Create(context.Background(), questionnaire.CreateRequest{
				CustomerName: name, ReportingYear: year, DueDate: due,
				Filename: filename, Data: data,
			})
			s.scope.Post(func() {
				w.busy.Set(false)
				if err != nil {
					s.log.Warn("questionnaire import failed", "customer", name, "err", err)
					w.failed.Set(true)
					w.status.Set(locales.QuestionnairesWizardFailed(cx) + ": " + err.Error())
					return
				}
				if err := dataRefresh(s, dataRev); err != nil {
					w.failed.Set(true)
					w.status.Set(err.Error())
					return
				}
				w.open.Set(false)
				w.customer.Set("")
				w.due.Set("")
				w.data = nil
				w.filename.Set("")
				onDone(result)
			})
		}()
	}

	footer := []core.Node{
		dataCancelButton(cx, w.open, "questionnaires-wizard-cancel"),
		ui.Button{Text: locales.QuestionnairesWizardUpload(cx), OnPress: submit,
			Busy: w.busy.Get, TestID: "questionnaires-wizard-submit"},
	}
	body := []core.Node{
		dataField(cx, locales.QuestionnairesWizardCustomer(cx),
			ui.Input{Value: w.customer.Get, Placeholder: locales.QuestionnairesWizardCustomer(cx),
				OnChange: w.customer.Set, TestID: "questionnaires-wizard-customer"}),
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignEnd, Gap: 8},
			Children: []core.Node{
				dataField(cx, locales.QuestionnairesWizardYear(cx),
					ui.Input{Value: w.year.Get, OnChange: w.year.Set,
						TestID: "questionnaires-wizard-year"}),
				dataField(cx, locales.QuestionnairesWizardDue(cx),
					ui.Input{Value: w.due.Get, OnChange: w.due.Set,
						TestID: "questionnaires-wizard-due"}),
			}},
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
			Children: []core.Node{
				ui.Button{Text: locales.QuestionnairesWizardFileChoose(cx), Variant: ui.ButtonSecondary,
					OnPress: pick, TestID: "questionnaires-wizard-file"},
				core.Text{ContentFunc: func() string {
					if w.filename.Get() == "" {
						return ""
					}
					return locales.QuestionnairesWizardFileChosen(cx, w.filename.Get())
				}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
					MaxLines: 1},
			}},
		core.Show{When: func() bool { return w.status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return w.status.Get() },
					Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style {
						if w.failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	}
	return dataDialogSized(cx, w.open, locales.QuestionnairesWizardTitle(cx), body, footer,
		"questionnaires-wizard-dialog", 600)
}

// show loads one questionnaire and opens the detail dialog.
func (d *questionnaireDetail) show(cx *core.Scope, q store.Questionnaire) {
	d.id = q.ID
	d.customer.Set(q.CustomerName)
	d.year.Set(q.ReportingYear)
	d.status.Set(q.Status)
	d.due.Set(q.DueDate)
	d.message.Set("")
	d.failed.Set(false)
	d.selectedID.Set("")
	d.selectedAnswerID.Set("")
	d.selectedTitle.Set("")
	d.value.Set("")
	d.unit.Set("")
	d.selectedFinalized.Set(false)
	if err := d.load(); err != nil {
		d.failed.Set(true)
		d.message.Set(err.Error())
	}
	d.open.Set(true)
}

func (d *questionnaireDetail) load() error {
	questions, err := d.db.ListQuestions(context.Background(), d.id)
	if err != nil {
		return err
	}
	d.questions = questions
	d.rev.Set(d.rev.Get() + 1)
	return nil
}

func (d *questionnaireDetail) selectQuestion(index int) {
	if index < 0 || index >= len(d.questions) {
		return
	}
	q := d.questions[index]
	d.selectedID.Set(q.ID)
	d.selectedAnswerID.Set(q.AnswerID)
	d.selectedTitle.Set(q.RawText)
	d.value.Set(q.AnswerValue)
	d.unit.Set(firstNonEmpty(q.AnswerUnit, q.ExpectedUnit))
	d.selectedFinalized.Set(q.AnswerFinalizedAt != "")
	d.selectedAnswered.Set(q.Answered())
	d.message.Set("")
	d.failed.Set(false)
}

// syncSelected folds a reloaded question row back into the editor.
func (d *questionnaireDetail) syncSelected() {
	id := d.selectedID.Get()
	if id == "" {
		return
	}
	for _, q := range d.questions {
		if q.ID != id {
			continue
		}
		d.value.Set(q.AnswerValue)
		d.unit.Set(firstNonEmpty(q.AnswerUnit, q.ExpectedUnit))
		d.selectedAnswerID.Set(q.AnswerID)
		d.selectedFinalized.Set(q.AnswerFinalizedAt != "")
		d.selectedAnswered.Set(q.Answered())
		return
	}
}

func (s *Session) answerService(cx *core.Scope) *answer.Service {
	return &answer.Service{Store: s.db, Provider: s.llmProvider(cx),
		NewClient: newExtractor, NewRunner: newAgentRunner}
}

// answerErrorText localizes the generation errors the user can act on.
func answerErrorText(cx *core.Scope, err error) string {
	var noData *answer.NoDataError
	switch {
	case errors.Is(err, answer.ErrInventoryEmpty):
		return locales.AnswerInventoryEmpty(cx)
	case errors.As(err, &noData):
		if noData.Reason != "" {
			return locales.AnswerGenerateErrorLabel(cx) + ": " + noData.Reason
		}
		return locales.AnswerGenerateNoData(cx)
	case errors.Is(err, answer.ErrInbound):
		return locales.AnswerGenerateErrorLabel(cx)
	default:
		return locales.AnswerGenerateErrorLabel(cx) + ": " + err.Error()
	}
}

func (d *questionnaireDetail) generate(s *Session, cx *core.Scope,
	dataRev *core.Signal[int]) {
	id := d.selectedID.Get()
	if id == "" {
		return
	}
	generating := locales.AnswerGenerating(cx)
	d.busy.Set(true)
	d.failed.Set(false)
	d.message.Set(generating)
	go func() {
		answerRow, err := s.answerService(cx).Generate(context.Background(), id)
		s.scope.Post(func() {
			d.busy.Set(false)
			if err != nil {
				d.failed.Set(true)
				d.message.Set(answerErrorText(cx, err))
				return
			}
			d.message.Set(locales.QuestionnairesAnswerSaved(cx))
			d.selectedFinalized.Set(answerRow.FinalizedAt != "")
			d.selectedAnswered.Set(true)
			_ = d.load()
			d.syncSelected()
			_ = dataRefresh(s, dataRev)
		})
	}()
}

func (d *questionnaireDetail) generateAll(s *Session, cx *core.Scope,
	dataRev *core.Signal[int]) {
	if d.id == "" {
		return
	}
	running := locales.AnswerGenerateAllRunning(cx)
	d.busy.Set(true)
	d.failed.Set(false)
	d.message.Set(running)
	go func() {
		results, err := s.answerService(cx).GenerateAll(context.Background(), d.id)
		ok, failed := 0, 0
		for _, result := range results {
			if result.Err == nil {
				ok++
			} else {
				failed++
			}
		}
		s.scope.Post(func() {
			d.busy.Set(false)
			if err != nil {
				d.failed.Set(true)
				d.message.Set(answerErrorText(cx, err))
				return
			}
			if len(results) == 0 {
				d.message.Set(locales.AnswerGenerateAllEmpty(cx))
				return
			}
			d.failed.Set(failed > 0)
			d.message.Set(locales.AnswerGenerateAllDone(cx, strconv.Itoa(ok), strconv.Itoa(failed)))
			_ = d.load()
			d.syncSelected()
			_ = dataRefresh(s, dataRev)
		})
	}()
}

func (d *questionnaireDetail) save(s *Session, cx *core.Scope, dataRev *core.Signal[int],
	finalize bool) {
	id := d.selectedID.Get()
	if id == "" {
		return
	}
	before, _ := s.db.AnswerByQuestion(context.Background(), id)
	d.busy.Set(true)
	answer, err := s.db.SaveAnswer(context.Background(), store.SaveAnswerInput{
		QuestionID: id, Value: d.value.Get(), Unit: strings.TrimSpace(d.unit.Get()),
		Finalize: finalize,
	})
	d.busy.Set(false)
	if err != nil {
		d.failed.Set(true)
		d.message.Set(locales.QuestionnairesAnswerSaveFailed(cx) + ": " + err.Error())
		return
	}
	kind := "answer.save"
	if finalize {
		kind = "answer.finalize"
	}
	s.recordAnswerSave(d, kind, before, answer)
	d.failed.Set(false)
	d.message.Set(locales.QuestionnairesAnswerSaved(cx))
	d.selectedFinalized.Set(answer.FinalizedAt != "")
	if err := d.load(); err != nil {
		d.failed.Set(true)
		d.message.Set(err.Error())
	}
	d.syncSelected()
	if err := dataRefresh(s, dataRev); err != nil {
		d.failed.Set(true)
		d.message.Set(err.Error())
	}
}

func (d *questionnaireDetail) unfinalize(s *Session, cx *core.Scope) {
	id := d.selectedID.Get()
	if id == "" {
		return
	}
	before, _ := s.db.AnswerByQuestion(context.Background(), id)
	d.busy.Set(true)
	answer, err := s.db.UnfinalizeAnswer(context.Background(), id)
	d.busy.Set(false)
	if err != nil {
		d.failed.Set(true)
		d.message.Set(err.Error())
		return
	}
	s.recordAnswerSave(d, "answer.unfinalize", before, answer)
	d.failed.Set(false)
	d.message.Set(locales.QuestionnairesAnswerSaved(cx))
	d.selectedFinalized.Set(answer.FinalizedAt != "")
	_ = d.load()
	d.syncSelected()
}

func (d *questionnaireDetail) finalizeAll(s *Session, cx *core.Scope,
	dataRev *core.Signal[int]) {
	if d.id == "" {
		return
	}
	beforeAnswers, _ := s.db.ListAnswers(context.Background(), d.id)
	beforeStatus := ""
	if q, err := s.db.QuestionnaireByID(context.Background(), d.id); err == nil && q != nil {
		beforeStatus = q.Status
	}
	d.busy.Set(true)
	err := s.db.FinalizeQuestionnaire(context.Background(), d.id)
	d.busy.Set(false)
	if err != nil {
		d.failed.Set(true)
		d.message.Set(err.Error())
		return
	}
	s.recordFinalizeAll(d, beforeAnswers, beforeStatus)
	d.failed.Set(false)
	d.message.Set(locales.QuestionnairesAnswerSaved(cx))
	if q, err := s.db.QuestionnaireByID(context.Background(), d.id); err == nil && q != nil {
		d.status.Set(q.Status)
	}
	_ = d.load()
	d.syncSelected()
	_ = dataRefresh(s, dataRev)
}

// exportXLSX writes every positioned answer back into the original workbook
// and marks the questionnaire exported once the save succeeds.
func (d *questionnaireDetail) exportXLSX(s *Session, cx *core.Scope,
	dataRev *core.Signal[int]) {
	if d.id == "" {
		return
	}
	ctx := context.Background()
	q, err := s.db.QuestionnaireByID(ctx, d.id)
	if err != nil || q == nil {
		d.failed.Set(true)
		d.message.Set(locales.AnswerExportFailed(cx))
		return
	}
	document, err := s.db.DocumentByID(ctx, q.DocumentID)
	if err != nil || document == nil {
		d.failed.Set(true)
		d.message.Set(locales.AnswerExportFailed(cx))
		return
	}
	original, err := os.ReadFile(store.ResolveDocumentPath(document.StoragePath, s.dataDir))
	if err != nil {
		d.failed.Set(true)
		d.message.Set(locales.AnswerExportFailed(cx) + ": " + err.Error())
		return
	}
	questions, err := s.db.ListQuestions(ctx, d.id)
	if err != nil {
		d.failed.Set(true)
		d.message.Set(locales.AnswerExportFailed(cx))
		return
	}
	position := make(map[string]string, len(questions))
	for _, question := range questions {
		if question.Position != "" {
			position[question.ID] = question.Position
		}
	}
	answers, err := s.db.ListAnswers(ctx, d.id)
	if err != nil {
		d.failed.Set(true)
		d.message.Set(locales.AnswerExportFailed(cx))
		return
	}
	cells := make([]questionnaire.AnswerCell, 0, len(answers))
	for _, answer := range answers {
		ref := position[answer.QuestionID]
		if ref == "" {
			continue
		}
		cells = append(cells, questionnaire.AnswerCell{Ref: ref, Value: answer.Value,
			Draft: answer.FinalizedAt == ""})
	}
	out, written, drafts, err := questionnaire.WriteAnswers(original, cells)
	if err != nil {
		d.failed.Set(true)
		d.message.Set(locales.AnswerExportFailed(cx) + ": " + err.Error())
		return
	}
	base := document.Filename
	if strings.HasSuffix(strings.ToLower(base), ".xlsx") {
		base = base[:len(base)-len(".xlsx")]
	}
	name := base + "_filled.xlsx"
	d.message.Set(locales.AnswerExportRunning(cx))
	cx.SaveFile(core.SaveOptions{Name: name, MIME: questionnaire.WorkbookMIME, Data: out},
		func(saved bool, _ string, err error) {
			if err != nil {
				d.failed.Set(true)
				d.message.Set(locales.AnswerExportFailed(cx) + ": " + err.Error())
				return
			}
			if !saved {
				d.message.Set("")
				return
			}
			if err := s.db.MarkQuestionnaireExported(context.Background(), d.id); err != nil {
				d.failed.Set(true)
				d.message.Set(locales.AnswerExportFailed(cx) + ": " + err.Error())
				return
			}
			d.failed.Set(false)
			d.status.Set(store.QuestionnaireExported)
			d.message.Set(locales.AnswerExportDone(cx, strconv.Itoa(written), strconv.Itoa(drafts)))
			_ = dataRefresh(s, dataRev)
		})
}

func (d *questionnaireDetail) openPDFDialog(cx *core.Scope) {
	d.pdfLang.Set("en")
	if strings.HasPrefix(strings.ToLower(i18n.Language(cx)), "zh") {
		d.pdfLang.Set("zh-CN")
	}
	d.pdfStatus.Set("")
	d.pdfFailed.Set(false)
	d.pdfBusy.Set(false)
	d.pdfOpen.Set(true)
}

// exportPDF assembles and draws the questionnaire, then hands the bytes to the
// save dialog on the UI thread.
func (d *questionnaireDetail) exportPDF(s *Session, cx *core.Scope) {
	if d.id == "" {
		return
	}
	id := d.id
	lang := d.pdfLang.Get()
	labels := pdfLabelsFor(lang)
	d.pdfBusy.Set(true)
	d.pdfFailed.Set(false)
	d.pdfStatus.Set(locales.QuestionnaireExportPdfPending(cx))
	go func() {
		out, name, err := s.renderQuestionnairePDF(context.Background(), id, lang, labels)
		s.scope.Post(func() {
			d.pdfBusy.Set(false)
			if err != nil {
				d.pdfFailed.Set(true)
				d.pdfStatus.Set(locales.QuestionnaireExportPdfFailed(cx, err.Error()))
				return
			}
			cx.SaveFile(core.SaveOptions{Name: name, MIME: "application/pdf", Data: out},
				func(saved bool, path string, err error) {
					if err != nil {
						d.pdfFailed.Set(true)
						d.pdfStatus.Set(locales.QuestionnaireExportPdfFailed(cx, err.Error()))
						return
					}
					if !saved {
						d.pdfStatus.Set("")
						return
					}
					d.pdfFailed.Set(false)
					d.pdfStatus.Set(locales.QuestionnaireExportPdfSuccess(cx, path))
				})
		})
	}()
}

// renderQuestionnairePDF loads one questionnaire and draws it with the
// requested export language's labels.
func (s *Session) renderQuestionnairePDF(ctx context.Context, id string,
	lang string, labels pdfgen.Labels) ([]byte, string, error) {
	q, err := s.db.QuestionnaireByID(ctx, id)
	if err != nil {
		return nil, "", err
	}
	if q == nil {
		return nil, "", errors.New("questionnaire not found")
	}
	questions, err := s.db.ListQuestions(ctx, id)
	if err != nil {
		return nil, "", err
	}
	document, err := s.db.DocumentByID(ctx, q.DocumentID)
	if err != nil {
		return nil, "", err
	}
	documentName := ""
	if document != nil {
		documentName = document.Filename
	}
	data := pdfgen.Questionnaire{CustomerName: q.CustomerName, ReportingYear: q.ReportingYear,
		DocumentName: documentName, DueDate: q.DueDate}
	for _, question := range questions {
		item := pdfgen.Question{ID: question.ID, Position: question.Position,
			RawText: question.RawText, NormalizedText: question.NormalizedText,
			Kind: question.QuestionKind, ExpectedUnit: question.ExpectedUnit}
		if question.Answered() {
			item.Answer = &pdfgen.Answer{Value: question.AnswerValue, Unit: question.AnswerUnit,
				FinalizedAt:   question.AnswerFinalizedAt,
				SourceSummary: question.AnswerSourceSummary}
		}
		data.Questions = append(data.Questions, item)
	}
	out, err := pdfgen.RenderQuestionnaire(data, labels)
	if err != nil {
		return nil, "", err
	}
	return out, pdfSlug(q.CustomerName) + "-questionnaire-" + strconv.Itoa(q.ReportingYear) +
		"-" + lang + ".pdf", nil
}

func pdfLabelsFor(lang string) pdfgen.Labels {
	msgs := locales.In(lang)
	return pdfgen.Labels{
		DueDate:     msgs.QuestionnairePdfCoverDueDate(),
		GeneratedAt: msgs.QuestionnairePdfCoverGeneratedAt(),
		Draft:       msgs.QuestionnairePdfDraft(),
		Finalized:   msgs.QuestionnairePdfFinalized(),
		Source:      msgs.QuestionnairePdfSourceSummary(),
		TOC:         msgs.QuestionnairePdfTocHeading(),
		Unanswered:  msgs.QuestionnairePdfUnanswered(),
		Unspecified: msgs.QuestionnairePdfUnspecified(),
		Kinds: map[string]string{
			"numerical":   msgs.QuestionnairesDetailNumerical(),
			"categorical": msgs.QuestionnairesDetailCategorical(),
			"narrative":   msgs.QuestionnairesDetailNarrative(),
		},
	}
}

func pdfSlug(name string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case !lastDash && b.Len() > 0:
			b.WriteByte('-')
			lastDash = true
		}
		if b.Len() >= 40 {
			break
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		return "questionnaire"
	}
	return slug
}

func (d *questionnaireDetail) pdfDialog(cx *core.Scope, s *Session) core.Node {
	options := []ui.Option[string]{
		{Value: "en", Label: locales.QuestionnaireExportPdfLangEn(cx)},
		{Value: "zh-CN", Label: locales.QuestionnaireExportPdfLangZh(cx)},
	}
	body := []core.Node{
		core.Text{Content: locales.QuestionnaireExportPdfDialogSubheading(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		dataField(cx, locales.QuestionnaireExportPdfLangLabel(cx),
			ui.Select[string]{Options: options, Value: d.pdfLang.Get,
				OnChange: d.pdfLang.Set, Label: locales.QuestionnaireExportPdfLangLabel(cx),
				TestID: "questionnaires-pdf-lang"}),
		core.Show{When: func() bool { return d.pdfStatus.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return d.pdfStatus.Get() },
					Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
						if d.pdfFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	}
	footer := []core.Node{
		ui.Button{Text: locales.QuestionnaireExportPdfCancel(cx), Variant: ui.ButtonSecondary,
			OnPress: func() { d.pdfOpen.Set(false) }, TestID: "questionnaires-pdf-cancel"},
		ui.Button{Text: locales.QuestionnaireExportPdfConfirm(cx),
			OnPress: func() { d.exportPDF(s, cx) }, Busy: d.pdfBusy.Get,
			TestID: "questionnaires-pdf-export"},
	}
	return dataDialog(cx, d.pdfOpen, locales.QuestionnaireExportPdfDialogHeading(cx), body,
		footer, "questionnaires-pdf-dialog")
}

func (d *questionnaireDetail) dialog(cx *core.Scope, s *Session,
	dataRev *core.Signal[int]) core.Node {
	dialog := func(cx *core.Scope) core.Node {
		_ = d.rev.Get()
		answered := 0
		for _, q := range d.questions {
			if q.Answered() {
				answered++
			}
		}
		list := make([]core.Node, 0, len(d.questions))
		for i, q := range d.questions {
			i, q := i, q
			answer := q.AnswerValue
			if strings.TrimSpace(answer) == "" {
				answer = locales.AnswerNotGenerated(cx)
			}
			badge := ui.Badge{Text: locales.AnswerDraft(cx), Variant: ui.BadgeNeutral}
			if q.AnswerFinalizedAt != "" {
				badge = ui.Badge{Text: locales.AnswerFinalized(cx), Variant: ui.BadgeAccent}
			} else if !q.Answered() {
				badge = ui.Badge{Text: locales.QuestionnairesStatusMapping(cx), Variant: ui.BadgeNeutral}
			}
			list = append(list, core.View{TestID: "questionnaires-question-" + strconv.Itoa(i),
				Role:    core.RoleButton,
				OnPress: func(core.PressEvent) { d.selectQuestion(i) },
				Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
					Padding: core.Symmetric(8, 6)},
				StyleFunc: func() core.Style {
					style := core.Style{BorderColor: ui.ColorsOf(cx).Line()}
					if d.selectedID.Get() == q.ID {
						style.Background = ui.Alpha(ui.ColorsOf(cx).Accent(), 0.10)
					}
					return style
				},
				Children: []core.Node{
					core.Text{Content: firstNonEmpty(q.Position, "—"), Style: core.Style{
						FontSize: 11, Width: core.Pt(110)}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint),
						MaxLines: 1},
					core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1,
						MinWidth: core.Pt(0)}, Children: []core.Node{
						core.Text{Content: firstNonEmpty(q.RawText, q.NormalizedText),
							Style: core.Style{FontSize: 12}, MaxLines: 2},
						core.Text{Content: answer, Style: core.Style{FontSize: 11},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
					}},
					core.Text{Content: questionnaireKindLabel(cx, q.QuestionKind),
						Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
						MaxLines: 1},
					badge,
				}})
		}
		if len(list) == 0 {
			list = append(list, core.Text{Content: locales.QuestionnairesEmpty(cx),
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		}

		editor := []core.Node{
			core.Text{ContentFunc: func() string {
				if d.selectedID.Get() == "" {
					return locales.QuestionnairesDetailSelect(cx)
				}
				return d.selectedTitle.Get()
			}, Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}, MaxLines: 3},
		}
		if d.selectedID.Get() != "" {
			editor = append(editor, core.View{Style: core.Style{Direction: core.Row,
				AlignItems: core.AlignEnd, Gap: 8}, Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{
					dataField(cx, locales.AnswerValue(cx),
						ui.Input{Value: d.value.Get, OnChange: d.value.Set, Multiline: true,
							TestID: "questionnaires-answer-value"})}},
				core.View{Style: core.Style{Width: core.Pt(110)}, Children: []core.Node{
					dataField(cx, locales.AnswerUnit(cx),
						ui.Input{Value: d.unit.Get, OnChange: d.unit.Set,
							TestID: "questionnaires-answer-unit"})}},
			}})
			actions := make([]core.Node, 0, 3)
			if !d.selectedAnswered.Get() {
				actions = append(actions, ui.Button{Text: locales.AnswerGenerate(cx),
					OnPress: func() { d.generate(s, cx, dataRev) }, Busy: d.busy.Get,
					TestID: "questionnaires-answer-generate"})
			}
			actions = append(actions, ui.Button{Text: locales.AnswerSave(cx),
				Variant: ui.ButtonSecondary,
				OnPress: func() { d.save(s, cx, dataRev, false) }, Busy: d.busy.Get,
				TestID: "questionnaires-answer-save"})
			if d.selectedFinalized.Get() {
				actions = append(actions, ui.Button{Text: locales.AnswerUnfinalize(cx),
					Variant: ui.ButtonSecondary,
					OnPress: func() { d.unfinalize(s, cx) }, Busy: d.busy.Get,
					TestID: "questionnaires-answer-unfinalize"})
			} else {
				actions = append(actions, ui.Button{Text: locales.AnswerSaveFinalize(cx),
					OnPress: func() { d.save(s, cx, dataRev, true) }, Busy: d.busy.Get,
					TestID: "questionnaires-answer-finalize"})
			}
			if d.selectedAnswered.Get() {
				actions = append(actions, ui.Button{Text: locales.LineageOpenButton(cx),
					Variant: ui.ButtonSecondary,
					OnPress: func() {
						d.lineage.show(cx, s, "answer", d.selectedAnswerID.Get())
					}, TestID: "answer-lineage"})
			}
			editor = append(editor, core.View{Style: core.Style{Direction: core.Row, Gap: 8},
				Children: actions})
		}
		if d.message.Get() != "" {
			editor = append(editor, core.Text{ContentFunc: func() string { return d.message.Get() },
				Style: core.Style{FontSize: 12}, StyleFunc: func() core.Style {
					if d.failed.Get() {
						return ui.Colored(ui.ColorsOf(cx).Danger)()
					}
					return ui.Colored(ui.ColorsOf(cx).Muted)()
				}})
		}

		body := []core.Node{
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
				Children: []core.Node{
					core.Text{ContentFunc: func() string {
						return strconv.Itoa(d.year.Get()) + " · " +
							questionnaireStatusLabel(cx, d.status.Get())
					}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					core.Text{ContentFunc: func() string { return d.due.Get() },
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
					core.View{Style: core.Style{FlexGrow: 1}},
					core.Text{Content: locales.QuestionnairesAnswerProgress(cx,
						strconv.Itoa(answered), strconv.Itoa(len(d.questions))),
						Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				}},
			core.Scroll{Style: core.Style{MaxHeight: core.Pt(360)},
				Children: []core.Node{core.View{Style: core.Style{Gap: 0}, Children: list}}},
			dataCard(cx, editor...),
			d.lineage.dialog(cx, s),
		}
		if d.guide != nil {
			body = append([]core.Node{d.guide.node(s, func() bool { return true })}, body...)
		}
		footer := []core.Node{
			ui.Button{Text: locales.QuestionnairesDetailClose(cx), Variant: ui.ButtonSecondary,
				OnPress: func() { d.open.Set(false) }, TestID: "questionnaires-detail-close"},
			ui.Button{Text: locales.AnswerGenerateAllButton(cx), Variant: ui.ButtonSecondary,
				OnPress: func() { d.generateAll(s, cx, dataRev) }, Busy: d.busy.Get,
				TestID: "questionnaires-generate-all"},
			ui.Button{Text: locales.AnswerExportButton(cx), Variant: ui.ButtonSecondary,
				OnPress: func() { d.exportXLSX(s, cx, dataRev) }, Busy: d.busy.Get,
				TestID: "questionnaires-export-xlsx"},
			ui.Button{Text: locales.QuestionnaireExportPdfButton(cx), Variant: ui.ButtonSecondary,
				OnPress: func() { d.openPDFDialog(cx) }, TestID: "questionnaires-export-pdf"},
			ui.Button{Text: locales.QuestionnairesFinalizeButton(cx),
				OnPress: func() { d.finalizeAll(s, cx, dataRev) }, Busy: d.busy.Get,
				TestID: "questionnaires-finalize-all"},
		}
		return dataDialogSized(cx, d.open, d.customer.Get(), body, footer,
			"questionnaires-detail-dialog", 860)
	}
	return core.Dynamic(dialog)
}

func questionnaireKindLabel(cx *core.Scope, kind string) string {
	switch kind {
	case "numerical":
		return locales.QuestionnairesDetailNumerical(cx)
	case "narrative":
		return locales.QuestionnairesDetailNarrative(cx)
	default:
		return locales.QuestionnairesDetailCategorical(cx)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *Session) outboundQuestionnaires() int {
	count := 0
	for _, q := range s.questionnaires {
		if q.Direction == "outbound" {
			count++
		}
	}
	return count
}
