// Package spike is the Phase 0 feasibility harness. Each screen answers one
// question from docs/plans/2026-11-19-nsgo-migration.md and is meant to be
// deleted once the go/no-go decision is recorded.
package spike

import (
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// Screen names one experiment.
type Screen string

const (
	ScreenActivities Screen = "activities"
	ScreenPDFPreview Screen = "pdf-preview"
	ScreenPDFText    Screen = "pdf-text"
	ScreenReportPDF  Screen = "report-pdf"
	ScreenLLM        Screen = "llm"
)

type screenInfo struct {
	ID     Screen
	Title  string
	Blurb  string
	Icon   func() *core.SVG
	Render func(cx *core.Scope) core.Node
}

var screens = []screenInfo{
	{ID: ScreenActivities, Title: "Activities", Blurb: "base/datatable over 10,000 activity rows: sort, resize, scroll.",
		Icon: lucide.Table, Render: activitiesScreen},
	{ID: ScreenPDFPreview, Title: "PDF preview", Blurb: "core.WebView over a loopback server, the platform's own PDF viewer.",
		Icon: lucide.FileText, Render: pdfPreviewScreen},
	{ID: ScreenPDFText, Title: "PDF text", Blurb: "Pure-Go text extraction over the real fixture corpus, with per-file timing.",
		Icon: lucide.ScanText, Render: pdfTextScreen},
	{ID: ScreenReportPDF, Title: "Report PDF", Blurb: "CJK report layout generated in Go, then opened in the system viewer.",
		Icon: lucide.FileDown, Render: reportScreen},
	{ID: ScreenLLM, Title: "LLM adapter", Blurb: "OpenAI-compatible streaming, tool calls and schema validation against a fixture server.",
		Icon: lucide.Sparkles, Render: llmScreen},
}

// Shell is the harness window.
func Shell(cx *core.Scope) core.Node {
	active := core.NewSignal(cx, ScreenActivities)
	open := core.NewSignal(cx, true)

	var nav []core.Node
	nav = append(nav, core.View{
		Style: core.Style{Padding: core.Symmetric(10, 12), Gap: 2},
		Children: []core.Node{
			core.Text{Content: "CarbonInk 2.0", Style: core.Style{FontSize: 15, FontWeight: ui.Bold}},
			core.Text{Content: "NSGo feasibility harness", Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		},
	})
	for _, s := range screens {
		s := s
		nav = append(nav, ui.SidebarButton{
			Text:     s.Title,
			Icon:     s.Icon,
			Selected: func() bool { return active.Get() == s.ID },
			OnPress:  func() { active.Set(s.ID) },
			TestID:   "nav:" + string(s.ID),
		})
	}
	nav = append(nav, core.View{Style: core.Style{Height: core.Pt(1), Background: ui.ColorsOf(cx).Border(),
		Margin: core.Symmetric(8, 4)}})
	nav = append(nav, core.Text{Content: "Phase 0 · not the product", Style: core.Style{FontSize: 11},
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)})

	byID := func(id Screen) screenInfo {
		for _, s := range screens {
			if s.ID == id {
				return s
			}
		}
		return screens[0]
	}
	var content []core.Node
	for _, s := range screens {
		s := s
		content = append(content, core.Show{
			When: func() bool { return active.Get() == s.ID },
			Then: s.Render,
		})
	}

	return ui.SidebarShell{
		Variant:      ui.SidebarShellInset,
		Open:         open.Get,
		OnOpenChange: open.Set,
		ToggleLabel:  "Toggle sidebar",
		Sidebar:      []core.Node{core.View{Style: core.Style{Gap: 2, Padding: core.Symmetric(4, 0)}, Children: nav}},
		Header: []core.Node{
			core.View{Style: core.Style{Gap: 2}, Children: []core.Node{
				core.Text{ContentFunc: func() string { return byID(active.Get()).Title },
					Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
				core.Text{ContentFunc: func() string { return byID(active.Get()).Blurb },
					Style: core.Style{FontSize: 12}, MaxLines: 1},
			}},
		},
		Content: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
				Children: content},
		},
		TestID: "shell",
	}
}

// panel is the common body of an experiment: a scrolling column of sections.
func panel(cx *core.Scope, children ...core.Node) core.Node {
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style:    core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: children,
		}},
	}
}

// card wraps content in the app's card look.
func card(cx *core.Scope, children ...core.Node) core.Node {
	style := ui.CardStyle(cx)
	style.Gap = 10
	style.Padding = core.All(14)
	style.AlignSelf = core.AlignStretch
	return core.View{Style: style, Children: children}
}

// label is a small section title.
func label(cx *core.Scope, text string) core.Node {
	return core.Text{Content: text, Style: core.Style{FontSize: 12, FontWeight: ui.Semibold},
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
}

// mono is a monospaced block.
func mono(cx *core.Scope, text string) core.Node {
	return core.Scroll{
		Style: core.Style{MaxHeight: core.Pt(320), Background: ui.ColorsOf(cx).Inset(), CornerRadius: 6,
			Padding: core.All(10)},
		Children: []core.Node{core.Text{Content: text, Style: core.Style{FontSize: 12, FontFamily: "monospace"}}},
	}
}
