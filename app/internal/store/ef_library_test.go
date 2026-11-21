package store

import (
	"errors"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/efimport"
)

func TestImportReplaceAndDeleteEFLibrary(t *testing.T) {
	s, ctx := openFixture(t)
	units, err := s.KnownUnits(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !units["kWh"] || !units["L"] {
		t.Fatalf("known units missing kWh/L: %v", units)
	}
	ch4 := 0.0001
	rows := []efimport.ValidRow{
		{Row: 2, FactorCode: "INT-GRID", Year: 2024, Geography: "CN", Scope: 2,
			Category: "electricity.grid", InputUnit: "kWh", CO2e: 0.42, CH4: &ch4,
			GWP: "AR6", NameZH: "内部电网", NameEN: "Internal grid"},
		{Row: 3, FactorCode: "INT-DIESEL", Year: 2024, Geography: "GLOBAL", Scope: 1,
			Category: "fuel.combustion", InputUnit: "L", CO2e: 2.68,
			GWP: "AR6", NameEN: "Internal diesel"},
	}
	library, imported, err := s.ImportEFLibrary(ctx, EFLibraryImport{
		Name: "Internal", Version: "1.0", Filename: "internal.xlsx",
		Rows: rows, TotalRows: 3, Skipped: 1, WarningCount: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if imported != 2 || library.FactorCount != 2 || library.Source != "user:Internal" {
		t.Fatalf("library = %+v, imported = %d", library, imported)
	}
	key := EmissionFactorKey{FactorCode: "INT-GRID", Year: 2024, Source: "user:Internal",
		Geography: "CN", DatasetVersion: "1.0"}
	ef, err := s.EmissionFactorByKey(ctx, key)
	if err != nil || ef == nil || ef.NameEN != "Internal grid" || ef.CO2eKgPerUnit != 0.42 {
		t.Fatalf("factor = %+v, %v", ef, err)
	}
	if ef.CH4KgPerUnit == nil || *ef.CH4KgPerUnit != ch4 {
		t.Errorf("CH4 = %v", ef.CH4KgPerUnit)
	}
	candidates, err := s.ListEmissionFactors(ctx, EFFilter{Scope: 2, Category: "electricity.grid"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, candidate := range candidates {
		if candidate.Source == "user:Internal" {
			found = true
		}
	}
	if !found {
		t.Error("imported factor missing from the catalog query")
	}

	if _, _, err := s.ImportEFLibrary(ctx, EFLibraryImport{
		Name: "Internal", Rows: rows,
	}); !errors.Is(err, ErrEFLibraryExists) {
		t.Fatalf("duplicate import error = %v", err)
	}
	library, imported, err = s.ImportEFLibrary(ctx, EFLibraryImport{
		Name: "Internal", Version: "2.0", Rows: rows[:1], Replace: true,
	})
	if err != nil || imported != 1 || library.Version != "2.0" || library.FactorCount != 1 {
		t.Fatalf("replace = %+v, %d, %v", library, imported, err)
	}
	old, err := s.EmissionFactorByKey(ctx, EmissionFactorKey{
		FactorCode: "INT-DIESEL", Year: 2024, Source: "user:Internal",
		Geography: "GLOBAL", DatasetVersion: "2.0",
	})
	if err != nil || old != nil {
		t.Fatalf("old factor still present: %+v, %v", old, err)
	}

	deleted, err := s.DeleteEFLibrary(ctx, library.ID)
	if err != nil || deleted != 1 {
		t.Fatalf("delete = %d, %v", deleted, err)
	}
	libraries, err := s.ListEFLibraries(ctx)
	if err != nil || len(libraries) != 0 {
		t.Fatalf("libraries after delete = %+v, %v", libraries, err)
	}
	if ef, err := s.EmissionFactorByKey(ctx, key); err != nil || ef != nil {
		t.Fatalf("deleted factor still resolvable: %+v, %v", ef, err)
	}
	events, err := s.AuditEvents(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, event := range events {
		kinds[event.Kind]++
	}
	if kinds["ef_library.imported"] != 2 || kinds["ef_library.deleted"] != 1 {
		t.Errorf("audit kinds = %v", kinds)
	}
}

func TestEFLibraryRejectsBadNames(t *testing.T) {
	s, ctx := openFixture(t)
	rows := []efimport.ValidRow{{FactorCode: "X", Year: 2024, Geography: "GLOBAL",
		Scope: 1, InputUnit: "L", CO2e: 1, GWP: "AR6", NameEN: "x"}}
	for _, name := range []string{"", "   ", "bad\x01name", strings.Repeat("a", 51)} {
		if _, _, err := s.ImportEFLibrary(ctx, EFLibraryImport{Name: name, Rows: rows}); !errors.Is(err, ErrEFLibraryInvalidName) {
			t.Errorf("name %q error = %v", name, err)
		}
	}
	if _, _, err := s.ImportEFLibrary(ctx, EFLibraryImport{Name: "ok", Rows: nil}); !errors.Is(err, ErrEFLibraryEmpty) {
		t.Errorf("empty rows error = %v", err)
	}
}
