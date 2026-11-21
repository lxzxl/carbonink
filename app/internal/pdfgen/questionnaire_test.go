package pdfgen

import (
	"strings"
	"testing"

	"app.carbonink.desktop/internal/docview"
)

func TestRenderQuestionnaireDrawsChineseAndAnswers(t *testing.T) {
	pdf, err := RenderQuestionnaire(Questionnaire{
		CustomerName:  "上海示例制造有限公司",
		ReportingYear: 2025,
		DocumentName:  "客户问卷.xlsx",
		DueDate:       "2026-03-31",
		GeneratedOn:   "2026-11-21",
		Questions: []Question{
			{ID: "q2", Position: "排放数据!B5", RawText: "年度外购电力用量（kWh）",
				NormalizedText: "annual electricity", Kind: "numerical", ExpectedUnit: "kWh",
				Answer: &Answer{Value: "120000", Unit: "kWh", FinalizedAt: "2026-01-01",
					SourceSummary: "来自活动数据 act-1"}},
			{ID: "q1", Position: "基本信息!B2", RawText: "公司是否已制定气候转型计划？",
				NormalizedText: "transition plan", Kind: "categorical",
				Answer: &Answer{Value: "是", FinalizedAt: ""}},
			{ID: "q3", Position: "", RawText: "补充说明", NormalizedText: "notes",
				Kind: "narrative"},
		},
	}, testLabels())
	if err != nil {
		t.Fatal(err)
	}
	text, pages, err := docview.PDFText(pdf)
	if err != nil {
		t.Fatal(err)
	}
	if pages < 3 {
		t.Fatalf("pages = %d", pages)
	}
	for _, want := range []string{"上海示例制造有限公司", "2025", "客户问卷.xlsx",
		"基本信息", "排放数据", "公司是否已制定气候转型计划", "年度外购电力用量",
		"120000 kWh", "DRAFT", "Finalized", "来自活动数据", "未指定", "补充说明"} {
		if !strings.Contains(text, want) {
			t.Errorf("PDF text is missing %q\n%s", want, text)
		}
	}
}

func TestGroupQuestionsOrdersCellsAndPutsUnspecifiedLast(t *testing.T) {
	sheets := groupQuestions([]Question{
		{ID: "c", Position: "Data!C10"},
		{ID: "a", Position: "Data!A2"},
		{ID: "u1", Position: ""},
		{ID: "b", Position: "Data!B2"},
		{ID: "first", Position: "Intro!A1"},
	}, "Unspecified")
	if len(sheets) != 3 {
		t.Fatalf("sheets = %+v", sheets)
	}
	if sheets[0].Name != "Data" || sheets[1].Name != "Intro" ||
		sheets[2].Name != "Unspecified" {
		t.Fatalf("sheet order = %v, %v, %v", sheets[0].Name, sheets[1].Name, sheets[2].Name)
	}
	got := []string{sheets[0].Questions[0].ID, sheets[0].Questions[1].ID,
		sheets[0].Questions[2].ID}
	if got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("cell order = %v", got)
	}
	if sheets[2].Questions[0].ID != "u1" {
		t.Fatalf("unspecified = %+v", sheets[2].Questions)
	}
	if row, col := cellAddress("Data!AA12"); row != 12 || col != 27 {
		t.Fatalf("AA12 = %d,%d", row, col)
	}
}

func testLabels() Labels {
	return Labels{
		DueDate: "Due date", GeneratedAt: "Generated", Draft: "DRAFT",
		Finalized: "Finalized", Source: "Source", TOC: "Table of contents",
		Unanswered: "(Unanswered)", Unspecified: "未指定",
		Kinds: map[string]string{"numerical": "数值", "categorical": "短答",
			"narrative": "叙述"},
	}
}
