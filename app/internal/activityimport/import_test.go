package activityimport

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

func TestAutoMapEnglishAndChineseHeaders(t *testing.T) {
	mapping := AutoMap([]string{"Emission Source", "Description", "Quantity", "Unit", "Date", "Notes"})
	want := map[Field]int{
		FieldSourceName: 0, FieldDescription: 1, FieldAmount: 2,
		FieldUnit: 3, FieldStart: 4, FieldNotes: 5,
	}
	for field, col := range want {
		if mapping[field] != col {
			t.Errorf("%s mapped to %d, want %d", field, mapping[field], col)
		}
	}
	if _, ok := mapping[FieldEnd]; ok {
		t.Errorf("single date column should not claim the end field")
	}

	zh := AutoMap([]string{"排放源名称", "活动描述", "数量", "单位", "开始日期", "结束日期", "备注"})
	for field, col := range map[Field]int{
		FieldSourceName: 0, FieldDescription: 1, FieldAmount: 2, FieldUnit: 3,
		FieldStart: 4, FieldEnd: 5, FieldNotes: 6,
	} {
		if zh[field] != col {
			t.Errorf("%s mapped to %d, want %d", field, zh[field], col)
		}
	}
}

func TestValidateNormalizesAndFlagsRows(t *testing.T) {
	mapping := Mapping{
		FieldSourceName: 0, FieldDescription: 1, FieldAmount: 2,
		FieldUnit: 3, FieldStart: 4, FieldEnd: 5, FieldNotes: 6,
	}
	rows := []Row{
		{Number: 2, Cells: []string{"Grid", "Office power", "1,234.5", "kWh", "2025/1/5", "", "first"}},
		{Number: 3, Cells: []string{"Grid", "Office power", "1234.5", "kWh", "2025-01-05", "", ""}},
		{Number: 4, Cells: []string{"", "Fleet", "10", "L", "2025-02-01", "2025-01-01", ""}},
		{Number: 5, Cells: []string{"Grid", "Power", "-1", "kWh", "03/04/2025", "", ""}},
		{Number: 6, Cells: []string{"Grid", "Power", "20", "", "", "", ""}},
	}
	got := Validate(rows, mapping, &PeriodBounds{Start: "2025-01-01", End: "2025-12-31"})
	if got.TotalRows != 5 || got.ValidCount != 2 {
		t.Fatalf("total=%d valid=%d, want 5 and 2", got.TotalRows, got.ValidCount)
	}
	if got.Valid[0].Amount != 1234.5 || got.Valid[0].Start != "2025-01-05" ||
		got.Valid[0].End != "2025-01-05" || got.Valid[0].Notes != "first" {
		t.Errorf("first valid row = %+v", got.Valid[0])
	}
	codes := map[string]int{}
	for _, issue := range got.Errors {
		codes[issue.Code]++
	}
	if codes["source_name_missing"] != 1 || codes["date_range_invalid"] != 1 ||
		codes["amount_invalid"] != 1 || codes["unit_missing"] != 1 {
		t.Errorf("error codes = %v", codes)
	}
	if got.WarningCount != 1 || got.Warnings[0].Code != "duplicate_in_file" {
		t.Errorf("warnings = %+v", got.Warnings)
	}
}

func TestParseDateRejectsAmbiguousShapes(t *testing.T) {
	for _, input := range []string{"2025-01-05", "2025/1/5", "2025.1.5", "2025年1月5日",
		"2025-01-05T00:00:00Z", "45662"} {
		if got, ok := ParseDate(input); !ok || got == "" {
			t.Errorf("ParseDate(%q) = %q, %v", input, got, ok)
		}
	}
	for _, input := range []string{"03/04/2025", "1989-01-01", "2025-02-30", "abc"} {
		if got, ok := ParseDate(input); ok {
			t.Errorf("ParseDate(%q) accepted as %q", input, got)
		}
	}
}

func TestParseCSVQuotedAndBOM(t *testing.T) {
	data := []byte("\ufeffSource,Description,Amount,Unit,Date\n" +
		"\"Grid, main\",\"Power, office\",12.5,kWh,2025-01-05\n" +
		"\n" +
		"Grid,Other,1,kWh,2025-01-06\n")
	grid, err := ParseFile(data, "ledger.csv")
	if err != nil {
		t.Fatal(err)
	}
	if grid.Headers[0] != "Source" || len(grid.Rows) != 2 {
		t.Fatalf("grid = %+v", grid)
	}
	if grid.Rows[0].Cells[0] != "Grid, main" || grid.Rows[0].Cells[1] != "Power, office" {
		t.Errorf("quoted cells = %+v", grid.Rows[0].Cells)
	}
	if grid.Rows[1].Number != 4 {
		t.Errorf("row after blank line = %d, want 4", grid.Rows[1].Number)
	}
}

func TestParseCSVGB18030Fallback(t *testing.T) {
	utf8Text := "排放源,活动描述,数量,单位,日期\n电网,办公用电,10,kWh,2025-01-05\n"
	encoded, _, err := transform.Bytes(simplifiedchinese.GB18030.NewEncoder(), []byte(utf8Text))
	if err != nil {
		t.Fatal(err)
	}
	grid, err := ParseFile(encoded, "ledger.csv")
	if err != nil {
		t.Fatal(err)
	}
	if grid.Headers[0] != "排放源" || grid.Rows[0].Cells[1] != "办公用电" {
		t.Errorf("decoded grid = %+v", grid)
	}
}

func TestParseXLSX(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	sheet := f.GetSheetName(0)
	rows := [][]any{
		{"Source", "Description", "Amount", "Unit", "Date"},
		{"Grid", "Office power", 12.5, "kWh", "2025-01-05"},
		{"", "", "", "", ""},
		{"Fleet", "Diesel", 30, "L", 45662},
	}
	for i, row := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow(sheet, cell, &row); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "ledger.xlsx")
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	grid, err := ParseFile(data, "ledger.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if len(grid.Rows) != 2 {
		t.Fatalf("rows = %d, want 2: %+v", len(grid.Rows), grid.Rows)
	}
	if grid.Rows[1].Number != 4 {
		t.Errorf("row after blank line = %d, want 4", grid.Rows[1].Number)
	}
	if grid.Rows[1].Cells[4] != "45662" {
		t.Errorf("serial cell = %q", grid.Rows[1].Cells[4])
	}
}

func TestGroupsAndOutliers(t *testing.T) {
	rows := []ResolvedRow{
		{ValidRow: ValidRow{Row: 2, Description: "Office  Power", Amount: 10, Unit: "kWh"}, SourceID: "s"},
		{ValidRow: ValidRow{Row: 3, Description: "office power", Amount: 11, Unit: "KWH"}, SourceID: "s"},
		{ValidRow: ValidRow{Row: 4, Description: "office power", Amount: 12, Unit: "kWh"}, SourceID: "s"},
		{ValidRow: ValidRow{Row: 5, Description: "office power", Amount: 10, Unit: "kWh"}, SourceID: "s"},
		{ValidRow: ValidRow{Row: 6, Description: "office power", Amount: 200, Unit: "kWh"}, SourceID: "s"},
		{ValidRow: ValidRow{Row: 7, Description: "Other", Amount: 1, Unit: "kWh"}, SourceID: "s"},
	}
	groups := BuildGroups(rows, func(string) string { return "Grid" })
	if len(groups) != 2 || groups[0].RowCount != 5 || groups[0].SourceName != "Grid" {
		t.Fatalf("groups = %+v", groups)
	}
	issues := DetectOutliers(rows, OutlierRatio)
	if len(issues) != 1 || issues[0].Row != 6 || issues[0].Code != "amount_outlier" {
		t.Errorf("outliers = %+v", issues)
	}
}

func TestParseFileRejectsUnsupportedAndEmpty(t *testing.T) {
	if _, err := ParseFile([]byte("x"), "ledger.txt"); err == nil {
		t.Error("unsupported extension accepted")
	}
	if _, err := ParseFile([]byte("\n\n"), "ledger.csv"); err == nil {
		t.Error("empty file accepted")
	}
	if _, err := ParseFile(bytes.Repeat([]byte("a"), MaxFileBytes+1), "ledger.csv"); err == nil {
		t.Error("oversized file accepted")
	}
}
