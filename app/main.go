// Command carbonink is the NSGo desktop app. Phase 1 opens the active
// workspace and shows its activity ledger; later phases fill in the rest.
package main

import (
	"app.carbonink.desktop/internal/app"
	"app.carbonink.desktop/internal/platform"
	"app.carbonink.desktop/internal/prefs"

	"github.com/nsgo-dev/nsgo"
	"github.com/nsgo-dev/nsgo/core"
)

// Root is the app's first screen.
func Root(cx *core.Scope) core.Node { return app.Root(cx) }

func main() {
	opts := []nsgo.Option{nsgo.WindowSize(1280, 820)}
	dataDir := platform.DataDir("app.carbonink.desktop.beta")
	if settings, err := prefs.Load(prefs.Path(dataDir)); err == nil {
		if w := settings.Window; w != nil && w.Width >= 640 && w.Height >= 480 {
			opts = append(opts, nsgo.WindowFrame(core.WindowFrame{
				X: core.Points(w.X), Y: core.Points(w.Y),
				Width: core.Points(w.Width), Height: core.Points(w.Height),
				Move: true,
			}))
		}
		switch settings.Theme {
		case "light":
			opts = append(opts, nsgo.Appearance(core.AppearanceLight))
		case "dark":
			opts = append(opts, nsgo.Appearance(core.AppearanceDark))
		}
	}
	nsgo.Run(Root, opts...)
}
