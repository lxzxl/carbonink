package app

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestCardHeaderStacksWhenNarrow proves a card header at 640 points keeps its
// detail inside the window and moves its action below the copy.
func TestCardHeaderStacksWhenNarrow(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(640, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	openSettings(ui, "efLibrary")
	body := ui.WaitFor("text:Bring your own factors", 5*time.Second)
	action := ui.WaitFor("text:Import library", 5*time.Second)
	bodyBounds, actionBounds := body.Bounds(), action.Bounds()
	if right := bodyBounds.Origin.X + bodyBounds.Size.Width; right > 640 {
		t.Fatalf("the copy ends at %v, past the 640-point window", right)
	}
	if actionBounds.Origin.Y < bodyBounds.Origin.Y+bodyBounds.Size.Height {
		t.Errorf("the action's top %v is beside copy ending at %v; want it below",
			actionBounds.Origin.Y, bodyBounds.Origin.Y+bodyBounds.Size.Height)
	}
}
