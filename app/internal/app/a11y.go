package app

import (
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// namedNode gives a text field the label the form shows above it, so assistive
// technology reads the same words a sighted user reads. A field that names
// itself, or is not a text field, comes back unchanged.
func namedNode(node core.Node, label func() string) core.Node {
	in, ok := node.(ui.Input)
	if !ok || in.Label != "" || in.LabelFunc != nil {
		return node
	}
	in.LabelFunc = label
	return in
}

// dataClickableRow gives a list row the pointer and keyboard feedback a
// pressable surface needs: a hover wash and a focus-visible ring.
func dataClickableRow(cx *core.Scope, testID string, onPress func(), children ...core.Node) core.View {
	return core.View{
		TestID: testID,
		Role:   core.RoleButton,
		OnPress: func(core.PressEvent) {
			onPress()
		},
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12,
			Padding: core.Symmetric(10, 8), CornerRadius: 6, Borders: core.Edges{Bottom: 1}},
		StyleFunc: func() core.Style {
			colors := ui.ColorsOf(cx)
			return core.Style{
				BorderColor:  colors.Line(),
				Hover:        &core.Style{Background: colors.Hover()},
				FocusVisible: ui.FocusRing(cx, -2),
			}
		},
		Children: children,
	}
}
