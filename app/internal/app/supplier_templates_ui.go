package app

import (
	"context"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/inbound"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

func (s *Session) allInboundTemplates() []inbound.Template {
	out := inbound.Templates()
	for _, ct := range s.customTemplates {
		out = append(out, inbound.FromStoreTemplate(ct))
	}
	return out
}

func (s *Session) inboundTemplateByKind(kind string) inbound.Template {
	if strings.TrimSpace(kind) == "" {
		return inbound.Cat1
	}
	for _, t := range s.allInboundTemplates() {
		if t.Kind == kind {
			return t
		}
	}
	return inbound.Cat1
}

type templateQuestionDraft struct {
	tier         *core.Signal[string]
	kind         *core.Signal[string]
	unit         *core.Signal[string]
	rawZH        *core.Signal[string]
	rawEN        *core.Signal[string]
}

type supplierTemplatesEditor struct {
	open     *core.Signal[bool]
	editing  *core.Signal[bool]
	rev      *core.Signal[int]
	editID   string
	labelZH  *core.Signal[string]
	labelEN  *core.Signal[string]
	category *core.Signal[string]
	status   *core.Signal[string]
	failed   *core.Signal[bool]
	busy     *core.Signal[bool]
	questions []*templateQuestionDraft
}

func newSupplierTemplatesEditor(cx *core.Scope) *supplierTemplatesEditor {
	return &supplierTemplatesEditor{
		open:     core.NewSignal(cx, false),
		editing:  core.NewSignal(cx, false),
		rev:      core.NewSignal(cx, 0),
		labelZH:  core.NewSignal(cx, ""),
		labelEN:  core.NewSignal(cx, ""),
		category: core.NewSignal(cx, inbound.TemplateCat1),
		status:   core.NewSignal(cx, ""),
		failed:   core.NewSignal(cx, false),
		busy:     core.NewSignal(cx, false),
	}
}

func (e *supplierTemplatesEditor) show() {
	e.editing.Set(false)
	e.status.Set("")
	e.failed.Set(false)
	e.busy.Set(false)
	e.open.Set(true)
}

func (e *supplierTemplatesEditor) newQuestionDraft(cx *core.Scope, q inbound.Question) *templateQuestionDraft {
	return &templateQuestionDraft{
		tier:  core.NewSignal(cx, strconv.Itoa(q.Tier)),
		kind:  core.NewSignal(cx, firstNonEmpty(q.Kind, "narrative")),
		unit:  core.NewSignal(cx, q.ExpectedUnit),
		rawZH: core.NewSignal(cx, q.RawZH),
		rawEN: core.NewSignal(cx, q.RawEN),
	}
}

func (e *supplierTemplatesEditor) startBlank(cx *core.Scope) {
	e.editID = ""
	e.labelZH.Set("")
	e.labelEN.Set("")
	e.category.Set(inbound.TemplateCat1)
	e.status.Set("")
	e.failed.Set(false)
	e.questions = []*templateQuestionDraft{
		e.newQuestionDraft(cx, inbound.Cat1.Questions[0]),
		e.newQuestionDraft(cx, inbound.Cat1.Questions[3]),
	}
	e.editing.Set(true)
	e.rev.Set(e.rev.Get() + 1)
}

func (e *supplierTemplatesEditor) startFromTemplate(cx *core.Scope, tmpl inbound.Template, duplicate bool) {
	if duplicate {
		e.editID = ""
		e.labelZH.Set(tmpl.LabelZH + "（自定义）")
		e.labelEN.Set(tmpl.LabelEN + " (Custom)")
	} else {
		e.editID = tmpl.ID
		e.labelZH.Set(tmpl.LabelZH)
		e.labelEN.Set(tmpl.LabelEN)
	}
	e.category.Set(categoryPresetForTemplate(tmpl))
	e.status.Set("")
	e.failed.Set(false)
	e.questions = make([]*templateQuestionDraft, 0, len(tmpl.Questions))
	for _, q := range tmpl.Questions {
		e.questions = append(e.questions, e.newQuestionDraft(cx, q))
	}
	e.editing.Set(true)
	e.rev.Set(e.rev.Get() + 1)
}

func categoryPresetForTemplate(tmpl inbound.Template) string {
	switch tmpl.GHGProtocolPath {
	case inbound.Cat4.GHGProtocolPath:
		return inbound.TemplateCat4
	case inbound.Cat5.GHGProtocolPath:
		return inbound.TemplateCat5
	case inbound.Cat6.GHGProtocolPath:
		return inbound.TemplateCat6
	default:
		return inbound.TemplateCat1
	}
}

func (e *supplierTemplatesEditor) dialog(cx *core.Scope, s *Session, dataRev *core.Signal[int]) core.Node {
	return core.Dynamic(func(cx *core.Scope) core.Node {
		if !e.open.Get() {
			return core.View{}
		}
		_ = e.rev.Get()
		_ = dataRev.Get()

		if !e.editing.Get() {
			return e.listDialog(cx, s, dataRev)
		}
		return e.editorDialog(cx, s, dataRev)
	})
}

func (e *supplierTemplatesEditor) listDialog(cx *core.Scope, s *Session, dataRev *core.Signal[int]) core.Node {
	builtInRows := make([]core.Node, 0, len(inbound.Templates()))
	for _, tmpl := range inbound.Templates() {
		tmpl := tmpl
		builtInRows = append(builtInRows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.Symmetric(8, 10), CornerRadius: radiusItem, BorderWidth: 1},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				return core.Style{Background: colors.Surface(), BorderColor: colors.Line()}
			},
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: []core.Node{
						core.Text{Content: supplierTemplateLabel(cx.Env().Locale(), tmpl),
							Style: core.Style{FontSize: typeBody, FontWeight: ui.Medium}, MaxLines: 1},
						core.Text{Content: locales.QuestionnairesQuestionCount(cx, strconv.Itoa(len(tmpl.Questions))),
							Style: core.Style{FontSize: typeCaption}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					}},
				ui.Badge{Text: locales.SupplierTemplatesBuiltInBadge(cx), Variant: ui.BadgeNeutral},
				ui.Button{Text: locales.SupplierTemplatesDuplicate(cx), Variant: ui.ButtonSecondary,
					Size: ui.SizeSmall,
					OnPress: func() { e.startFromTemplate(cx, tmpl, true) },
					TestID:  "supplier-templates-duplicate-" + tmpl.Kind},
			},
		})
	}

	customRows := make([]core.Node, 0, len(s.customTemplates))
	for _, raw := range s.customTemplates {
		tmpl := inbound.FromStoreTemplate(raw)
		id := raw.ID
		customRows = append(customRows, core.View{
			TestID: "supplier-templates-custom-row-" + id,
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(8, 10), CornerRadius: radiusItem, BorderWidth: 1},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				return core.Style{Background: colors.Surface(), BorderColor: colors.Line()}
			},
			Children: []core.Node{
				core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
					Children: []core.Node{
						core.Text{Content: supplierTemplateLabel(cx.Env().Locale(), tmpl),
							Style: core.Style{FontSize: typeBody, FontWeight: ui.Medium}, MaxLines: 1},
						core.Text{Content: locales.QuestionnairesQuestionCount(cx, strconv.Itoa(len(tmpl.Questions))),
							Style: core.Style{FontSize: typeCaption}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
					}},
				ui.Button{Text: locales.SupplierTemplatesEdit(cx), Variant: ui.ButtonSecondary,
					Size: ui.SizeSmall,
					OnPress: func() { e.startFromTemplate(cx, tmpl, false) },
					TestID:  "supplier-templates-edit-" + id},
				ui.Button{Text: locales.SupplierTemplatesDelete(cx), Variant: ui.ButtonOutline,
					Size: ui.SizeSmall, Tint: ui.ColorsOf(cx).Danger,
					OnPress: func() {
						if e.busy.Get() {
							return
						}
						e.busy.Set(true)
						go func() {
							err := s.db.DeleteInboundTemplate(context.Background(), id)
							s.scope.Post(func() {
								e.busy.Set(false)
								if err != nil {
									e.failed.Set(true)
									e.status.Set(err.Error())
									return
								}
								e.failed.Set(false)
								e.status.Set(locales.SupplierTemplateDeleted(cx))
								_ = dataRefresh(s, dataRev)
								e.rev.Set(e.rev.Get() + 1)
							})
						}()
					},
					TestID: "supplier-templates-delete-" + id},
			},
		})
	}
	if len(customRows) == 0 {
		customRows = append(customRows, core.Text{
			Content:   locales.SupplierTemplatesCustomEmpty(cx),
			Style:     core.Style{FontSize: typeCaption},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
		})
	}

	body := []core.Node{
		core.Text{Content: locales.SupplierTemplatesBuiltInHeading(cx),
			Style: core.Style{FontSize: typeCaption, FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.View{Style: core.Style{Gap: 6}, Children: builtInRows},
		core.Text{Content: locales.SupplierTemplatesCustomHeading(cx),
			Style: core.Style{FontSize: typeCaption, FontWeight: ui.Semibold, Padding: core.Edges{Top: 6}},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.Scroll{Style: core.Style{MaxHeight: core.Pt(220)},
			Children: []core.Node{core.View{Style: core.Style{Gap: 6}, Children: customRows}}},
		core.Show{When: func() bool { return e.status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: e.status.Get, Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style {
						if e.failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	}
	footer := []core.Node{
		ui.Button{Text: locales.SupplierTemplatesClose(cx), Variant: ui.ButtonSecondary,
			OnPress: func() { e.open.Set(false) }, TestID: "supplier-templates-close"},
		ui.Button{Text: locales.SupplierTemplatesNew(cx), Icon: lucide.Plus,
			OnPress: func() { e.startBlank(cx) }, TestID: "supplier-templates-new"},
	}
	return dataDialogSized(cx, e.open, locales.SupplierTemplatesTitle(cx), body, footer,
		"supplier-templates-dialog", 720)
}

func (e *supplierTemplatesEditor) editorDialog(cx *core.Scope, s *Session, dataRev *core.Signal[int]) core.Node {
	categoryOptions := make([]ui.Option[string], 0, len(inbound.Templates()))
	for _, tmpl := range inbound.Templates() {
		categoryOptions = append(categoryOptions, ui.Option[string]{
			Value: tmpl.Kind, Label: supplierTemplateLabel(cx.Env().Locale(), tmpl),
		})
	}
	tierOptions := []ui.Option[string]{
		{Value: "0", Label: locales.SupplierTemplateTierMeta(cx)},
		{Value: "1", Label: locales.SupplierTemplateTierOne(cx)},
		{Value: "2", Label: locales.SupplierTemplateTierTwo(cx)},
		{Value: "3", Label: locales.SupplierTemplateTierThree(cx)},
	}
	kindOptions := []ui.Option[string]{
		{Value: "numerical", Label: locales.QuestionnairesDetailNumerical(cx)},
		{Value: "categorical", Label: locales.QuestionnairesDetailCategorical(cx)},
		{Value: "narrative", Label: locales.QuestionnairesDetailNarrative(cx)},
	}

	save := func() {
		if e.busy.Get() {
			return
		}
		preset, ok := inbound.TemplateByKind(e.category.Get())
		if !ok {
			preset = inbound.Cat1
		}
		qs := make([]store.InboundTemplateQuestion, 0, len(e.questions))
		for _, q := range e.questions {
			tier, _ := strconv.Atoi(q.tier.Get())
			qs = append(qs, store.InboundTemplateQuestion{
				Tier:         tier,
				Kind:         q.kind.Get(),
				RawZH:        q.rawZH.Get(),
				RawEN:        q.rawEN.Get(),
				ExpectedUnit: q.unit.Get(),
			})
		}
		in := store.InboundTemplateInput{
			ID:              e.editID,
			LabelZH:         e.labelZH.Get(),
			LabelEN:         e.labelEN.Get(),
			Category:        preset.Category,
			GHGProtocolPath: preset.GHGProtocolPath,
			EFCategory:      preset.EFCategory,
			Tier1Unit:       preset.Tier1Unit,
			DefaultUnit:     preset.DefaultUnit,
			Questions:       qs,
		}
		e.busy.Set(true)
		e.failed.Set(false)
		e.status.Set("")
		go func() {
			_, err := s.db.SaveInboundTemplate(context.Background(), in)
			s.scope.Post(func() {
				e.busy.Set(false)
				if err != nil {
					e.failed.Set(true)
					e.status.Set(err.Error())
					return
				}
				_ = dataRefresh(s, dataRev)
				e.failed.Set(false)
				e.status.Set(locales.SupplierTemplateSaved(cx))
				e.editing.Set(false)
				e.rev.Set(e.rev.Get() + 1)
			})
		}()
	}

	qNodes := make([]core.Node, 0, len(e.questions))
	for i, q := range e.questions {
		i, q := i, q
		qNodes = append(qNodes, core.View{
			TestID: "supplier-template-question-" + strconv.Itoa(i),
			Style: core.Style{Gap: 6, Padding: core.All(10), CornerRadius: radiusItem, BorderWidth: 1},
			StyleFunc: func() core.Style {
				colors := ui.ColorsOf(cx)
				return core.Style{Background: colors.Inset(), BorderColor: colors.Line()}
			},
			Children: []core.Node{
				core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 8,
					AlignItems: core.AlignEnd}, Children: []core.Node{
					dataField(cx, locales.SupplierTemplateQuestionTier(cx),
						appSelect[string]{Options: tierOptions, Value: q.tier.Get,
							OnChange: q.tier.Set, Label: locales.SupplierTemplateQuestionTier(cx),
							TestID: "supplier-template-q-tier-" + strconv.Itoa(i)}),
					dataField(cx, locales.SupplierTemplateQuestionKind(cx),
						appSelect[string]{Options: kindOptions, Value: q.kind.Get,
							OnChange: q.kind.Set, Label: locales.SupplierTemplateQuestionKind(cx),
							TestID: "supplier-template-q-kind-" + strconv.Itoa(i)}),
					dataField(cx, locales.SupplierTemplateQuestionUnit(cx),
						ui.Input{Value: q.unit.Get, Placeholder: "kg",
							OnChange: q.unit.Set,
							TestID:   "supplier-template-q-unit-" + strconv.Itoa(i)}),
					ui.Button{Text: locales.SupplierTemplateQuestionRemove(cx),
						Variant: ui.ButtonGhost, Size: ui.SizeSmall,
						Disabled: func() bool { return len(e.questions) <= 1 },
						OnPress: func() {
							if len(e.questions) <= 1 {
								return
							}
							e.questions = append(e.questions[:i], e.questions[i+1:]...)
							e.rev.Set(e.rev.Get() + 1)
						},
						TestID: "supplier-template-q-remove-" + strconv.Itoa(i)},
				}},
				dataColumns(cx, 8,
					dataField(cx, locales.SupplierTemplateQuestionZH(cx),
						ui.Input{Value: q.rawZH.Get, OnChange: q.rawZH.Set,
							TestID: "supplier-template-q-zh-" + strconv.Itoa(i)}),
					dataField(cx, locales.SupplierTemplateQuestionEN(cx),
						ui.Input{Value: q.rawEN.Get, OnChange: q.rawEN.Set,
							TestID: "supplier-template-q-en-" + strconv.Itoa(i)})),
			},
		})
	}

	title := locales.SupplierTemplateEditorNewTitle(cx)
	if e.editID != "" {
		title = locales.SupplierTemplateEditorEditTitle(cx)
	}
	body := []core.Node{
		dataColumns(cx, 8,
			dataField(cx, locales.SupplierTemplateLabelZH(cx),
				ui.Input{Value: e.labelZH.Get, OnChange: e.labelZH.Set,
					TestID: "supplier-template-label-zh"}),
			dataField(cx, locales.SupplierTemplateLabelEN(cx),
				ui.Input{Value: e.labelEN.Get, OnChange: e.labelEN.Set,
					TestID: "supplier-template-label-en"})),
		dataField(cx, locales.SupplierTemplateCategory(cx),
			appSelect[string]{Options: categoryOptions, Value: e.category.Get,
				OnChange: e.category.Set, Label: locales.SupplierTemplateCategory(cx),
				TestID: "supplier-template-category", Style: core.Style{Width: core.Pct(100)}}),
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			JustifyContent: core.JustifySpaceBetween}, Children: []core.Node{
			core.Text{Content: locales.SupplierTemplateQuestions(cx),
				Style: core.Style{FontSize: typeCaption, FontWeight: ui.Semibold}},
			ui.Button{Text: locales.SupplierTemplateQuestionAdd(cx), Icon: lucide.Plus,
				Variant: ui.ButtonSecondary, Size: ui.SizeSmall,
				OnPress: func() {
					e.questions = append(e.questions, e.newQuestionDraft(cx, inbound.Question{
						Tier: 0, Kind: "narrative",
					}))
					e.rev.Set(e.rev.Get() + 1)
				}, TestID: "supplier-template-q-add"},
		}},
		core.Scroll{Style: core.Style{MaxHeight: core.Pt(300)},
			Children: []core.Node{core.View{Style: core.Style{Gap: 8}, Children: qNodes}}},
		core.Show{When: func() bool { return e.status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: e.status.Get, Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style {
						if e.failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	}
	footer := []core.Node{
		ui.Button{Text: locales.SupplierTemplateBack(cx), Variant: ui.ButtonSecondary,
			OnPress: func() {
				e.status.Set("")
				e.editing.Set(false)
			}, TestID: "supplier-template-cancel"},
		ui.Button{Text: locales.SupplierTemplateSave(cx),
			OnPress: save, Busy: e.busy.Get, TestID: "supplier-template-save"},
	}
	return dataDialogSized(cx, e.open, title, body, footer, "supplier-templates-dialog", 760)
}
