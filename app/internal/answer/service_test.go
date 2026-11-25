package answer

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

func TestGenerateUsesAgentAndPersistsAnswer(t *testing.T) {
	s, ctx, fixture := openAnswerFixture(t)
	runner := &fakeRunner{run: &llm.AgentRun{
		Output:    json.RawMessage(`{"value":"120000","unit":"kWh","source_summary":"from act-1"}`),
		Turns:     2,
		ToolCalls: []string{"list_activities", "sum_co2e"},
	}}
	service := &Service{Store: s, Provider: testProvider(), NewRunner: fixedRunner(runner)}
	answer, err := service.Generate(ctx, fixture.electricity.ID)
	if err != nil {
		t.Fatal(err)
	}
	if answer.Value != "120000" || answer.Unit != "kWh" || answer.SourceKind != "ai_suggested" ||
		answer.FinalizedAt != "" {
		t.Fatalf("answer = %+v", answer)
	}
	if !strings.Contains(answer.SourceSummary, "from act-1") {
		t.Fatalf("summary = %q", answer.SourceSummary)
	}
	if runner.calls != 1 {
		t.Fatalf("runner calls = %d", runner.calls)
	}
	var kind, payload string
	if err := s.DB().QueryRowContext(ctx, `SELECT event_kind, payload FROM audit_event
		WHERE event_kind = 'agent_answer.generate'`).Scan(&kind, &payload); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(payload, `"stopReason":"completed"`) ||
		!strings.Contains(payload, `"list_activities"`) {
		t.Fatalf("audit payload = %s", payload)
	}
}

func TestGenerateFallsBackAndDropsNarrativeUnit(t *testing.T) {
	s, ctx, fixture := openAnswerFixture(t)
	runner := &fakeRunner{err: llm.ErrAgentMaxTurns}
	extractor := &fakeExtractor{reply: `{"value":"Our transition plan is current.",
		"unit":"kWh","source_summary":"derived from act-1"}`}
	service := &Service{Store: s, Provider: testProvider(), NewRunner: fixedRunner(runner),
		NewClient: fixedExtractor(extractor)}
	answer, err := service.Generate(ctx, fixture.narrative.ID)
	if err != nil {
		t.Fatal(err)
	}
	if answer.Unit != "" {
		t.Fatalf("narrative unit = %q", answer.Unit)
	}
	if !strings.HasPrefix(answer.SourceSummary, FallbackPrefix) {
		t.Fatalf("summary = %q", answer.SourceSummary)
	}
	if extractor.calls != 1 {
		t.Fatalf("extractor calls = %d", extractor.calls)
	}
}

func TestGenerateErrors(t *testing.T) {
	s, ctx, fixture := openAnswerFixture(t)
	service := &Service{Store: s, Provider: testProvider(),
		NewRunner: fixedRunner(&fakeRunner{err: llm.ErrAgentStalled}),
		NewClient: fixedExtractor(&fakeExtractor{
			reply: `{"value":"","unit":null,"source_summary":"no data"}`})}
	if _, err := service.Generate(ctx, fixture.narrative.ID); err == nil {
		t.Fatal("blank answer accepted")
	} else {
		var noData *NoDataError
		if !errors.As(err, &noData) || noData.Reason != "no data" {
			t.Fatalf("error = %v", err)
		}
	}

	if _, err := service.Generate(ctx, "missing"); !errors.Is(err, ErrQuestionNotFound) {
		t.Fatalf("missing question = %v", err)
	}
	if _, err := s.SaveAnswer(ctx, store.SaveAnswerInput{QuestionID: fixture.electricity.ID,
		Value: "1", Unit: "kWh"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Generate(ctx, fixture.electricity.ID); !errors.Is(err, ErrAlreadyAnswered) {
		t.Fatalf("answered question = %v", err)
	}

	if _, err := s.DB().ExecContext(ctx, `INSERT INTO questionnaire
		(id, counterparty_id, document_id, reporting_year, status, direction, created_at)
		SELECT 'inbound', counterparty_id, document_id, 2025, 'received', 'inbound',
			'2026-01-01T00:00:00Z' FROM questionnaire WHERE id = ?`, fixture.questionnaireID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().ExecContext(ctx, `INSERT INTO question
		(id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text,
		 question_kind, position)
		VALUES ('inbound-question', 'inbound', 'sig', 'v1', 'q', 'q', 'numerical', 'A1')`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Generate(ctx, "inbound-question"); !errors.Is(err, ErrInbound) {
		t.Fatalf("inbound question = %v", err)
	}

	unconfigured := &Service{Store: s}
	if _, err := unconfigured.Generate(ctx, fixture.narrative.ID); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("unconfigured = %v", err)
	}
}

func TestGenerateRefusesEmptyInventory(t *testing.T) {
	s, ctx, _ := openAnswerFixture(t)
	dir := t.TempDir()
	document, _, err := s.SaveDocument(ctx, store.DocumentInput{Filename: "q.xlsx",
		MIMEType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Data:     []byte("x")}, dir)
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := s.CreateQuestionnaire(ctx, store.QuestionnaireInput{
		CustomerName: "Empty Co", DocumentID: document.ID, ReportingYear: 2024,
		Questions: []store.QuestionInput{{NormalizedText: "employees",
			QuestionKind: "numerical", Position: "A2"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	questions, err := s.ListQuestions(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: s, Provider: testProvider()}
	if _, err := service.Generate(ctx, questions[0].ID); !errors.Is(err, ErrInventoryEmpty) {
		t.Fatalf("error = %v", err)
	}
}

func TestGenerateAllSkipsAnswered(t *testing.T) {
	s, ctx, fixture := openAnswerFixture(t)
	service := &Service{Store: s, Provider: testProvider(),
		NewRunner: fixedRunner(&fakeRunner{run: &llm.AgentRun{
			Output: json.RawMessage(`{"value":"42","unit":null,"source_summary":"ok"}`)}})}
	if _, err := s.SaveAnswer(ctx, store.SaveAnswerInput{QuestionID: fixture.electricity.ID,
		Value: "1"}); err != nil {
		t.Fatal(err)
	}
	results, err := service.GenerateAll(ctx, fixture.questionnaireID)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %d, want 2 unanswered", len(results))
	}
	for _, result := range results {
		if result.Err != nil || result.Answer == nil {
			t.Fatalf("result = %+v", result)
		}
	}
	if _, err := service.GenerateAll(ctx, "missing"); !errors.Is(err, ErrQuestionnaireNotFound) {
		t.Fatalf("missing questionnaire = %v", err)
	}
}

func TestInventoryToolsReadTheLedger(t *testing.T) {
	s, ctx, fixture := openAnswerFixture(t)
	tools := BuildTools(s, "org", fixture.questionnaireID, 2025)
	byName := map[string]llm.AgentTool{}
	for _, tool := range tools {
		byName[tool.Name] = tool
	}
	list, ok := byName["list_activities"]
	if !ok {
		t.Fatal("list_activities missing")
	}
	out, err := list.Run(ctx, json.RawMessage(`{"year":2025,"scope":2,"limit":10}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(out)
	if !strings.Contains(string(encoded), `"count":1`) ||
		!strings.Contains(string(encoded), `"act-1"`) {
		t.Fatalf("list = %s", encoded)
	}

	out, err = byName["sum_co2e"].Run(ctx, json.RawMessage(`{"scope":2}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(out)
	if !strings.Contains(string(encoded), `"total_kg":50`) {
		t.Fatalf("sum = %s", encoded)
	}

	out, err = byName["list_emission_sources"].Run(ctx, json.RawMessage(`{"scope":2}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(out)
	if !strings.Contains(string(encoded), `"name":"外购电力"`) {
		t.Fatalf("sources = %s", encoded)
	}

	out, err = byName["get_emission_factor"].Run(ctx, json.RawMessage(`{"activity_id":"act-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(out)
	if !strings.Contains(string(encoded), `"factor_code":"ef"`) ||
		!strings.Contains(string(encoded), `"co2e_kg_per_unit":0.5`) {
		t.Fatalf("factor = %s", encoded)
	}

	out, err = byName["read_questionnaire_context"].Run(ctx,
		json.RawMessage(`{"questionnaire_id":"`+fixture.questionnaireID+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(out)
	if !strings.Contains(string(encoded), `"customer_name":"ACME Ltd"`) ||
		!strings.Contains(string(encoded), `"question_count":3`) {
		t.Fatalf("context = %s", encoded)
	}
}

type answerFixture struct {
	questionnaireID string
	electricity     store.Question
	transitionID    string
	narrative       store.Question
}

func openAnswerFixture(t *testing.T) (*store.Store, context.Context, answerFixture) {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "answer.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.DB().ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	const ts = "2025-01-15T00:00:00Z"
	exec(`INSERT INTO organization (id, singleton_key, name_zh, country_code, boundary_kind,
		created_at, updated_at) VALUES ('org', 1, '测试组织', 'CN', 'operational_control', ?, ?)`,
		ts, ts)
	exec(`INSERT INTO site (id, organization_id, name_zh, country_code, created_at, updated_at)
		VALUES ('site', 'org', '上海工厂', 'CN', ?, ?)`, ts, ts)
	exec(`INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at,
		ends_at, created_at) VALUES ('period', 'org', 2025, 'annual', '2025-01-01', '2025-12-31', ?)`, ts)
	exec(`INSERT INTO emission_source (id, site_id, name, scope, category)
		VALUES ('src', 'site', '外购电力', 2, 'electricity.grid')`)
	exec(`INSERT INTO pinned_emission_factor (factor_code, year, source, geography,
		dataset_version, scope, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
		VALUES ('ef', 2024, 'MEE', 'CN', '2024', 2, 'kWh', 0.5, 'AR6', ?, 'seed')`, ts)
	exec(`INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
		occurred_at_start, occurred_at_end, amount, unit,
		ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
		computed_co2e_kg, computed_at, created_at, updated_at)
		VALUES ('act-1', 'site', 'src', 'period', ?, ?, 100.0, 'kWh',
		'ef', 2024, 'MEE', 'CN', '2024', 50.0, ?, ?, ?)`, ts, ts, ts, ts, ts)

	document, _, err := s.SaveDocument(ctx, store.DocumentInput{Filename: "questionnaire.xlsx",
		MIMEType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Data:     []byte("workbook")}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := s.CreateQuestionnaire(ctx, store.QuestionnaireInput{
		CustomerName: "ACME Ltd", DocumentID: document.ID, ReportingYear: 2025,
		Questions: []store.QuestionInput{
			{NormalizedText: "annual electricity use", RawText: "Annual electricity use (kWh)",
				QuestionKind: "numerical", ExpectedUnit: "kWh", Position: "Data!B2"},
			{NormalizedText: "describe transition plan", RawText: "Describe your transition plan",
				QuestionKind: "narrative", Position: "Data!B3"},
			{NormalizedText: "employees", RawText: "Total employees",
				QuestionKind: "numerical", Position: "Data!B4"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	questions, err := s.ListQuestions(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	var fixture answerFixture
	fixture.questionnaireID = id
	for _, question := range questions {
		switch question.NormalizedText {
		case "annual electricity use":
			fixture.electricity = question
		case "describe transition plan":
			fixture.narrative = question
		case "employees":
			fixture.transitionID = question.ID
		}
	}
	return s, ctx, fixture
}

func testProvider() Provider {
	return Provider{Name: "test", BaseURL: "http://example.invalid", Model: "m"}
}

type fakeRunner struct {
	run   *llm.AgentRun
	err   error
	calls int
}

func (f *fakeRunner) RunAgent(context.Context, string, string, []llm.AgentTool, llm.Tool,
	int) (*llm.AgentRun, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.run, nil
}

func fixedRunner(run llm.AgentRunner) func(Provider) llm.AgentRunner {
	return func(Provider) llm.AgentRunner { return run }
}

type fakeExtractor struct {
	reply string
	err   error
	calls int
}

func (f *fakeExtractor) Extract(context.Context, string, string,
	llm.Tool) (json.RawMessage, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return json.RawMessage(f.reply), nil
}

func (f *fakeExtractor) ExtractVision(context.Context, string, string, []llm.ImagePart,
	llm.Tool) (json.RawMessage, error) {
	return nil, errors.New("vision not expected")
}

func fixedExtractor(extractor llm.Extractor) func(Provider) llm.Extractor {
	return func(Provider) llm.Extractor { return extractor }
}
