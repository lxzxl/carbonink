package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureBootstraps(t *testing.T) {
	dir := t.TempDir()
	m := New(filepath.Join(dir, "data"), "")
	reg, imported, err := m.Ensure()
	if err != nil {
		t.Fatal(err)
	}
	if imported {
		t.Fatal("bootstrap reported an import")
	}
	if reg.Version != 1 || len(reg.Workspaces) != 1 {
		t.Fatalf("unexpected registry: %+v", reg)
	}
	w := reg.Workspaces[0]
	if w.File != defaultFile || w.Name != defaultName || len(w.ID) != 26 {
		t.Fatalf("unexpected workspace: %+v", w)
	}
	if reg.ActiveID != w.ID {
		t.Fatalf("active_id = %q, want %q", reg.ActiveID, w.ID)
	}
	path, err := m.DBPath(w)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != m.dir {
		t.Fatalf("db path %q escapes %q", path, m.dir)
	}
	info, err := os.Stat(filepath.Join(m.dir, registryName))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("registry mode = %o, want 600", perm)
	}

	again, imported, err := m.Ensure()
	if err != nil {
		t.Fatal(err)
	}
	if imported || again.ActiveID != w.ID {
		t.Fatalf("second Ensure changed the registry: %+v imported=%v", again, imported)
	}
}

func TestImportLegacy(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "legacy")
	data := filepath.Join(root, "data")
	writeFile(t, filepath.Join(legacy, "workspaces.json"), `{
	  "version": 1,
	  "workspaces": [
	    {"id": "01KY6QPV8EY31MTRCMFRT8DK04", "name": "默认账套", "file": "app.sqlite", "created_at": "2026-07-23T05:38:24.143Z"},
	    {"id": "01KY6TRH4RAVGQ9YFE5RGZQQVY", "name": "SH", "file": "workspace-sh.sqlite", "created_at": "2026-07-23T06:31:45.050Z"}
	  ],
	  "active_id": "01KY6TRH4RAVGQ9YFE5RGZQQVY"
	}`)
	writeFile(t, filepath.Join(legacy, "app.sqlite"), "first")
	writeFile(t, filepath.Join(legacy, "app.sqlite-wal"), "wal")
	writeFile(t, filepath.Join(legacy, "workspace-sh.sqlite"), "second")
	writeFile(t, filepath.Join(legacy, "auto-backups", "2026-08-01", "app.sqlite"), "backup")
	writeFile(t, filepath.Join(legacy, "uploads", "doc.pdf"), "pdf")

	m := New(data, legacy)
	reg, imported, err := m.Ensure()
	if err != nil {
		t.Fatal(err)
	}
	if !imported {
		t.Fatal("expected an import")
	}
	if len(reg.Workspaces) != 2 || reg.ActiveID != "01KY6TRH4RAVGQ9YFE5RGZQQVY" {
		t.Fatalf("unexpected registry: %+v", reg)
	}
	for _, tc := range []struct{ path, want string }{
		{"app.sqlite", "first"},
		{"app.sqlite-wal", "wal"},
		{"workspace-sh.sqlite", "second"},
		{filepath.Join("auto-backups", "2026-08-01", "app.sqlite"), "backup"},
		{filepath.Join("uploads", "doc.pdf"), "pdf"},
	} {
		got, err := os.ReadFile(filepath.Join(data, tc.path))
		if err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
		if string(got) != tc.want {
			t.Fatalf("%s = %q, want %q", tc.path, got, tc.want)
		}
	}
	// The legacy directory is never mutated.
	if _, err := os.Stat(filepath.Join(legacy, "app.sqlite")); err != nil {
		t.Fatal(err)
	}

	_, imported, err = m.Ensure()
	if err != nil {
		t.Fatal(err)
	}
	if imported {
		t.Fatal("imported twice")
	}
}

func TestRejectsEscapingFile(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, registryName), `{
	  "version": 1,
	  "workspaces": [{"id": "a", "name": "A", "file": "../evil.sqlite", "created_at": ""}],
	  "active_id": "a"
	}`)
	m := New(dir, "")
	if _, err := m.Load(); err == nil {
		t.Fatal("Load accepted a path that escapes the data dir")
	}
}

func TestActiveFallsBackToFirst(t *testing.T) {
	dir := t.TempDir()
	reg := &Registry{
		Version: 1,
		Workspaces: []Workspace{
			{ID: "a", Name: "A", File: "a.sqlite"},
			{ID: "b", Name: "B", File: "b.sqlite"},
		},
		ActiveID: "missing",
	}
	m := New(dir, "")
	if err := m.Save(reg); err != nil {
		t.Fatal(err)
	}
	w, path, err := m.Active()
	if err != nil {
		t.Fatal(err)
	}
	if w.ID != "a" || filepath.Base(path) != "a.sqlite" {
		t.Fatalf("Active = %+v %q", w, path)
	}
	if err := m.SetActive("b"); err != nil {
		t.Fatal(err)
	}
	w, _, err = m.Active()
	if err != nil {
		t.Fatal(err)
	}
	if w.ID != "b" {
		t.Fatalf("Active = %q, want b", w.ID)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRegistryRoundTrip(t *testing.T) {
	dir := t.TempDir()
	reg := &Registry{Version: 1, Workspaces: []Workspace{{ID: "a", Name: "A", File: "a.sqlite", CreatedAt: "x"}}, ActiveID: "a"}
	m := New(dir, "")
	if err := m.Save(reg); err != nil {
		t.Fatal(err)
	}
	got, err := m.Load()
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(reg)
	b, _ := json.Marshal(got)
	if string(a) != string(b) {
		t.Fatalf("round trip mismatch:\n%s\n%s", a, b)
	}
}
