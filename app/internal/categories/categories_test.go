package categories

import "testing"

func TestTaxonomyShape(t *testing.T) {
	if len(All) != 23 {
		t.Fatalf("categories = %d, want 23", len(All))
	}
	if got := len(ForScope(1)); got != 4 {
		t.Errorf("scope 1 = %d, want 4", got)
	}
	if got := len(ForScope(2)); got != 4 {
		t.Errorf("scope 2 = %d, want 4", got)
	}
	if got := len(ForScope(3)); got != 15 {
		t.Errorf("scope 3 = %d, want 15", got)
	}
	seen := map[string]bool{}
	for _, category := range All {
		if seen[category.Code] {
			t.Errorf("duplicate code %q", category.Code)
		}
		seen[category.Code] = true
		if category.LabelEN == "" || category.LabelZH == "" {
			t.Errorf("%s: missing a label", category.Code)
		}
		if category.Scope < 1 || category.Scope > 3 {
			t.Errorf("%s: scope %d", category.Code, category.Scope)
		}
	}
}

func TestLookupAndMapping(t *testing.T) {
	category, ok := ByCode("scope2.purchased_electricity")
	if !ok || category.Scope != 2 || category.ISO != 2 {
		t.Fatalf("scope2 lookup = %+v, %v", category, ok)
	}
	if got := EFCategoryForCode(category.Code); got != "electricity" {
		t.Errorf("ef category = %q", got)
	}
	if got := EFCategoryForCode("scope1.process_emissions"); got != "" {
		t.Errorf("process ef category = %q, want empty", got)
	}
	if _, ok := ByCode("scope9.unknown"); ok {
		t.Error("unknown code resolved")
	}
}

func TestLabelsAndSearch(t *testing.T) {
	travel, _ := ByCode("scope3.cat6_business_travel")
	if got := travel.Label("en-US"); got != "3.6 Business travel" {
		t.Errorf("en label = %q", got)
	}
	if got := travel.Label("zh-CN"); got != "3.6 商务差旅" {
		t.Errorf("zh label = %q", got)
	}
	electricity, _ := ByCode("scope2.purchased_electricity")
	if got := electricity.Label("zh-CN"); got != "外购电力" {
		t.Errorf("scope 2 zh label = %q", got)
	}
	if !travel.Matches("机票") || !travel.Matches("flight") || travel.Matches("cement") {
		t.Error("keyword search mismatch")
	}
}
