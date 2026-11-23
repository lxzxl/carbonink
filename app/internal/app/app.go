// Package app is CarbonInk 2.0's desktop shell. Phase 1 wires the real
// workspace registry and SQLite store into the navigation; the remaining
// screens arrive in Phase 2 and later.
package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"app.carbonink.desktop/internal/agentbridge"
	"app.carbonink.desktop/internal/backup"
	"app.carbonink.desktop/internal/platform"
	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/internal/undo"
	"app.carbonink.desktop/internal/workspace"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// Screen names one top-level destination.
type Screen string

const (
	ScreenDashboard           Screen = "dashboard"
	ScreenActivities          Screen = "activities"
	ScreenSources             Screen = "sources"
	ScreenDocuments           Screen = "documents"
	ScreenQuestionnaires      Screen = "questionnaires"
	ScreenSupplierDisclosures Screen = "supplier-disclosures"
	ScreenReports             Screen = "reports"
	ScreenAudit               Screen = "audit"
	ScreenSettings            Screen = "settings"
)

// Session is one open workspace: the registry entry, the database, and the
// rows the first screen shows.
type Session struct {
	// scope is the app root scope; background work posts UI updates here so
	// they survive the screen that started them.
	scope          *core.Scope
	workspace      workspace.Workspace
	workspaces     *workspace.Manager
	db             *store.Store
	organization   *store.Organization
	sites          []store.Site
	periods        []store.ReportingPeriod
	sources        []store.EmissionSource
	summary        store.Summary
	totals         store.ReportTotals
	activities     []store.Activity
	documents      []store.Document
	documentTotal  int
	questionnaires []store.Questionnaire
	suppliers      []store.Customer
	// extractionStatus is keyed by document id; documents without a row
	// have no extraction yet.
	extractionStatus map[string]store.ExtractionDocumentStatus
	batch            *batchExtraction
	imported         bool
	adoptedProvider  bool
	dataDir          string
	dataRev          *core.Signal[int]
	bridge           *agentbridge.Server
	prefsPath        string
	settings         prefs.Settings
	log              *platform.Logger
	undo             *undo.Manager
	undoStatus       *core.Signal[string]
	// pendingActivity is a cross-screen jump target; the activities table
	// consumes it on its next build and clears it.
	pendingActivity string
	// pendingNewActivity and pendingSourceCatalog open those dialogs when
	// the dashboard's getting-started CTA lands on their screen.
	pendingNewActivity   bool
	pendingSourceCatalog bool
	// pendingSupplierDisclosure opens an inbound disclosure when an activity
	// row's provenance link sends the user to the supplier-disclosures screen.
	pendingSupplierDisclosure string
}

// Root opens the active workspace and returns the shell. It is the app's
// first screen.
func Root(cx *core.Scope) core.Node {
	cx.SetTheme(carboninkTheme())
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
	notifyOverdueInbound(cx, s)
	s.dataRev = core.NewSignal(cx, 0)
	s.startBridge(cx)
	cx.OnQuit(func(context.Context) {
		s.stopBridge()
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
	s := &Session{log: log, dataDir: cx.DataDir(), scope: cx, batch: newBatchExtraction(cx),
		undo: undo.New(100)}
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
		s.workspaces = m
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
	if err := s.reload(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("read workspace data: %w", err)
	}
	if s.imported {
		if adoptLegacyProvider(ctx, db, &s.settings) {
			if err := prefs.Save(s.prefsPath, s.settings); err != nil {
				log.Warn("save imported provider settings failed", "err", err)
			} else {
				s.adoptedProvider = true
				log.Info("adopted legacy provider", "provider", s.settings.LLMProvider,
					"model", s.settings.LLMModel)
			}
		}
	}
	log.Info("workspace loaded", "organization", s.organization != nil, "sites", len(s.sites),
		"periods", len(s.periods), "sources", len(s.sources), "activities", len(s.activities))
	if autoBackupEnabled(ctx, db) {
		made, err := runAutoBackup(ctx, s, cx.DataDir())
		if err != nil {
			log.Warn("auto backup failed", "err", err)
		}
		for _, dest := range made {
			log.Info("auto backup", "path", dest)
		}
	}
	return s, nil
}

// autoBackupSettingKey gates the boot snapshot. Absent or any value but
// "false" means enabled, matching 1.x.
const autoBackupSettingKey = "auto_backup.enabled"

func autoBackupEnabled(ctx context.Context, db *store.Store) bool {
	value, ok, err := db.Setting(ctx, autoBackupSettingKey)
	return err != nil || !ok || value != "false"
}

// runAutoBackup snapshots every registered workspace when one is due. With
// CARBONINK_TEST_DB there is no registry, so the single open database is the
// only target.
func runAutoBackup(ctx context.Context, s *Session, dataDir string) ([]string, error) {
	if s.workspaces == nil {
		dest, err := backup.Run(ctx, s.db, dataDir, s.workspace.ID, time.Now())
		if dest == "" {
			return nil, err
		}
		return []string{dest}, err
	}
	reg, err := s.workspaces.Load()
	if err != nil {
		return nil, err
	}
	targets := make([]backup.Target, 0, len(reg.Workspaces))
	for _, w := range reg.Workspaces {
		targets = append(targets, backup.Target{ID: w.ID, File: w.File})
	}
	return backup.RunAll(ctx, s.db, dataDir, targets, s.workspace.ID, time.Now())
}

// reload refreshes the records every Phase 2 screen reads. It is called at
// startup and after each write, so the views never need their own caches.
func (s *Session) reload(ctx context.Context) error {
	documents, documentTotal, err := s.db.ListDocuments(ctx, 200, 0)
	if err != nil {
		return err
	}
	s.documents, s.documentTotal = documents, documentTotal
	questionnaires, err := s.db.ListQuestionnaires(ctx)
	if err != nil {
		return err
	}
	s.questionnaires = questionnaires
	suppliers, err := s.db.ListSuppliers(ctx)
	if err != nil {
		return err
	}
	s.suppliers = suppliers
	statuses, err := s.db.ExtractionStatusByDocument(ctx)
	if err != nil {
		return err
	}
	s.extractionStatus = make(map[string]store.ExtractionDocumentStatus, len(statuses))
	for _, status := range statuses {
		s.extractionStatus[status.DocumentID] = status
	}
	org, err := s.db.CurrentOrganization(ctx)
	if err != nil {
		return err
	}
	s.organization = org
	s.sites = nil
	s.periods = nil
	s.sources = nil
	s.summary = store.Summary{}
	s.totals = store.ReportTotals{}
	if org != nil {
		if s.sites, err = s.db.ListSites(ctx, org.ID); err != nil {
			return err
		}
		if s.periods, err = s.db.ListPeriods(ctx, org.ID); err != nil {
			return err
		}
		if s.sources, err = s.db.ListSources(ctx, org.ID); err != nil {
			return err
		}
		if s.summary, err = s.db.Summary(ctx, org.ID); err != nil {
			return err
		}
		if len(s.periods) > 0 {
			if s.totals, err = s.db.ActivityTotals(ctx, s.periods[len(s.periods)-1].ID); err != nil {
				return err
			}
		}
	}
	s.activities, err = s.db.Activities(ctx, 0)
	return err
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
	{ScreenQuestionnaires, locales.NavDisclosureFilings, lucide.ClipboardList},
	{ScreenSupplierDisclosures, locales.NavSupplierDisclosures, lucide.ClipboardCheck},
	{ScreenReports, locales.NavReports, lucide.ChartColumn},
	{ScreenAudit, locales.AuditNav, lucide.ScrollText},
	{ScreenSettings, locales.NavSettings, lucide.Settings},
}

func (s *Session) view(cx *core.Scope) core.Node {
	start := ScreenActivities
	if s.organization == nil {
		start = ScreenDashboard
	}
	active := core.NewSignal(cx, start)
	open := core.NewSignal(cx, true)
	paletteOpen := core.NewSignal(cx, false)
	undoStatus := core.NewSignal(cx, "")
	s.undoStatus = undoStatus
	dataRev := s.dataRev
	cx.OnKey("mod+k", func() { paletteOpen.Set(true) })
	cx.OnKey("mod+z", func() { s.performHistory(cx, dataRev, false) })
	cx.OnKey("mod+shift+z", func() { s.performHistory(cx, dataRev, true) })
	cx.OnKey("mod+y", func() { s.performHistory(cx, dataRev, true) })
	cx.OnNotificationPress(func(id string) {
		if id == overdueNotificationID {
			active.Set(ScreenSupplierDisclosures)
		}
	})

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
		case ScreenQuestionnaires:
			nav = append(nav, navSection(cx, locales.NavDisclosures))
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
	nav = append(nav, core.Show{When: func() bool { return undoStatus.Get() != "" },
		Then: func(cx *core.Scope) core.Node {
			return core.Text{ContentFunc: func() string { return undoStatus.Get() },
				Style:     core.Style{FontSize: 11, Padding: core.All(10)},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2}
		}})

	content := []core.Node{
		core.Show{When: func() bool { return active.Get() == ScreenActivities },
			Then: func(cx *core.Scope) core.Node { return s.activitiesScreen(cx, dataRev, active) }},
		core.Show{When: func() bool { return active.Get() == ScreenDashboard },
			Then: func(cx *core.Scope) core.Node { return s.dashboardScreen(cx, dataRev, active) }},
		core.Show{When: func() bool { return active.Get() == ScreenSources },
			Then: func(cx *core.Scope) core.Node { return s.sourcesScreen(cx, dataRev) }},
		core.Show{When: func() bool { return active.Get() == ScreenDocuments },
			Then: func(cx *core.Scope) core.Node { return s.documentsScreen(cx, dataRev) }},
		core.Show{When: func() bool { return active.Get() == ScreenQuestionnaires },
			Then: func(cx *core.Scope) core.Node { return s.questionnairesScreen(cx, dataRev) }},
		core.Show{When: func() bool { return active.Get() == ScreenSupplierDisclosures },
			Then: func(cx *core.Scope) core.Node { return s.supplierDisclosuresScreen(cx, dataRev) }},
		core.Show{When: func() bool { return active.Get() == ScreenReports },
			Then: func(cx *core.Scope) core.Node { return s.reportsScreen(cx, dataRev, active) }},
		core.Show{When: func() bool { return active.Get() == ScreenAudit },
			Then: func(cx *core.Scope) core.Node {
				return s.auditScreen(cx, dataRev, func(id string) {
					s.pendingActivity = id
					active.Set(ScreenActivities)
				})
			}},
		core.Show{When: func() bool { return active.Get() == ScreenSettings },
			Then: func(cx *core.Scope) core.Node { return s.settingsScreen(cx) }},
		core.Show{When: func() bool {
			id := active.Get()
			return id != ScreenActivities && id != ScreenDashboard &&
				id != ScreenSources && id != ScreenDocuments && id != ScreenQuestionnaires &&
				id != ScreenSupplierDisclosures && id != ScreenReports &&
				id != ScreenAudit && id != ScreenSettings
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
					_ = dataRev.Get()
					switch active.Get() {
					case ScreenActivities:
						return locales.ActivitiesSubtitle(cx)
					case ScreenDashboard:
						return locales.WorkspaceActive(cx) + " · " + s.workspace.Name
					case ScreenSources:
						return locales.DataSourcesSubtitle(cx)
					case ScreenDocuments:
						return locales.DocumentsSubtitle(cx)
					case ScreenQuestionnaires:
						return locales.QuestionnairesSubtitle(cx)
					case ScreenSupplierDisclosures:
						return locales.SupplierDisclosuresSubtitle(cx)
					case ScreenReports:
						return locales.ReportsListSubheading(cx)
					case ScreenAudit:
						return locales.AuditSubheading(cx)
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
				return core.Style{Background: selectionTint(cx)}
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

func commaFloat(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	dot := len(s) - 3
	for i := dot - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}
