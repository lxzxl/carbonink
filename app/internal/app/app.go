// Package app is CarbonInk 2.0's desktop shell. Phase 1 wires the real
// workspace registry and SQLite store into the navigation; the remaining
// screens arrive in Phase 2 and later.
package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	"app.carbonink.desktop/internal/backup"
	"app.carbonink.desktop/internal/platform"
	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/internal/workspace"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base/datatable"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// Screen names one top-level destination.
type Screen string

const (
	ScreenDashboard  Screen = "dashboard"
	ScreenActivities Screen = "activities"
	ScreenSources    Screen = "sources"
	ScreenDocuments  Screen = "documents"
	ScreenReports    Screen = "reports"
	ScreenSettings   Screen = "settings"
)

// Session is one open workspace: the registry entry, the database, and the
// rows the first screen shows.
type Session struct {
	workspace  workspace.Workspace
	db         *store.Store
	activities []store.Activity
	imported   bool
	prefsPath  string
	settings   prefs.Settings
	log        *platform.Logger
}

// Root opens the active workspace and returns the shell. It is the app's
// first screen.
func Root(cx *core.Scope) core.Node {
	log := platform.NewLogger(cx.LogsDir())
	s, err := open(cx, log)
	if err != nil {
		log.Error("open workspace failed", "err", err)
		_ = log.Close()
		return errorView(cx, err)
	}
	log.Info("workspace ready", "name", s.workspace.Name, "file", s.workspace.File, "imported", s.imported)
	if s.settings.Locale != "" {
		cx.SetLocale(s.settings.Locale)
	}
	applyAppearance(cx, s.settings.Theme)
	cx.OnQuit(func(context.Context) {
		f := desktop.Frame(cx)
		s.settings.Window = &prefs.Window{
			X: float32(f.X), Y: float32(f.Y), Width: float32(f.Width), Height: float32(f.Height),
		}
		_ = prefs.Save(s.prefsPath, s.settings)
		log.Info("quit", "window", fmt.Sprintf("%.0fx%.0f", f.Width, f.Height))
		_ = log.Close()
		_ = s.db.Close()
	})
	return s.view(cx)
}

func open(cx *core.Scope, log *platform.Logger) (*Session, error) {
	ctx := context.Background()
	s := &Session{log: log}
	s.prefsPath = prefs.Path(cx.DataDir())
	if settings, err := prefs.Load(s.prefsPath); err == nil {
		s.settings = settings
	}
	var path string

	if testDB := os.Getenv("CARBONINK_TEST_DB"); testDB != "" {
		s.workspace = workspace.Workspace{ID: "test", Name: "Test workspace", File: filepath.Base(testDB)}
		path = testDB
	} else {
		m := workspace.New(cx.DataDir(), platform.LegacyDir())
		_, imported, err := m.Ensure()
		if err != nil {
			return nil, fmt.Errorf("workspace registry: %w", err)
		}
		s.imported = imported
		w, dbPath, err := m.Active()
		if err != nil {
			return nil, fmt.Errorf("active workspace: %w", err)
		}
		s.workspace, path = w, dbPath
	}

	db, err := store.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	s.db = db
	applied, err := db.Migrate(ctx)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}
	log.Info("migrations applied", "count", applied)
	s.activities, err = db.Activities(ctx, 5000)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("read activities: %w", err)
	}
	log.Info("activities loaded", "count", len(s.activities))
	if dest, err := backup.Run(ctx, db, cx.DataDir(), s.workspace.ID, time.Now()); err != nil {
		log.Warn("auto backup failed", "err", err)
	} else if dest != "" {
		log.Info("auto backup", "path", dest)
	}
	return s, nil
}

type screenInfo struct {
	ID    Screen
	Title func(*core.Scope) string
	Icon  func() *core.SVG
}

var screens = []screenInfo{
	{ScreenDashboard, locales.NavDashboard, lucide.LayoutDashboard},
	{ScreenActivities, locales.NavActivities, lucide.Table},
	{ScreenSources, locales.NavSources, lucide.Building},
	{ScreenDocuments, locales.NavDocuments, lucide.Files},
	{ScreenReports, locales.NavReports, lucide.ChartColumn},
	{ScreenSettings, locales.NavSettings, lucide.Settings},
}

func (s *Session) view(cx *core.Scope) core.Node {
	active := core.NewSignal(cx, ScreenActivities)
	open := core.NewSignal(cx, true)
	paletteOpen := core.NewSignal(cx, false)
	cx.OnKey("mod+k", func() { paletteOpen.Set(true) })

	byID := func(id Screen) screenInfo {
		for _, sc := range screens {
			if sc.ID == id {
				return sc
			}
		}
		return screens[0]
	}

	nav := []core.Node{
		core.View{Style: core.Style{Padding: core.Symmetric(10, 12), Gap: 2}, Children: []core.Node{
			core.Text{ContentFunc: func() string { return locales.AppName(cx) },
				Style: core.Style{FontSize: 15, FontWeight: ui.Bold}},
			core.Text{ContentFunc: func() string { return locales.WorkspaceActive(cx) + " · " + s.workspace.Name },
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
		}},
		core.View{Style: core.Style{Padding: core.Symmetric(0, 10)}, Children: []core.Node{
			paletteButton(cx, func() { paletteOpen.Set(true) }),
		}},
		navSection(cx, locales.NavOverview),
	}
	for _, sc := range screens {
		sc := sc
		switch sc.ID {
		case ScreenSources:
			nav = append(nav, navSection(cx, locales.NavInventory))
		case ScreenDocuments:
			nav = append(nav, navSection(cx, locales.NavInputs))
		case ScreenSettings:
			nav = append(nav, navSection(cx, locales.NavSystem))
		}
		nav = append(nav, navButton(cx, sc, func() bool { return active.Get() == sc.ID },
			func() { active.Set(sc.ID) }))
	}
	if s.imported {
		nav = append(nav, core.Text{ContentFunc: func() string { return locales.ImportedLegacy(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)})
	}

	content := []core.Node{
		core.Show{When: func() bool { return active.Get() == ScreenActivities },
			Then: func(cx *core.Scope) core.Node { return s.activitiesScreen(cx) }},
		core.Show{When: func() bool { return active.Get() == ScreenSettings },
			Then: func(cx *core.Scope) core.Node { return s.settingsScreen(cx) }},
		core.Show{When: func() bool {
			id := active.Get()
			return id != ScreenActivities && id != ScreenSettings
		},
			Then: func(cx *core.Scope) core.Node { return placeholder(cx) }},
		s.commandDialog(cx, paletteOpen, active),
	}

	return ui.SidebarShell{
		Variant:      ui.SidebarShellInset,
		Open:         open.Get,
		OnOpenChange: open.Set,
		ToggleLabel:  "Toggle sidebar",
		Sidebar:      []core.Node{core.View{Style: core.Style{Gap: 2, Padding: core.Symmetric(4, 0)}, Children: nav}},
		Header: []core.Node{
			core.View{Style: core.Style{Gap: 2}, Children: []core.Node{
				core.Text{ContentFunc: func() string { return byID(active.Get()).Title(cx) },
					Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
				core.Text{ContentFunc: func() string {
					if active.Get() == ScreenActivities {
						return locales.ActivitiesSubtitle(cx) + " · " + locales.ActivitiesCount(cx, len(s.activities))
					}
					return ""
				}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
			}},
		},
		Content: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
				Children: content},
		},
		TestID: "shell",
	}
}

// navButton is SidebarButton with a reactive label, so switching language
// updates the sidebar without a restart.
func navButton(cx *core.Scope, sc screenInfo, selected func() bool, onPress func()) core.Node {
	return core.View{
		TestID: "nav:" + string(sc.ID),
		Role:   core.RoleButton,
		OnPress: func(core.PressEvent) {
			onPress()
		},
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
			Height: core.Pt(30), Padding: core.Symmetric(0, 8), CornerRadius: 6},
		StyleFunc: func() core.Style {
			if selected() {
				return core.Style{Background: ui.Alpha(ui.ColorsOf(cx).Accent(), 0.12)}
			}
			return core.Style{}
		},
		Children: []core.Node{
			ui.Icon(sc.Icon, 16, ui.ColorsOf(cx).Muted),
			core.Text{ContentFunc: func() string { return sc.Title(cx) },
				Style: core.Style{FontSize: 13}, MaxLines: 1},
		},
	}
}

func navSection(cx *core.Scope, title func(*core.Scope) string) core.Node {
	return core.Text{ContentFunc: func() string { return title(cx) },
		Style:     core.Style{FontSize: 11, FontWeight: ui.Semibold, Padding: core.Edges{Left: 12, Top: 10, Bottom: 2}},
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)}
}

func placeholder(cx *core.Scope) core.Node {
	return core.View{Style: core.Style{FlexGrow: 1, AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter, Padding: core.All(32)},
		Children: []core.Node{
			core.Text{ContentFunc: func() string { return locales.PhaseTwo(cx) },
				Style: core.Style{FontSize: 14}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}}
}

func errorView(cx *core.Scope, err error) core.Node {
	return core.View{Style: core.Style{FlexGrow: 1, AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter, Padding: core.All(32), Gap: 8},
		Children: []core.Node{
			core.Text{Content: "CarbonInk could not open the workspace",
				Style: core.Style{FontSize: 16, FontWeight: ui.Semibold}},
			core.Text{Content: err.Error(), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}}
}

func (s *Session) activitiesScreen(cx *core.Scope) core.Node {
	sortBy := core.NewSignal(cx, datatable.Sort{Key: "date", Descending: true})
	revision := core.NewSignal(cx, 0)
	rows := s.activities
	sortRows(rows, sortBy.Get())

	columns := func() []datatable.Column {
		return []datatable.Column{
			{Key: "date", Title: locales.ColDate(cx), Width: 104, Sortable: true},
			{Key: "site", Title: locales.ColSite(cx), Width: 140, Sortable: true},
			{Key: "source", Title: locales.ColSource(cx), Width: 240, Sortable: true},
			{Key: "amount", Title: locales.ColAmount(cx), Width: 110, Align: datatable.AlignEndColumn, Sortable: true},
			{Key: "unit", Title: locales.ColUnit(cx), Width: 70},
			{Key: "co2e", Title: locales.ColCO2e(cx), Width: 130, Align: datatable.AlignEndColumn, Sortable: true},
			{Key: "scope", Title: locales.ColScope(cx), Width: 70, Align: datatable.AlignCenterColumn},
		}
	}

	return core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0), Padding: core.All(16), Gap: 10},
		Children: []core.Node{
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
				core.Text{ContentFunc: func() string { return locales.ActivitiesCount(cx, len(rows)) },
					Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
				core.Text{ContentFunc: func() string {
					sp := sortBy.Get()
					if sp.Key == "" {
						return ""
					}
					dir := "ascending"
					if sp.Descending {
						dir = "descending"
					}
					return "· " + sp.Key + " " + dir
				}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			}},
			core.View{Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)}, Children: []core.Node{
				datatable.DataTable{
					TestID: "activities-table", Label: locales.ActivitiesTitle(cx),
					Columns:  columns,
					RowCount: func() int { _ = revision.Get(); return len(rows) },
					Text: func(row, col int) string {
						_ = revision.Get()
						if row < 0 || row >= len(rows) {
							return ""
						}
						return activityCell(rows[row], col)
					},
					RowHeight: 30, FontSize: 13, NoRowHeader: true,
					Stripe: func() bool { return true },
					Sort:   sortBy.Get,
					StyleFunc: func() core.Style {
						return core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0), CornerRadius: 8,
							BorderWidth: 1, BorderColor: ui.ColorsOf(cx).Border(), Background: ui.ColorsOf(cx).Surface()}
					},
					OnSortChange: func(next datatable.Sort) {
						sortBy.Set(next)
						sortRows(rows, next)
						revision.Set(revision.Get() + 1)
					},
					Empty: core.View{Style: core.Style{FlexGrow: 1, AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter},
						Children: []core.Node{
							core.Text{ContentFunc: func() string { return locales.ActivitiesEmpty(cx) },
								Style: core.Style{FontSize: 13}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
						}},
				},
			}},
		}}
}

func activityCell(a store.Activity, col int) string {
	switch col {
	case 0:
		if len(a.OccurredAt) >= 10 {
			return a.OccurredAt[:10]
		}
		return a.OccurredAt
	case 1:
		return a.Site
	case 2:
		return a.Source
	case 3:
		return commaFloat(a.Amount)
	case 4:
		return a.Unit
	case 5:
		return commaFloat(a.CO2eKg)
	default:
		return strconv.Itoa(a.Scope)
	}
}

func sortRows(rows []store.Activity, s datatable.Sort) {
	less := func(i, j int) bool {
		switch s.Key {
		case "site":
			return rows[i].Site < rows[j].Site
		case "source":
			return rows[i].Source < rows[j].Source
		case "amount":
			return rows[i].Amount < rows[j].Amount
		case "co2e":
			return rows[i].CO2eKg < rows[j].CO2eKg
		default:
			return rows[i].OccurredAt < rows[j].OccurredAt
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if s.Descending {
			return less(j, i)
		}
		return less(i, j)
	})
}

func commaFloat(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	dot := len(s) - 3
	for i := dot - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}
