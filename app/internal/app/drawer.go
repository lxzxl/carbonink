package app

import (
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// sideDrawer is the app's right-side panel, the NSGo counterpart of 1.x's
// vaul drawers: a title bar with a close button, a scrolling body, and an
// optional footer of actions.
func sideDrawer(cx *core.Scope, open *core.Signal[bool], title string, width core.Points,
	body []core.Node, footer []core.Node, testID string, closeLabel string) core.Node {
	colors := ui.ColorsOf(cx)
	if closeLabel == "" {
		closeLabel = locales.DataCancel(cx)
	}
	header := core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
			Padding: core.Symmetric(14, 16), Borders: core.Edges{Bottom: 1}},
		StyleFunc: func() core.Style { return core.Style{BorderColor: colors.Line()} },
		Children: []core.Node{
			core.Text{Content: title, Style: core.Style{FontSize: 15, FontWeight: ui.Semibold,
				FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
			ui.IconButton{Icon: lucide.X, Label: closeLabel, Size: 28,
				OnPress: func() { open.Set(false) }, TestID: testID + "-close"},
		},
	}
	children := []core.Node{header, core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{Style: core.Style{Padding: core.All(16), Gap: 16},
			Children: body}},
	}}
	if len(footer) > 0 {
		children = append(children, core.View{
			Style: core.Style{Direction: core.Row, Wrap: core.Wrap, AlignItems: core.AlignCenter,
				JustifyContent: core.JustifyEnd, Gap: 8, Padding: core.Symmetric(12, 16),
				Borders: core.Edges{Top: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: colors.Line()} },
			Children:  footer,
		})
	}
	return base.Sheet{
		Open: open.Get,
		OnOpenChange: func(value bool, _ base.Reason) {
			open.Set(value)
		},
		Side:          core.PlaceRight,
		Label:         title,
		TestID:        testID,
		BackdropStyle: core.Style{Background: ui.Black(0.32)},
		PopupStyleFunc: func() core.Style {
			return core.Style{Width: core.Pt(width), Background: colors.Surface(),
				Borders: core.Edges{Left: 1}, BorderColor: colors.Line()}
		},
		Children: children,
	}
}
