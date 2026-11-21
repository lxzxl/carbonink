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
