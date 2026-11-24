package app

import (
	"context"
	"image"
	"io"
	"os"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/docview"
	"app.carbonink.desktop/internal/lineage"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// lineageView is one loaded record: either an activity or an answer, plus the
// audit timeline shared by both. The fields stay plain data behind rev.
type lineageView struct {
	activity *lineage.ActivityLineage
	answer   *lineage.AnswerLineage
	history  []store.AuditEvent
}

func (v *lineageView) evidence() []store.EvidenceAttachment {
	switch {
	case v == nil:
		return nil
	case v.activity != nil:
		return v.activity.Evidence
	case v.answer != nil:
		return v.answer.Evidence
	default:
		return nil
	}
}

// lineagePanel is the NSGo counterpart of 1.x's right-side lineage drawer.
// The chain reads top-to-bottom as source → record → pinned EF → downstream.
type lineagePanel struct {
	open    *core.Signal[bool]
	entity  *core.Signal[string]
	id      *core.Signal[string]
	rev     *core.Signal[int]
	view    *core.Signal[*lineageView]
	status  *core.Signal[string]
	busy    *core.Signal[bool]
	preview *core.Signal[string]
	frame   *core.Signal[*image.RGBA]
}

func newLineagePanel(cx *core.Scope) *lineagePanel {
	return &lineagePanel{
		open:    core.NewSignal(cx, false),
		entity:  core.NewSignal(cx, ""),
		id:      core.NewSignal(cx, ""),
		rev:     core.NewSignal(cx, 0),
		view:    core.NewSignal[*lineageView](cx, nil),
		status:  core.NewSignal(cx, ""),
		busy:    core.NewSignal(cx, false),
		preview: core.NewSignal(cx, ""),
		frame:   core.NewSignal[*image.RGBA](cx, nil),
	}
}

func (p *lineagePanel) show(cx *core.Scope, s *Session, entity, id string) {
	if strings.TrimSpace(id) == "" {
		return
	}
	p.entity.Set(entity)
	p.id.Set(id)
	p.status.Set("")
	p.preview.Set("")
	p.frame.Set(nil)
	p.open.Set(true)
	p.load(s)
}

func (p *lineagePanel) load(s *Session) {
	entity := p.entity.Get()
	id := p.id.Get()
	ctx := context.Background()
	next := &lineageView{}
	var err error
	switch entity {
	case "activity_data":
		next.activity, err = lineage.Activity(ctx, s.db, id)
	case "answer":
		next.answer, err = lineage.Answer(ctx, s.db, id)
	default:
		p.view.Set(nil)
		p.status.Set(locales.LineageLoadFailed(s.scope) + ": unknown entity " + entity)
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	if err != nil {
		p.view.Set(nil)
		p.status.Set(locales.LineageLoadFailed(s.scope) + ": " + err.Error())
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	activityID, answerID := "", ""
	if next.activity != nil {
		activityID = next.activity.Activity.ID
	}
	if next.answer != nil {
		answerID = next.answer.Answer.ID
		if next.answer.SourceActivity != nil {
			activityID = next.answer.SourceActivity.Activity.ID
		}
	}
	next.history, err = s.db.AuditEventsForRecord(ctx, activityID, answerID, 200)
	if err != nil {
		p.view.Set(nil)
		p.status.Set(locales.LineageLoadFailed(s.scope) + ": " + err.Error())
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	p.status.Set("")
	p.view.Set(next)
	p.rev.Set(p.rev.Get() + 1)
}

func (p *lineagePanel) drawer(cx *core.Scope, s *Session) core.Node {
	body := []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
		_ = p.rev.Get()
		if p.status.Get() != "" && p.view.Get() == nil {
			return core.Text{Content: p.status.Get(), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		}
		view := p.view.Get()
		if view == nil {
			return core.Text{Content: locales.Loading(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
		}
		sections := []core.Node{
			lineageSection(cx, locales.LineageSectionChain(cx),
				lineageChain(cx, view)),
			p.evidenceSection(cx, s, view),
			lineageSection(cx, locales.LineageSectionHistory(cx),
				lineageHistory(cx, view.history)),
		}
		if p.status.Get() != "" {
			sections = append(sections, core.Text{Content: p.status.Get(),
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
		}
		return core.View{Style: core.Style{Gap: 16}, Children: sections}
	})}
	return sideDrawer(cx, p.open, locales.LineageDrawerTitle(cx), 480, body, nil,
		"lineage-dialog", locales.LineageDrawerClose(cx))
}

func lineageSection(cx *core.Scope, title string, children ...core.Node) core.Node {
	all := []core.Node{core.Text{Content: title,
		Style:     core.Style{FontSize: 11, FontWeight: ui.Semibold},
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}}
	all = append(all, children...)
	return core.View{Style: core.Style{Gap: 8}, Children: all}
}

func lineageBlock(cx *core.Scope, testID, label string, children ...core.Node) core.Node {
	all := []core.Node{core.Text{Content: label, Style: core.Style{FontSize: 11},
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}}
	all = append(all, children...)
	return core.View{TestID: testID, Style: core.Style{Gap: 3}, Children: all}
}

func lineageChain(cx *core.Scope, view *lineageView) core.Node {
	if view.activity != nil {
		return activityChain(cx, view.activity)
	}
	if view.answer != nil {
		return answerChain(cx, view.answer)
	}
	return core.Text{Content: "—"}
}

func activityChain(cx *core.Scope, chain *lineage.ActivityLineage) core.Node {
	blocks := []core.Node{activitySourceBlock(cx, chain.Source)}
	a := chain.Activity
	blocks = append(blocks, lineageBlock(cx, "lineage-node-activity",
		locales.LineageNodeActivity(cx),
		core.Text{Content: chain.EmissionSourceName,
			Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
		core.Text{Content: commaFloat(a.Amount) + " " + a.Unit + " → " +
			commaFloat(a.CO2eKg) + " kg CO2e", Style: core.Style{FontSize: 12}}))
	blocks = append(blocks, lineageEFBlock(cx, chain.PinnedEF))
	blocks = append(blocks, lineageDownstreamBlock(cx, chain))
	return core.View{Style: core.Style{Gap: 14}, Children: blocks}
}

func activitySourceBlock(cx *core.Scope, source lineage.SourceNode) core.Node {
	switch source.Kind {
	case lineage.SourceDocument:
		return lineageBlock(cx, "lineage-source-document",
			locales.LineageSourceDocument(cx),
			core.Text{Content: source.Filename, Style: core.Style{FontSize: typeBody}},
			core.Text{Content: source.ExtractionID, Style: core.Style{FontSize: typeMicro, FontFamily: core.FontMonospace},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	case lineage.SourceInbound:
		details := []core.Node{
			core.Text{Content: firstNonEmpty(source.SupplierName, source.QuestionnaireID),
				Style: core.Style{FontSize: 13}},
		}
		if source.Tier > 0 {
			details = append(details, core.Text{
				Content: locales.LineageSourceTier(cx, strconv.Itoa(source.Tier)),
				Style:   core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		}
		return lineageBlock(cx, "lineage-source-inbound",
			locales.LineageSourceInbound(cx), details...)
	default:
		return lineageBlock(cx, "lineage-source-manual",
			locales.LineageSourceManual(cx),
			core.Text{Content: locales.LineageSourceManualHint(cx),
				Style:     core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
}

func lineageEFBlock(cx *core.Scope, ef *lineage.PinnedEF) core.Node {
	if ef == nil {
		return lineageBlock(cx, "lineage-pinned-ef", locales.LineageNodeEf(cx),
			core.Text{Content: "—", Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	date := ef.PinnedAt
	if len(date) > 10 {
		date = date[:10]
	}
	return lineageBlock(cx, "lineage-pinned-ef", locales.LineageNodeEf(cx),
		core.Text{Content: ef.FactorCode,
			Style: core.Style{FontSize: typeCaption, FontFamily: core.FontMonospace}},
		core.Text{Content: ef.Source + " · " + strconv.Itoa(ef.Year) + " · " + ef.Geography +
			" · " + ef.DatasetVersion, Style: core.Style{FontSize: typeMicro},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.Text{Content: strconv.FormatFloat(ef.CO2eKgPerUnit, 'f', 6, 64) +
			" kg/" + ef.InputUnit, Style: core.Style{FontSize: typeMicro, FontVariant: core.FontTabularNums}},
		core.Text{Content: locales.LineageEfPinnedAt(cx, date),
			Style:     core.Style{FontSize: typeMicro},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
}

func lineageDownstreamBlock(cx *core.Scope, chain *lineage.ActivityLineage) core.Node {
	if len(chain.Answers) == 0 && len(chain.Snapshots) == 0 {
		return lineageBlock(cx, "lineage-downstream", locales.LineageNodeDownstream(cx),
			core.Text{Content: locales.LineageNoDownstream(cx), Style: core.Style{FontSize: typeCaption},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	children := make([]core.Node, 0, len(chain.Answers)+len(chain.Snapshots)+2)
	if len(chain.Answers) > 0 {
		children = append(children, core.Text{Content: locales.LineageNodeAnswers(cx),
			Style: core.Style{FontSize: typeMicro, FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		for _, answer := range chain.Answers {
			children = append(children, core.View{
				TestID: "lineage-answer-" + answer.AnswerID,
				Children: []core.Node{core.Text{Content: answer.QuestionText,
					Style: core.Style{FontSize: typeCaption}, MaxLines: 2}}})
		}
	}
	if len(chain.Snapshots) > 0 {
		children = append(children, core.Text{Content: locales.LineageNodeSnapshots(cx),
			Style: core.Style{FontSize: typeMicro, FontWeight: ui.Semibold},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		for _, snapshot := range chain.Snapshots {
			date := snapshot.FrozenAt
			if len(date) > 10 {
				date = date[:10]
			}
			children = append(children, core.View{
				TestID: "lineage-snapshot-" + snapshot.SnapshotID,
				Children: []core.Node{core.Text{
					Content:   locales.LineageSnapshotRevision(cx, strconv.Itoa(snapshot.Revision), date),
					Style:     core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}}})
		}
	}
	return lineageBlock(cx, "lineage-downstream", locales.LineageNodeDownstream(cx), children...)
}

func answerChain(cx *core.Scope, chain *lineage.AnswerLineage) core.Node {
	q := chain.Questionnaire
	question := []core.Node{
		core.Text{Content: chain.QuestionText, Style: core.Style{FontSize: 13}, MaxLines: 3},
		core.Text{Content: firstNonEmpty(q.CustomerName, q.ID) + " · " +
			strconv.Itoa(q.ReportingYear), Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
	}
	answer := []core.Node{
		core.Text{Content: chain.Answer.Value + " " + chain.Answer.Unit,
			Style: core.Style{FontSize: 13}},
		core.Text{Content: answerSourceKind(cx, chain.Answer.SourceKind),
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
	}
	blocks := []core.Node{
		lineageBlock(cx, "lineage-node-question", locales.LineageNodeQuestion(cx), question...),
		lineageBlock(cx, "lineage-node-answer", locales.LineageNodeAnswer(cx), answer...),
	}
	if chain.SourceActivity != nil {
		blocks = append(blocks, lineageSection(cx, locales.LineageAnswerUpstream(cx),
			activityChain(cx, chain.SourceActivity)))
	}
	return core.View{Style: core.Style{Gap: 14}, Children: blocks}
}

func answerSourceKind(cx *core.Scope, kind string) string {
	switch kind {
	case "mapped_inventory":
		return locales.LineageAnswerKindMapped(cx)
	case "ai_suggested":
		return locales.LineageAnswerKindAi(cx)
	default:
		return locales.LineageAnswerKindManual(cx)
	}
}

func lineageHistory(cx *core.Scope, events []store.AuditEvent) core.Node {
	if len(events) == 0 {
		return core.Text{Content: locales.LineageHistoryEmpty(cx), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
	}
	rows := make([]core.Node, 0, len(events))
	for _, event := range events {
		when := event.OccurredAt
		if len(when) > 16 {
			when = when[:16]
		}
		rows = append(rows, core.View{TestID: "lineage-audit-row",
			Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
				core.Text{Content: when, Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
				core.Text{Content: dataAuditKind(cx, event.Kind), Style: core.Style{FontSize: 12}},
			}})
	}
	return core.View{Style: core.Style{Gap: 4}, Children: rows}
}

func (p *lineagePanel) evidenceSection(cx *core.Scope, s *Session,
	view *lineageView) core.Node {
	evidence := view.evidence()
	children := []core.Node{}
	if len(evidence) == 0 {
		children = append(children, core.Text{Content: locales.EvidenceEmpty(cx),
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}
	for _, item := range evidence {
		item := item
		meta := strconv.FormatFloat(float64(item.SizeBytes)/1024, 'f', 1, 64) + " KB"
		if len(item.CreatedAt) >= 10 {
			meta += " · " + item.CreatedAt[:10]
		}
		if item.Note != "" {
			meta += " · " + item.Note
		}
		children = append(children, core.View{TestID: "lineage-evidence-row-" + item.ID,
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(6, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style {
				return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
			},
			Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0),
					Gap: 2}, Children: []core.Node{
					core.Text{Content: item.Filename, Style: core.Style{FontSize: 12}, MaxLines: 1},
					core.Text{Content: meta, Style: core.Style{FontSize: 11},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				}},
				ui.Button{Text: locales.DocumentsPreviewButton(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { p.previewEvidence(s, item) },
					TestID:  "lineage-evidence-preview-" + item.ID},
				ui.Button{Text: locales.EvidenceRemoveButton(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { p.removeEvidence(cx, s, item.ID) },
					TestID:  "lineage-evidence-remove-" + item.ID},
			}})
	}
	if p.preview.Get() != "" {
		if frame := p.frame.Get(); frame != nil {
			children = append(children, core.Image{
				TestID:     "lineage-evidence-preview-image",
				Source:     core.ImageSource{Pixels: frame},
				ResizeMode: core.Contain,
				Style:      core.Style{Width: core.Pt(520), Height: core.Pt(280)},
			})
		} else if p.status.Get() != "" {
			children = append(children, core.Text{Content: p.status.Get(),
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		}
	}
	children = append(children, ui.Button{Text: locales.EvidenceAddButton(cx),
		Variant: ui.ButtonSecondary, Busy: p.busy.Get,
		OnPress: func() { p.addEvidence(cx, s) }, TestID: "lineage-evidence-add"})
	return lineageSection(cx, locales.LineageSectionEvidence(cx), children...)
}

func (p *lineagePanel) addEvidence(cx *core.Scope, s *Session) {
	p.busy.Set(true)
	p.status.Set("")
	cx.PickFiles(core.PickFilesOptions{
		Multiple: false,
		Types:    []string{".pdf", ".xlsx", ".png", ".jpg", ".jpeg", ".webp"},
		Title:    locales.EvidenceAddButton(cx),
		Button:   locales.EvidenceAddButton(cx),
	}, func(files []core.File, err error) {
		defer p.busy.Set(false)
		if err != nil {
			p.status.Set(locales.EvidenceAddFailed(cx) + ": " + err.Error())
			p.rev.Set(p.rev.Get() + 1)
			return
		}
		if len(files) == 0 {
			return
		}
		file := files[0]
		if file.Size > store.MaxDocumentBytes {
			p.status.Set(locales.EvidenceAddFailed(cx) + ": " +
				locales.SupplierDisclosuresFileTooLarge(cx))
			p.rev.Set(p.rev.Get() + 1)
			return
		}
		reader, err := file.Open()
		if err != nil {
			p.status.Set(locales.EvidenceAddFailed(cx) + ": " + err.Error())
			p.rev.Set(p.rev.Get() + 1)
			return
		}
		data, readErr := io.ReadAll(io.LimitReader(reader, store.MaxDocumentBytes+1))
		_ = reader.Close()
		if readErr != nil {
			p.status.Set(locales.EvidenceAddFailed(cx) + ": " + readErr.Error())
			p.rev.Set(p.rev.Get() + 1)
			return
		}
		mimeType := uploadedDocumentMIME(file)
		if mimeType == "" {
			p.status.Set(locales.EvidenceAddFailed(cx))
			p.rev.Set(p.rev.Get() + 1)
			return
		}
		target := store.EvidenceTarget{}
		if p.entity.Get() == "answer" {
			target.AnswerID = p.id.Get()
		} else {
			target.ActivityDataID = p.id.Get()
		}
		if _, err := s.db.AddEvidence(context.Background(), target, store.DocumentInput{
			Filename: file.Name, MIMEType: mimeType, Data: data,
		}, s.dataDir, ""); err != nil {
			p.status.Set(locales.EvidenceAddFailed(cx) + ": " + err.Error())
			p.rev.Set(p.rev.Get() + 1)
			return
		}
		p.load(s)
	})
}

func (p *lineagePanel) removeEvidence(cx *core.Scope, s *Session, id string) {
	if err := s.db.RemoveEvidence(context.Background(), id); err != nil {
		p.status.Set(locales.EvidenceRemoveFailed(cx) + ": " + err.Error())
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	p.preview.Set("")
	p.frame.Set(nil)
	p.load(s)
}

func (p *lineagePanel) previewEvidence(s *Session, item store.EvidenceAttachment) {
	if p.preview.Get() == item.ID {
		p.preview.Set("")
		p.frame.Set(nil)
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	p.preview.Set(item.ID)
	p.frame.Set(nil)
	p.status.Set("")
	document, err := s.db.DocumentByID(context.Background(), item.DocumentID)
	if err != nil || document == nil {
		p.status.Set(locales.DocumentsPreviewFailed(s.scope))
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	data, err := os.ReadFile(store.ResolveDocumentPath(document.StoragePath, s.dataDir))
	if err != nil {
		p.status.Set(locales.DocumentsPreviewFailed(s.scope))
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	var frame *image.RGBA
	switch {
	case strings.HasPrefix(document.MIMEType, "image/"):
		frame, err = docview.DecodeImage(data)
	case document.MIMEType == "application/pdf":
		frame, err = docview.RenderPDFPage(data, 0, 120)
	default:
		p.status.Set(locales.EvidencePreviewUnsupported(s.scope))
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	if err != nil {
		p.status.Set(locales.DocumentsPreviewFailed(s.scope))
		p.rev.Set(p.rev.Get() + 1)
		return
	}
	p.frame.Set(frame)
	p.rev.Set(p.rev.Get() + 1)
}
