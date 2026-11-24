package app

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

const maxBatchFailures = 50

// batchConcurrency mirrors 1.x: two in-flight model calls, small enough for
// common provider rate limits.
const batchConcurrency = 2

type batchDoc struct {
	ID       string
	Filename string
}

type batchFailure struct {
	DocumentID string
	Filename   string
	Reason     string
	Detail     string
}

// batchExtraction is the one in-memory recognition queue. It lives on the
// Session so navigating away and back keeps the progress; every field except
// cancel is written on the UI thread through scope.Post.
type batchExtraction struct {
	rev      *core.Signal[int]
	cancel   atomic.Bool
	cancelFn context.CancelFunc

	running  bool
	canceled bool
	finished bool
	total    int
	done     int
	ok       int
	failed   int

	current  map[string]string
	failures []batchFailure
}

func newBatchExtraction(cx *core.Scope) *batchExtraction {
	return &batchExtraction{rev: core.NewSignal(cx, 0), current: map[string]string{}}
}

// batchCandidates is the 1.x pool: PDFs with no extraction history at all.
// Rejected documents are a human decision and stay out.
func (s *Session) batchCandidates() []batchDoc {
	out := make([]batchDoc, 0, len(s.documents))
	for _, document := range s.documents {
		if document.MIMEType != "application/pdf" {
			continue
		}
		if _, ok := s.extractionStatus[document.ID]; ok {
			continue
		}
		out = append(out, batchDoc{ID: document.ID, Filename: document.Filename})
	}
	return out
}

// startBatch classifies and extracts each document in order. One batch at a
// time; cancel stops dequeuing and aborts the in-flight model call, leaving
// that document unextracted for the next run.
func (s *Session) startBatch(cx *core.Scope, docs []batchDoc) {
	b := s.batch
	if b == nil || b.running || len(docs) == 0 || s.scope == nil {
		return
	}
	provider := s.llmProvider(cx)
	if !provider.Configured() {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	b.running, b.canceled, b.finished = true, false, false
	b.total, b.done, b.ok, b.failed = len(docs), 0, 0, 0
	b.current = map[string]string{}
	b.failures = nil
	b.cancel.Store(false)
	b.cancelFn = cancel
	b.rev.Set(b.rev.Get() + 1)
	go func() {
		defer cancel()
		service := &extraction.Service{Store: s.db, DataDir: s.dataDir, Provider: provider,
			NewClient: newExtractor}
		var next atomic.Int32
		worker := func() {
			for {
				if b.cancel.Load() {
					return
				}
				index := int(next.Add(1)) - 1
				if index >= len(docs) {
					return
				}
				document := docs[index]
				s.scope.Post(func() {
					b.current[document.ID] = document.Filename
					b.rev.Set(b.rev.Get() + 1)
				})
				_, _, err := service.ClassifyAndRun(ctx, document.ID)
				if b.cancel.Load() {
					return
				}
				s.scope.Post(func() {
					delete(b.current, document.ID)
					b.done++
					if err != nil {
						b.failed++
						if len(b.failures) < maxBatchFailures {
							failure := batchFailure{DocumentID: document.ID, Filename: document.Filename,
								Reason: "error", Detail: batchErrorMessage(err)}
							if errors.Is(err, extraction.ErrUnclassified) {
								failure.Reason, failure.Detail = "classify_failed", ""
							}
							b.failures = append(b.failures, failure)
						}
					} else {
						b.ok++
					}
					_ = s.reload(context.Background())
					b.rev.Set(b.rev.Get() + 1)
				})
			}
		}
		var wg sync.WaitGroup
		workers := batchConcurrency
		if len(docs) < workers {
			workers = len(docs)
		}
		for i := 0; i < workers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				worker()
			}()
		}
		wg.Wait()
		s.scope.Post(func() {
			b.running = false
			b.finished = true
			b.current = map[string]string{}
			b.canceled = b.cancel.Load()
			b.cancelFn = nil
			b.rev.Set(b.rev.Get() + 1)
		})
	}()
}

func batchErrorMessage(err error) string {
	message := strings.TrimSpace(err.Error())
	if runes := []rune(message); len(runes) > 200 {
		message = string(runes[:200])
	}
	return message
}

// batchCard renders the trigger, progress, or the last run's summary.
func (s *Session) batchCard(cx *core.Scope) core.Node {
	b := s.batch
	if b == nil {
		return nil
	}
	style := core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
		Padding: core.Symmetric(10, 14), Margin: core.Edges{Left: 12, Right: 12, Top: 8},
		Wrap: core.Wrap}
	bannerFunc := func() core.Style {
		colors := ui.ColorsOf(cx)
		return core.Style{Background: colors.Inset(), CornerRadius: radiusCard,
			BorderWidth: 1, BorderColor: colors.Border()}
	}

	switch {
	case b.running:
		text := locales.DocumentsBatchProgress(cx, strconv.Itoa(b.done), strconv.Itoa(b.total))
		if names := currentBatchNames(b.current); names != "" {
			text += " · " + names
		}
		if b.failed > 0 {
			text += " · " + strconv.Itoa(b.failed) + " × " + locales.DocumentsBatchReasonError(cx)
		}
		return core.View{Style: style, StyleFunc: bannerFunc, Children: []core.Node{
			core.Text{Content: text, Style: core.Style{FontSize: typeCaption,
				FontVariant: core.FontTabularNums, FlexGrow: 1},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
			ui.Button{Text: locales.DocumentsBatchCancel(cx), Variant: ui.ButtonSecondary,
				OnPress: func() {
					b.cancel.Store(true)
					if b.cancelFn != nil {
						b.cancelFn()
					}
					b.rev.Set(b.rev.Get() + 1)
				},
				TestID: "documents-batch-cancel"},
		}}
	case b.finished:
		text := locales.DocumentsBatchSummaryToast(cx, strconv.Itoa(b.ok), strconv.Itoa(b.failed))
		if b.canceled {
			text = locales.DocumentsBatchCanceledToast(cx, strconv.Itoa(b.done), strconv.Itoa(b.total))
		}
		children := []core.Node{
			core.Text{Content: text, Style: core.Style{FontSize: typeCaption, FontWeight: ui.Semibold,
				FontVariant: core.FontTabularNums},
				MaxLines: 2},
		}
		if len(b.failures) > 0 {
			children = append(children, s.batchFailures(cx)...)
		}
		finished := style
		finished.Direction = core.Column
		finished.AlignItems = core.AlignStretch
		return core.View{Style: finished, StyleFunc: bannerFunc, Children: children}
	default:
		docs := s.batchCandidates()
		if len(docs) == 0 || !s.llmProvider(cx).Configured() {
			return nil
		}
		count := strconv.Itoa(len(docs))
		return core.View{Style: style, StyleFunc: bannerFunc, Children: []core.Node{
			core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.Text{Content: locales.DocumentsBatchHint(cx, count),
						Style: core.Style{FontSize: typeCaption, FontVariant: core.FontTabularNums},
						MaxLines: 2},
				}},
			ui.Button{Text: locales.DocumentsBatchButton(cx, count), Variant: ui.ButtonSecondary,
				OnPress: func() { s.startBatch(cx, docs) },
				TestID:  "documents-batch"},
		}}
	}
}

func (s *Session) batchFailures(cx *core.Scope) []core.Node {
	b := s.batch
	if b == nil || len(b.failures) == 0 {
		return nil
	}
	out := []core.Node{core.Text{Content: locales.DocumentsBatchFailuresHeading(cx),
		Style:     core.Style{FontSize: 11, FontWeight: ui.Semibold},
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}}
	for _, failure := range b.failures {
		reason := locales.DocumentsBatchReasonError(cx)
		if failure.Reason == "classify_failed" {
			reason = locales.DocumentsBatchReasonClassifyFailed(cx)
		}
		text := failure.Filename + " — " + reason
		if failure.Detail != "" {
			text += ": " + failure.Detail
		}
		out = append(out, core.Text{Content: text, Style: core.Style{FontSize: 11},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger), MaxLines: 2})
	}
	return out
}

// batchRowBadge is the per-row "Extracting..." marker while the worker owns a
// document. It replaces the status chip so the row reads as in-flight.
func (s *Session) batchRowBadge(cx *core.Scope, documentID string) (string, bool) {
	if s.batch == nil || !s.batch.running {
		return "", false
	}
	if _, ok := s.batch.current[documentID]; !ok {
		return "", false
	}
	return locales.DocumentsExtractionRunning(cx), true
}

func currentBatchNames(current map[string]string) string {
	if len(current) == 0 {
		return ""
	}
	names := make([]string, 0, len(current))
	for _, name := range current {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, " · ")
}
