package app

import (
	"slices"
	"strconv"
	"strings"
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

// buildMonthBuckets spreads each activity's emissions across the days it
// covers, then sums those day shares into the reporting period's twelve
// calendar months. A year-long activity therefore shows in every month
// instead of landing in whichever month its end date falls.
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
		start, end, ok := activityDateRange(activity)
		if !ok {
			continue
		}
		totalDays := int(end.Sub(start).Hours()/24) + 1
		if totalDays <= 0 {
			continue
		}
		for month := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC); !month.After(end); month = month.AddDate(0, 1, 0) {
			monthEnd := month.AddDate(0, 1, 0).AddDate(0, 0, -1)
			from := start
			if month.After(from) {
				from = month
			}
			to := end
			if monthEnd.Before(to) {
				to = monthEnd
			}
			if to.Before(from) {
				continue
			}
			i, inYear := index[month.Format("2006-01")]
			if !inYear {
				continue
			}
			days := int(to.Sub(from).Hours()/24) + 1
			buckets[i].total += activity.CO2eKg * float64(days) / float64(totalDays)
		}
	}
	return buckets
}

// activityDateRange reads the start and end dates, falling back to whichever
// one the row has. Bad dates are ignored rather than counted in one month.
func activityDateRange(activity store.Activity) (time.Time, time.Time, bool) {
	start, startOK := parseActivityDate(activity.OccurredAt)
	end, endOK := parseActivityDate(activity.OccurredAtEnd)
	switch {
	case startOK && endOK:
	case startOK:
		end = start
	case endOK:
		start = end
	default:
		return time.Time{}, time.Time{}, false
	}
	if end.Before(start) {
		start, end = end, start
	}
	return start, end, true
}

func parseActivityDate(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if len(value) < 10 {
		return time.Time{}, false
	}
	parsed, err := time.Parse("2006-01-02", value[:10])
	return parsed, err == nil
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
func (s *Session) dashboardWidgets(cx *core.Scope, nav *screenNav) core.Node {
	activities := s.latestPeriodActivities()
	if s.totals.TotalKg == 0 || len(activities) == 0 {
		return core.View{}
	}
	year := time.Now().Year()
	if len(s.periods) > 0 {
		year = s.periods[len(s.periods)-1].Year
	}
	monthly := s.monthlyTrendCard(cx, activities, year)
	recent := s.recentActivitiesCard(cx, activities, nav)
	if cx.Env().Window().Width < 900 {
		return core.View{Style: core.Style{Gap: 12}, Children: []core.Node{monthly, recent}}
	}
	return core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignStretch, Gap: 16},
		Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 3, FlexBasis: core.Pt(0), AlignSelf: core.AlignStretch},
				Children: []core.Node{monthly}},
			core.View{Style: core.Style{FlexGrow: 2, FlexBasis: core.Pt(0), AlignSelf: core.AlignStretch},
				Children: []core.Node{recent}},
		},
	}
}

// readinessHomeCard is the 1.x dashboard's entry point to the readiness
// review. It is a link, not a live count: running the sweep writes an audit
// event, so visiting the dashboard must not trigger it.
func (s *Session) readinessHomeCard(cx *core.Scope, nav *screenNav) core.Node {
	if s.totals.TotalKg == 0 || len(s.periods) == 0 {
		return core.View{}
	}
	return core.View{
		TestID:    "dashboard-readiness",
		Style:     core.Style{Padding: core.All(16), AlignSelf: core.AlignStretch},
		StyleFunc: cardSurface(cx),
		Children: []core.Node{dataHeaderRow(cx,
			core.View{Style: core.Style{Gap: 4, FlexShrink: 1,
				MinWidth: core.Pt(0)}, Children: []core.Node{
				core.Text{Content: locales.ReadinessHomeCardTitle(cx),
					Style: core.Style{FontSize: typeSectionTitle, FontWeight: ui.Semibold}},
				core.Text{Content: locales.ReadinessDescription(cx),
					Style:     core.Style{FontSize: typeCaption},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}},
			ui.Button{Text: locales.ReadinessHomeCardCta(cx) + " →",
				Variant: ui.ButtonOutline, Size: ui.SizeSmall,
				OnPress: func() { nav.Set(ScreenReports) },
				TestID:  "dashboard-readiness-open"}),
		},
	}
}

func (s *Session) monthlyTrendCard(cx *core.Scope, activities []store.Activity, year int) core.Node {
	buckets := buildMonthBuckets(activities, year)
	maxTotal := 0.0
	for _, bucket := range buckets {
		maxTotal = max(maxTotal, bucket.total)
	}

	card := func(children ...core.Node) core.Node {
		return core.View{Style: core.Style{Gap: 12, Padding: core.All(16),
			FlexGrow: 1, AlignSelf: core.AlignStretch}, StyleFunc: cardSurface(cx), Children: children}
	}
	scaleCaption := strconv.Itoa(year)
	if maxTotal > 0 {
		scaleCaption = strconv.Itoa(year) + " · " + co2eWithUnit(maxTotal)
	}
	header := core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			JustifyContent: core.JustifySpaceBetween, Gap: 8},
		Children: []core.Node{
			core.Text{Content: locales.DashboardMonthlyTrend(cx),
				Style: core.Style{FontSize: typeSectionTitle, FontWeight: ui.Semibold}},
			core.Text{Content: scaleCaption,
				Style:     core.Style{FontSize: typeMicro, FontVariant: core.FontTabularNums},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
		},
	}
	children := []core.Node{header}
	if maxTotal == 0 {
		children = append(children,
			core.Text{Content: locales.DashboardNoDataForChart(cx), Style: core.Style{FontSize: typeCaption},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2})
		return core.View{TestID: "dashboard-monthly-trend",
			Style: core.Style{FlexGrow: 1, AlignSelf: core.AlignStretch}, Children: []core.Node{card(children...)}}
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
						Style: core.Style{Height: core.Pt(height), CornerRadius: radiusMark, Opacity: core.Alpha(0.7)},
						StyleFunc: func() core.Style {
							return core.Style{Background: ui.ColorsOf(cx).Accent()}
						},
					}}},
				core.Text{Content: bucket.short, Style: core.Style{FontSize: typeMicro,
					FontVariant: core.FontTabularNums, TextAlign: core.TextAlignCenter},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			},
		})
	}
	children = append(children, core.View{
		TestID:   "dashboard-trend",
		Style:    core.Style{Direction: core.Row, AlignItems: core.AlignEnd, Gap: 4},
		Children: bars,
	})
	return core.View{TestID: "dashboard-monthly-trend",
		Style: core.Style{FlexGrow: 1, AlignSelf: core.AlignStretch}, Children: []core.Node{card(children...)}}
}

func (s *Session) recentActivitiesCard(cx *core.Scope, activities []store.Activity,
	nav *screenNav) core.Node {
	recent := recentActivities(activities)
	children := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			JustifyContent: core.JustifySpaceBetween, Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1, MinWidth: core.Pt(0)}, Children: []core.Node{
				core.Text{Content: locales.DashboardRecentActivities(cx),
					Style: core.Style{FontSize: typeSectionTitle, FontWeight: ui.Semibold}},
			}},
			ui.Button{Text: locales.DashboardWidgetViewAll(cx) + " →",
				Variant: ui.ButtonGhost, Size: ui.SizeSmall,
				OnPress: func() { nav.Set(ScreenActivities) }, TestID: "dashboard-recent-view-all"},
		}},
	}
	card := func(children ...core.Node) core.Node {
		return core.View{Style: core.Style{Gap: 12, Padding: core.All(16),
			FlexGrow: 1, AlignSelf: core.AlignStretch}, StyleFunc: cardSurface(cx), Children: children}
	}
	if len(recent) == 0 {
		children = append(children,
			core.Text{Content: locales.DashboardRecentEmpty(cx), Style: core.Style{FontSize: typeCaption},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
		return core.View{TestID: "dashboard-recent",
			Style: core.Style{FlexGrow: 1, AlignSelf: core.AlignStretch}, Children: []core.Node{card(children...)}}
	}

	rows := make([]core.Node, 0, len(recent))
	for i, activity := range recent {
		borders := core.Edges{}
		if i < len(recent)-1 {
			borders.Bottom = 1
		}
		rows = append(rows, core.View{
			TestID: "dashboard-recent-" + activity.ID,
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(8, 0), Borders: borders},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, Children: []core.Node{
					core.Text{Content: activity.Source,
						Style: core.Style{FontSize: typeBody, FontWeight: ui.Medium,
							FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
						MaxLines: 1},
				}},
				core.Text{Content: activityEndDate(activity),
					Style:     core.Style{FontSize: typeCaption, FontVariant: core.FontTabularNums},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				core.View{Style: core.Style{Width: core.Pt(8)}},
				core.Text{Content: commaFloat(activity.CO2eKg) + " " + locales.UnitKgCo2e(cx),
					Style: core.Style{FontSize: typeBody, FontWeight: ui.Medium,
						FontVariant: core.FontTabularNums, TextAlign: core.TextAlignEnd,
						FlexShrink: 0}, MaxLines: 1},
			},
		})
	}
	children = append(children, core.View{Style: core.Style{Gap: 0}, Children: rows})
	return core.View{TestID: "dashboard-recent",
		Style: core.Style{FlexGrow: 1, AlignSelf: core.AlignStretch}, Children: []core.Node{card(children...)}}
}

// activityEndDate is the dashboard's date: 1.x shows occurred_at_end there,
// while the ledger list shows the start date.
func activityEndDate(activity store.Activity) string {
	if len(activity.OccurredAtEnd) >= 10 {
		return activity.OccurredAtEnd[:10]
	}
	return activity.OccurredAtEnd
}
