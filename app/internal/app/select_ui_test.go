package app

import (
	"context"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/nsgo-dev/nsgo/ui"
)

func findDropdownPopup(t *testing.T, v *nsgotest.View, isMenu bool) *nsgotest.View {
	t.Helper()
	for p := v; p != nil; p = p.Parent {
		if isMenu {
			if p.Props.Role == core.RoleMenu {
				return p
			}
			continue
		}
		if p.Props.Role == core.RoleListbox {
			if p.Parent != nil {
				return p.Parent
			}
			return p
		}
	}
	t.Fatalf("could not find popup ancestor for %q (isMenu=%v)", v.Props.TestID, isMenu)
	return nil
}

func collectDescendantTexts(v *nsgotest.View, out *[]*nsgotest.View) {
	if v.Kind == nsgotest.KindText {
		*out = append(*out, v)
	}
	for _, c := range v.Children {
		collectDescendantTexts(c, out)
	}
}

func assertDropdownOptionsContained(t *testing.T, appUI *nsgotest.App, testID string,
	count int, windowW core.Points, isMenu bool) *nsgotest.View {
	t.Helper()
	var popup *nsgotest.View
	checked := 0
	for i := 0; i < count; i++ {
		id := testID + "-" + strconv.Itoa(i)
		matches := appUI.Query("id:" + id)
		if len(matches) == 0 {
			continue
		}
		checked++
		opt := matches[0]
		if popup == nil {
			popup = findDropdownPopup(t, opt, isMenu)
			pb := popup.Bounds()
			if pb.Origin.X < -0.5 || pb.Origin.X+pb.Size.Width > windowW+0.5 {
				t.Fatalf("popup %q x-bounds [%.1f, %.1f] exceed window [0, %.1f]",
					testID, pb.Origin.X, pb.Origin.X+pb.Size.Width, windowW)
			}
		}
		pb := popup.Bounds()
		rb := opt.Bounds()
		if rb.Origin.X < pb.Origin.X-0.5 || rb.Origin.X+rb.Size.Width > pb.Origin.X+pb.Size.Width+0.5 {
			t.Fatalf("option %s [%.1f, %.1f] overflows popup [%.1f, %.1f]",
				id, rb.Origin.X, rb.Origin.X+rb.Size.Width, pb.Origin.X, pb.Origin.X+pb.Size.Width)
		}
		var texts []*nsgotest.View
		collectDescendantTexts(opt, &texts)
		if len(texts) == 0 {
			t.Fatalf("option %s rendered no text nodes", id)
		}
		for _, txt := range texts {
			if !isMenu && txt.MaxLines != 0 {
				t.Fatalf("option %s text %q has MaxLines=%d, want 0 (unbounded wrapping)",
					id, txt.Text, txt.MaxLines)
			}
			tb := txt.Bounds()
			if tb.Origin.X < rb.Origin.X-0.5 || tb.Origin.X+tb.Size.Width > rb.Origin.X+rb.Size.Width+0.5 {
				t.Fatalf("option %s text %q [%.1f, %.1f] overflows row [%.1f, %.1f]",
					id, txt.Text, tb.Origin.X, tb.Origin.X+tb.Size.Width, rb.Origin.X, rb.Origin.X+rb.Size.Width)
			}
			if tb.Origin.X < pb.Origin.X-0.5 || tb.Origin.X+tb.Size.Width > pb.Origin.X+pb.Size.Width+0.5 {
				t.Fatalf("option %s text %q [%.1f, %.1f] overflows popup [%.1f, %.1f]",
					id, txt.Text, tb.Origin.X, tb.Origin.X+tb.Size.Width, pb.Origin.X, pb.Origin.X+pb.Size.Width)
			}
			if !isMenu {
				rightClearance := (pb.Origin.X + pb.Size.Width) - (tb.Origin.X + tb.Size.Width)
				if rightClearance < 13.5 {
					t.Fatalf("option %s text %q leaves %.1f pt right clearance (< 14 pt for scrollbar)",
						id, txt.Text, rightClearance)
				}
			}
		}
	}
	if checked == 0 {
		t.Fatalf("no rendered options found for %q", testID)
	}
	return popup
}

// TestOnboardingIndustryDropdownDisplaysFullLabels verifies that opening the
// onboarding industry selector expands the popup past its trigger width so
// "建筑材料与水泥 · Construction materials" and all sibling rows remain inside
// the popup bounds with scrollbar clearance.
func TestOnboardingIndustryDropdownDisplaysFullLabels(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "empty.sqlite")
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Migrate(ctx); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	appUI := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "zh-CN"}))

	appUI.WaitFor("id:onboarding-org-industry", 3*time.Second)
	trigger := appUI.Find("id:onboarding-org-industry")
	triggerW := trigger.Bounds().Size.Width

	appUI.Press("id:onboarding-org-industry")
	appUI.WaitFor("id:onboarding-org-industry-5", 2*time.Second)

	popup := assertDropdownOptionsContained(t, appUI, "onboarding-org-industry",
		len(onboardingIndustries), 1280, false)
	if popup.Bounds().Size.Width <= triggerW {
		t.Fatalf("popup width %.1f did not expand beyond trigger width %.1f",
			popup.Bounds().Size.Width, triggerW)
	}

	appUI.Press("id:onboarding-org-industry-5")
	appUI.WaitForGone("id:onboarding-org-industry-5", 2*time.Second)
	appUI.WaitFor("text:建筑材料与水泥 · Construction materials", 2*time.Second)
}

// TestAppSelectLongOptionsAndNarrowTrigger verifies narrow-trigger auto
// expansion, wrapping fallback for extra-long labels, and searchable filtering.
func TestAppSelectLongOptionsAndNarrowTrigger(t *testing.T) {
	const longLabel = "Operational Control — emissions from facilities you operate, regardless of ownership, including leased equipment and temporary sites across regions."
	var pickedNarrow, pickedLong, pickedSearch string

	root := func(cx *core.Scope) core.Node {
		narrowVal := core.NewSignal(cx, "s1")
		longVal := core.NewSignal(cx, "short")
		searchVal := core.NewSignal(cx, "a")
		return core.View{
			Style: core.Style{Padding: core.All(16), Gap: 16},
			Children: []core.Node{
				appSelect[string]{
					Options: []ui.Option[string]{
						{Value: "s1", Label: "Scope 1 — direct emissions"},
						{Value: "mat", Label: "建筑材料与水泥 · Construction materials"},
					},
					Value: narrowVal.Get,
					OnChange: func(v string) {
						narrowVal.Set(v)
						pickedNarrow = v
					},
					TestID: "test-narrow",
					Label:  "Narrow",
					Style:  core.Style{Width: core.Pt(120)},
				},
				appSelect[string]{
					Options: []ui.Option[string]{
						{Value: "short", Label: "Short option"},
						{Value: "long", Label: longLabel},
					},
					Value: longVal.Get,
					OnChange: func(v string) {
						longVal.Set(v)
						pickedLong = v
					},
					TestID: "test-long",
					Label:  "Long",
					Style:  core.Style{Width: core.Pt(180)},
				},
				appSelect[string]{
					Options: []ui.Option[string]{
						{Value: "a", Label: "Alpha fuel source"},
						{Value: "b", Label: "建筑材料与水泥 · Construction materials"},
					},
					Value: searchVal.Get,
					OnChange: func(v string) {
						searchVal.Set(v)
						pickedSearch = v
					},
					Searchable:        true,
					SearchPlaceholder: "Filter options",
					TestID:            "test-search",
					Label:             "Search",
					Style:             core.Style{Width: core.Pt(180)},
				},
			},
		}
	}

	appUI := nsgotest.Start(t, root, nsgotest.Size(800, 600),
		nsgotest.Idiom(core.IdiomDesktop),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))

	// 1. Narrow trigger expands to show full bilingual option without clipping.
	appUI.WaitFor("id:test-narrow", 2*time.Second)
	appUI.Press("id:test-narrow")
	appUI.WaitFor("id:test-narrow-1", 2*time.Second)
	narrowPopup := assertDropdownOptionsContained(t, appUI, "test-narrow", 2, 800, false)
	if narrowPopup.Bounds().Size.Width <= 120 {
		t.Fatalf("narrow select popup width %.1f did not expand beyond 120 pt trigger",
			narrowPopup.Bounds().Size.Width)
	}
	appUI.Press("id:test-narrow-1")
	appUI.WaitForGone("id:test-narrow-1", 2*time.Second)
	if pickedNarrow != "mat" {
		t.Fatalf("pickedNarrow = %q, want mat", pickedNarrow)
	}

	// 2. Extra-long label caps popup width at <= 560 pt and wraps text cleanly.
	appUI.Press("id:test-long")
	appUI.WaitFor("id:test-long-1", 2*time.Second)
	longPopup := assertDropdownOptionsContained(t, appUI, "test-long", 2, 800, false)
	if longPopup.Bounds().Size.Width > 560.5 {
		t.Fatalf("long select popup width %.1f exceeded 560 pt cap", longPopup.Bounds().Size.Width)
	}
	longOpt := appUI.Find("id:test-long-1")
	var texts []*nsgotest.View
	collectDescendantTexts(longOpt, &texts)
	if len(texts) == 0 || texts[0].Bounds().Size.Height <= 20 {
		t.Fatalf("expected extra-long option text to wrap onto multiple lines, got texts=%v", texts)
	}
	appUI.Press("id:test-long-1")
	appUI.WaitForGone("id:test-long-1", 2*time.Second)
	if pickedLong != "long" {
		t.Fatalf("pickedLong = %q, want long", pickedLong)
	}

	// 3. Searchable select filters items and delivers OnChange.
	appUI.Press("id:test-search")
	appUI.WaitFor("id:test-search-1", 2*time.Second)
	assertDropdownOptionsContained(t, appUI, "test-search", 2, 800, false)
	appUI.Type("role:textbox", "Construction")
	appUI.WaitForGone("id:test-search-0", 2*time.Second)
	appUI.Press("id:test-search-1")
	appUI.WaitForGone("id:test-search-1", 2*time.Second)
	if pickedSearch != "b" {
		t.Fatalf("pickedSearch = %q, want b", pickedSearch)
	}
}

// TestWideSelectClampsToNarrowWindow proves wideSelect clamps its popup within
// a narrow window, wraps long titles/details cleanly, and avoids scrollbar overlap.
func TestWideSelectClampsToNarrowWindow(t *testing.T) {
	var picked string
	root := func(cx *core.Scope) core.Node {
		val := core.NewSignal(cx, "ef1")
		return core.View{
			Style: core.Style{Padding: core.All(16)},
			Children: []core.Node{
				wideSelect{
					Options: []wideOption{
						{
							Value:  "ef1",
							Label:  "National Grid Average Emission Factor — East China Regional Grid Electricity Supply 2024",
							Detail: "MEE 2024 · 0.5366 kgCO2e/kWh · Grid electricity default emission factor",
						},
						{
							Value:  "ef2",
							Label:  "建筑材料与水泥行业综合电力与热力排放因子 · Industrial Combined Factor",
							Detail: "GHG Protocol Scope 2 · Location-based method",
						},
					},
					Value:             val.Get,
					OnChange:          func(v string) { val.Set(v); picked = v },
					Label:             "Emission factor",
					TestID:            "test-wide",
					Searchable:        true,
					SearchPlaceholder: "Search emission factors...",
					Width:             320,
					PopupWidth:        560,
				},
			},
		}
	}

	appUI := nsgotest.Start(t, root, nsgotest.Size(420, 600),
		nsgotest.Idiom(core.IdiomDesktop),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	appUI.WaitFor("id:test-wide", 2*time.Second)
	appUI.Press("id:test-wide")
	appUI.WaitFor("id:test-wide-1", 2*time.Second)

	popup := assertDropdownOptionsContained(t, appUI, "test-wide", 2, 420, false)
	if popup.Bounds().Size.Width > 404.5 {
		t.Fatalf("wideSelect popup width %.1f exceeded narrow window cap 404 pt",
			popup.Bounds().Size.Width)
	}
	appUI.Press("id:test-wide-1")
	appUI.WaitForGone("id:test-wide-1", 2*time.Second)
	if picked != "ef2" {
		t.Fatalf("picked = %q, want ef2", picked)
	}
}

// TestSortMenuItemsContained verifies that sortMenu items render completely inside
// the menu popup and window bounds in both zh-CN and en-US locales.
func TestSortMenuItemsContained(t *testing.T) {
	for _, locale := range []string{"zh-CN", "en-US"} {
		t.Run(locale, func(t *testing.T) {
			root := func(cx *core.Scope) core.Node {
				order := core.NewSignal(cx, activitySortRecent)
				return core.View{
					Style: core.Style{
						Direction:      core.Row,
						JustifyContent: core.JustifyEnd,
						Padding:        core.All(16),
					},
					Children: []core.Node{
						core.Text{Content: locales.SortLabel(cx), Style: core.Style{FontSize: 13}},
						sortMenu(cx, activitySortOptions(cx), order.Get, order.Set, "test-sort"),
					},
				}
			}
			appUI := nsgotest.Start(t, root, nsgotest.Size(800, 600),
				nsgotest.Idiom(core.IdiomDesktop),
				nsgotest.Environment(core.Environment{Locale: locale}))
			appUI.WaitFor("id:test-sort", 2*time.Second)
			appUI.Press("id:test-sort")
			appUI.WaitFor("id:test-sort-4", 2*time.Second)

			assertDropdownOptionsContained(t, appUI, "test-sort", 5, 800, true)

			appUI.Press("id:test-sort-2")
			appUI.WaitForGone("id:test-sort-4", 2*time.Second)
		})
	}
}
