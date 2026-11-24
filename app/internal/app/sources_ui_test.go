package app

import (
	"context"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestSourceListSearchScopeCategoryAndClear(t *testing.T) {
	dbPath := fixtureDB(t)
	s, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().ExecContext(context.Background(),
		`INSERT INTO emission_source (id, site_id, name, scope, category)
		 VALUES ('src-diesel', 'site', '柴油', 1, 'fuel.diesel')`); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:nav:sources")
	ui.WaitFor("id:sources-search", 3*time.Second)
	ui.WaitFor("id:source-row-src", 2*time.Second)
	ui.WaitFor("id:source-row-src-diesel", 2*time.Second)
	ui.WaitFor("id:source-row-src >> text:Grid electricity", 2*time.Second)
	ui.WaitFor("id:source-row-src >> text:last 2025-01-15", 2*time.Second)

	ui.Type("id:sources-search", "柴油")
	ui.WaitForGone("id:source-row-src", 2*time.Second)
	ui.WaitFor("id:source-row-src-diesel", 2*time.Second)
	ui.Clear("id:sources-search")
	ui.WaitFor("id:source-row-src", 2*time.Second)

	ui.Press("id:sources-scope-1")
	ui.WaitForGone("id:source-row-src", 2*time.Second)
	ui.WaitFor("id:source-row-src-diesel", 2*time.Second)
	ui.Press("id:sources-scope-2")
	ui.WaitForGone("id:source-row-src-diesel", 2*time.Second)
	ui.WaitFor("id:source-row-src", 2*time.Second)
	ui.Press("id:sources-scope-0")
	ui.WaitFor("id:source-row-src-diesel", 2*time.Second)

	ui.Press("id:sources-category-fuel.diesel")
	ui.WaitForGone("id:source-row-src", 2*time.Second)
	ui.WaitFor("id:source-row-src-diesel", 2*time.Second)
	ui.Press("id:sources-scope-2")
	ui.WaitFor("id:source-row-src", 2*time.Second)
	ui.WaitForGone("id:source-row-src-diesel", 2*time.Second)
	ui.Press("id:sources-scope-0")

	ui.Type("id:sources-search", "zzz")
	ui.WaitFor("id:sources-filter-empty-clear", 2*time.Second)
	ui.Press("id:sources-filter-empty-clear")
	ui.WaitFor("id:source-row-src", 2*time.Second)
	ui.WaitFor("id:source-row-src-diesel", 2*time.Second)
}
