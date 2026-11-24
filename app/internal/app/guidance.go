package app

import (
	"strconv"

	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// tourStep is one card of a tour: the copy 1.x showed in a popover.
type tourStep struct {
	title func(*core.Scope) string
	body  func(*core.Scope) string
}

// tours holds the 1.x guidance copy, grouped by the screen it explains. The
// report bundle step is left out: 2.0 exports PDF and Excel but does not yet
// write the ZIP deliverable, and a tour must not describe a missing control.
var tours = map[string][]tourStep{
	"questionnaires": {
		{locales.GuidanceQuestionnairesNewTitle, locales.GuidanceQuestionnairesNewBody},
		{locales.GuidanceQuestionnairesListTitle, locales.GuidanceQuestionnairesListBody},
	},
	"extraction": {
		{locales.GuidanceExtractionStageTitle, locales.GuidanceExtractionStageBody},
		{locales.GuidanceExtractionActionsTitle, locales.GuidanceExtractionActionsBody},
		{locales.GuidanceExtractionSwitchTitle, locales.GuidanceExtractionSwitchBody},
	},
	"answer-review": {
		{locales.GuidanceAnswerCardTitle, locales.GuidanceAnswerCardBody},
		{locales.GuidanceAnswerActionsTitle, locales.GuidanceAnswerActionsBody},
		{locales.GuidanceAnswerBulkTitle, locales.GuidanceAnswerBulkBody},
	},
	"ef-rebind": {
		{locales.GuidanceRebindCurrentTitle, locales.GuidanceRebindCurrentBody},
		{locales.GuidanceRebindPickerTitle, locales.GuidanceRebindPickerBody},
		{locales.GuidanceRebindConfirmTitle, locales.GuidanceRebindConfirmBody},
	},
	"report-export": {
		{locales.GuidanceReportScopeTitle, locales.GuidanceReportScopeBody},
		{locales.GuidanceReportExportTitle, locales.GuidanceReportExportBody},
	},
}

// guidance is one screen's position in its tour. A panel lives as long as the
// screen does, so stepping Back and Next keeps its place across re-renders.
type guidance struct {
	id   string
	step *core.Signal[int]
	seen *core.Signal[bool]
}

func newGuidance(cx *core.Scope, s *Session, id string) *guidance {
	return &guidance{id: id, step: core.NewSignal(cx, 0), seen: core.NewSignal(cx, s.guidanceSeen(id))}
}

// node draws the tour card while it has steps left, guidance is on, and the
// screen's ready condition holds, re-rendering as the step changes. Finishing
// or skipping records the tour so it never returns unless the user replays the
// tours in Settings.
func (g *guidance) node(s *Session, ready func() bool) core.Node {
	return core.Dynamic(func(cx *core.Scope) core.Node { return g.render(cx, s, ready) })
}

func (g *guidance) render(cx *core.Scope, s *Session, ready func() bool) core.Node {
	if g == nil || s.settings.GuidanceDisabled {
		return core.View{}
	}
	steps, ok := tours[g.id]
	if !ok || g.seen.Get() || !ready() {
		return core.View{}
	}
	index := g.step.Get()
	if index < 0 || index >= len(steps) {
		return core.View{}
	}
	finish := func() {
		s.markGuidanceSeen(g.id)
		g.seen.Set(true)
	}

	current := steps[index]
	nav := []core.Node{}
	if index > 0 {
		nav = append(nav, ui.Button{Text: locales.GuidanceBack(cx), Variant: ui.ButtonGhost,
			OnPress: func() { g.step.Set(index - 1) }, TestID: "guidance-" + g.id + "-back"})
	}
	if index+1 < len(steps) {
		nav = append(nav, ui.Button{Text: locales.GuidanceNext(cx),
			OnPress: func() { g.step.Set(index + 1) }, TestID: "guidance-" + g.id + "-next"})
	} else {
		nav = append(nav, ui.Button{Text: locales.GuidanceDone(cx), OnPress: finish,
			TestID: "guidance-" + g.id + "-done"})
	}

	status := ui.Badge{Text: locales.GuidanceProgress(cx, strconv.Itoa(index+1),
		strconv.Itoa(len(steps))), Variant: ui.BadgeNeutral}

	colors := ui.ColorsOf(cx)
	return core.View{
		TestID: "guidance-" + g.id,
		Style: core.Style{Gap: 8, Padding: core.All(14), CornerRadius: ui.RadiusCard,
			BorderWidth: 1, Margin: core.Edges{Top: 12, Left: 16, Right: 16, Bottom: 12}},
		StyleFunc: func() core.Style {
			return core.Style{BorderColor: ui.Alpha(colors.Accent(), 0.45),
				Background: ui.Alpha(colors.Accent(), 0.06)}
		},
		Children: []core.Node{
			core.Text{Content: current.title(cx), Style: core.Style{FontSize: 14,
				FontWeight: ui.Semibold}, MaxLines: 2},
			core.View{Style: core.Style{Direction: core.Row}, Children: []core.Node{status}},
			core.Text{Content: current.body(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(colors.Muted), MaxLines: 6},
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Wrap: core.Wrap, Gap: 8}, Children: append(nav,
				core.View{Style: core.Style{FlexGrow: 1}},
				ui.Button{Text: locales.GuidanceSkip(cx), Variant: ui.ButtonGhost,
					OnPress: finish, TestID: "guidance-" + g.id + "-skip"})},
		},
	}
}

// guidanceSeen reports whether a tour was finished or skipped.
func (s *Session) guidanceSeen(id string) bool {
	for _, seen := range s.settings.GuidanceSeen {
		if seen == id {
			return true
		}
	}
	return false
}

// markGuidanceSeen records a tour in prefs so it survives a restart.
func (s *Session) markGuidanceSeen(id string) {
	if s.guidanceSeen(id) {
		return
	}
	s.settings.GuidanceSeen = append(s.settings.GuidanceSeen, id)
	if err := prefs.Save(s.prefsPath, s.settings); err != nil && s.log != nil {
		s.log.Warn("save guidance state failed", "err", err)
	}
}

// resetGuidance makes every tour play again on the next visit to its screen.
func (s *Session) resetGuidance() {
	s.settings.GuidanceSeen = nil
	if err := prefs.Save(s.prefsPath, s.settings); err != nil && s.log != nil {
		s.log.Warn("reset guidance state failed", "err", err)
	}
}
