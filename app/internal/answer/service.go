package answer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"app.carbonink.desktop/internal/extraction"
	"app.carbonink.desktop/internal/llm"
	"app.carbonink.desktop/internal/store"
)

// FallbackPrefix marks source summaries produced by the single-shot path.
const FallbackPrefix = "【单 shot fallback】"

// ErrNotConfigured means no LLM provider is available.
var ErrNotConfigured = errors.New("answer: no LLM provider is configured")

// ErrInbound means the question belongs to a supplier disclosure.
var ErrInbound = errors.New("answer: inbound supplier questions are answered by import")

// ErrAlreadyAnswered means the question already has an answer row.
var ErrAlreadyAnswered = errors.New("answer: the question already has an answer")

// ErrInventoryEmpty means the reporting year has no activity rows.
var ErrInventoryEmpty = errors.New("answer: no activity data for the reporting year")

// ErrQuestionNotFound means the question id does not exist.
var ErrQuestionNotFound = errors.New("answer: question not found")

// ErrQuestionnaireNotFound means the question's questionnaire is missing.
var ErrQuestionnaireNotFound = errors.New("answer: questionnaire not found")

// NoDataError means the model returned an empty value because the inventory
// did not cover the question. Reason is the model's explanation.
type NoDataError struct{ Reason string }

func (e *NoDataError) Error() string {
	if e.Reason == "" {
		return "answer: the model found no inventory data for the question"
	}
	return "answer: " + e.Reason
}

// Provider is one configured endpoint; the same shape extraction uses.
type Provider = extraction.Provider

// Service drafts answers for one workspace.
type Service struct {
	Store    *store.Store
	Provider Provider

	// Test seams; nil uses the production adapters.
	NewClient func(Provider) llm.Extractor
	NewRunner func(Provider) llm.AgentRunner
}

// GenerateAllResult is one question's outcome from GenerateAll.
type GenerateAllResult struct {
	QuestionID string
	Answer     *store.Answer
	Err        error
}

// Generate drafts one answer and persists it as ai_suggested.
func (s *Service) Generate(ctx context.Context, questionID string) (*store.Answer, error) {
	if s.Store == nil {
		return nil, errors.New("answer: store is required")
	}
	if !s.Provider.Configured() {
		return nil, ErrNotConfigured
	}
	question, err := s.Store.QuestionByID(ctx, questionID)
	if err != nil {
		return nil, err
	}
	if question == nil {
		return nil, ErrQuestionNotFound
	}
	direction, ok, err := s.Store.QuestionDirection(ctx, questionID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrQuestionNotFound
	}
	if direction == "inbound" {
		return nil, ErrInbound
	}
	if question.Answered() {
		return nil, ErrAlreadyAnswered
	}
	questionnaire, err := s.Store.QuestionnaireByID(ctx, question.QuestionnaireID)
	if err != nil {
		return nil, err
	}
	if questionnaire == nil {
		return nil, ErrQuestionnaireNotFound
	}
	inventory, err := s.inventory(ctx, questionnaire.ReportingYear)
	if err != nil {
		return nil, err
	}
	if inventory.ActivityCount == 0 {
		return nil, ErrInventoryEmpty
	}
	q := QuestionContext{RawText: question.RawText, ExpectedUnit: question.ExpectedUnit,
		QuestionKind: question.QuestionKind}
	if strings.TrimSpace(q.RawText) == "" {
		q.RawText = question.NormalizedText
	}

	started := time.Now()
	output, isFallback, trace, err := s.draft(ctx, q, inventory, question.QuestionnaireID)
	if err != nil {
		return nil, err
	}
	elapsed := time.Since(started)
	s.recordAudit(ctx, questionID, isFallback, trace, elapsed)

	if strings.TrimSpace(output.Value) == "" {
		return nil, &NoDataError{Reason: output.SourceSummary}
	}
	unit := ""
	if question.QuestionKind == "numerical" && output.Unit != nil {
		unit = strings.TrimSpace(*output.Unit)
	}
	summary := output.SourceSummary
	if isFallback {
		summary = FallbackPrefix + " " + summary
	}
	return s.Store.SaveAnswer(ctx, store.SaveAnswerInput{
		QuestionID: questionID, Value: output.Value, Unit: unit,
		SourceKind: "ai_suggested", SourceSummary: summary,
		AgentTrace: encodeAgentTrace(isFallback, trace, elapsed),
	})
}

// GenerateAll drafts every unanswered question in a questionnaire, in order.
func (s *Service) GenerateAll(ctx context.Context, questionnaireID string) ([]GenerateAllResult, error) {
	questionnaire, err := s.Store.QuestionnaireByID(ctx, questionnaireID)
	if err != nil {
		return nil, err
	}
	if questionnaire == nil {
		return nil, ErrQuestionnaireNotFound
	}
	if questionnaire.Direction == "inbound" {
		return nil, ErrInbound
	}
	questions, err := s.Store.ListQuestions(ctx, questionnaireID)
	if err != nil {
		return nil, err
	}
	results := make([]GenerateAllResult, 0, len(questions))
	for _, question := range questions {
		if question.Answered() {
			continue
		}
		result := GenerateAllResult{QuestionID: question.ID}
		result.Answer, result.Err = s.Generate(ctx, question.ID)
		results = append(results, result)
	}
	return results, nil
}

// AgentTrace is the structured execution summary persisted on an answer row
// so the review drawer can render the agent's tool-call chain.
type AgentTrace struct {
	Mode       string          `json:"mode"`
	StopReason string          `json:"stop_reason"`
	IsFallback bool            `json:"is_fallback"`
	Turns      int             `json:"turns"`
	DurationMs int64           `json:"duration_ms"`
	Steps      []llm.AgentStep `json:"steps,omitempty"`
}

type draftTrace struct {
	Turns     int
	ToolCalls []string
	Steps     []llm.AgentStep
	Stop      string
}

func encodeAgentTrace(isFallback bool, trace draftTrace, elapsed time.Duration) string {
	mode := "agent"
	if isFallback {
		mode = "single_shot"
	}
	encoded, err := json.Marshal(AgentTrace{
		Mode:       mode,
		StopReason: trace.Stop,
		IsFallback: isFallback,
		Turns:      trace.Turns,
		DurationMs: elapsed.Milliseconds(),
		Steps:      trace.Steps,
	})
	if err != nil {
		return ""
	}
	return string(encoded)
}

func (s *Service) draft(ctx context.Context, q QuestionContext, inventory InventoryContext,
	questionnaireID string) (AnswerOutput, bool, draftTrace, error) {
	finish := FinishTool(q.QuestionKind)
	runner := s.runner()
	var output AnswerOutput
	if runner != nil {
		tools := BuildTools(s.Store, s.organizationID(ctx), questionnaireID, inventory.Year)
		run, err := runner.RunAgent(ctx, AgentSystemPrompt,
			BuildAgentUserPrompt(q, inventory), tools, finish, 6)
		switch {
		case err == nil:
			if run == nil {
				return AnswerOutput{}, false, draftTrace{},
					errors.New("answer: agent returned no result")
			}
			if err := llm.Validate(finish.Schema, run.Output); err != nil {
				return AnswerOutput{}, false, draftTrace{}, err
			}
			if err := json.Unmarshal(run.Output, &output); err != nil {
				return AnswerOutput{}, false, draftTrace{}, err
			}
			return output, false, draftTrace{Turns: run.Turns, ToolCalls: run.ToolCalls,
				Steps: run.Steps, Stop: "completed"}, nil
		case errors.Is(err, llm.ErrAgentMaxTurns):
			output, err = s.singleShot(ctx, q, inventory)
			if err != nil {
				return AnswerOutput{}, false, draftTrace{}, err
			}
			return output, true, draftTrace{Turns: runTurns(run), ToolCalls: runToolCalls(run),
				Steps: runSteps(run), Stop: "max_turns"}, nil
		case errors.Is(err, llm.ErrAgentStalled):
			output, err = s.singleShot(ctx, q, inventory)
			if err != nil {
				return AnswerOutput{}, false, draftTrace{}, err
			}
			return output, true, draftTrace{Turns: runTurns(run), ToolCalls: runToolCalls(run),
				Steps: runSteps(run), Stop: "stalled"}, nil
		default:
			return AnswerOutput{}, false, draftTrace{}, err
		}
	}
	output, err := s.singleShot(ctx, q, inventory)
	if err != nil {
		return AnswerOutput{}, false, draftTrace{}, err
	}
	return output, true, draftTrace{Stop: "single_shot"}, nil
}

func runTurns(run *llm.AgentRun) int {
	if run == nil {
		return 0
	}
	return run.Turns
}

func runToolCalls(run *llm.AgentRun) []string {
	if run == nil {
		return nil
	}
	return run.ToolCalls
}

func runSteps(run *llm.AgentRun) []llm.AgentStep {
	if run == nil {
		return nil
	}
	return run.Steps
}

func (s *Service) singleShot(ctx context.Context, q QuestionContext,
	inventory InventoryContext) (AnswerOutput, error) {
	client := s.extractor()
	raw, err := client.Extract(ctx, SingleShotSystemPrompt, BuildSingleShotPrompt(q, inventory),
		FinishTool(q.QuestionKind))
	if err != nil {
		return AnswerOutput{}, err
	}
	var output AnswerOutput
	if err := json.Unmarshal(raw, &output); err != nil {
		return AnswerOutput{}, fmt.Errorf("answer: decode reply: %w", err)
	}
	return output, nil
}

func (s *Service) extractor() llm.Extractor {
	if s.NewClient != nil {
		return s.NewClient(s.Provider)
	}
	if s.Provider.Name == "anthropic" {
		return &llm.AnthropicClient{BaseURL: s.Provider.BaseURL, APIKey: s.Provider.APIKey,
			Model: s.Provider.Model}
	}
	return &llm.Client{BaseURL: s.Provider.BaseURL, APIKey: s.Provider.APIKey,
		Model: s.Provider.Model}
}

func (s *Service) runner() llm.AgentRunner {
	if s.NewRunner != nil {
		return s.NewRunner(s.Provider)
	}
	if s.Provider.Name == "anthropic" {
		return &llm.AnthropicClient{BaseURL: s.Provider.BaseURL, APIKey: s.Provider.APIKey,
			Model: s.Provider.Model}
	}
	return &llm.Client{BaseURL: s.Provider.BaseURL, APIKey: s.Provider.APIKey, Model: s.Provider.Model}
}

func (s *Service) organizationID(ctx context.Context) string {
	org, err := s.Store.CurrentOrganization(ctx)
	if err != nil || org == nil {
		return ""
	}
	return org.ID
}

func (s *Service) inventory(ctx context.Context, year int) (InventoryContext, error) {
	inventory := InventoryContext{Year: year}
	org, err := s.Store.CurrentOrganization(ctx)
	if err != nil {
		return inventory, err
	}
	if org == nil {
		inventory.ActivitiesSummary = "无组织"
		return inventory, nil
	}
	activities, err := s.Store.ActivitiesForYear(ctx, year)
	if err != nil {
		return inventory, err
	}
	inventory.ActivityCount = len(activities)
	inventory.ActivitiesSummary = fmt.Sprintf("%d 条活动数据", len(activities))
	if len(activities) == 0 {
		return inventory, nil
	}
	totals := &Totals{}
	var scope1, scope2, scope3 float64
	var has1, has2, has3 bool
	for _, activity := range activities {
		totals.TotalCO2eKg += activity.CO2eKg
		switch activity.Scope {
		case 1:
			scope1 += activity.CO2eKg
			has1 = true
		case 2:
			scope2 += activity.CO2eKg
			has2 = true
		case 3:
			scope3 += activity.CO2eKg
			has3 = true
		}
	}
	if has1 {
		totals.Scope1Kg = &scope1
	}
	if has2 {
		totals.Scope2Kg = &scope2
	}
	if has3 {
		totals.Scope3Kg = &scope3
	}
	inventory.Totals = totals
	return inventory, nil
}

func (s *Service) recordAudit(ctx context.Context, questionID string, fallback bool,
	trace draftTrace, elapsed time.Duration) {
	payload := map[string]any{
		"questionId":      questionID,
		"isFallback":      fallback,
		"turnCount":       trace.Turns,
		"toolCallSummary": trace.ToolCalls,
		"durationMs":      elapsed.Milliseconds(),
		"stopReason":      trace.Stop,
	}
	_ = s.Store.RecordAuditEvent(ctx, "agent_answer.generate", payload)
}
