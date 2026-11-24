package app

import (
	"strconv"

	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// 1.x laid every route out inside a 24 pt page margin, a 24 pt vertical
// rhythm, and an 80 rem content cap. These helpers keep the whole 2.0 app on
// that grid instead of repeating the numbers per screen.
const (
	pageMaxWidth core.Points = 1280
	pagePadding  core.Points = 24
	pageGap      core.Points = 24
)

// appPage is a scrolling page: centered, capped, 24 pt around and between
// its blocks.
func appPage(children ...core.Node) core.Node {
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(pagePadding), Gap: pageGap,
				Width: core.Pct(100), MaxWidth: core.Pt(pageMaxWidth), AlignSelf: core.AlignCenter},
			Children: children,
		}},
	}
}

// appFixedPage fills the content area so a table or split view can own its
// scroll, still centered and capped like every other page.
func appFixedPage(children ...core.Node) core.Node {
	return core.View{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
			AlignItems: core.AlignCenter},
		Children: []core.Node{core.View{
			Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
				Width: core.Pct(100), MaxWidth: core.Pt(pageMaxWidth),
				Padding: core.All(pagePadding), Gap: 16},
			Children: children,
		}},
	}
}

// pageHeading is the 1.x route title: 24 pt semibold, actions flush right.
func pageHeading(cx *core.Scope, title func(*core.Scope) string, actions ...core.Node) core.Node {
	children := []core.Node{core.Text{ContentFunc: func() string { return title(cx) },
		Style: core.Style{FontSize: 24, FontWeight: ui.Semibold, FlexGrow: 1,
			FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1}}
	if len(actions) > 0 {
		children = append(children, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				FlexShrink: 0, Gap: 8},
			Children: actions,
		})
	}
	return core.View{
		Style:    core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 12},
		Children: children,
	}
}

// pageHeadingWithDetail adds the one muted line 1.x showed under a route
// title on screens that explain themselves (reports, audit, settings).
func pageHeadingWithDetail(cx *core.Scope, title, detail func(*core.Scope) string,
	actions ...core.Node) core.Node {
	head := pageHeading(cx, title, actions...)
	if detail == nil {
		return head
	}
	return core.View{Style: core.Style{Gap: 4}, Children: []core.Node{
		head,
		core.Text{ContentFunc: func() string { return detail(cx) },
			Style:     core.Style{FontSize: 13, FlexShrink: 1, MinWidth: core.Pt(0)},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
	}}
}

// splitPage is 1.x's list/detail two-pane layout. width is the list pane's
// share of the content area; the detail pane takes the rest.
func splitPage(cx *core.Scope, width float32, list, detail core.Node) core.Node {
	return core.View{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0), Direction: core.Row},
		Children: []core.Node{
			core.View{Style: core.Style{FlexBasis: core.Pct(width), FlexGrow: 0, FlexShrink: 0,
				MinWidth: core.Pt(260), MinHeight: core.Pt(0), Borders: core.Edges{Right: 1}},
				StyleFunc: func() core.Style {
					return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
				},
				Children: []core.Node{list}},
			core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0),
				MinHeight: core.Pt(0)}, Children: []core.Node{detail}},
		},
	}
}

// listPaneHeader is the sticky heading above a list column.
func listPaneHeader(cx *core.Scope, title, detail func(*core.Scope) string,
	actions ...core.Node) core.Node {
	head := []core.Node{core.Text{ContentFunc: func() string { return title(cx) },
		Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}, MaxLines: 1}}
	if detail != nil {
		head = append(head, core.Text{ContentFunc: func() string { return detail(cx) },
			Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
			MaxLines: 2})
	}
	row := []core.Node{core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1,
		MinWidth: core.Pt(0)}, Children: head}}
	if len(actions) > 0 {
		row = append(row, core.View{Style: core.Style{Direction: core.Row,
			AlignItems: core.AlignCenter, Gap: 8}, Children: actions})
	}
	return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
		Gap: 12, Padding: core.Symmetric(12, 16), FlexShrink: 0,
		Borders: core.Edges{Bottom: 1}}, StyleFunc: func() core.Style {
		return core.Style{Background: ui.ColorsOf(cx).Background(),
			BorderColor: ui.ColorsOf(cx).Line()}
	}, Children: row}
}

// detailEmpty is the quiet placeholder a two-pane detail column shows before
// a row is picked.
func detailEmpty(cx *core.Scope, text func(*core.Scope) string) core.Node {
	return core.View{Style: core.Style{FlexGrow: 1, AlignItems: core.AlignCenter,
		JustifyContent: core.JustifyCenter, Padding: core.All(32)},
		Children: []core.Node{core.Text{ContentFunc: func() string { return text(cx) },
			Style:     core.Style{FontSize: 13, TextAlign: core.TextAlignCenter},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2}}}
}

// detailEmptyIcon is the two-pane empty state 1.x showed before a row was
// picked: one large faint outline above a short explanation.
func detailEmptyIcon(cx *core.Scope, icon func() *core.SVG,
	text func(*core.Scope) string) core.Node {
	return core.View{Style: core.Style{FlexGrow: 1, AlignItems: core.AlignCenter,
		JustifyContent: core.JustifyCenter, Gap: 12, Padding: core.All(32)},
		Children: []core.Node{
			ui.Icon(icon, 44, ui.ColorsOf(cx).Faint),
			core.Text{ContentFunc: func() string { return text(cx) },
				Style:     core.Style{FontSize: 14, TextAlign: core.TextAlignCenter},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
		}}
}

// detailPaneShell is the right column of a 1.x list/detail screen: a pinned
// header, a scrolling body, and an optional action bar along the bottom.
func detailPaneShell(cx *core.Scope, testID, title string, actions, body, footer []core.Node) core.Node {
	header := []core.Node{
		core.Text{Content: title, Style: core.Style{FontSize: 18, FontWeight: ui.Semibold,
			FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 2},
	}
	header = append(header, actions...)
	children := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Gap: 8, Padding: core.Symmetric(12, 16), Borders: core.Edges{Bottom: 1},
			FlexShrink: 0}, StyleFunc: func() core.Style {
			return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
		}, Children: header},
		core.Scroll{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
			Children: []core.Node{core.View{Style: core.Style{Padding: core.Symmetric(20, 24),
				Gap: 16}, Children: body}}},
	}
	if len(footer) > 0 {
		children = append(children, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Wrap: core.Wrap,
				JustifyContent: core.JustifyEnd, Gap: 8, Padding: core.Symmetric(12, 16),
				FlexShrink: 0, Borders: core.Edges{Top: 1}},
			StyleFunc: func() core.Style {
				return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
			}, Children: footer})
	}
	return core.View{
		TestID:   testID,
		Style:    core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: children,
	}
}

// segment is one choice in a 1.x scope filter: a label and an optional
// count.
type segment struct {
	Value  int
	Label  func(*core.Scope) string
	Count  func() int
	TestID string
}

// segmentedControl is 1.x's scope filter: transparent buttons whose selected
// one carries the text color's 12% wash. fill spreads them across the pane,
// as /sources does; without it they sit together at their natural width, as
// /activities does.
func segmentedControl(cx *core.Scope, options []segment, value func() int,
	onChange func(int), fill bool) core.Node {
	children := make([]core.Node, 0, len(options))
	for _, option := range options {
		option := option
		kids := []core.Node{core.Text{ContentFunc: func() string { return option.Label(cx) },
			Style: core.Style{FontSize: 12, FontWeight: ui.Medium},
			StyleFunc: func() core.Style {
				if value() == option.Value {
					return core.Style{}
				}
				return ui.Colored(ui.ColorsOf(cx).Muted)()
			}}}
		if option.Count != nil {
			kids = append(kids, countBadge(cx, option.Count, value() == option.Value))
		}
		style := core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			JustifyContent: core.JustifyCenter, Gap: 4, Height: core.Pt(26),
			Padding: core.Symmetric(0, 8), CornerRadius: 6}
		if fill {
			style.FlexGrow = 1
			style.FlexBasis = core.Pt(0)
		}
		children = append(children, core.View{
			TestID: option.TestID,
			Role:   core.RoleButton,
			OnPress: func(core.PressEvent) {
				onChange(option.Value)
			},
			Style: style,
			StyleFunc: func() core.Style {
				if value() == option.Value {
					return core.Style{Background: ui.Alpha(ui.ColorsOf(cx).Text(), 0.12)}
				}
				return core.Style{Hover: &core.Style{
					Background: ui.Alpha(ui.ColorsOf(cx).Text(), 0.05)}}
			},
			Children: kids,
		})
	}
	style := core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 4}
	if fill {
		style.Width = core.Pct(100)
	}
	return core.View{Style: style, Children: children}
}

// countBadge is 1.x's ChipCountBadge: an 18 pt rounded square holding a
// small, semibold count.
func countBadge(cx *core.Scope, count func() int, active bool) core.Node {
	return core.View{
		Style: core.Style{Height: core.Pt(18), MinWidth: core.Pt(18),
			AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter,
			Padding: core.Symmetric(0, 4), CornerRadius: 4},
		StyleFunc: func() core.Style {
			colors := ui.ColorsOf(cx)
			if active {
				return core.Style{Background: ui.Alpha(colors.Text(), 0.20)}
			}
			return core.Style{Background: ui.Alpha(colors.Text(), 0.08)}
		},
		Children: []core.Node{core.Text{ContentFunc: func() string {
			return strconv.Itoa(count())
		}, Style: core.Style{FontSize: 10, FontWeight: ui.Semibold}, MaxLines: 1,
			StyleFunc: func() core.Style {
				if active {
					return core.Style{}
				}
				return core.Style{Color: ui.Alpha(ui.ColorsOf(cx).Muted(), 0.8)}
			}}},
	}
}

// filterChip is 1.x's compact status filter: a borderless label and count.
// dense is the 11 pt variant the questionnaire lists use; documents use the
// 12 pt one.
func filterChip(cx *core.Scope, dense bool, testID, label string, count func() int,
	selected func() bool, onPress func(),
	labelColor ...func(*core.Scope) core.Color) core.Node {
	var color func(*core.Scope) core.Color
	if len(labelColor) > 0 {
		color = labelColor[0]
	}
	fontSize, padX, padY := core.Points(12), core.Points(8), core.Points(4)
	if dense {
		fontSize, padX, padY = 11, 6, 2
	}
	return core.View{
		TestID: testID,
		Role:   core.RoleButton,
		OnPress: func(core.PressEvent) {
			onPress()
		},
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 4,
			Padding: core.Symmetric(padY, padX), CornerRadius: 6, FlexShrink: 0},
		StyleFunc: func() core.Style {
			if selected() {
				return core.Style{Background: ui.Alpha(ui.ColorsOf(cx).Text(), 0.12)}
			}
			return core.Style{Hover: &core.Style{
				Background: ui.Alpha(ui.ColorsOf(cx).Text(), 0.05)}}
		},
		Children: []core.Node{
			core.Text{Content: label, Style: core.Style{FontSize: fontSize,
				FontWeight: ui.Medium}, MaxLines: 1, StyleFunc: func() core.Style {
				if color != nil {
					return core.Style{Color: color(cx)}
				}
				return core.Style{}
			}},
			countBadge(cx, count, selected()),
		},
	}
}

// searchField is 1.x's list search: a magnifier inside the field's left edge.
func searchField(cx *core.Scope, value func() string, placeholder string,
	onChange func(string), testID string) core.Node {
	colors := ui.ColorsOf(cx)
	return core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter},
		Children: []core.Node{
			ui.Input{Value: value, Placeholder: placeholder, OnChange: onChange,
				TestID: testID, Role: core.RoleSearchField,
				LabelFunc: func() string { return placeholder },
				Style:     core.Style{FlexGrow: 1, Padding: core.Edges{Left: 30, Right: 10}}},
			core.View{Style: core.Style{Position: core.Absolute, Left: core.Pt(9),
				Top: core.Pt(0), Bottom: core.Pt(0), Width: core.Pt(16),
				AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter,
				PointerEvents: core.PointerEventsNone},
				Children: []core.Node{ui.Icon(lucide.Search, 14, colors.Muted)}},
		},
	}
}

// sortMenu is 1.x's sort control: a bordered 28 pt pill carrying the sort
// glyph, a muted "Sort:" label and the current choice, opening a check menu.
func sortMenu[T comparable](cx *core.Scope, options []ui.Option[T],
	value func() T, onChange func(T), testID string) core.Node {
	open := core.NewSignal(cx, false)
	colors := ui.ColorsOf(cx)
	current := func() string {
		v := value()
		for _, option := range options {
			if option.Value == v {
				return option.Label
			}
		}
		return ""
	}
	face := core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6,
			Height: core.Pt(28), Padding: core.Symmetric(0, 8), CornerRadius: 6},
		StyleFunc: func() core.Style {
			return core.Style{BorderWidth: 1, BorderColor: colors.Border(),
				Background: colors.Background(),
				Hover:      &core.Style{Background: ui.Alpha(colors.Text(), 0.05)}}
		},
		Children: []core.Node{
			ui.Icon(lucide.ArrowUpDown, 12, colors.Muted),
			core.Text{Content: locales.SortLabel(cx) + ":", Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(colors.Muted), MaxLines: 1},
			core.Text{ContentFunc: current, Style: core.Style{FontSize: 12,
				FontWeight: ui.Medium}, MaxLines: 1},
		},
	}
	items := make([]core.Node, 0, len(options))
	for i, option := range options {
		option := option
		items = append(items, ui.MenuItem{
			Text:    option.Label,
			Checked: func() bool { return value() == option.Value },
			OnSelect: func() {
				onChange(option.Value)
			},
			TestID: testID + "-" + strconv.Itoa(i),
		})
	}
	return ui.Menu{Open: open.Get,
		OnOpenChange: func(value bool, _ base.Reason) { open.Set(value) },
		Trigger:      ui.Button{Text: locales.SortLabel(cx)},
		Face:         face,
		Children:     items,
		Align:        core.AlignEnd,
		Label:        locales.SortLabel(cx),
		TestID:       testID,
	}
}

// settingsSectionHeading is the title + description at the top of a settings
// section's right pane.
func settingsSectionHeading(cx *core.Scope, title, detail func(*core.Scope) string) core.Node {
	return core.View{Style: core.Style{Gap: 4}, Children: []core.Node{
		core.Text{ContentFunc: func() string { return title(cx) },
			Style: core.Style{FontSize: 20, FontWeight: ui.Semibold}},
		core.Text{ContentFunc: func() string { return detail(cx) },
			Style:     core.Style{FontSize: 13},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
	}}
}

// settingsCard is 1.x's settings group: an inset card holding an icon-titled
// heading, a short explanation, and the group's controls. Settings whose 1.x
// layout was a plain block (General, AI, AMap) stay flat; the Data, EF library
// and migration groups use this shape.
func settingsCard(cx *core.Scope, icon func() *core.SVG,
	title, detail func(*core.Scope) string, children ...core.Node) core.Node {
	head := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Gap: 8}, Children: []core.Node{
			ui.Icon(icon, 16, ui.ColorsOf(cx).Text),
			core.Text{ContentFunc: func() string { return title(cx) },
				Style: core.Style{FontSize: 14, FontWeight: ui.Semibold, FlexShrink: 1,
					MinWidth: core.Pt(0)}, MaxLines: 2},
		}},
	}
	if detail != nil {
		head = append(head, core.Text{ContentFunc: func() string { return detail(cx) },
			Style:     core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 4})
	}
	body := []core.Node{core.View{Style: core.Style{Gap: 6}, Children: head}}
	body = append(body, children...)
	return core.View{
		Style:     core.Style{Gap: 12, Padding: core.All(16), AlignSelf: core.AlignStretch},
		StyleFunc: cardSurface(cx),
		Children:  body,
	}
}

// settingsDangerCard is settingsCard tinted with the destructive palette, as
// 1.x's Reset group was.
func settingsDangerCard(cx *core.Scope, icon func() *core.SVG,
	title, detail func(*core.Scope) string, children ...core.Node) core.Node {
	head := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Gap: 8}, Children: []core.Node{
			ui.Icon(icon, 16, ui.ColorsOf(cx).Danger),
			core.Text{ContentFunc: func() string { return title(cx) },
				Style: core.Style{FontSize: 14, FontWeight: ui.Semibold, FlexShrink: 1,
					MinWidth: core.Pt(0)},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger), MaxLines: 2},
		}},
	}
	if detail != nil {
		head = append(head, core.Text{ContentFunc: func() string { return detail(cx) },
			Style:     core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 4})
	}
	body := []core.Node{core.View{Style: core.Style{Gap: 6}, Children: head}}
	body = append(body, children...)
	return core.View{
		Style: core.Style{Gap: 12, Padding: core.All(16), AlignSelf: core.AlignStretch},
		StyleFunc: func() core.Style {
			colors := ui.ColorsOf(cx)
			return core.Style{CornerRadius: 8, BorderWidth: 1,
				Background:  ui.Alpha(colors.Danger(), 0.05),
				BorderColor: ui.Alpha(colors.Danger(), 0.4)}
		},
		Children: body,
	}
}
