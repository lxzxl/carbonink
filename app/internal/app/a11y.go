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
	return dataClickableRowSelected(cx, testID, onPress, nil, children...)
}

// dataClickableRowSelected is dataClickableRow with the 1.x selected-row
// wash while selected reports true.
func dataClickableRowSelected(cx *core.Scope, testID string, onPress func(),
	selected func() bool, children ...core.Node) core.View {
	return dataClickableRowBordered(cx, testID, onPress, selected, true, children...)
}

// dataClickableRowBordered renders an interactive list row with hover wash,
// focus ring, selection tint, and an optional bottom hairline divider.
func dataClickableRowBordered(cx *core.Scope, testID string, onPress func(),
	selected func() bool, bottomBorder bool, children ...core.Node) core.View {
	var borders core.Edges
	if bottomBorder {
		borders = core.Edges{Bottom: 1}
	}
	return core.View{
		TestID: testID,
		Role:   core.RoleButton,
		OnPress: func(core.PressEvent) {
			onPress()
		},
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12,
			Padding: core.Symmetric(10, 16), CornerRadius: radiusItem, Borders: borders},
		StyleFunc: func() core.Style {
			colors := ui.ColorsOf(cx)
			style := core.Style{
				BorderColor:  colors.Line(),
				Hover:        &core.Style{Background: colors.Hover()},
				FocusVisible: ui.FocusRing(cx, -2),
			}
			if selected != nil && selected() {
				style.Background = selectionTint(cx)
				style.Hover = &core.Style{Background: selectionHoverTint(cx)}
			}
			return style
		},
		Children: children,
	}
}
