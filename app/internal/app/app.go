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
	"app.carbonink.desktop/internal/mcpconfig"
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
	pendingNewActivity      bool
	pendingImportActivities bool
	pendingSourceCatalog    bool
	// pendingSupplierDisclosure opens an inbound disclosure when an activity
	// row's provenance link sends the user to the supplier-disclosures screen.
	pendingSupplierDisclosure string
	// onboarded flips once the setup wizard finishes, so the root swaps to
	// the shell without watching every data refresh.
	onboarded *core.Signal[bool]
	// justOnboarded lands the first shell on the dashboard, as 1.x did
	// after the wizard.
	justOnboarded bool
	// mcpRev changes when the agent-host configuration changes, so the
	// sidebar's MCP status dot follows Settings without a restart.
	mcpRev *core.Signal[int]
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
	s.onboarded = core.NewSignal(cx, s.organization != nil)
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
	return s.rootView(cx)
}

// rootView chooses between the full-screen onboarding wizard and the
// inventory shell. 1.x suppressed the sidebar and header until onboarding
// finished, so the wizard owns the whole window.
func (s *Session) rootView(cx *core.Scope) core.Node {
	return core.Show{
		When: func() bool { return s.onboarded != nil && s.onboarded.Get() },
		Then: s.view,
		Else: s.onboardingRoot,
	}
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
	{ScreenAudit, locales.AuditNav, lucide.FileSearch},
	{ScreenSources, locales.NavSources, lucide.SlidersHorizontal},
	{ScreenActivities, locales.NavActivities, lucide.Flame},
	{ScreenReports, locales.NavReports, lucide.ScrollText},
	{ScreenDocuments, locales.NavDocuments, lucide.FileText},
	{ScreenQuestionnaires, locales.NavDisclosureFilings, lucide.ClipboardList},
	{ScreenSupplierDisclosures, locales.NavSupplierDisclosures, lucide.Download},
	{ScreenSettings, locales.NavSettings, lucide.Settings},
}

// navGroups is 1.x's sidebar: Overview, Inventory, Inputs. Settings lives in
// the sidebar footer, not in a fourth group.
var navGroups = []struct {
	Title func(*core.Scope) string
	Items []Screen
}{
	{locales.NavSectionGeneral, []Screen{ScreenDashboard, ScreenAudit}},
	{locales.NavSectionInventory, []Screen{ScreenSources, ScreenActivities, ScreenReports}},
	{locales.NavSectionDocumentsQuestionnaires,
		[]Screen{ScreenDocuments, ScreenQuestionnaires, ScreenSupplierDisclosures}},
}

func (s *Session) view(cx *core.Scope) core.Node {
	start := ScreenActivities
	if s.justOnboarded {
		start = ScreenDashboard
		s.justOnboarded = false
	}
	nav := newScreenNav(cx, start)
	s.mcpRev = core.NewSignal(cx, 0)
	s.watchMCP(cx)
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
			nav.Set(ScreenSupplierDisclosures)
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

	overdue := s.overdueSupplierDisclosures()
	subtitle := func() string { return locales.AppTagline(cx) }
	if s.workspaces != nil {
		if registry, err := s.workspaces.Load(); err == nil && len(registry.Workspaces) > 1 {
			name := s.workspace.Name
			subtitle = func() string { return name }
		}
	}
	items := []core.Node{brandHeader(cx, subtitle)}
	for _, group := range navGroups {
		items = append(items, navSection(cx, group.Title))
		for _, id := range group.Items {
			sc := byID(id)
			badge := 0
			if id == ScreenSupplierDisclosures {
				badge = overdue
			}
			items = append(items, navButton(cx, sc, badge, func() bool { return nav.Get() == sc.ID },
				func() { nav.Set(sc.ID) }))
		}
	}
	if s.imported {
		items = append(items, core.Text{ContentFunc: func() string { return locales.ImportedLegacy(cx) },
			Style:     core.Style{FontSize: 11, Padding: core.Symmetric(4, 12)},
			StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)})
	}
	items = append(items, core.Show{When: func() bool { return undoStatus.Get() != "" },
		Then: func(cx *core.Scope) core.Node {
			return core.Text{ContentFunc: func() string { return undoStatus.Get() },
				Style:     core.Style{FontSize: 11, Padding: core.All(10)},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2}
		}})

	content := []core.Node{
		core.Show{When: func() bool { return nav.Get() == ScreenActivities },
			Then: func(cx *core.Scope) core.Node { return s.activitiesScreen(cx, dataRev, nav) }},
		core.Show{When: func() bool { return nav.Get() == ScreenDashboard },
			Then: func(cx *core.Scope) core.Node { return s.dashboardScreen(cx, dataRev, nav) }},
		core.Show{When: func() bool { return nav.Get() == ScreenSources },
			Then: func(cx *core.Scope) core.Node { return s.sourcesScreen(cx, dataRev) }},
		core.Show{When: func() bool { return nav.Get() == ScreenDocuments },
			Then: func(cx *core.Scope) core.Node { return s.documentsScreen(cx, dataRev) }},
		core.Show{When: func() bool { return nav.Get() == ScreenQuestionnaires },
			Then: func(cx *core.Scope) core.Node { return s.questionnairesScreen(cx, dataRev) }},
		core.Show{When: func() bool { return nav.Get() == ScreenSupplierDisclosures },
			Then: func(cx *core.Scope) core.Node { return s.supplierDisclosuresScreen(cx, dataRev) }},
		core.Show{When: func() bool { return nav.Get() == ScreenReports },
			Then: func(cx *core.Scope) core.Node { return s.reportsScreen(cx, dataRev, nav) }},
		core.Show{When: func() bool { return nav.Get() == ScreenAudit },
			Then: func(cx *core.Scope) core.Node {
				return s.auditScreen(cx, dataRev, func(id string) {
					s.pendingActivity = id
					nav.Set(ScreenActivities)
				})
			}},
		core.Show{When: func() bool { return nav.Get() == ScreenSettings },
			Then: func(cx *core.Scope) core.Node { return s.settingsScreen(cx, dataRev) }},
		core.Show{When: func() bool {
			id := nav.Get()
			return id != ScreenActivities && id != ScreenDashboard &&
				id != ScreenSources && id != ScreenDocuments && id != ScreenQuestionnaires &&
				id != ScreenSupplierDisclosures && id != ScreenReports &&
				id != ScreenAudit && id != ScreenSettings
		},
			Then: func(cx *core.Scope) core.Node { return placeholder(cx) }},
		s.commandDialog(cx, paletteOpen, nav),
	}

	return ui.SidebarShell{
		Variant:      ui.SidebarShellInset,
		Open:         open.Get,
		DefaultWidth: 256,
		Fixed:        true,
		Sidebar:      []core.Node{core.View{Style: core.Style{Gap: 2, Padding: core.Symmetric(4, 8)}, Children: items}},
		SidebarFooter: []core.Node{
			navButton(cx, byID(ScreenSettings), 0,
				func() bool { return nav.Get() == ScreenSettings },
				func() { nav.Set(ScreenSettings) }, s.mcpStatusDot(cx)),
		},
		Header: []core.Node{
			ui.Button{Variant: ui.ButtonOutline, Icon: lucide.PanelLeft, Side: 28, IconSize: 14,
				Label: locales.SidebarToggle(cx), TestID: "sidebar-toggle",
				OnPress: func() { open.Set(!open.Get()) }},
			core.View{Style: core.Style{Width: core.Pt(1), Height: core.Pt(20), FlexShrink: 0},
				StyleFunc: ui.Filled(ui.ColorsOf(cx).Border)},
			ui.Button{Variant: ui.ButtonGhost, Icon: lucide.ArrowLeft, Side: 28, IconSize: 16,
				Label: locales.TopbarBack(cx), TestID: "nav-back",
				Disabled: func() bool { return !nav.CanBack() }, OnPress: nav.Back},
			ui.Button{Variant: ui.ButtonGhost, Icon: lucide.ArrowRight, Side: 28, IconSize: 16,
				Label: locales.TopbarForward(cx), TestID: "nav-forward",
				Disabled: func() bool { return !nav.CanForward() }, OnPress: nav.Forward},
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
func navButton(cx *core.Scope, sc screenInfo, badge int, selected func() bool, onPress func(),
	trailing ...core.Node) core.Node {
	children := []core.Node{
		ui.Icon(sc.Icon, 16, ui.ColorsOf(cx).Muted),
		core.Text{ContentFunc: func() string { return sc.Title(cx) },
			Style: core.Style{FontSize: 13, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)}, MaxLines: 1},
	}
	if badge > 0 {
		children = append(children, ui.Badge{Text: strconv.Itoa(badge), Variant: ui.BadgeDanger})
	}
	children = append(children, trailing...)
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
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Gap: 8, FlexGrow: 1}, Children: children},
		},
	}
}

func navSection(cx *core.Scope, title func(*core.Scope) string) core.Node {
	return core.Text{ContentFunc: func() string { return title(cx) },
		Style:     core.Style{FontSize: 11, FontWeight: ui.Semibold, Padding: core.Edges{Left: 8, Top: 12, Bottom: 4}},
		StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)}
}

// brandHeader is 1.x's sidebar header: the boxed leaf mark, the app name,
// and the active workspace (or the tagline while only one exists).
func brandHeader(cx *core.Scope, subtitle func() string) core.Node {
	return core.View{
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
			Padding: core.Edges{Left: 8, Right: 8, Top: 6, Bottom: 12}},
		Children: []core.Node{
			core.View{Style: core.Style{Width: core.Pt(28), Height: core.Pt(28),
				CornerRadius: 6, AlignItems: core.AlignCenter, JustifyContent: core.JustifyCenter},
				StyleFunc: ui.Filled(accentTint(cx)),
				Children:  []core.Node{ui.Icon(lucide.Leaf, 16, ui.ColorsOf(cx).Accent)}},
			core.View{Style: core.Style{Gap: 1, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.Text{ContentFunc: func() string { return locales.AppName(cx) },
						Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}, MaxLines: 1},
					core.Text{ContentFunc: subtitle, Style: core.Style{FontSize: 12},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				}},
		},
	}
}

// overdueSupplierDisclosures counts inbound rows past their due date, as
// 1.x's sidebar badge did.
func (s *Session) overdueSupplierDisclosures() int {
	today := time.Now().Format("2006-01-02")
	count := 0
	for _, q := range s.questionnaires {
		if q.Direction == "inbound" && q.Status == store.QuestionnaireSent &&
			q.DueDate != "" && q.DueDate < today {
			count++
		}
	}
	return count
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

// co2eWithUnit is 1.x's dense source-row total: tonnes past 1,000 kg,
// kilograms below it, so the card sheds precision instead of digits.
func co2eWithUnit(kg float64) string {
	if kg >= 1000 {
		return commaFloat(kg/1000) + " t"
	}
	return commaFloat(kg) + " kg"
}

// mcpStatusDot is 1.x's footer status: green when any detected agent host
// points at this app, amber while one is installed but not configured.
func (s *Session) mcpStatusDot(cx *core.Scope) core.Node {
	return core.Dynamic(func(cx *core.Scope) core.Node {
		_ = s.mcpRev.Get()
		configured := false
		for _, status := range mcpconfig.Detect(agentHome(), agentConfigDir(), agentEntry()) {
			if status.Configured {
				configured = true
				break
			}
		}
		label := locales.SidebarMcpLabelPending(cx)
		color := ui.ColorsOf(cx).Warn()
		if configured {
			label = locales.SidebarMcpLabelAvailable(cx)
			color = ui.ColorsOf(cx).Accent()
		}
		return core.View{
			TestID: "sidebar-mcp-status",
			Role:   core.RoleStatus,
			Label:  label,
			Style: core.Style{Width: core.Pt(8), Height: core.Pt(8),
				CornerRadius: 4, FlexShrink: 0},
			StyleFunc: func() core.Style { return core.Style{Background: color} },
		}
	})
}

// bumpMCP re-renders the footer dot after Settings writes a host config.
func (s *Session) bumpMCP() {
	if s.mcpRev != nil {
		s.mcpRev.Set(s.mcpRev.Get() + 1)
	}
}

// watchMCP refreshes the footer dot every ten seconds, as 1.x's status
// poller did, so a host configured outside the app turns it green without a
// restart. The scope owns the timer and stops it with the shell.
func (s *Session) watchMCP(cx *core.Scope) {
	var tick func()
	tick = func() {
		s.bumpMCP()
		cx.AfterFunc(10*time.Second, tick)
	}
	cx.AfterFunc(10*time.Second, tick)
}
