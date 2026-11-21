package presets

import (
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/categories"
)

func TestCatalogShape(t *testing.T) {
	if len(All) != 300 {
		t.Fatalf("catalog has %d entries, want 300", len(All))
	}
	seen := map[string]bool{}
	for _, preset := range All {
		if seen[preset.ID] {
			t.Fatalf("duplicate id %s", preset.ID)
		}
		seen[preset.ID] = true
		if preset.NameZH == "" || preset.NameEN == "" || preset.HintUnit == "" {
			t.Errorf("%s is missing a name or unit: %+v", preset.ID, preset)
		}
		if preset.Scope < 1 || preset.Scope > 3 {
			t.Errorf("%s has scope %d", preset.ID, preset.Scope)
		}
		if preset.Source == "" || preset.Region == "" || preset.Year == 0 {
			t.Errorf("%s is missing provenance: %+v", preset.ID, preset)
		}
	}
}

func TestEveryPresetResolvesToTaxonomy(t *testing.T) {
	for _, preset := range All {
		code := preset.Code()
		if code == "" {
			t.Errorf("%s (%s) has no taxonomy code", preset.ID, preset.Category)
			continue
		}
		category, ok := categories.ByCode(code)
		if !ok {
			t.Errorf("%s resolves to unknown code %s", preset.ID, code)
			continue
		}
		if category.Scope != preset.Scope {
			t.Errorf("%s says scope %d but %s is scope %d", preset.ID, preset.Scope, code, category.Scope)
		}
		if got, want := preset.EFCategory(), category.EFCategory; got != want {
			t.Errorf("%s EF category = %q, want %q", preset.ID, got, want)
		}
	}
}

func TestEveryClimatiqCategoryIsMapped(t *testing.T) {
	observed := map[string]bool{}
	for _, preset := range All {
		observed[preset.Category] = true
	}
	if len(observed) != 41 {
		t.Fatalf("catalog has %d distinct categories, want 41", len(observed))
	}
	for category := range observed {
		if _, ok := categoryCodes[category]; !ok {
			t.Errorf("Climatiq category %q has no taxonomy mapping", category)
		}
		if CategoryLabel(category, "zh-CN") == category {
			t.Errorf("Climatiq category %q has no Chinese label", category)
		}
	}
	if got := len(Categories()); got != len(observed) {
		t.Errorf("Categories() = %d, want %d", got, len(observed))
	}
}

func TestClimatiqCategoryNeverLeaksIntoSourceCategory(t *testing.T) {
	for _, preset := range All {
		if preset.EFCategory() == preset.Category {
			t.Errorf("%s would write the Climatiq category into emission_source.category", preset.ID)
		}
	}
}

func TestDistrictSteamOverridesPurchasedHeat(t *testing.T) {
	steam, ok := ByID("heat_and_steam-type_district_steam")
	if !ok {
		t.Fatal("district steam preset is missing")
	}
	if steam.Code() != "scope2.purchased_steam" || steam.EFCategory() != "" {
		t.Errorf("district steam code = %q, EF category = %q", steam.Code(), steam.EFCategory())
	}
	hotWater, ok := ByID("heat_and_steam-type_district_hot_water")
	if !ok {
		t.Fatal("district hot water preset is missing")
	}
	if hotWater.Code() != "scope2.purchased_heat" {
		t.Errorf("district hot water code = %q", hotWater.Code())
	}
}

func TestMatchesBilingualTerms(t *testing.T) {
	preset, ok := ByID("electricity-supply_grid-source_supplier_mix")
	if !ok {
		t.Fatal("grid electricity preset is missing")
	}
	for _, query := range []string{"grid", "电网", "电力", "electricity", "BEIS", "2025"} {
		if !preset.Matches(query) {
			t.Errorf("%q did not match", query)
		}
	}
	if preset.Matches("diesel") {
		t.Error("diesel matched grid electricity")
	}
	if !preset.Matches("electricity BEIS") {
		t.Error("multi-term query should require all terms")
	}
	if preset.Matches("electricity diesel") {
		t.Error("multi-term query matched with a missing term")
	}
}

func TestNameFollowsLocale(t *testing.T) {
	preset, ok := ByID("electricity-supply_grid-source_supplier_mix")
	if !ok {
		t.Fatal("grid electricity preset is missing")
	}
	if got := preset.Name("zh-CN"); got != "电网供电" {
		t.Errorf("zh-CN name = %q", got)
	}
	if got := preset.Name("en-US"); got != "Electricity supplied from grid" {
		t.Errorf("en-US name = %q", got)
	}
}

// TestCatalogMatchesElectron fails when the embedded copy drifts from the
// shared 1.x export before Electron is removed.
func TestCatalogMatchesElectron(t *testing.T) {
	legacy := filepath.Join("..", "..", "..", "desktop", "src", "main", "data", "preset-sources.json")
	want, err := os.ReadFile(legacy)
	if os.IsNotExist(err) {
		t.Skip("Electron catalog is gone; the copy is now canonical")
	}
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, catalogJSON) {
		t.Fatal("embedded preset catalog differs from the Electron copy")
	}
}

func TestYearIsSearchable(t *testing.T) {
	preset := All[0]
	if !preset.Matches(strconv.Itoa(preset.Year)) {
		t.Errorf("year %d did not match", preset.Year)
	}
	if strings.TrimSpace(preset.Name("en")) == "" {
		t.Error("en locale rendered an empty name")
	}
}
