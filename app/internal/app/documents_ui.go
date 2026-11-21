package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/docview"
	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

type documentPreview struct {
	open   *core.Signal[bool]
	doc    *core.Signal[store.Document]
	page   *core.Signal[int]
	total  *core.Signal[int]
	frame  *core.Signal[*image.RGBA]
	status *core.Signal[string]
	failed *core.Signal[bool]
	busy   *core.Signal[bool]
	rev    *core.Signal[int]
}

type documentDetail struct {
	scope         *core.Scope
	open          *core.Signal[bool]
	doc           *core.Signal[store.Document]
	rev           *core.Signal[int]
	status        *core.Signal[string]
	failed        *core.Signal[bool]
	busy          *core.Signal[bool]
	stage         *core.Signal[string]
	extracting    *core.Signal[bool]
	extraction    *core.Signal[*store.Extraction]
	providerReady bool
	evidence      []store.DocumentEvidence
	total         int
	text          string
	pages         int
}

func newDocumentDetail(cx *core.Scope) *documentDetail {
	return &documentDetail{
		scope:      cx,
		open:       core.NewSignal(cx, false),
		doc:        core.NewSignal(cx, store.Document{}),
		rev:        core.NewSignal(cx, 0),
		status:     core.NewSignal(cx, ""),
		failed:     core.NewSignal(cx, false),
		busy:       core.NewSignal(cx, false),
		stage:      core.NewSignal(cx, ""),
		extracting: core.NewSignal(cx, false),
		extraction: core.NewSignal[*store.Extraction](cx, nil),
	}
}

func newDocumentPreview(cx *core.Scope) *documentPreview {
	return &documentPreview{
		open:   core.NewSignal(cx, false),
		doc:    core.NewSignal(cx, store.Document{}),
		page:   core.NewSignal(cx, 0),
		total:  core.NewSignal(cx, 0),
		frame:  core.NewSignal[*image.RGBA](cx, nil),
		status: core.NewSignal(cx, ""),
		failed: core.NewSignal(cx, false),
		busy:   core.NewSignal(cx, false),
		rev:    core.NewSignal(cx, 0),
	}
}

func (s *Session) documentsScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	status := core.NewSignal(cx, "")
	statusFailed := core.NewSignal(cx, false)
	preview := newDocumentPreview(cx)
	detail := newDocumentDetail(cx)
	return core.View{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{
			core.Scroll{
				Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
				Children: []core.Node{core.View{
					Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
					Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
						_ = dataRev.Get()
						return s.documentsBody(cx, dataRev, status, statusFailed, preview, detail)
					})},
				}},
			},
			s.documentPreviewDialog(cx, preview),
			s.documentDetailDialog(cx, detail),
		},
	}
}

func (s *Session) documentsBody(cx *core.Scope, dataRev *core.Signal[int],
	status *core.Signal[string], statusFailed *core.Signal[bool], preview *documentPreview,
	detail *documentDetail) core.Node {
	rows := make([]core.Node, 0, len(s.documents))
	for i := range s.documents {
		rows = append(rows, s.documentRow(cx, s.documents[i], status, statusFailed, preview, detail))
	}
	if len(rows) == 0 {
		rows = append(rows, core.View{
			Style: core.Style{Padding: core.All(24), Gap: 6, AlignItems: core.AlignCenter},
			Children: []core.Node{
				core.Text{ContentFunc: func() string { return locales.DocumentsEmptyTitle(cx) },
					Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
				core.Text{ContentFunc: func() string { return locales.DocumentsEmptyBody(cx) },
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
			},
		})
	}

	children := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
			dataHeading(cx, locales.NavDocuments(cx),
				locales.DocumentsCount(cx, strconv.Itoa(s.documentTotal))),
			core.View{Style: core.Style{FlexGrow: 1}},
			ui.Button{Text: locales.DocumentsUploadButton(cx), Variant: ui.ButtonPrimary,
				OnPress: func() { s.uploadDocuments(cx, dataRev, status, statusFailed) },
				TestID:  "documents-upload"},
		}},
		core.Text{ContentFunc: func() string { return locales.DocumentsUploadTypesHint(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style {
						if statusFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		core.View{Style: core.Style{Gap: 0}, Children: rows},
	}
	if s.documentTotal > len(s.documents) {
		children = append(children, core.Text{
			ContentFunc: func() string {
				return locales.DocumentsShowingLatest(cx, strconv.Itoa(len(s.documents)),
					strconv.Itoa(s.documentTotal))
			},
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
		})
	}
	return dataCard(cx, children...)
}

func (s *Session) documentRow(cx *core.Scope, document store.Document,
	status *core.Signal[string], statusFailed *core.Signal[bool], preview *documentPreview,
	detail *documentDetail) core.Node {
	meta := documentKind(document.MIMEType) + " · " + documentSize(document.SizeBytes)
	if date := documentDate(document.UploadedAt); date != "" {
		meta += " · " + locales.DocumentsReviewUploadedOn(cx, date)
	}
	actions := []core.Node{}
	actions = append(actions, ui.Button{Text: locales.DocumentsDetailButton(cx), Variant: ui.ButtonGhost,
		OnPress: func() { s.openDocumentDetail(cx, detail, document) },
		TestID:  "documents-detail-" + document.ID})
	if documentPreviewable(document.MIMEType) {
		actions = append(actions, ui.Button{Text: locales.DocumentsPreviewButton(cx), Variant: ui.ButtonGhost,
			OnPress: func() { s.openDocumentPreview(cx, preview, document) },
			TestID:  "documents-preview-" + document.ID})
	}
	actions = append(actions, ui.Button{Text: locales.DocumentsOpenRow(cx), Variant: ui.ButtonGhost,
		OnPress: func() { s.openDocument(cx, document, status, statusFailed) },
		TestID:  "documents-open-" + document.ID})
	children := []core.Node{
		ui.Icon(documentIcon(document.MIMEType), 15, ui.ColorsOf(cx).Muted),
		core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
			Children: []core.Node{
				core.Text{Content: document.Filename,
					Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}, MaxLines: 1},
				core.Text{Content: meta, Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
			}},
	}
	children = append(children, actions...)
	return core.View{
		TestID: "documents-row-" + document.ID,
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
			Padding: core.Symmetric(9, 0), Borders: core.Edges{Bottom: 1}},
		StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
		Children:  children,
	}
}

func (s *Session) openDocumentPreview(cx *core.Scope, preview *documentPreview, document store.Document) {
	preview.doc.Set(document)
	preview.page.Set(0)
	preview.total.Set(0)
	preview.frame.Set(nil)
	preview.status.Set("")
	preview.failed.Set(false)
	preview.open.Set(true)
	preview.rev.Set(preview.rev.Get() + 1)
	s.loadDocumentPreview(cx, preview)
}

func (s *Session) loadDocumentPreview(cx *core.Scope, preview *documentPreview) {
	document := preview.doc.Get()
	page := preview.page.Get()
	path := store.ResolveDocumentPath(document.StoragePath, s.dataDir)
	failedPrefix := locales.DocumentsPreviewFailed(cx)
	preview.busy.Set(true)
	preview.status.Set("")
	preview.failed.Set(false)
	preview.rev.Set(preview.rev.Get() + 1)
	go func() {
		data, err := os.ReadFile(path)
		total := 0
		var frame *image.RGBA
		if err == nil {
			if document.MIMEType == "application/pdf" {
				total, err = docview.PDFPageCount(data)
				if err == nil {
					frame, err = docview.RenderPDFPage(data, page, 120)
				}
			} else {
				frame, err = docview.DecodeImage(data)
			}
		}
		cx.Post(func() {
			if !preview.open.Get() || preview.doc.Get().ID != document.ID || preview.page.Get() != page {
				return
			}
			preview.busy.Set(false)
			if err != nil {
				preview.status.Set(failedPrefix + ": " + err.Error())
				preview.failed.Set(true)
				preview.rev.Set(preview.rev.Get() + 1)
				return
			}
			preview.frame.Set(frame)
			preview.total.Set(total)
			preview.status.Set("")
			preview.rev.Set(preview.rev.Get() + 1)
		})
	}()
}

func (s *Session) documentPreviewDialog(cx *core.Scope, preview *documentPreview) core.Node {
	return ui.Dialog{
		Open: preview.open.Get,
		OnOpenChange: func(open bool, _ base.Reason) {
			preview.open.Set(open)
			if !open {
				preview.busy.Set(false)
			}
		},
		TitleFunc: func() string { return preview.doc.Get().Filename },
		Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
			_ = preview.rev.Get()
			if preview.busy.Get() {
				return core.Text{ContentFunc: func() string { return locales.DocumentsPreviewLoading(cx) },
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
			}
			if preview.status.Get() != "" {
				return core.Text{ContentFunc: func() string { return preview.status.Get() },
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
			}
			frame := preview.frame.Get()
			if frame == nil {
				return core.Text{ContentFunc: func() string { return locales.DocumentsPreviewLoading(cx) },
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
			}
			return core.Scroll{
				Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
					MaxHeight: core.Pt(560), AlignItems: core.AlignCenter},
				Children: []core.Node{core.Image{
					TestID:     "documents-preview-image",
					Source:     core.ImageSource{Pixels: frame},
					ResizeMode: core.Contain,
					Style:      core.Style{Width: core.Pt(720), AlignSelf: core.AlignCenter},
				}},
			}
		})},
		Footer: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
			return s.documentPreviewFooter(cx, preview)
		})},
		TestID: "documents-preview-dialog",
		Style:  core.Style{Width: core.Pt(780)},
	}
}

func (s *Session) documentPreviewFooter(cx *core.Scope, preview *documentPreview) core.Node {
	document := preview.doc.Get()
	children := []core.Node{}
	if document.MIMEType == "application/pdf" {
		children = append(children,
			ui.Button{Text: locales.DocumentsPrev(cx), Variant: ui.ButtonSecondary,
				Disabled: func() bool { return preview.page.Get() <= 0 },
				OnPress: func() {
					preview.page.Set(preview.page.Get() - 1)
					s.loadDocumentPreview(cx, preview)
				}, TestID: "documents-preview-prev"},
			core.Show{When: func() bool { return preview.total.Get() > 0 },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string {
						return locales.DocumentsPreviewPage(cx,
							strconv.Itoa(preview.page.Get()+1), strconv.Itoa(preview.total.Get()))
					}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
				}},
			ui.Button{Text: locales.DocumentsNext(cx), Variant: ui.ButtonSecondary,
				Disabled: func() bool {
					return preview.total.Get() <= 0 || preview.page.Get()+1 >= preview.total.Get()
				},
				OnPress: func() {
					preview.page.Set(preview.page.Get() + 1)
					s.loadDocumentPreview(cx, preview)
				}, TestID: "documents-preview-next"},
		)
	}
	children = append(children,
		core.View{Style: core.Style{FlexGrow: 1}},
		ui.Button{Text: locales.DocumentsOpenRow(cx), Variant: ui.ButtonSecondary,
			OnPress: func() { s.openDocument(cx, document, preview.status, preview.failed) }},
		ui.Button{Text: locales.DocumentsPreviewClose(cx), Variant: ui.ButtonSecondary,
			OnPress: func() {
				preview.busy.Set(false)
				preview.open.Set(false)
			}, TestID: "documents-preview-close"},
	)
	return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
		Children: children}
}

func documentPreviewable(mimeType string) bool {
	switch mimeType {
	case "application/pdf", "image/png", "image/jpeg", "image/webp":
		return true
	default:
		return false
	}
}

func (s *Session) openDocumentDetail(cx *core.Scope, detail *documentDetail, document store.Document) {
	detail.doc.Set(document)
	detail.evidence = nil
	detail.total = 0
	detail.text = ""
	detail.pages = 0
	detail.providerReady = s.llmProvider(cx).Configured()
	detail.status.Set("")
	detail.failed.Set(false)
	detail.busy.Set(document.MIMEType == "application/pdf")
	detail.stage.Set(defaultExtractionStage())
	detail.open.Set(true)

	evidence, total, err := s.db.DocumentEvidence(context.Background(), document.ID, 50)
	if err != nil {
		detail.status.Set(locales.DocumentsDetailLoadFailed(cx) + ": " + err.Error())
		detail.failed.Set(true)
	} else {
		detail.evidence, detail.total = evidence, total
	}
	s.loadLatestExtraction(context.Background(), detail, document.ID)
	detail.rev.Set(detail.rev.Get() + 1)
	if document.MIMEType == "application/pdf" {
		s.loadDocumentText(cx, detail)
	}
}

func (s *Session) loadDocumentText(cx *core.Scope, detail *documentDetail) {
	document := detail.doc.Get()
	path := store.ResolveDocumentPath(document.StoragePath, s.dataDir)
	failedPrefix := locales.DocumentsDetailTextFailed(cx)
	go func() {
		data, err := os.ReadFile(path)
		text := ""
		pages := 0
		if err == nil {
			text, pages, err = docview.PDFText(data)
		}
		cx.Post(func() {
			if !detail.open.Get() || detail.doc.Get().ID != document.ID {
				return
			}
			detail.busy.Set(false)
			if err != nil {
				detail.status.Set(failedPrefix + ": " + err.Error())
				detail.failed.Set(true)
			} else {
				detail.text, detail.pages = text, pages
			}
			detail.rev.Set(detail.rev.Get() + 1)
		})
	}()
}

func defaultExtractionStage() string {
	stages := extraction.List()
	if len(stages) == 0 {
		return ""
	}
	return stages[0].ID
}

// loadLatestExtraction refreshes the newest extraction for the dialog. It is
// called on open and after a run or discard.
func (s *Session) loadLatestExtraction(ctx context.Context, detail *documentDetail, documentID string) {
	rows, err := s.db.ListExtractions(ctx, documentID)
	if err != nil {
		detail.extraction.Set(nil)
		return
	}
	if len(rows) == 0 {
		detail.extraction.Set(nil)
		return
	}
	latest := rows[0]
	detail.extraction.Set(&latest)
}

func (s *Session) runDocumentExtraction(cx *core.Scope, detail *documentDetail) {
	if detail.extracting.Get() {
		return
	}
	document := detail.doc.Get()
	stage := detail.stage.Get()
	provider := s.llmProvider(cx)
	if !provider.Configured() {
		detail.status.Set(locales.DocumentsExtractionNotConfigured(cx))
		detail.failed.Set(true)
		detail.rev.Set(detail.rev.Get() + 1)
		return
	}
	if stage == "" {
		return
	}
	detail.extracting.Set(true)
	detail.status.Set("")
	detail.failed.Set(false)
	detail.rev.Set(detail.rev.Get() + 1)
	go func() {
		service := &extraction.Service{Store: s.db, DataDir: s.dataDir, Provider: provider}
		row, err := service.Run(context.Background(), document.ID, stage)
		detail.scope.Post(func() {
			if !detail.open.Get() || detail.doc.Get().ID != document.ID {
				return
			}
			detail.extracting.Set(false)
			if err != nil {
				detail.status.Set(extractionErrorText(detail.scope, err))
				detail.failed.Set(true)
			} else {
				detail.extraction.Set(row)
				detail.status.Set(locales.DocumentsExtractionDone(detail.scope))
				detail.failed.Set(false)
			}
			detail.rev.Set(detail.rev.Get() + 1)
		})
	}()
}

func extractionErrorText(cx *core.Scope, err error) string {
	switch {
	case errors.Is(err, extraction.ErrNoTextLayer):
		return locales.DocumentsExtractionNoText(cx)
	case errors.Is(err, extraction.ErrNotConfigured):
		return locales.DocumentsExtractionNotConfigured(cx)
	default:
		return locales.DocumentsExtractionFailed(cx) + ": " + err.Error()
	}
}

func (s *Session) discardDocumentExtraction(cx *core.Scope, detail *documentDetail) {
	row := detail.extraction.Get()
	if row == nil {
		return
	}
	if err := s.db.DiscardExtraction(context.Background(), row.ID); err != nil {
		detail.status.Set(err.Error())
		detail.failed.Set(true)
		detail.rev.Set(detail.rev.Get() + 1)
		return
	}
	detail.status.Set(locales.DocumentsReviewDiscardSuccess(cx))
	detail.failed.Set(false)
	s.loadLatestExtraction(context.Background(), detail, detail.doc.Get().ID)
	detail.rev.Set(detail.rev.Get() + 1)
}

func (s *Session) documentExtractionCard(cx *core.Scope, detail *documentDetail) core.Node {
	stages := extraction.List()
	options := make([]ui.Option[string], 0, len(stages))
	for _, stage := range stages {
		options = append(options, ui.Option[string]{Value: stage.ID, Label: stage.ID})
	}
	row := detail.extraction.Get()

	header := []core.Node{
		dataHeading(cx, locales.DocumentsExtractionTitle(cx), ""),
		core.View{Style: core.Style{FlexGrow: 1}},
	}
	if row != nil {
		header = append(header, extractionStatusBadge(cx, row.Status))
	}

	children := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8},
			Children: header},
		core.Text{ContentFunc: func() string { return locales.DocumentsExtractionHint(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
	}
	if !detail.providerReady {
		children = append(children, core.Text{ContentFunc: func() string {
			return locales.DocumentsExtractionNotConfigured(cx)
		}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)})
		return dataCard(cx, children...)
	}
	runLabel := locales.DocumentsExtractionRunNow(cx)
	if row != nil {
		runLabel = locales.DocumentsExtractionRunAgain(cx)
	}
	children = append(children,
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignEnd, Gap: 8}, Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1}, Children: []core.Node{dataField(cx,
				locales.DocumentsReviewStage(cx),
				ui.Select[string]{Options: options, Value: detail.stage.Get,
					OnChange: func(value string) {
						detail.stage.Set(value)
						detail.rev.Set(detail.rev.Get() + 1)
					},
					Label: locales.DocumentsReviewStage(cx), TestID: "documents-extraction-stage"})}},
			ui.Button{Text: runLabel, Busy: detail.extracting.Get,
				OnPress: func() { s.runDocumentExtraction(cx, detail) },
				TestID:  "documents-extraction-run"},
		}},
		core.Show{When: func() bool { return detail.extracting.Get() },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string {
					return locales.DocumentsExtractionRunning(cx)
				}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
			}},
	)
	if row != nil {
		children = append(children, s.documentExtractionResult(cx, detail, row))
	}
	return dataCard(cx, children...)
}

func (s *Session) documentExtractionResult(cx *core.Scope, detail *documentDetail,
	row *store.Extraction) core.Node {
	meta := row.PromptVersion + " · " + row.LLMProvider + "/" + row.LLMModel
	if date := documentDate(row.CreatedAt); date != "" {
		meta += " · " + date
	}
	children := []core.Node{
		core.Text{Content: meta, Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
	}
	if row.Status == store.ExtractionRejected {
		children = append(children, core.Text{ContentFunc: func() string {
			return locales.DocumentsReviewPreviousDiscarded(cx)
		}, Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3})
		return core.View{Style: core.Style{Gap: 6}, Children: children}
	}
	fields, confidence := extractionFieldNodes(cx, row.ParsedJSON)
	if confidence != "" {
		children = append(children, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6},
			Children: []core.Node{
				core.Text{ContentFunc: func() string { return locales.DocumentsReviewConfidence(cx) },
					Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				ui.Badge{Text: extractionConfidenceLabel(cx, confidence), Variant: ui.BadgeNeutral},
			}})
	}
	if len(fields) > 0 {
		children = append(children,
			core.Text{ContentFunc: func() string { return locales.DocumentsExtractionFields(cx) },
				Style: core.Style{FontSize: 12, FontWeight: ui.Semibold}},
			core.View{Style: core.Style{Gap: 4}, Children: fields})
	}
	if row.Status == store.ExtractionReviewNeeded {
		children = append(children,
			core.Text{ContentFunc: func() string { return locales.DocumentsExtractionReviewHint(cx) },
				Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
			core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd},
				Children: []core.Node{
					ui.Button{Text: locales.DocumentsReviewDiscard(cx), Variant: ui.ButtonSecondary,
						OnPress: func() { s.discardDocumentExtraction(cx, detail) },
						TestID:  "documents-extraction-discard"},
				}})
	}
	return core.View{Style: core.Style{Gap: 6}, Children: children}
}

func extractionStatusBadge(cx *core.Scope, status string) core.Node {
	switch status {
	case store.ExtractionReviewNeeded:
		return ui.Badge{Text: locales.DocumentsStatusReviewNeeded(cx), Variant: ui.BadgeWarn}
	case store.ExtractionParsed:
		return ui.Badge{Text: locales.DocumentsStatusParsed(cx), Variant: ui.BadgeAccent}
	case store.ExtractionRejected:
		return ui.Badge{Text: locales.DocumentsStatusRejected(cx), Variant: ui.BadgeNeutral}
	default:
		return ui.Badge{Text: locales.DocumentsStatusUnclassified(cx), Variant: ui.BadgeNeutral}
	}
}

func extractionConfidenceLabel(cx *core.Scope, confidence string) string {
	switch confidence {
	case "high":
		return locales.DocumentsReviewConfidenceHigh(cx)
	case "medium":
		return locales.DocumentsReviewConfidenceMedium(cx)
	case "low":
		return locales.DocumentsReviewConfidenceLow(cx)
	default:
		return confidence
	}
}

// extractionFieldNodes renders the parsed object in a stable, readable order.
// Unknown keys follow the known ones alphabetically so a new stage still shows
// its data without a UI change.
func extractionFieldNodes(cx *core.Scope, raw string) ([]core.Node, string) {
	var value map[string]any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, ""
	}
	order := []string{
		"supplier_name", "doc_type", "mode", "account_no",
		"amount_kwh", "amount_yuan", "volume_l", "volume_m3", "quantity_kg", "weight_kg",
		"unit_price_yuan", "distance_km",
		"period_start", "period_end", "occurred_at", "departure_at", "arrival_at",
		"origin", "destination", "passenger_name", "travel_class",
		"flight_or_train_no", "vehicle_plate", "vehicle_class", "ticket_no",
		"tracking_no", "invoice_no", "item_description", "fuel_type", "fuel_category",
		"category",
	}
	seen := map[string]bool{}
	var keys []string
	for _, key := range order {
		if _, ok := value[key]; ok {
			keys = append(keys, key)
			seen[key] = true
		}
	}
	var rest []string
	for key := range value {
		if !seen[key] && key != "confidence" {
			rest = append(rest, key)
		}
	}
	sort.Strings(rest)
	keys = append(keys, rest...)

	nodes := make([]core.Node, 0, len(keys))
	for _, key := range keys {
		nodes = append(nodes, documentDetailField(cx, extractionFieldLabel(cx, key),
			extractionFieldValue(value[key]), false))
	}
	confidence, _ := value["confidence"].(string)
	return nodes, confidence
}

func extractionFieldValue(value any) string {
	switch v := value.(type) {
	case nil:
		return "—"
	case string:
		if strings.TrimSpace(v) == "" {
			return "—"
		}
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	default:
		return fmt.Sprint(v)
	}
}

func extractionFieldLabel(cx *core.Scope, key string) string {
	switch key {
	case "supplier_name":
		return locales.DocumentsReviewFieldSupplier(cx)
	case "doc_type":
		return locales.DocumentsReviewStage(cx)
	case "mode":
		return locales.DocumentsReviewFieldMode(cx)
	case "account_no":
		return locales.DocumentsReviewFieldAccount(cx)
	case "amount_kwh":
		return locales.DocumentsReviewFieldAmountKwh(cx)
	case "amount_yuan":
		return locales.DocumentsReviewFieldAmountYuan(cx)
	case "volume_l":
		return locales.DocumentsReviewFieldVolumeL(cx)
	case "volume_m3":
		return locales.DocumentsReviewFieldVolumeM3(cx)
	case "quantity_kg":
		return locales.DocumentsReviewFieldQuantityKg(cx)
	case "weight_kg":
		return locales.DocumentsReviewFieldWeightKg(cx)
	case "unit_price_yuan":
		return locales.DocumentsReviewFieldUnitPriceYuan(cx)
	case "distance_km":
		return locales.DocumentsReviewFieldDistanceKm(cx)
	case "period_start":
		return locales.DocumentsReviewFieldPeriodStart(cx)
	case "period_end":
		return locales.DocumentsReviewFieldPeriodEnd(cx)
	case "occurred_at":
		return locales.DocumentsReviewFieldOccurredAt(cx)
	case "departure_at":
		return locales.DocumentsReviewFieldDepartureAt(cx)
	case "arrival_at":
		return locales.DocumentsReviewFieldArrivalAt(cx)
	case "origin":
		return locales.DocumentsReviewFieldOrigin(cx)
	case "destination":
		return locales.DocumentsReviewFieldDestination(cx)
	case "passenger_name":
		return locales.DocumentsReviewFieldPassengerName(cx)
	case "travel_class":
		return locales.DocumentsReviewFieldTravelClass(cx)
	case "flight_or_train_no":
		return locales.DocumentsReviewFieldFlightOrTrainNo(cx)
	case "vehicle_plate":
		return locales.DocumentsReviewFieldVehiclePlate(cx)
	case "vehicle_class":
		return locales.DocumentsReviewFieldVehicleClass(cx)
	case "ticket_no":
		return locales.DocumentsReviewFieldTicketNo(cx)
	case "tracking_no":
		return locales.DocumentsReviewFieldTrackingNo(cx)
	case "invoice_no":
		return locales.DocumentsReviewFieldInvoiceNo(cx)
	case "item_description":
		return locales.DocumentsReviewFieldItemDescription(cx)
	case "fuel_type":
		return locales.DocumentsReviewFieldFuelType(cx)
	case "fuel_category":
		return locales.DocumentsReviewFieldFuelCategory(cx)
	case "category":
		return locales.DocumentsReviewFieldCategory(cx)
	default:
		return key
	}
}

func (s *Session) documentDetailDialog(cx *core.Scope, detail *documentDetail) core.Node {
	return ui.Dialog{
		Open: detail.open.Get,
		OnOpenChange: func(open bool, _ base.Reason) {
			detail.open.Set(open)
			if !open {
				detail.busy.Set(false)
			}
		},
		TitleFunc: func() string { return detail.doc.Get().Filename },
		Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
			_ = detail.rev.Get()
			return s.documentDetailBody(cx, detail)
		})},
		Footer: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
			document := detail.doc.Get()
			return core.View{Style: core.Style{Direction: core.Row, JustifyContent: core.JustifyEnd, Gap: 8},
				Children: []core.Node{
					ui.Button{Text: locales.DocumentsOpenRow(cx), Variant: ui.ButtonSecondary,
						OnPress: func() { s.openDocument(cx, document, detail.status, detail.failed) }},
					ui.Button{Text: locales.DocumentsPreviewClose(cx), Variant: ui.ButtonSecondary,
						OnPress: func() {
							detail.busy.Set(false)
							detail.open.Set(false)
						}, TestID: "documents-detail-close"},
				}}
		})},
		TestID: "documents-detail-dialog",
		Style:  core.Style{Width: core.Pt(760)},
	}
}

func (s *Session) documentDetailBody(cx *core.Scope, detail *documentDetail) core.Node {
	document := detail.doc.Get()
	metaRows := []core.Node{
		documentDetailField(cx, locales.DocumentsDetailKind(cx), documentKind(document.MIMEType), false),
		documentDetailField(cx, locales.DocumentsDetailSize(cx), documentSize(document.SizeBytes), false),
		documentDetailField(cx, locales.DocumentsTableUploaded(cx), documentDate(document.UploadedAt), false),
		documentDetailField(cx, locales.DocumentsDetailSha(cx), document.SHA256, true),
	}
	if document.UploadedBy != "" {
		metaRows = append(metaRows,
			documentDetailField(cx, locales.DocumentsDetailUploadedBy(cx), document.UploadedBy, false))
	}

	evidenceRows := []core.Node{}
	for i, item := range detail.evidence {
		date := item.OccurredAt
		if len(date) >= 10 {
			date = date[:10]
		}
		meta := date + " · " + item.SourceName
		if item.SiteName != "" {
			meta += " · " + item.SiteName
		}
		meta += " · " + commaFloat(item.Amount) + " " + item.Unit +
			" · " + commaFloat(item.CO2eKg) + " kgCO2e"
		evidenceRows = append(evidenceRows, core.View{
			TestID: "documents-detail-evidence-" + strconv.Itoa(i),
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(6, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				core.Text{Content: meta, Style: core.Style{FontSize: 12}, MaxLines: 1,
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.View{Style: core.Style{FlexGrow: 1}},
				ui.Badge{Text: dataScopeLabel(cx, item.Scope), Variant: ui.BadgeNeutral},
			},
		})
	}
	if len(evidenceRows) == 0 {
		evidenceRows = append(evidenceRows, core.Text{ContentFunc: func() string {
			return locales.DocumentsDetailEvidenceEmpty(cx)
		}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	} else if detail.total > len(detail.evidence) {
		evidenceRows = append(evidenceRows, core.Text{ContentFunc: func() string {
			return locales.DocumentsShowingLatest(cx, strconv.Itoa(len(detail.evidence)),
				strconv.Itoa(detail.total))
		}, Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	}

	textChildren := []core.Node{}
	switch {
	case document.MIMEType != "application/pdf":
		textChildren = append(textChildren, core.Text{ContentFunc: func() string {
			return locales.DocumentsDetailTextUnsupported(cx)
		}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	case detail.busy.Get():
		textChildren = append(textChildren, core.Text{ContentFunc: func() string {
			return locales.DocumentsDetailTextLoading(cx)
		}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	case strings.TrimSpace(detail.text) == "":
		textChildren = append(textChildren, core.Text{ContentFunc: func() string {
			return locales.DocumentsDetailTextEmpty(cx)
		}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	default:
		textChildren = append(textChildren,
			core.Text{Content: truncateRunes(detail.text, 20000),
				Style: core.Style{FontSize: 11, FontFamily: "monospace"}},
			ui.Button{Text: locales.DocumentsDetailCopy(cx), Variant: ui.ButtonSecondary,
				OnPress: func() {
					cx.SetClipboard(detail.text)
					detail.status.Set(locales.DocumentsDetailCopied(cx))
					detail.failed.Set(false)
					detail.rev.Set(detail.rev.Get() + 1)
				}, TestID: "documents-detail-copy"},
		)
	}

	status := core.Show{When: func() bool { return detail.status.Get() != "" },
		Then: func(cx *core.Scope) core.Node {
			return core.Text{ContentFunc: func() string { return detail.status.Get() },
				Style: core.Style{FontSize: 12},
				StyleFunc: func() core.Style {
					if detail.failed.Get() {
						return ui.Colored(ui.ColorsOf(cx).Danger)()
					}
					return ui.Colored(ui.ColorsOf(cx).Muted)()
				}}
		}}

	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0), MaxHeight: core.Pt(560)},
		Children: []core.Node{core.View{Style: core.Style{Gap: 12}, Children: []core.Node{
			dataCard(cx,
				dataHeading(cx, locales.DocumentsDetailMetadata(cx), ""),
				core.View{Style: core.Style{Gap: 6}, Children: metaRows},
				status,
			),
			s.documentExtractionCard(cx, detail),
			dataCard(cx,
				dataHeading(cx, locales.DocumentsDetailEvidence(cx),
					locales.DocumentsDetailEvidenceCount(cx, strconv.Itoa(detail.total))),
				core.View{Style: core.Style{Gap: 0}, Children: evidenceRows},
			),
			dataCard(cx,
				core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
					dataHeading(cx, locales.DocumentsDetailText(cx), ""),
					core.View{Style: core.Style{FlexGrow: 1}},
					core.Show{When: func() bool { return detail.pages > 0 },
						Then: func(cx *core.Scope) core.Node {
							return ui.Badge{Text: locales.DocumentsDetailPages(cx, strconv.Itoa(detail.pages)),
								Variant: ui.BadgeNeutral}
						}},
				}},
				core.View{Style: core.Style{Gap: 8}, Children: textChildren},
			),
		}}},
	}
}

func documentDetailField(cx *core.Scope, label string, value string, monospace bool) core.Node {
	style := core.Style{FontSize: 12}
	if monospace {
		style.FontFamily = "monospace"
		style.FontSize = 11
	}
	return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
		core.Text{Content: label, Style: core.Style{FontSize: 11}, MaxLines: 1,
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		core.View{Style: core.Style{FlexGrow: 1}},
		core.Text{Content: value, Style: style, MaxLines: 2},
	}}
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}

func (s *Session) uploadDocuments(cx *core.Scope, dataRev *core.Signal[int],
	status *core.Signal[string], statusFailed *core.Signal[bool]) {
	status.Set("")
	statusFailed.Set(false)
	cx.PickFiles(core.PickFilesOptions{
		Multiple: true,
		Types:    []string{".pdf", ".xlsx", ".csv", ".png", ".jpg", ".jpeg", ".webp"},
		Title:    locales.NavDocuments(cx),
		Button:   locales.DocumentsUploadButton(cx),
	}, func(files []core.File, err error) {
		if err != nil {
			status.Set(locales.DocumentsUploadFailed(cx) + ": " + err.Error())
			statusFailed.Set(true)
			return
		}
		if len(files) == 0 {
			return
		}
		ok, failed := 0, 0
		for _, file := range files {
			if err := s.saveUploadedDocument(file); err != nil {
				failed++
				s.log.Warn("document upload failed", "file", file.Name, "err", err)
				continue
			}
			ok++
		}
		if err := dataRefresh(s, dataRev); err != nil {
			status.Set(locales.DocumentsUploadFailed(cx) + ": " + err.Error())
			statusFailed.Set(true)
			return
		}
		status.Set(locales.DocumentsUploadSummary(cx, strconv.Itoa(ok), strconv.Itoa(failed)))
		statusFailed.Set(failed > 0)
	})
}

func (s *Session) saveUploadedDocument(file core.File) error {
	if file.Size > store.MaxDocumentBytes {
		return fmt.Errorf("document exceeds %d bytes", store.MaxDocumentBytes)
	}
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, store.MaxDocumentBytes+1))
	if err != nil {
		return err
	}
	mimeType := uploadedDocumentMIME(file)
	if mimeType == "" {
		return fmt.Errorf("unsupported document type")
	}
	_, _, err = s.db.SaveDocument(context.Background(), store.DocumentInput{
		Filename: file.Name,
		MIMEType: mimeType,
		Data:     data,
	}, s.dataDir)
	return err
}

func (s *Session) openDocument(cx *core.Scope, document store.Document,
	status *core.Signal[string], statusFailed *core.Signal[bool]) {
	path := store.ResolveDocumentPath(document.StoragePath, s.dataDir)
	if path == "" {
		status.Set(locales.DocumentsOpenFailed(cx))
		statusFailed.Set(true)
		return
	}
	cx.OpenFile(core.SharedFile{Path: path, Name: document.Filename, MIME: document.MIMEType},
		func(opened bool, err error) {
			if err != nil {
				status.Set(locales.DocumentsOpenFailed(cx) + ": " + err.Error())
				statusFailed.Set(true)
				return
			}
			if !opened {
				status.Set(locales.DocumentsOpenFailed(cx))
				statusFailed.Set(true)
			}
		})
}

func uploadedDocumentMIME(file core.File) string {
	if mimeType := documentMIMEForFilename(file.Name); mimeType != "" {
		return mimeType
	}
	mimeType := strings.ToLower(strings.TrimSpace(file.MIME))
	if mimeType == "" || mimeType == "application/octet-stream" {
		return ""
	}
	return mimeType
}

func documentMIMEForFilename(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".pdf":
		return "application/pdf"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".csv":
		return "text/csv"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	}
	return ""
}

func documentKind(mimeType string) string {
	switch mimeType {
	case "application/pdf":
		return "PDF"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return "XLSX"
	case "text/csv":
		return "CSV"
	case "image/png":
		return "PNG"
	case "image/jpeg":
		return "JPEG"
	case "image/webp":
		return "WebP"
	default:
		return "File"
	}
}

func documentIcon(mimeType string) func() *core.SVG {
	switch mimeType {
	case "application/pdf":
		return lucide.FileText
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return lucide.FileSpreadsheet
	case "text/csv":
		return lucide.FileSpreadsheet
	default:
		return lucide.FileImage
	}
}

func documentSize(bytes int64) string {
	switch {
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(bytes)/(1<<10))
	default:
		return strconv.FormatInt(bytes, 10) + " B"
	}
}

func documentDate(uploadedAt string) string {
	if len(uploadedAt) >= 10 {
		return uploadedAt[:10]
	}
	return uploadedAt
}
