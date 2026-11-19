package spike

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/nsgo-dev/nsgo/base/datatable"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// activity is one inventory row, close enough to the real shape that the
// table's density and column mix are representative.
type activity struct {
	ID       string
	Date     time.Time
	Site     string
	Source   string
	Category string
	Amount   float64
	Unit     string
	KgCO2e   float64
	Evidence int
	Status   string
}

var (
	sites      = []string{"上海工厂", "苏州仓库", "深圳办公室", "Singapore HQ", "Hangzhou DC"}
	sources    = []string{"国家电网", "柴油", "航空货运", "商务差旅", "外购蒸汽", "供应商发票"}
	categories = []string{"Cat 1 外购商品", "Cat 2 资本货物", "Cat 3 燃料", "Cat 4 运输", "Cat 6 差旅", "Cat 12 废弃物"}
	units      = []string{"kWh", "L", "t·km", "night", "t", "kg"}
	statuses   = []string{"草稿", "已定稿", "已导出"}
)

// activities is 10,000 rows generated once; the real app reads them from
// SQLite, which is the point of the separate store experiment.
var activities = generateActivities(10_000)

func generateActivities(n int) []activity {
	out := make([]activity, n)
	base := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range out {
		h := uint32(i+1) * 2654435761
		pick := func(xs []string, k uint32) string { return xs[(h>>k)%uint32(len(xs))] }
		amount := 1 + float64((h>>3)%1_000_000)/37
		factor := 0.02 + float64((h>>7)%10_000)/4_000
		out[i] = activity{
			ID:       fmt.Sprintf("act_%06d", i+1),
			Date:     base.AddDate(0, 0, i%365),
			Site:     pick(sites, 1),
			Source:   pick(sources, 5),
			Category: pick(categories, 9),
			Amount:   math.Round(amount*100) / 100,
			Unit:     pick(units, 13),
			KgCO2e:   math.Round(amount*factor*100) / 100,
			Evidence: int(h % 4),
			Status:   pick(statuses, 17),
		}
	}
	return out
}

func activitiesScreen(cx *core.Scope) core.Node {
	sortBy := core.NewSignal(cx, datatable.Sort{Key: "date", Descending: true})
	selected := core.NewSignal(cx, datatable.NoTableSelection)
	visible := core.NewSignal(cx, [2]int{})
	rows := sortedActivities(sortBy.Get())

	columns := func() []datatable.Column {
		return []datatable.Column{
			{Key: "id", Title: "Activity", Width: 110, Fixed: true, NoResize: true},
			{Key: "date", Title: "Date", Width: 96, Sortable: true},
			{Key: "site", Title: "Site", Width: 130},
			{Key: "source", Title: "Source", Width: 120},
			{Key: "category", Title: "GHG category", Width: 150},
			{Key: "amount", Title: "Amount", Width: 96, Align: datatable.AlignEndColumn, Sortable: true},
			{Key: "unit", Title: "Unit", Width: 60},
			{Key: "kg", Title: "kgCO₂e", Width: 96, Align: datatable.AlignEndColumn, Sortable: true},
			{Key: "evidence", Title: "Docs", Width: 56, Align: datatable.AlignEndColumn},
			{Key: "status", Title: "Status", Width: 80},
		}
	}
	cell := func(a activity, col int) string {
		switch col {
		case 0:
			return a.ID
		case 1:
			return a.Date.Format("2006-01-02")
		case 2:
			return a.Site
		case 3:
			return a.Source
		case 4:
			return a.Category
		case 5:
			return strconv.FormatFloat(a.Amount, 'f', 2, 64)
		case 6:
			return a.Unit
		case 7:
			return strconv.FormatFloat(a.KgCO2e, 'f', 2, 64)
		case 8:
			return strconv.Itoa(a.Evidence)
		default:
			return a.Status
		}
	}

	table := &datatable.Ref{}
	return panel(cx,
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
			core.Text{ContentFunc: func() string { return fmt.Sprintf("%s rows", comma(len(rows))) },
				Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
			core.Text{ContentFunc: func() string {
				s := sortBy.Get()
				dir := "ascending"
				if s.Descending {
					dir = "descending"
				}
				return "· sorted by " + s.Key + " " + dir + fmt.Sprintf(" · %d..%d in view", visible.Get()[0], visible.Get()[1])
			}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			core.View{Style: core.Style{FlexGrow: 1}},
			ui.Button{Text: "Scroll to end", Variant: ui.ButtonSecondary, Size: ui.SizeSmall,
				OnPress: func() { table.ScrollToRow(len(rows)-1, false) }},
		}},
		core.View{Style: core.Style{Height: core.Pt(620)}, Children: []core.Node{
			datatable.DataTable{
				Ref: table, TestID: "activities", Label: "Activities",
				Columns: columns, RowCount: func() int { return len(rows) },
				Text: func(row, col int) string {
					if row < 0 || row >= len(rows) {
						return ""
					}
					return cell(rows[row], col)
				},
				RowHeight: 30, FontSize: 13, NoRowHeader: true,
				Stripe: func() bool { return true },
				Sort:   sortBy.Get,
				StyleFunc: func() core.Style {
					return core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0), CornerRadius: 8,
						BorderWidth: 1, BorderColor: ui.ColorsOf(cx).Border(), Background: ui.ColorsOf(cx).Surface()}
				},
				StylesFunc: tableStyles(cx),
				OnSortChange: func(next datatable.Sort) {
					sortBy.Set(next)
					rows = sortedActivities(next)
				},
				OnSelectionChange: selected.Set,
				OnVisibleRowsChange: func(start, end int) {
					visible.Set([2]int{start, end})
				},
			},
		}},
		core.Text{ContentFunc: func() string {
			s := selected.Get()
			if s.Row < 0 {
				return "Select a row to see the payload the detail pane would load."
			}
			a := rows[s.Row]
			return fmt.Sprintf("%s · %s · %s · %.2f %s · %.2f kgCO₂e · %s", a.ID, a.Date.Format("2006-01-02"),
				a.Source, a.Amount, a.Unit, a.KgCO2e, a.Status)
		}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
	)
}

func sortedActivities(s datatable.Sort) []activity {
	out := append([]activity(nil), activities...)
	less := func(i, j int) bool {
		switch s.Key {
		case "amount":
			return out[i].Amount < out[j].Amount
		case "kg":
			return out[i].KgCO2e < out[j].KgCO2e
		default:
			return out[i].Date.Before(out[j].Date)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if s.Descending {
			return less(j, i)
		}
		return less(i, j)
	})
	return out
}

func comma(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

func tableStyles(cx *core.Scope) func() datatable.Styles {
	return ui.Themed(cx, func() datatable.Styles { return tableParts(cx) })
}

func tableParts(cx *core.Scope) datatable.Styles {
	colors := ui.ColorsOf(cx).Now()
	selected := &core.Style{Color: colors.Text, Opacity: core.Alpha(1)}
	chevron := core.Style{Color: colors.Muted, Opacity: core.Alpha(0.6), Selected: selected}
	return datatable.Styles{
		Header:             core.Style{Background: ui.Alpha(colors.Inset, 0.5), Color: colors.Muted, Borders: core.Edges{Bottom: 1}, BorderColor: colors.Border},
		HeaderCell:         core.Style{Padding: core.Edges{Left: 8, Right: 4}},
		HeaderContent:      core.Style{Gap: 4},
		HeaderCellSelected: core.Style{Background: ui.Alpha(colors.Accent, 0.10)},
		HeaderCellDragging: core.Style{Opacity: core.Alpha(0.5)},
		GroupCell:          core.Style{Borders: core.Edges{Bottom: 1, Right: 1}, BorderColor: colors.Border, Padding: core.Symmetric(0, 8)},
		SortIndicator:      core.Style{CornerRadius: 4, Color: colors.Muted, Hover: &core.Style{Background: ui.Alpha(colors.Text, 0.10)}},
		SortAscending:      chevron,
		SortDescending:     chevron,
		ResizeHandle:       core.Style{Background: colors.Border},
		MoveIndicator:      core.Style{Background: colors.Accent},
		Row:                core.Style{Borders: core.Edges{Bottom: 1}, BorderColor: colors.Line},
		RowOdd:             core.Style{Background: ui.Alpha(colors.Inset, 0.35)},
		RowSelected:        core.Style{Background: ui.Alpha(colors.Accent, 0.12)},
		RowActive:          core.Style{Background: ui.Alpha(colors.Inset, 0.6)},
		Cell:               core.Style{Padding: core.Symmetric(0, 8)},
		CellSelected:       core.Style{BorderWidth: 1, BorderColor: colors.Accent},
		CellColumnSelected: core.Style{Background: ui.Alpha(colors.Accent, 0.08)},
		CellActive:         core.Style{BorderWidth: 1, BorderColor: ui.Alpha(colors.Accent, 0.5)},
		RowHeader:          core.Style{Color: colors.Muted},
		FixedEdge:          core.Style{Background: colors.Border},
	}
}
