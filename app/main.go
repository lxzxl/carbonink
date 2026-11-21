// Command carbonink is the NSGo desktop app. Phase 1 opens the active
// workspace and shows its activity ledger; later phases fill in the rest.
package main

import (
	"app.carbonink.desktop/internal/app"

	"github.com/nsgo-dev/nsgo"
	"github.com/nsgo-dev/nsgo/core"
)

// Root is the app's first screen.
func Root(cx *core.Scope) core.Node { return app.Root(cx) }

func main() {
	nsgo.Run(Root, nsgo.WindowSize(1280, 820))
}
