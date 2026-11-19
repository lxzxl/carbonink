// Command carbonink-spike is the NSGo feasibility harness for the
// Electron-to-NSGo migration. It is not the product: each screen answers one
// question from docs/plans/2026-11-19-nsgo-migration.md, Phase 0.
package main

import (
	"app.carbonink.desktop/internal/spike"

	"github.com/nsgo-dev/nsgo"
	"github.com/nsgo-dev/nsgo/core"
)

// Root is the app's first screen.
func Root(cx *core.Scope) core.Node { return spike.Shell(cx) }

func main() {
	nsgo.Run(Root, nsgo.WindowSize(1280, 820))
}
