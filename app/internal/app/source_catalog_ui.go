package app

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/presets"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/i18n"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// catalogPageSize caps the rows rendered at once; "load more" grows the page.
const catalogPageSize = 100

// sourceCatalog is the dialog state for the bundled preset catalog.
type sourceCatalog struct {
	open     *core.Signal[bool]
	rev      *core.Signal[int]
	query    *core.Signal[string]
	scope    *core.Signal[int]
	category *core.Signal[string]
	status   *core.Signal[string]
	busy     *core.Signal[bool]
	selected map[string]bool

	// existing holds the preset ids already in the organization, keyed by
	// template_origin, so adding the same preset twice is impossible.
	existing map[string]bool
	limit    int
}

func (s *Session) sourceCatalogDialog(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	node, _ := s.sourceCatalogDialogWithShow(cx, dataRev, false)
	return node
}

func (s *Session) sourceCatalogDialogWithShow(cx *core.Scope,
	dataRev *core.Signal[int], opened bool) (core.Node, func()) {
	c := &sourceCatalog{
		open:     core.NewSignal(cx, opened),
		rev:      core.NewSignal(cx, 0),
		query:    core.NewSignal(cx, ""),
		scope:    core.NewSignal(cx, 0),
		category: core.NewSignal(cx, ""),
		status:   core.NewSignal(cx, ""),
		busy:     core.NewSignal(cx, false),
		selected: map[string]bool{},
		existing: map[string]bool{},
		limit:    catalogPageSize,
	}
	for _, src := range s.sources {
		if src.TemplateOrigin != "" {
			c.existing[src.TemplateOrigin] = true
		}
	}
	show := func() {
		c.query.Set("")
		c.scope.Set(0)
		c.category.Set("")
		c.status.Set("")
		c.busy.Set(false)
		c.selected = map[string]bool{}
		c.limit = catalogPageSize
		c.existing = map[string]bool{}
		for _, src := range s.sources {
			if src.TemplateOrigin != "" {
				c.existing[src.TemplateOrigin] = true
			}
		}
		c.rev.Set(c.rev.Get() + 1)
		c.open.Set(true)
	}
	add := func() {
		if c.busy.Get() {
			return
		}
		chosen := c.selected
		if len(chosen) == 0 {
			return
		}
		siteID := ""
		for _, site := range s.sites {
			if site.IsActive {
				siteID = site.ID
				break
			}
		}
		if siteID == "" {
			c.status.Set(locales.SourcesCatalogNoSite(cx))
			return
		}
		ids := make([]string, 0, len(chosen))
		for id := range chosen {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		lang := i18n.Language(cx)
		inputs := make([]store.SourceInput, 0, len(ids))
		for _, id := range ids {
			preset, ok := presets.ByID(id)
			if !ok {
				continue
			}
			inputs = append(inputs, store.SourceInput{
				SiteID:          siteID,
				Name:            preset.Name(lang),
				Scope:           preset.Scope,
				Category:        preset.EFCategory(),
				GHGProtocolPath: preset.Code(),
				TemplateOrigin:  preset.ID,
			})
		}
		c.busy.Set(true)
		created, err := s.db.CreateSources(context.Background(), inputs)
		c.busy.Set(false)
		if err != nil {
			c.status.Set(err.Error())
			c.rev.Set(c.rev.Get() + 1)
			return
		}
		s.recordSourceBatchCreate(created, dataRev)
		c.open.Set(false)
		_ = dataRefresh(s, dataRev)
	}

	search := ui.Input{Value: c.query.Get, Placeholder: locales.SourcesCatalogSearchPlaceholder(cx),
		OnChange: func(v string) {
			c.query.Set(v)
			c.limit = catalogPageSize
			c.rev.Set(c.rev.Get() + 1)
		},
		TestID: "source-catalog-search"}

	scopeOptions := []ui.Option[int]{
		{Value: 0, Label: locales.SourcesCatalogScopeAll(cx)},
		{Value: 1, Label: locales.SourcesCatalogScope1Short(cx)},
		{Value: 2, Label: locales.SourcesCatalogScope2Short(cx)},
		{Value: 3, Label: locales.SourcesCatalogScope3Short(cx)},
	}
	categoryOptions := []ui.Option[string]{{Value: "", Label: locales.SourcesCatalogCategoryAll(cx)}}
	for _, category := range presets.Categories() {
		categoryOptions = append(categoryOptions, ui.Option[string]{
			Value: category, Label: presets.CategoryLabel(category, i18n.Language(cx))})
	}

	footer := []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
		_ = c.rev.Get()
		return core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
			Wrap: core.Wrap, Gap: 8, Width: core.Pct(100)},
			Children: []core.Node{
				core.Text{Content: locales.SourcesCatalogSelectedCount(cx,
					strconv.Itoa(len(c.selected))), Style: core.Style{FontSize: 12},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
				core.View{Style: core.Style{FlexGrow: 1}},
				dataCancelButton(cx, c.open, "source-catalog-cancel"),
				ui.Button{Text: locales.SourcesCatalogAdd(cx),
					Disabled: func() bool { return len(c.selected) == 0 }, Busy: c.busy.Get,
					OnPress: add, TestID: "source-catalog-add"},
			}}
	})}

	return core.View{Children: []core.Node{
		ui.Button{Text: locales.SourcesCatalogButton(cx), Icon: lucide.Layers,
			Variant: ui.ButtonOutline,
			OnPress: show, TestID: "source-catalog"},
		sideDrawer(cx, c.open, locales.SourcesCatalogTitle(cx), 680, []core.Node{
			search,
			dataColumns(cx, 8,
				dataField(cx, locales.SourcesFormScope(cx),
					appSelect[int]{Options: scopeOptions, Value: c.scope.Get,
						OnChange: func(scope int) {
							c.category.Set("")
							c.scope.Set(scope)
							c.limit = catalogPageSize
							c.rev.Set(c.rev.Get() + 1)
						},
						Label: locales.SourcesFormScope(cx), TestID: "source-catalog-scope",
						Style: core.Style{Width: core.Pct(100)}}),
				dataField(cx, locales.SourcesFormCategory(cx),
					appSelect[string]{Options: categoryOptions, Value: c.category.Get,
						OnChange: func(category string) {
							c.category.Set(category)
							c.limit = catalogPageSize
							c.rev.Set(c.rev.Get() + 1)
						},
						Label: locales.SourcesFormCategory(cx), Searchable: true,
						SearchPlaceholder: locales.SourcesFormCategorySearch(cx),
						Empty:             locales.SourcesFormCategoryEmpty(cx),
						TestID:            "source-catalog-category",
						Style:             core.Style{Width: core.Pct(100)}}),
			),
			core.Dynamic(func(cx *core.Scope) core.Node {
				_ = c.rev.Get()
				return catalogList(cx, c)
			}),
			dataError(cx, c.status),
		}, footer, "source-catalog-dialog", locales.DataCancel(cx)),
	}}, show
}

func (c *sourceCatalog) filtered() []presets.Preset {
	query := c.query.Get()
	scope := c.scope.Get()
	category := c.category.Get()
	out := make([]presets.Preset, 0, 64)
	for _, preset := range presets.All {
		if scope != 0 && preset.Scope != scope {
			continue
		}
		if category != "" && preset.Category != category {
			continue
		}
		if !preset.Matches(query) {
			continue
		}
		out = append(out, preset)
	}
	return out
}

func catalogList(cx *core.Scope, c *sourceCatalog) core.Node {
	visible := c.filtered()
	lang := i18n.Language(cx)
	if len(visible) == 0 {
		return core.Text{Content: locales.SourcesCatalogNoResults(cx), Style: core.Style{FontSize: 12},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
	}
	shown := c.limit
	if shown > len(visible) {
		shown = len(visible)
	}
	rows := make([]core.Node, 0, shown+2)
	rows = append(rows, core.Text{
		Content: locales.SourcesCatalogCount(cx, strconv.Itoa(shown), strconv.Itoa(len(visible))),
		Style:   core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)})
	for i := 0; i < shown; i++ {
		preset := visible[i]
		already := c.existing[preset.ID]
		primary, secondary := catalogNames(preset, lang)
		meta := presets.CategoryLabel(preset.Category, lang) + " · " + preset.HintUnit
		provenance := strings.Join([]string{preset.Source, preset.Region, strconv.Itoa(preset.Year)}, " · ")
		kids := []core.Node{
			ui.Checkbox{
				Checked:  func() bool { return c.selected[preset.ID] },
				Disabled: func() bool { return already },
				OnChange: func(checked bool) {
					if checked {
						c.selected[preset.ID] = true
					} else {
						delete(c.selected, preset.ID)
					}
					c.rev.Set(c.rev.Get() + 1)
				},
				Label:  primary,
				TestID: "source-catalog-item-" + preset.ID,
			},
			core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6},
						Children: []core.Node{
							core.Text{Content: primary, Style: core.Style{FontSize: typeBody, FontWeight: ui.Semibold},
								MaxLines: 1},
							core.Text{Content: secondary, Style: core.Style{FontSize: typeMicro},
								StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
						}},
					core.Text{Content: meta, Style: core.Style{FontSize: typeMicro},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
					core.Text{Content: provenance, Style: core.Style{FontSize: typeMicro},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				}},
		}
		if already {
			kids = append(kids, ui.Badge{Text: locales.SourcesCatalogAdded(cx), Variant: ui.BadgeNeutral})
		}
		rows = append(rows, core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
				Padding: core.Symmetric(7, 0), Borders: core.Edges{Bottom: 1}},
			StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
			Children:  kids,
		})
	}
	if shown < len(visible) {
		rows = append(rows, core.View{Style: core.Style{Padding: core.Symmetric(8, 0)},
			Children: []core.Node{
				ui.Button{Text: locales.SourcesCatalogLoadMore(cx), Variant: ui.ButtonSecondary,
					OnPress: func() {
						c.limit += catalogPageSize
						c.rev.Set(c.rev.Get() + 1)
					},
					TestID: "source-catalog-more"},
			}})
	}
	return core.View{Style: core.Style{Gap: 0}, Children: rows}
}

func catalogNames(preset presets.Preset, locale string) (string, string) {
	if strings.HasPrefix(strings.ToLower(locale), "zh") {
		return preset.NameZH, preset.NameEN
	}
	return preset.NameEN, preset.NameZH
}
