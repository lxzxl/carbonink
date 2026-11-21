package efimport

import (
	"testing"

	"app.carbonink.desktop/internal/activityimport"
)

func TestAutoMapAndRequired(t *testing.T) {
	mapping := AutoMap([]string{"factor_code", "中文名称", "英文名称", "scope", "category",
		"year", "geography", "unit", "co2e", "ch4", "gwp", "备注"})
	for field, col := range map[Field]int{
		FieldFactorCode: 0, FieldNameZH: 1, FieldNameEN: 2, FieldScope: 3, FieldCategory: 4,
		FieldYear: 5, FieldGeography: 6, FieldInputUnit: 7, FieldCO2e: 8, FieldCH4: 9,
		FieldGWP: 10, FieldNotes: 11,
	} {
		if mapping[field] != col {
			t.Errorf("%s = %d, want %d", field, mapping[field], col)
		}
	}
	if missing := MissingRequired(mapping); len(missing) != 0 {
		t.Errorf("missing = %v", missing)
	}
	if missing := MissingRequired(AutoMap([]string{"name"})); len(missing) != 4 {
		t.Errorf("missing = %v, want 4 required fields", missing)
	}
}

func TestValidateRows(t *testing.T) {
	mapping := Mapping{
		FieldFactorCode: 0, FieldNameZH: 1, FieldNameEN: 2, FieldScope: 3,
		FieldCategory: 4, FieldYear: 5, FieldGeography: 6, FieldInputUnit: 7,
		FieldCO2e: 8, FieldCH4: 9, FieldGWP: 10,
	}
	rows := []activityimport.Row{
		{Number: 2, Cells: []string{"", "柴油", "", "范围1", "fuel.combustion", "2024",
			"", "L", "2.68", "0.0001", "AR6"}},
		{Number: 3, Cells: []string{"DUP", "", "", "4", "", "2024", "CN", "L", "1", "", ""}},
		{Number: 4, Cells: []string{"DUP", "名称", "", "Scope 2", "", "2024", "CN", "kWh", "0.5", "", ""}},
		{Number: 5, Cells: []string{"DUP", "名称", "", "2", "", "2024", "CN", "kWh", "0.6", "", ""}},
		{Number: 6, Cells: []string{"", "", "", "2", "", "2024", "CN", "kWh", "abc", "", ""}},
	}
	got := Validate(rows, mapping, map[string]bool{"L": true, "kWh": true})
	if got.TotalRows != 5 || got.ValidCount != 2 {
		t.Fatalf("total=%d valid=%d: %+v", got.TotalRows, got.ValidCount, got.Errors)
	}
	if got.Valid[0].FactorCode != "EF-00001" || got.Valid[0].Geography != "GLOBAL" ||
		got.Valid[0].CH4 == nil || *got.Valid[0].CH4 != 0.0001 {
		t.Errorf("first row = %+v", got.Valid[0])
	}
	if got.Valid[1].Scope != 2 || got.Valid[1].FactorCode != "DUP" {
		t.Errorf("second row = %+v", got.Valid[1])
	}
	codes := map[string]int{}
	for _, issue := range got.Errors {
		codes[issue.Code]++
	}
	if codes["scope_invalid"] != 1 || codes["duplicate_key"] != 1 || codes["value_invalid"] != 1 {
		t.Errorf("errors = %+v", got.Errors)
	}
	if got.WarningCount != 1 || got.Warnings[0].Code != "category_empty" {
		t.Errorf("warnings = %+v", got.Warnings)
	}
}

func TestScopeForms(t *testing.T) {
	for raw, want := range map[string]int{
		"1": 1, "Scope 1": 1, "范围1": 1, "一": 1, "Scope 2": 2, "范围三": 3, "3": 3,
	} {
		got, ok := parseScope(raw)
		if !ok || got != want {
			t.Errorf("parseScope(%q) = %d, %v", raw, got, ok)
		}
	}
	for _, raw := range []string{"4", "Scope", ""} {
		if _, ok := parseScope(raw); ok {
			t.Errorf("parseScope(%q) accepted", raw)
		}
	}
}
