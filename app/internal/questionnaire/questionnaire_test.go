package questionnaire

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"

	"github.com/xuri/excelize/v2"
)

func TestParseWorkbookAndPrompt(t *testing.T) {
	data := testWorkbook(t)
	cells, err := ParseWorkbook(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(cells) == 0 {
		t.Fatal("no cells")
	}
	var intros, electricity *Cell
	for i := range cells {
		switch cells[i].Value {
		case "Introduction":
			intros = &cells[i]
		case "Annual electricity use (kWh)":
			electricity = &cells[i]
		}
	}
	if intros == nil || intros.Ref != "Intro!A1" {
		t.Fatalf("intro cell = %+v", intros)
	}
	if electricity == nil || electricity.Ref != "Data!A2" || electricity.Row != 2 ||
		electricity.Col != 1 {
		t.Fatalf("electricity cell = %+v", electricity)
	}

	prompt := BuildExtractPrompt(cells)
	if !strings.Contains(prompt, `=== Sheet "Data" ===`) ||
		!strings.Contains(prompt, `Data!A2="Annual electricity use (kWh)"`) {
		t.Errorf("prompt missing cells:\n%s", prompt)
	}
	if strings.Index(prompt, `=== Sheet "Data" ===`) > strings.Index(prompt, `=== Sheet "Intro" ===`) {
		t.Error("sheets are not sorted")
	}
	if _, err := ParseWorkbook([]byte("not a workbook")); err == nil {
		t.Error("garbage accepted")
	}
}

func TestParseExtractReplyRejectsBadShapes(t *testing.T) {
	good := `{"questions":[{"raw_text":"Q","normalized_text":"q","answer_cell_ref":"Data!B2",
		"expected_unit":null,"sheet":"Data","question_row":2,"question_kind":"numerical"}]}`
	questions, err := ParseExtractReply([]byte(good))
	if err != nil || len(questions) != 1 || questions[0].QuestionKind != "numerical" {
		t.Fatalf("reply = %+v, %v", questions, err)
	}
	bad := []string{
		`{"questions":[{"raw_text":"Q","normalized_text":"q","sheet":"Data","question_row":2,
			"question_kind":"essay"}]}`,
		`{"questions":"nope"}`,
		`not json`,
	}
	for _, reply := range bad {
		if _, err := ParseExtractReply([]byte(reply)); err == nil {
			t.Errorf("%s accepted", reply)
		}
	}
}

func TestServiceCreatesQuestionsAndReusesAnswers(t *testing.T) {
	ctx := context.Background()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	fake := &fakeExtractor{reply: `{"questions":[
		{"raw_text":"Annual electricity use (kWh)","normalized_text":"annual electricity use",
		 "answer_cell_ref":"Data!B2","expected_unit":"kWh","sheet":"Data","question_row":2,
		 "question_kind":"numerical"},
		{"raw_text":"Describe your transition plan","normalized_text":"describe your transition plan",
		 "answer_cell_ref":null,"expected_unit":null,"sheet":"Data","question_row":3,
		 "question_kind":"narrative"}]}`}
	service := &Service{Store: s, DataDir: t.TempDir(),
		Provider:  Provider{Name: "test", BaseURL: "http://example.invalid", Model: "m"},
		NewClient: func(Provider) llm.Extractor { return fake }}
	result, err := service.Create(ctx, CreateRequest{
		CustomerName:  "ACME Ltd",
		ReportingYear: 2025,
		Filename:      "questionnaire.xlsx",
		Data:          testWorkbook(t),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.QuestionCount != 2 || result.ReusedCount != 0 || fake.calls != 1 {
		t.Fatalf("result = %+v, calls = %d", result, fake.calls)
	}
	questionnaire, err := s.QuestionnaireByID(ctx, result.QuestionnaireID)
	if err != nil || questionnaire.CustomerName != "ACME Ltd" ||
		questionnaire.QuestionCount != 2 {
		t.Fatalf("questionnaire = %+v, %v", questionnaire, err)
	}
	questions, err := s.ListQuestions(ctx, result.QuestionnaireID)
	if err != nil {
		t.Fatal(err)
	}
	var electricity store.Question
	for _, q := range questions {
		if q.NormalizedText == "annual electricity use" {
			electricity = q
		}
	}
	if electricity.Position != "Data!B2" || electricity.ExpectedUnit != "kWh" {
		t.Fatalf("electricity = %+v", electricity)
	}
	if _, err := s.SaveAnswer(ctx, store.SaveAnswerInput{
		QuestionID: electricity.ID, Value: "120000", Unit: "kWh", Finalize: true,
	}); err != nil {
		t.Fatal(err)
	}

	second, err := service.Create(ctx, CreateRequest{
		CustomerName:  "ACME Ltd",
		ReportingYear: 2026,
		Filename:      "questionnaire-2026.xlsx",
		Data:          testWorkbook(t),
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ReusedCount != 1 {
		t.Fatalf("reused = %d, want 1", second.ReusedCount)
	}
	if fake.calls != 2 {
		t.Fatalf("calls = %d", fake.calls)
	}

	empty := &fakeExtractor{err: errors.New("must not be called")}
	service.NewClient = func(Provider) llm.Extractor { return empty }
	emptyResult, err := service.Create(ctx, CreateRequest{
		CustomerName: "ACME Ltd", ReportingYear: 2026, Filename: "empty.xlsx",
		Data: emptyWorkbook(t),
	})
	if err != nil || emptyResult.QuestionCount != 0 || empty.calls != 0 {
		t.Fatalf("empty import = %+v, calls = %d, %v", emptyResult, empty.calls, err)
	}
	service.Provider = Provider{}
	if _, err := service.Create(ctx, CreateRequest{CustomerName: "ACME",
		ReportingYear: 2026, Filename: "x.xlsx", Data: testWorkbook(t)}); err == nil {
		t.Error("service without a provider accepted")
	}
}

type fakeExtractor struct {
	reply string
	err   error
	calls int
}

func (f *fakeExtractor) Extract(_ context.Context, _, _ string, _ llm.Tool) (json.RawMessage, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return json.RawMessage(f.reply), nil
}

func (f *fakeExtractor) ExtractVision(_ context.Context, _, _ string, _ []llm.ImagePart,
	_ llm.Tool) (json.RawMessage, error) {
	f.calls++
	return nil, errors.New("vision not expected")
}

func testWorkbook(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	if err := f.SetSheetName("Sheet1", "Intro"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("Intro", "A1", "Introduction"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.NewSheet("Data"); err != nil {
		t.Fatal(err)
	}
	cells := map[string]string{
		"A1": "Question",
		"B1": "Answer",
		"C1": "Unit",
		"A2": "Annual electricity use (kWh)",
		"C2": "kWh",
		"A3": "Describe your transition plan",
		"A4": "Total employees",
	}
	for ref, value := range cells {
		if err := f.SetCellValue("Data", ref, value); err != nil {
			t.Fatal(err)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return bytes.Clone(buf.Bytes())
}

func emptyWorkbook(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
