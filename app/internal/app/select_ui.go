package app

import (
	"strconv"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// wideOption is one row of a wideSelect: a primary label and the quieter
// detail line beneath it, so long factor names wrap instead of clipping.
type wideOption struct {
	Value  string
	Label  string
	Detail string
}

// wideSelect is a select whose popup is wider than its field and whose rows
// carry a wrapping label and detail. NSGo's stock Select keeps the popup at
// the trigger's width and clips each option to one line, which hides long
// emission-factor names.
type wideSelect struct {
	Options           []wideOption
	Value             func() string
	OnChange          func(value string)
	Placeholder       string
	Label             string
	TestID            string
	Searchable        bool
	SearchPlaceholder string
	PopupWidth        core.Points
	Width             core.Points
}

func (s wideSelect) Render(cx *core.Scope) core.Node {
	colors := ui.ColorsOf(cx)
	open := core.NewSignal(cx, false)
	value := func() string {
		if s.Value != nil {
			return s.Value()
		}
		return ""
	}
	hasValue := func() bool {
		current := value()
		for _, option := range s.Options {
			if option.Value == current {
				return true
			}
		}
		return false
	}
	title := func() string {
		current := value()
		for _, option := range s.Options {
			if option.Value == current {
				return option.Label
			}
		}
		return s.Placeholder
	}
	width := s.Width
	if width <= 0 {
		width = 440
	}
	popupWidth := s.PopupWidth
	if popupWidth <= 0 {
		popupWidth = 560
	}
	field := core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6,
			Height: core.Pt(32), Padding: core.Edges{Left: 10, Right: 8},
			CornerRadius: 6, BorderWidth: 1},
		StyleFunc: func() core.Style {
			border := colors.FieldBorder()
			if open.Get() {
				border = colors.Accent()
			}
			return core.Style{Background: colors.Surface(), BorderColor: border}
		},
		Children: []core.Node{
			core.Text{ContentFunc: title, MaxLines: 1,
				Style: core.Style{FontSize: 13, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				StyleFunc: func() core.Style {
					if !hasValue() {
						return core.Style{Color: colors.Faint()}
					}
					return core.Style{Color: colors.Text()}
				}},
			ui.Icon(lucide.ChevronDown, 14, colors.Muted),
		},
	}
	items := func() []base.SelectItem {
		out := make([]base.SelectItem, len(s.Options))
		for i, option := range s.Options {
			search := option.Label
			if option.Detail != "" {
				search += " " + option.Detail
			}
			out[i] = base.SelectItem{Value: strconv.Itoa(i), Title: search}
		}
		return out
	}
	label := s.Label
	if label == "" {
		label = s.Placeholder
	}
	row := core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
		Padding: core.Symmetric(7, 8), CornerRadius: 6}
	return base.Select{
		Items: items,
		Value: func() *string {
			current := value()
			for i, option := range s.Options {
				if option.Value == current {
					raw := strconv.Itoa(i)
					return &raw
				}
			}
			return nil
		},
		Open:         open.Get,
		OnOpenChange: func(next bool, _ base.Reason) { open.Set(next) },
		Presentation: base.PresentPopup,
		Offset:       4,
		Margin:       8,
		RootStyle:    core.Style{Width: core.Pt(width), AlignSelf: core.AlignStart},
		Style:        core.Style{FlexGrow: 1},
		StyleFunc:    func() core.Style { return core.Style{FocusVisible: ui.FocusRing(cx, 2)} },
		Trigger:      field,
		PopupStyleFunc: func() core.Style {
			return core.Style{Width: core.Pt(popupWidth), Padding: core.All(4),
				Background: colors.Surface(), BorderWidth: 1, BorderColor: colors.Line(),
				CornerRadius: 8}
		},
		ListStyle: core.Style{MaxHeight: core.Pt(360)},
		ItemStyle: row,
		ItemStyleFunc: func() core.Style {
			return core.Style{Color: colors.Text(), Focus: &core.Style{Background: colors.Hover()}, Selected: &core.Style{Background: ui.Alpha(colors.Text(), 0.1)}}
		},
		Label:             label,
		TestID:            s.TestID,
		Searchable:        func() bool { return s.Searchable },
		SearchPlaceholder: s.SearchPlaceholder,
		SearchLabel:       s.SearchPlaceholder,
		RenderItem: func(entry base.SelectEntry) core.Node {
			if entry.Index < 0 || entry.Index >= len(s.Options) {
				return core.Text{Content: entry.Title}
			}
			option := s.Options[entry.Index]
			children := []core.Node{core.View{
				Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.Text{Content: option.Label,
						Style: core.Style{FontSize: 13, FlexShrink: 1, MinWidth: core.Pt(0)}},
					core.Show{When: func() bool { return option.Detail != "" },
						Then: func(cx *core.Scope) core.Node {
							return core.Text{Content: option.Detail,
								Style:     core.Style{FontSize: 11, FlexShrink: 1, MinWidth: core.Pt(0)},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
						}},
				},
			}}
			if option.Value == value() {
				children = append(children, ui.Icon(lucide.Check, 14, colors.Accent))
			}
			testID := ""
			if s.TestID != "" {
				testID = s.TestID + "-" + strconv.Itoa(entry.Index)
			}
			return core.View{TestID: testID, Style: core.Style{Direction: core.Row,
				AlignItems: core.AlignCenter, Gap: 8, FlexGrow: 1, FlexShrink: 1,
				MinWidth: core.Pt(0)}, Children: children}
		},
		OnChange: func(next *string) {
			if next == nil {
				return
			}
			index, err := strconv.Atoi(*next)
			if err != nil || index < 0 || index >= len(s.Options) || s.OnChange == nil {
				return
			}
			s.OnChange(s.Options[index].Value)
		},
	}
}
