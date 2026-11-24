package app

import (
	"strconv"

	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// appSelect is the app's single-choice dropdown built on base.Select.
// NSGo v0.2.0's ui.Select pins popup width to the trigger, centers rows with
// non-shrinking labels (causing symmetric left/right overflow), truncates to
// MaxLines: 1, and leaves only 8 pt right padding under macOS overlay
// scrollbars. appSelect auto-expands the popup up to the widest option
// (capped inside the window), wraps any ultra-long labels cleanly instead of
// clipping, and leaves clearance for the scrollbar.
type appSelect[T comparable] struct {
	Ref               *core.Ref
	LabelledBy        []*core.Ref
	Invalid           func() bool
	Options           []ui.Option[T]
	Value             func() T
	OnChange          func(value T)
	Placeholder       string
	Searchable        bool
	SearchPlaceholder string
	Empty             string
	OnClear           func()
	Disabled          func() bool
	Presentation      base.Presentation
	Label             string
	TestID            string
	Style             core.Style
}

func selectPickerStyle(s core.Style) (root, field core.Style) {
	field = core.Style{
		Height:     s.Height,
		MinHeight:  s.MinHeight,
		MaxHeight:  s.MaxHeight,
		Padding:    s.Padding,
		FontSize:   s.FontSize,
		LineHeight: s.LineHeight,
	}
	s.Padding, s.FontSize, s.LineHeight = core.Edges{}, 0, 0
	return core.Style{Width: core.Pt(200), AlignSelf: core.AlignStart}.Merge(s), field
}

func measureSelectOptionsWidth[T comparable](cx *core.Scope, options []ui.Option[T],
	searchable bool) core.Points {
	var widest core.Points
	font := core.Font{Size: ui.TypeBody.FontSize}
	for _, o := range options {
		w := core.Points(cx.MeasureText(o.Label, font).Width)
		if o.Leading != nil {
			w += 22
		}
		if o.Trailing != nil {
			w += 22
		}
		if w > widest {
			widest = w
		}
	}
	// Reserve horizontal chrome: border (2) + popup padding (8) +
	// row padding (10 left + 18 right for scrollbar clearance) + 18 pt buffer
	// for CJK/platform text metrics rounding.
	total := widest + 56
	if searchable && total < 240 {
		total = 240
	}
	return total
}

func selectPopupWidth(cx *core.Scope, triggerW, contentW core.Points) core.Points {
	expandCap := core.Points(560)
	if triggerW > expandCap {
		expandCap = triggerW
	}
	if winW := cx.Env().Window().Width; winW > 0 {
		winCap := max(core.Points(160), winW-16)
		if expandCap > winCap {
			expandCap = winCap
		}
	}
	popupW := max(triggerW, contentW)
	if popupW > expandCap {
		popupW = expandCap
	}
	return popupW
}

func selectSearchField(in core.Input) core.Node {
	in.Style = in.Style.Merge(core.Style{Margin: core.Edges{Bottom: 4}})
	return ui.Input(in)
}

func selectEmptyNode(cx *core.Scope, text string) core.Node {
	return core.Text{
		Content:   text,
		Style:     ui.TypeBody.Merge(core.Style{Padding: core.All(12), TextAlign: core.TextAlignCenter}),
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
	}
}

func (s appSelect[T]) Render(cx *core.Scope) core.Node {
	colors := ui.ColorsOf(cx)
	open := core.NewSignal(cx, false)
	chosen := core.NewMemo(cx, func() int {
		if s.Value != nil {
			v := s.Value()
			for i, o := range s.Options {
				if o.Value == v {
					return i
				}
			}
		}
		return -1
	})
	leading := core.Dynamic(func(*core.Scope) core.Node {
		if i := chosen.Get(); i >= 0 && s.Options[i].Leading != nil {
			return s.Options[i].Leading
		}
		return core.Group(nil)
	})
	title := func() string {
		if i := chosen.Get(); i >= 0 {
			return s.Options[i].Label
		}
		return ""
	}
	root, field := selectPickerStyle(s.Style)
	triggerChildren := []core.Node{
		leading,
		core.Text{
			MaxLines: 1,
			Style: ui.TypeBody.Merge(core.Style{
				FontSize:   field.FontSize,
				LineHeight: field.LineHeight,
				FlexGrow:   1,
				FlexShrink: 1,
				MinWidth:   core.Pt(0),
			}),
			ContentFunc: func() string {
				if v := title(); v != "" {
					return v
				}
				return s.Placeholder
			},
			StyleFunc: func() core.Style {
				if title() != "" {
					return core.Style{Color: colors.Text()}
				}
				return core.Style{Color: colors.Faint()}
			},
		},
		core.View{
			Style:    core.Style{FlexShrink: 0},
			Children: []core.Node{ui.Icon(lucide.ChevronDown, 14, colors.Muted)},
		},
	}
	face := core.View{
		Style: core.Style{
			Direction:    core.Row,
			AlignItems:   core.AlignCenter,
			Gap:          6,
			Height:       core.Pt(ui.ButtonHeight),
			Padding:      core.Edges{Left: 10, Right: 8},
			CornerRadius: ui.RadiusControl,
			BorderCurve:  core.BorderCurveContinuous,
			BorderWidth:  1,
		}.Merge(field),
		StyleFunc: func() core.Style {
			border := colors.FieldBorder()
			if open.Get() {
				border = colors.Accent()
			}
			return core.Style{
				Background:  colors.Surface(),
				BorderColor: border,
				GroupStyle: &core.GroupStyle{
					Hover:  &core.Style{Background: colors.Hover()},
					Active: &core.Style{Background: colors.Pressed()},
				},
			}
		},
		Children: triggerChildren,
	}

	items := func() []base.SelectItem {
		out := make([]base.SelectItem, len(s.Options))
		for i, o := range s.Options {
			out[i] = base.SelectItem{
				Value:    strconv.Itoa(i),
				Title:    o.Label,
				Disabled: o.Disabled != nil && o.Disabled(),
			}
		}
		return out
	}

	anchor := s.Ref
	if anchor == nil {
		anchor = new(core.Ref)
	}
	triggerW := core.NewSignal[core.Points](cx, 0)

	var measuredW core.Points = -1
	contentWidth := func() core.Points {
		if measuredW < 0 {
			measuredW = measureSelectOptionsWidth(cx, s.Options, s.Searchable)
		}
		return measuredW
	}

	popupStyleFunc := func() core.Style {
		w := triggerW.Get()
		if b, ok := anchor.ContentBounds(); ok && b.Size.Width > 0 {
			w = b.Size.Width
		}
		popupW := selectPopupWidth(cx, w, contentWidth())
		return ui.FinOf(cx).Menu().Over(core.Style{
			Width:        core.Pt(popupW),
			MinWidth:     core.Pt(0),
			Padding:      core.All(4),
			CornerRadius: radiusMenu,
			BorderWidth:  1,
			Color:        colors.Text(),
		})
	}
	var backdropStyle core.Style
	if s.Presentation == base.PresentSheet {
		backdropStyle = core.Style{Background: ui.Black(0.4)}
	}

	label := s.Label
	if label == "" {
		label = s.Placeholder
	}

	rowStyle := core.Style{
		Direction:    core.Row,
		AlignItems:   core.AlignCenter,
		Gap:          6,
		MinHeight:    core.Pt(28),
		Padding:      core.Edges{Top: 5, Bottom: 5, Left: 10, Right: 18},
		CornerRadius: ui.RadiusControl - 2,
		Disabled:     ui.Dimmed(),
	}
	rowLook := func() core.Style {
		return core.Style{
			Color:    colors.Text(),
			Focus:    &core.Style{Background: colors.Hover()},
			Selected: &core.Style{Background: ui.Alpha(colors.Text(), 0.1)},
		}
	}
	groupStyle := ui.TypeCaption.Merge(core.Style{Padding: core.Edges{Top: 6, Right: 8, Bottom: 3, Left: 8}})

	b := base.Select{
		Ref:          anchor,
		LabelledBy:   s.LabelledBy,
		Invalid:      s.Invalid,
		Items:        items,
		Disabled:     s.Disabled,
		Presentation: s.Presentation,
		Open:         open.Get,
		OnOpenChange: func(v bool, _ base.Reason) { open.Set(v) },
		Value: func() *string {
			if i := chosen.Get(); i >= 0 {
				v := strconv.Itoa(i)
				return &v
			}
			return nil
		},
		OnChange: func(v *string) {
			if v == nil {
				if s.OnClear != nil {
					s.OnClear()
				}
				return
			}
			if i, err := strconv.Atoi(*v); err == nil && i >= 0 && i < len(s.Options) && s.OnChange != nil {
				s.OnChange(s.Options[i].Value)
			}
		},
		Offset:         4,
		Margin:         8,
		RootStyle:      root,
		Style:          core.Style{Group: "button", CornerRadius: ui.RadiusControl},
		StyleFunc:      func() core.Style { return core.Style{FocusVisible: ui.FocusRing(cx, 2)} },
		Trigger:        face,
		PopupStyleFunc: popupStyleFunc,
		BackdropStyle:  backdropStyle,
		ListStyle:      core.Style{MaxHeight: core.Pt(320)},
		ItemStyle:      rowStyle,
		ItemStyleFunc:  rowLook,
		GroupStyle:     groupStyle,
		GroupStyleFunc: ui.Colored(colors.Muted),
		Label:          label,
		TestID:         s.TestID,
		OnLayout: func(b core.Bounds) {
			if ab, ok := anchor.ContentBounds(); ok && ab.Size.Width > 0 {
				triggerW.Set(ab.Size.Width)
			} else if b.Size.Width > 0 {
				triggerW.Set(b.Size.Width)
			}
		},
		RenderItem: func(e base.SelectEntry) core.Node {
			id := ""
			if s.TestID != "" {
				id = s.TestID + "-" + strconv.Itoa(e.Index)
			}
			if e.Index < 0 || e.Index >= len(s.Options) {
				return core.Text{Content: e.Title}
			}
			o := s.Options[e.Index]
			var children []core.Node
			if o.Leading != nil {
				children = append(children, core.View{
					Style:    core.Style{FlexShrink: 0},
					Children: []core.Node{o.Leading},
				})
			}
			children = append(children, core.Text{
				Content:   o.Label,
				Style:     ui.TypeBody.Merge(core.Style{FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}),
				StyleFunc: ui.Colored(colors.Text),
			})
			if o.Trailing != nil {
				children = append(children, core.View{
					Style:    core.Style{FlexShrink: 0},
					Children: []core.Node{o.Trailing},
				})
			}
			return core.View{
				TestID: id,
				Style: core.Style{
					Direction:  core.Row,
					AlignItems: core.AlignCenter,
					Gap:        6,
					FlexGrow:   1,
					FlexShrink: 1,
					MinWidth:   core.Pt(0),
				},
				Children: children,
			}
		},
	}
	if s.Searchable {
		b.Searchable = func() bool { return true }
		b.SearchPlaceholder = s.SearchPlaceholder
		b.SearchLabel = s.SearchPlaceholder
		if b.SearchLabel == "" {
			b.SearchLabel = locales.CommandSearch(cx)
		}
		b.SearchField = selectSearchField
		emptyText := s.Empty
		if emptyText == "" {
			emptyText = locales.SettingsPickerNoMatch(cx)
		}
		b.Empty = selectEmptyNode(cx, emptyText)
	}
	if s.OnClear != nil {
		b.Cleanable = true
		b.ClearButton = ui.Icon(lucide.X, 14, colors.Muted)
		b.ClearButtonStyle = core.Style{
			Position:       core.Absolute,
			Top:            core.Pt(0),
			Bottom:         core.Pt(0),
			Right:          core.Pt(26),
			Width:          core.Pt(20),
			AlignItems:     core.AlignCenter,
			JustifyContent: core.JustifyCenter,
		}
		b.ClearButtonLabel = locales.ActivitiesFilterClear(cx)
	}
	return b
}

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
	Height            core.Points
}

func (s wideSelect) Render(cx *core.Scope) core.Node {
	colors := ui.ColorsOf(cx)
	open := core.NewSignal(cx, false)
	anchor := new(core.Ref)
	triggerW := core.NewSignal[core.Points](cx, 0)
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
	rootStyle := core.Style{Width: core.Pct(100)}
	if s.Width > 0 {
		rootStyle = core.Style{Width: core.Pt(s.Width), AlignSelf: core.AlignStart}
	}
	height := s.Height
	if height <= 0 {
		height = ui.ButtonHeight
	}
	popupWidth := s.PopupWidth
	if popupWidth <= 0 {
		popupWidth = 560
	}
	field := core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6,
			Height: core.Pt(height), Padding: core.Edges{Left: 10, Right: 8},
			CornerRadius: ui.RadiusControl, BorderCurve: core.BorderCurveContinuous,
			BorderWidth: 1},
		StyleFunc: func() core.Style {
			border := colors.FieldBorder()
			if open.Get() {
				border = colors.Accent()
			}
			return core.Style{
				Background:  colors.Surface(),
				BorderColor: border,
				GroupStyle: &core.GroupStyle{
					Hover:  &core.Style{Background: colors.Hover()},
					Active: &core.Style{Background: colors.Pressed()},
				},
			}
		},
		Children: []core.Node{
			core.Text{ContentFunc: title, MaxLines: 1,
				Style: core.Style{FontSize: typeBody, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				StyleFunc: func() core.Style {
					if !hasValue() {
						return core.Style{Color: colors.Faint()}
					}
					return core.Style{Color: colors.Text()}
				}},
			core.View{
				Style:    core.Style{FlexShrink: 0},
				Children: []core.Node{ui.Icon(lucide.ChevronDown, 14, colors.Muted)},
			},
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
	row := core.Style{
		Direction:    core.Row,
		AlignItems:   core.AlignCenter,
		Gap:          8,
		Padding:      core.Edges{Top: 7, Bottom: 7, Left: 10, Right: 18},
		CornerRadius: radiusItem,
	}
	b := base.Select{
		Ref:   anchor,
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
		RootStyle:    rootStyle,
		Style:        core.Style{Group: "button", FlexGrow: 1, CornerRadius: ui.RadiusControl},
		StyleFunc:    func() core.Style { return core.Style{FocusVisible: ui.FocusRing(cx, 2)} },
		Trigger:      field,
		OnLayout: func(bounds core.Bounds) {
			if ab, ok := anchor.ContentBounds(); ok && ab.Size.Width > 0 {
				triggerW.Set(ab.Size.Width)
			} else if bounds.Size.Width > 0 {
				triggerW.Set(bounds.Size.Width)
			}
		},
		PopupStyleFunc: func() core.Style {
			w := max(s.Width, triggerW.Get())
			if bounds, ok := anchor.ContentBounds(); ok && bounds.Size.Width > w {
				w = bounds.Size.Width
			}
			desired := max(popupWidth, w)
			if winW := cx.Env().Window().Width; winW > 0 {
				winCap := max(core.Points(200), winW-16)
				if desired > winCap {
					desired = winCap
				}
			}
			return ui.FinOf(cx).Menu().Over(core.Style{
				Width:        core.Pt(desired),
				MinWidth:     core.Pt(0),
				Padding:      core.All(4),
				CornerRadius: radiusMenu,
				BorderWidth:  1,
				Color:        colors.Text(),
			})
		},
		ListStyle: core.Style{MaxHeight: core.Pt(360)},
		ItemStyle: row,
		ItemStyleFunc: func() core.Style {
			return core.Style{Color: colors.Text(), Focus: &core.Style{Background: colors.Hover()}, Selected: &core.Style{Background: ui.Alpha(colors.Text(), 0.1)}}
		},
		Label:  label,
		TestID: s.TestID,
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
				children = append(children, core.View{
					Style:    core.Style{FlexShrink: 0},
					Children: []core.Node{ui.Icon(lucide.Check, 14, colors.Accent)},
				})
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
	if s.Searchable {
		b.Searchable = func() bool { return true }
		b.SearchPlaceholder = s.SearchPlaceholder
		b.SearchLabel = s.SearchPlaceholder
		if b.SearchLabel == "" {
			b.SearchLabel = locales.CommandSearch(cx)
		}
		b.SearchField = selectSearchField
		b.Empty = selectEmptyNode(cx, locales.SettingsPickerNoMatch(cx))
	}
	return b
}
