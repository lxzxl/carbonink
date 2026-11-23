package app

import (
	"slices"
	"strconv"
	"time"

	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

type monthBucket struct {
	label string
	short string
	total float64
}

// buildMonthBuckets sums activities into the reporting period's twelve
// calendar months. Activities outside that year are ignored.
func buildMonthBuckets(activities []store.Activity, year int) []monthBucket {
	buckets := make([]monthBucket, 0, 12)
	index := make(map[string]int, 12)
	for month := 1; month <= 12; month++ {
		at := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.Local)
		label := at.Format("2006-01")
		index[label] = len(buckets)
		buckets = append(buckets, monthBucket{label: label, short: strconv.Itoa(month)})
	}
	for _, activity := range activities {
		if len(activity.OccurredAtEnd) < 7 {
			continue
		}
		if i, ok := index[activity.OccurredAtEnd[:7]]; ok {
			buckets[i].total += activity.CO2eKg
		}
	}
	return buckets
}

// recentActivities returns the five newest rows by their end date, newest
// first. The dashboard shows the latest reporting period's ledger.
func recentActivities(activities []store.Activity) []store.Activity {
	recent := slices.Clone(activities)
	slices.SortStableFunc(recent, func(a, b store.Activity) int {
		switch {
		case a.OccurredAtEnd > b.OccurredAtEnd:
			return -1
		case a.OccurredAtEnd < b.OccurredAtEnd:
			return 1
		default:
			return 0
		}
	})
	if len(recent) > 5 {
		recent = recent[:5]
	}
	return recent
}

// latestPeriodActivities is the ledger of the period the totals card shows.
func (s *Session) latestPeriodActivities() []store.Activity {
	if len(s.periods) == 0 {
		return nil
	}
	periodID := s.periods[len(s.periods)-1].ID
	out := make([]store.Activity, 0, len(s.activities))
	for _, activity := range s.activities {
		if activity.ReportingPeriodID == periodID {
			out = append(out, activity)
		}
	}
	return out
}

// dashboardWidgets is the monthly trend and recent ledger shown once the
// current period has emissions. It is the same pair, and the same newness
// rule, as the 1.x dashboard.
func (s *Session) dashboardWidgets(cx *core.Scope, active *core.Signal[Screen]) core.Node {
	activities := s.latestPeriodActivities()
	if s.totals.TotalKg == 0 || len(activities) == 0 {
		return core.View{}
	}
	year := time.Now().Year()
	if len(s.periods) > 0 {
		year = s.periods[len(s.periods)-1].Year
	}
	monthly := s.monthlyTrendCard(cx, activities, year)
	recent := s.recentActivitiesCard(cx, activities, active)
	if cx.Env().Window().Width < 900 {
		return core.View{Style: core.Style{Gap: 12}, Children: []core.Node{monthly, recent}}
	}
	return core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignStretch, Gap: 12},
		Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 3, FlexBasis: core.Pt(0)}, Children: []core.Node{
				monthly,
			}},
			core.View{Style: core.Style{FlexGrow: 2, FlexBasis: core.Pt(0)}, Children: []core.Node{
				recent,
			}},
		},
	}
}

// readinessHomeCard is the 1.x dashboard's entry point to the readiness
// review. It is a link, not a live count: running the sweep writes an audit
// event, so visiting the dashboard must not trigger it.
func (s *Session) readinessHomeCard(cx *core.Scope, active *core.Signal[Screen]) core.Node {
	if s.totals.TotalKg == 0 || len(s.periods) == 0 {
		return core.View{}
	}
	return core.View{TestID: "dashboard-readiness", Children: []core.Node{
		dataCard(cx,
			dataHeaderRow(cx,
				core.View{Style: core.Style{Gap: 3, FlexShrink: 1,
					MinWidth: core.Pt(0)}, Children: []core.Node{
					core.Text{Content: locales.ReadinessHomeCardTitle(cx),
						Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
					core.Text{Content: locales.ReadinessDescription(cx),
						Style:     core.Style{FontSize: 12},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				}},
				ui.Button{Text: locales.ReadinessHomeCardCta(cx), Variant: ui.ButtonSecondary,
					OnPress: func() { active.Set(ScreenReports) },
					TestID:  "dashboard-readiness-open"}),
		),
	}}
}

func (s *Session) monthlyTrendCard(cx *core.Scope, activities []store.Activity, year int) core.Node {
	buckets := buildMonthBuckets(activities, year)
	maxTotal := 0.0
	for _, bucket := range buckets {
		maxTotal = max(maxTotal, bucket.total)
	}

	children := []core.Node{dataHeading(cx, locales.DashboardMonthlyTrend(cx), "")}
	if maxTotal == 0 {
		children = append(children,
			core.Text{Content: locales.DashboardNoDataForChart(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2})
		return core.View{TestID: "dashboard-monthly-trend", Children: []core.Node{dataCard(cx, children...)}}
	}

	bars := make([]core.Node, 0, len(buckets))
	for _, bucket := range buckets {
		height := core.Points(2)
		if bucket.total > 0 {
			height = core.Points(max(2, bucket.total/maxTotal*104))
		}
		bars = append(bars, core.View{
			TestID: "dashboard-trend-" + bucket.label,
			Style:  core.Style{FlexGrow: 1, FlexBasis: core.Pt(0), Gap: 4},
			Children: []core.Node{
				core.View{Style: core.Style{Height: core.Pt(112), JustifyContent: core.JustifyEnd},
					Children: []core.Node{core.View{
						Style: core.Style{Height: core.Pt(height), CornerRadius: 2, Opacity: core.Alpha(0.6)},
						StyleFunc: func() core.Style {
							return core.Style{Background: ui.ColorsOf(cx).Accent()}
						},
					}}},
				core.Text{Content: bucket.short, Style: core.Style{FontSize: 9, TextAlign: core.TextAlignCenter},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			},
		})
	}
	children = append(children, core.View{
		TestID:   "dashboard-trend",
		Style:    core.Style{Direction: core.Row, AlignItems: core.AlignEnd, Gap: 3},
		Children: bars,
	})
	return core.View{TestID: "dashboard-monthly-trend", Children: []core.Node{dataCard(cx, children...)}}
}

func (s *Session) recentActivitiesCard(cx *core.Scope, activities []store.Activity,
	active *core.Signal[Screen]) core.Node {
	recent := recentActivities(activities)
	children := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1, MinWidth: core.Pt(0)}, Children: []core.Node{
				core.Text{Content: locales.DashboardRecentActivities(cx),
					Style: core.Style{FontSize: 14, FontWeight: ui.Semibold}},
			}},
			ui.Button{Text: locales.DashboardWidgetViewAll(cx), Variant: ui.ButtonGhost, Size: ui.SizeSmall,
				OnPress: func() { active.Set(ScreenActivities) }, TestID: "dashboard-recent-view-all"},
		}},
	}
	if len(recent) == 0 {
		children = append(children,
			core.Text{Content: locales.DashboardRecentEmpty(cx), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		return core.View{TestID: "dashboard-recent", Children: []core.Node{dataCard(cx, children...)}}
	}

	rows := make([]core.Node, 0, len(recent))
	for _, activity := range recent {
		rows = append(rows, core.View{
			TestID: "dashboard-recent-" + activity.ID,
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(7, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, Children: []core.Node{
					core.Text{Content: activity.Source,
						Style: core.Style{FontSize: 12, FontWeight: ui.Medium,
							FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
						MaxLines: 1},
				}},
				core.Text{Content: activityEndDate(activity), Style: core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				core.View{Style: core.Style{Width: core.Pt(12)}},
				core.Text{Content: commaFloat(activity.CO2eKg) + " " + locales.UnitKgCo2e(cx),
					Style: core.Style{FontSize: 12, FontWeight: ui.Medium, FlexShrink: 0}, MaxLines: 1},
			},
		})
	}
	children = append(children, core.View{Style: core.Style{Gap: 0}, Children: rows})
	return core.View{TestID: "dashboard-recent", Children: []core.Node{dataCard(cx, children...)}}
}

// activityEndDate is the dashboard's date: 1.x shows occurred_at_end there,
// while the ledger list shows the start date.
func activityEndDate(activity store.Activity) string {
	if len(activity.OccurredAtEnd) >= 10 {
		return activity.OccurredAtEnd[:10]
	}
	return activity.OccurredAtEnd
}
