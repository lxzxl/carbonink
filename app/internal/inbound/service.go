package inbound

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
)

// Service is the supplier disclosure use case over one workspace store.
type Service struct {
	Store *store.Store
}

// CreateRequest materializes one draft.
type CreateRequest struct {
	SupplierID    string
	ReportingYear int
	Positions     []string
}

// CreateDraft writes the draft and returns its id and question count.
func (s *Service) CreateDraft(ctx context.Context, in CreateRequest) (string, int, error) {
	if s.Store == nil {
		return "", 0, errors.New("inbound: store is required")
	}
	supplier, err := s.Store.SupplierByID(ctx, in.SupplierID)
	if err != nil {
		return "", 0, err
	}
	if supplier == nil {
		return "", 0, fmt.Errorf("inbound: supplier not found: %s", in.SupplierID)
	}
	t := Cat1
	questions := t.included(in.Positions)
	if len(questions) == 0 {
		return "", 0, errors.New("inbound: at least one template question must be included")
	}
	stage := make([]store.InboundQuestionInput, 0, len(questions))
	for _, q := range questions {
		stage = append(stage, store.InboundQuestionInput{
			Signature:      signature(t.Version, q.Position),
			NormalizedText: q.RawZH,
			RawText:        q.RawZH,
			Kind:           q.Kind,
			ExpectedUnit:   q.ExpectedUnit,
			Position:       q.Position,
			Tier:           q.Tier,
			Required:       q.Tier == 0,
		})
	}
	id, err := s.Store.CreateInboundDraft(ctx, store.InboundDraftInput{
		SupplierID: in.SupplierID, TemplateKind: t.Kind,
		ReportingYear: in.ReportingYear, Questions: stage,
	})
	if err != nil {
		return "", 0, err
	}
	return id, len(questions), nil
}

// ExportBlank renders the fillable workbook and moves a draft to sent.
func (s *Service) ExportBlank(ctx context.Context, questionnaireID string) ([]byte, string, error) {
	q, err := s.loadInbound(ctx, questionnaireID)
	if err != nil {
		return nil, "", err
	}
	if q.Status != store.QuestionnaireDraft && q.Status != store.QuestionnaireSent {
		return nil, "", fmt.Errorf("inbound: questionnaire is %q, not draft or sent", q.Status)
	}
	t, ok := TemplateByKind(q.TemplateKind)
	if !ok {
		return nil, "", fmt.Errorf("inbound: unknown template %q", q.TemplateKind)
	}
	questions, err := s.Store.ListQuestions(ctx, questionnaireID)
	if err != nil {
		return nil, "", err
	}
	positions := make([]string, 0, len(questions))
	for _, question := range questions {
		positions = append(positions, question.Position)
	}
	org, err := s.Store.CurrentOrganization(ctx)
	if err != nil {
		return nil, "", err
	}
	orgName := ""
	if org != nil {
		orgName = strings.TrimSpace(org.NameZH)
		if orgName == "" {
			orgName = strings.TrimSpace(org.NameEN)
		}
		if orgName == "" {
			orgName = org.ID
		}
	}
	data, err := RenderBlank(RenderOptions{
		Template: t, QuestionnaireID: questionnaireID, SupplierName: q.CustomerName,
		PeriodYear: q.ReportingYear, OrgName: orgName, DueDate: q.DueDate,
		Positions: positions,
	})
	if err != nil {
		return nil, "", err
	}
	wasDraft := q.Status == store.QuestionnaireDraft
	if err := s.Store.MarkInboundExported(ctx, questionnaireID, wasDraft, map[string]any{
		"supplier_id":    q.CustomerID,
		"template_kind":  t.Kind,
		"question_count": len(positions),
		"period_year":    q.ReportingYear,
	}); err != nil {
		return nil, "", err
	}
	name := "inbound-" + slug(q.CustomerName) + "-" + strconv.Itoa(q.ReportingYear) + ".xlsx"
	return data, name, nil
}

// ImportFilled parses a supplier reply, stages tentative answers, and returns
// the review preview.
func (s *Service) ImportFilled(ctx context.Context, questionnaireID string, data []byte) (Preview, error) {
	q, err := s.loadInbound(ctx, questionnaireID)
	if err != nil {
		return Preview{}, err
	}
	if q.Status != store.QuestionnaireSent && q.Status != store.QuestionnaireReceived {
		return Preview{}, fmt.Errorf("inbound: questionnaire is %q, not sent or received", q.Status)
	}
	t, ok := TemplateByKind(q.TemplateKind)
	if !ok {
		return Preview{}, fmt.Errorf("inbound: unknown template %q", q.TemplateKind)
	}
	parsed, err := ParseFilled(data, t, questionnaireID, q.ReportingYear)
	if err != nil {
		return Preview{}, err
	}
	questions, err := s.Store.ListQuestions(ctx, questionnaireID)
	if err != nil {
		return Preview{}, err
	}
	byPosition := make(map[string]store.Question, len(questions))
	for _, question := range questions {
		byPosition[question.Position] = question
	}
	staged := make([]store.InboundAnswerInput, 0, len(parsed.Answers))
	blanks := 0
	for _, a := range parsed.Answers {
		row, ok := byPosition[a.Position]
		if !ok {
			continue
		}
		if a.IsBlank && a.Note == "" {
			blanks++
			continue
		}
		value := a.Text
		if a.IsNumeric {
			value = strconv.FormatFloat(a.Number, 'f', -1, 64)
		}
		staged = append(staged, store.InboundAnswerInput{
			QuestionID: row.ID, Value: value, Unit: row.ExpectedUnit,
			Summary: answerSummary(a.Position, row.Tier, a.Note),
		})
	}
	first := q.Status == store.QuestionnaireSent
	if err := s.Store.ImportInboundAnswers(ctx, questionnaireID, staged, map[string]any{
		"supplier_id":     q.CustomerID,
		"is_first_import": first,
		"answer_count":    len(staged),
		"blank_count":     blanks,
		"warning_count":   len(parsed.Warnings),
	}); err != nil {
		return Preview{}, err
	}
	questions, err = s.Store.ListQuestions(ctx, questionnaireID)
	if err != nil {
		return Preview{}, err
	}
	for _, question := range questions {
		byPosition[question.Position] = question
	}
	return buildPreview(q, t, byPosition, parsed.Answers, parsed.Warnings), nil
}

// Preview rebuilds the review view from staged answers.
func (s *Service) Preview(ctx context.Context, questionnaireID string) (Preview, error) {
	q, err := s.loadInbound(ctx, questionnaireID)
	if err != nil {
		return Preview{}, err
	}
	if q.Status != store.QuestionnaireReceived {
		return Preview{}, fmt.Errorf("inbound: questionnaire is %q, not received", q.Status)
	}
	t, ok := TemplateByKind(q.TemplateKind)
	if !ok {
		return Preview{}, fmt.Errorf("inbound: unknown template %q", q.TemplateKind)
	}
	questions, err := s.Store.ListQuestions(ctx, questionnaireID)
	if err != nil {
		return Preview{}, err
	}
	byPosition := make(map[string]store.Question, len(questions))
	parsed := make([]ParsedAnswer, 0, len(questions))
	for _, question := range questions {
		byPosition[question.Position] = question
		answer := ParsedAnswer{Position: question.Position, IsBlank: true}
		if question.Answered() {
			answer.Raw = question.AnswerValue
			answer.Note = noteFromSummary(question.AnswerSourceSummary)
			answer.IsBlank = strings.TrimSpace(question.AnswerValue) == ""
			if question.QuestionKind == "numerical" {
				if n, err := strconv.ParseFloat(strings.TrimSpace(question.AnswerValue), 64); err == nil {
					answer.Number, answer.IsNumeric = n, true
				}
			} else {
				answer.Text = strings.TrimSpace(question.AnswerValue)
			}
		}
		parsed = append(parsed, answer)
	}
	return buildPreview(q, t, byPosition, parsed, nil), nil
}

// Preview describes one supplier reply under review.
type Preview struct {
	QuestionnaireID string
	SupplierName    string
	Answers         []PreviewAnswer
	Plan            IngestPlan
	Warnings        []Warning
}

// PreviewAnswer is one row of the review list.
type PreviewAnswer struct {
	QuestionID     string
	Position       string
	Tier           int
	Kind           string
	Raw            string
	Number         float64
	Text           string
	IsNumeric      bool
	IsBlank        bool
	Note           string
	ProposedCO2eKg *float64
	Finalized      bool
}

// IngestPlan summarizes what ingest will write.
type IngestPlan struct {
	Tier               int
	AvailableTiers     []int
	EmissionSourceName string
	TotalCO2eKg        float64
	ActivityRows       int
}

func buildPreview(q *store.Questionnaire, t Template, questions map[string]store.Question,
	parsed []ParsedAnswer, warnings []Warning) Preview {
	byPosition := make(map[string]ParsedAnswer, len(parsed))
	for _, a := range parsed {
		byPosition[a.Position] = a
	}
	available := availableTiers(t, questions, byPosition)
	selected := 0
	if len(available) > 0 {
		selected = available[0]
	}
	preview := Preview{QuestionnaireID: q.ID, SupplierName: q.CustomerName, Warnings: warnings}
	total := 0.0
	rows := 0
	for _, tq := range t.Questions {
		row, ok := questions[tq.Position]
		if !ok {
			continue
		}
		a := byPosition[tq.Position]
		item := PreviewAnswer{
			QuestionID: row.ID, Position: tq.Position, Tier: tq.Tier, Kind: tq.Kind,
			Raw: a.Raw, Number: a.Number, Text: a.Text, IsNumeric: a.IsNumeric,
			IsBlank: a.IsBlank, Note: a.Note, Finalized: row.AnswerFinalizedAt != "",
		}
		if selected == 2 && tq.Position == "tier2.3" && a.IsNumeric {
			value := a.Number
			item.ProposedCO2eKg = &value
			total += value
			rows++
		}
		preview.Answers = append(preview.Answers, item)
	}
	preview.Plan = IngestPlan{
		Tier: selected, AvailableTiers: available,
		EmissionSourceName: fmt.Sprintf("%s — purchased goods (%d)", q.CustomerName, q.ReportingYear),
		TotalCO2eKg:        total,
		ActivityRows:       rows,
	}
	return preview
}

// IngestRequest accepts a reviewed reply.
type IngestRequest struct {
	QuestionnaireID string
	Accepted        []string
	Tier1Quantity   *float64
	TierOverride    int
}

// IngestResult names the inventory rows written.
type IngestResult struct {
	ActivityIDs      []string
	EmissionSourceID string
	Ingested         bool
}

// Ingest converts the accepted answers into one inventory row. A reply with
// no usable tier is a soft no-op: nothing is written and Ingested is false.
func (s *Service) Ingest(ctx context.Context, in IngestRequest) (IngestResult, error) {
	q, err := s.loadInbound(ctx, in.QuestionnaireID)
	if err != nil {
		return IngestResult{}, err
	}
	if q.Status == store.QuestionnaireIngested {
		ids, sourceID, err := s.Store.InboundActivities(ctx, in.QuestionnaireID)
		if err != nil {
			return IngestResult{}, err
		}
		return IngestResult{ActivityIDs: ids, EmissionSourceID: sourceID, Ingested: true}, nil
	}
	if q.Status != store.QuestionnaireReceived {
		return IngestResult{}, fmt.Errorf("inbound: questionnaire is %q, not received", q.Status)
	}
	t, ok := TemplateByKind(q.TemplateKind)
	if !ok {
		return IngestResult{}, fmt.Errorf("inbound: unknown template %q", q.TemplateKind)
	}
	questions, err := s.Store.ListQuestions(ctx, in.QuestionnaireID)
	if err != nil {
		return IngestResult{}, err
	}
	byPosition := make(map[string]store.Question, len(questions))
	for _, question := range questions {
		byPosition[question.Position] = question
	}
	accepted := make(map[string]bool, len(in.Accepted))
	for _, id := range in.Accepted {
		accepted[id] = true
	}
	allowed := make(map[string]store.Question, len(accepted))
	for position, question := range byPosition {
		if accepted[question.ID] {
			allowed[position] = question
		}
	}
	tier := decideTier(t, allowed, in.TierOverride)
	if tier == 0 {
		return IngestResult{}, nil
	}

	chosen, amount, err := tierAmount(t, allowed, tier, in.Tier1Quantity, in.QuestionnaireID)
	if err != nil {
		return IngestResult{}, err
	}
	note := noteFromSummary(chosen.AnswerSourceSummary)
	base := fmt.Sprintf("来自 %s 供应商问卷 (%d)", q.CustomerName, q.ReportingYear)
	notes := base
	if note != "" {
		notes = base + "；供应商备注：" + note
	}
	acceptedIDs := make([]string, 0, len(allowed))
	for _, question := range allowed {
		acceptedIDs = append(acceptedIDs, question.ID)
	}
	result, err := s.Store.IngestInbound(ctx, store.InboundActivityInput{
		QuestionnaireID: in.QuestionnaireID, AcceptedQuestionIDs: acceptedIDs,
		InboundQuestionID: chosen.ID, InboundTier: tier, AmountCO2eKg: amount, Notes: notes,
	})
	if err != nil {
		return IngestResult{}, err
	}
	return IngestResult{ActivityIDs: []string{result.ActivityID},
		EmissionSourceID: result.EmissionSourceID, Ingested: true}, nil
}

// Delete removes one inbound questionnaire and its ingested inventory rows.
func (s *Service) Delete(ctx context.Context, questionnaireID string) (int, error) {
	return s.Store.DeleteInboundQuestionnaire(ctx, questionnaireID)
}

// ErrQuantityRequired is returned when a Tier 1 reply is accepted without the
// purchase quantity the per-kg footprint must be multiplied by.
var ErrQuantityRequired = errors.New("inbound: tier 1 ingest requires a purchased quantity")

func tierAmount(t Template, questions map[string]store.Question, tier int,
	quantity *float64, questionnaireID string) (store.Question, float64, error) {
	if tier == 1 {
		row, ok := questions["tier1.1"]
		if !ok {
			return store.Question{}, 0, ErrQuantityRequired
		}
		pcf, err := strconv.ParseFloat(strings.TrimSpace(row.AnswerValue), 64)
		if err != nil {
			return store.Question{}, 0, ErrQuantityRequired
		}
		if quantity == nil || *quantity <= 0 {
			return store.Question{}, 0, fmt.Errorf("%w: %s", ErrQuantityRequired, questionnaireID)
		}
		return row, pcf * *quantity, nil
	}
	row, ok := questions["tier2.3"]
	if !ok {
		return store.Question{}, 0, errors.New("inbound: tier 2 attribution row is missing")
	}
	amount, err := strconv.ParseFloat(strings.TrimSpace(row.AnswerValue), 64)
	if err != nil || amount <= 0 {
		return store.Question{}, 0, errors.New("inbound: tier 2 attribution is not a positive number")
	}
	return row, amount, nil
}

// availableTiers returns the tiers the parsed answers support, in preference
// order (Tier 1 first).
func availableTiers(t Template, questions map[string]store.Question,
	answers map[string]ParsedAnswer) []int {
	var out []int
	for _, q := range t.Questions {
		if q.Tier != 1 || q.Kind != "numerical" {
			continue
		}
		a, ok := answers[q.Position]
		if ok && !a.IsBlank && a.IsNumeric {
			out = append(out, 1)
			break
		}
	}
	tier2 := make([]Question, 0, 3)
	for _, q := range t.Questions {
		if q.Tier == 2 {
			tier2 = append(tier2, q)
		}
	}
	if len(tier2) > 0 {
		all := true
		for _, q := range tier2 {
			row, ok := questions[q.Position]
			if !ok || strings.TrimSpace(row.AnswerValue) == "" {
				all = false
				break
			}
		}
		if all {
			out = append(out, 2)
		}
	}
	return out
}

// decideTier picks the tier to ingest from the accepted rows. An override is
// honored only when that tier is actually satisfiable.
func decideTier(t Template, questions map[string]store.Question, override int) int {
	var tiers []int
	tier1 := false
	for _, q := range t.Questions {
		if q.Tier != 1 || q.Kind != "numerical" {
			continue
		}
		row, ok := questions[q.Position]
		if !ok {
			continue
		}
		if _, err := strconv.ParseFloat(strings.TrimSpace(row.AnswerValue), 64); err == nil {
			tier1 = true
		}
	}
	if tier1 {
		tiers = append(tiers, 1)
	}
	tier2 := true
	seen := false
	for _, q := range t.Questions {
		if q.Tier != 2 {
			continue
		}
		seen = true
		row, ok := questions[q.Position]
		if !ok || strings.TrimSpace(row.AnswerValue) == "" {
			tier2 = false
		}
	}
	if seen && tier2 {
		tiers = append(tiers, 2)
	}
	for _, tier := range tiers {
		if tier == override {
			return tier
		}
	}
	if len(tiers) == 0 {
		return 0
	}
	return tiers[0]
}

func answerSummary(position string, tier int, note string) string {
	payload := map[string]any{"source": "inbound_questionnaire", "position": position}
	if tier > 0 {
		payload["tier"] = tier
	}
	if note != "" {
		payload["note"] = note
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(data)
}

func noteFromSummary(summary string) string {
	if summary == "" {
		return ""
	}
	var payload struct {
		Note string `json:"note"`
	}
	if json.Unmarshal([]byte(summary), &payload) == nil {
		return payload.Note
	}
	return ""
}

func (s *Service) loadInbound(ctx context.Context, id string) (*store.Questionnaire, error) {
	if s.Store == nil {
		return nil, errors.New("inbound: store is required")
	}
	q, err := s.Store.QuestionnaireByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if q == nil {
		return nil, fmt.Errorf("inbound: questionnaire not found: %s", id)
	}
	if q.Direction != "inbound" {
		return nil, fmt.Errorf("inbound: questionnaire %s is not inbound", id)
	}
	return q, nil
}

func slug(name string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case !lastDash && b.Len() > 0:
			b.WriteByte('-')
			lastDash = true
		}
		if b.Len() >= 40 {
			break
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "supplier"
	}
	return out
}
