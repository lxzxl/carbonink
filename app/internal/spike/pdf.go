package spike

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"github.com/ledongthuc/pdf"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/ui"
)

func pdfPreviewScreen(cx *core.Scope) core.Node {
	files := pdfFixtures()
	selected := core.NewSignal(cx, files[0])
	base, err := pdfServer()

	var tabs []core.Node
	for _, f := range files {
		f := f
		tabs = append(tabs, ui.Button{
			Text:    filepath.Base(f),
			Variant: ui.ButtonGhost,
			Size:    ui.SizeSmall,
			OnPress: func() { selected.Set(f) },
		})
	}
	if err != nil {
		return panel(cx, card(cx,
			label(cx, "Loopback server failed"),
			core.Text{Content: err.Error(), Style: core.Style{FontSize: 13}},
		))
	}

	return panel(cx,
		core.View{Style: core.Style{Direction: core.Row, Gap: 4, Wrap: core.Wrap}, Children: tabs},
		core.View{Style: core.Style{Height: core.Pt(620), BorderWidth: 1, BorderColor: ui.ColorsOf(cx).Border(),
			CornerRadius: 8, Overflow: core.Hidden}, Children: []core.Node{
			core.WebView{
				TestID: "pdf-view",
				SourceFunc: func() core.WebSource {
					return core.WebSrc(base + "/pdf/" + filepath.Base(selected.Get()))
				},
				Style: core.Style{FlexGrow: 1},
			},
		}},
		core.View{Style: core.Style{Direction: core.Row, Gap: 8, AlignItems: core.AlignCenter}, Children: []core.Node{
			core.Text{ContentFunc: func() string { return base + "/pdf/" + filepath.Base(selected.Get()) },
				Style: core.Style{FontSize: 11, FontFamily: "monospace"}, MaxLines: 1},
			core.View{Style: core.Style{FlexGrow: 1}},
			ui.Button{Text: "Open in system viewer", Variant: ui.ButtonSecondary, Size: ui.SizeSmall,
				OnPress: func() {
					data, err := fixtureBytes(selected.Get())
					if err != nil {
						return
					}
					out := filepath.Join(os.TempDir(), filepath.Base(selected.Get()))
					if os.WriteFile(out, data, 0o644) == nil {
						openPDF(cx, out)
					}
				}},
		}},
	)
}

type extractResult struct {
	Name    string
	Pages   int
	Runes   int
	Elapsed time.Duration
	Err     string
	Text    string
}

func pdfTextScreen(cx *core.Scope) core.Node {
	files := pdfFixtures()
	results := core.NewSignalFunc(cx, []extractResult(nil), nil)
	selected := core.NewSignal(cx, 0)
	running := core.NewSignal(cx, false)

	run := func() {
		running.Set(true)
		var out []extractResult
		for _, f := range files {
			data, err := fixtureBytes(f)
			if err != nil {
				out = append(out, extractResult{Name: filepath.Base(f), Err: err.Error()})
				continue
			}
			start := time.Now()
			text, pages, err := extractPDFText(data)
			r := extractResult{Name: filepath.Base(f), Pages: pages, Runes: len([]rune(text)),
				Elapsed: time.Since(start), Text: text}
			if err != nil {
				r.Err = err.Error()
			}
			out = append(out, r)
		}
		results.Set(out)
		selected.Set(0)
		running.Set(false)
	}

	return panel(cx,
		card(cx,
			label(cx, "Pure-Go extraction"),
			core.Text{Content: "The same six fixture PDFs the Electron tests use, read with github.com/ledongthuc/pdf. Accuracy on Chinese text is the go/no-go item: if this is not good enough, the fallback is provider-native PDF input or a small document sidecar.", Style: core.Style{FontSize: 13}},
			core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
				ui.Button{Text: "Extract all", OnPress: run, Busy: running.Get},
				ui.Button{Text: "Open folder", Variant: ui.ButtonSecondary, OnPress: func() {
					desktop.RevealFile(cx, mustAbs("internal/spike/fixtures/pdf"), nil)
				}},
			}},
		),
		card(cx,
			label(cx, "Results"),
			core.View{Style: core.Style{Gap: 6}, Children: []core.Node{
				core.Text{ContentFunc: func() string {
					rs := results.Get()
					if len(rs) == 0 {
						return "Not run yet."
					}
					var b strings.Builder
					for _, r := range rs {
						if r.Err != "" {
							fmt.Fprintf(&b, "%-28s %5d pages  %7d runes  %8s  ERROR: %s\n", r.Name, r.Pages, r.Runes, r.Elapsed.Round(time.Millisecond), r.Err)
						} else {
							fmt.Fprintf(&b, "%-28s %5d pages  %7d runes  %8s\n", r.Name, r.Pages, r.Runes, r.Elapsed.Round(time.Millisecond))
						}
					}
					return b.String()
				}, Style: core.Style{FontSize: 12, FontFamily: "monospace"}},
			}},
		),
		card(cx,
			label(cx, "Extracted text (first 1,500 runes)"),
			core.Text{ContentFunc: func() string {
				rs := results.Get()
				if len(rs) == 0 {
					return "Run the extraction first."
				}
				i := selected.Get()
				if i < 0 || i >= len(rs) {
					i = 0
				}
				t := []rune(rs[i].Text)
				if len(t) > 1500 {
					t = t[:1500]
				}
				return string(t)
			}, Style: core.Style{FontSize: 12}},
		),
	)
}

// extractPDFText reads every page's plain text. The library panics on some
// malformed files, so a panic becomes an error instead of taking the app down.
func extractPDFText(data []byte) (text string, pages int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
		}
	}()
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", 0, err
	}
	pages = r.NumPage()
	var b strings.Builder
	for i := 1; i <= pages; i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		s, err := p.GetPlainText(nil)
		if err != nil {
			return b.String(), pages, fmt.Errorf("page %d: %w", i, err)
		}
		b.WriteString(s)
		b.WriteString("\n")
	}
	return b.String(), pages, nil
}

func mustAbs(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}
