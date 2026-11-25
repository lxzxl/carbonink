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

// CreateRequest materializes one draft. Empty TemplateKind defaults to Cat 1.
type CreateRequest struct {
	SupplierID    string
	TemplateKind  string
	ReportingYear int
	Positions     []string
}

// Templates returns all built-in templates followed by user-authored custom
// templates stored in the workspace.
func (s *Service) Templates(ctx context.Context) ([]Template, error) {
	out := Templates()
	if s.Store == nil {
		return out, nil
	}
	custom, err := s.Store.ListInboundTemplates(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range custom {
		out = append(out, FromStoreTemplate(item))
	}
	return out, nil
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
	kind := strings.TrimSpace(in.TemplateKind)
	if kind == "" {
		kind = TemplateCat1
	}
	t, ok, err := s.resolveTemplate(ctx, kind)
	if err != nil {
		return "", 0, err
	}
	if !ok {
		return "", 0, fmt.Errorf("inbound: unknown template %q", kind)
	}
	questions := t.included(in.Positions)
	if len(questions) == 0 {
		return "", 0, errors.New("inbound: at least one template question must be included")
	}
	stage := make([]store.InboundQuestionInput, 0, len(questions))
	for _, q := range questions {
		stage = append(stage, store.InboundQuestionInput{
			Signature:      signatureFor(t.Kind, t.Version, q.Position),
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
	t, ok, err := s.resolveTemplateForQuestionnaire(ctx, q)
	if err != nil {
		return nil, "", err
	}
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
	t, ok, err := s.resolveTemplateForQuestionnaire(ctx, q)
	if err != nil {
		return Preview{}, err
	}
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
		unit := row.ExpectedUnit
		if a.IsNumeric {
			value = strconv.FormatFloat(a.Number, 'f', -1, 64)
			if a.UnitSuffix != "" && row.Tier == 3 {
				unit = a.UnitSuffix
			}
		}
		staged = append(staged, store.InboundAnswerInput{
			QuestionID: row.ID, Value: value, Unit: unit,
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
	return s.buildPreview(ctx, q, t, byPosition, parsed.Answers, parsed.Warnings), nil
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
	t, ok, err := s.resolveTemplateForQuestionnaire(ctx, q)
	if err != nil {
		return Preview{}, err
	}
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
					if question.Tier == 3 && question.AnswerUnit != "" {
						answer.UnitSuffix = question.AnswerUnit
					}
				}
			} else {
				answer.Text = strings.TrimSpace(question.AnswerValue)
			}
		}
		parsed = append(parsed, answer)
	}
	return s.buildPreview(ctx, q, t, byPosition, parsed, nil), nil
}

// Preview describes one supplier reply under review.
type Preview struct {
	QuestionnaireID   string
	TemplateKind      string
	SupplierName      string
	Tier1Unit         string
	Answers           []PreviewAnswer
	Plan              IngestPlan
	Warnings          []Warning
	QuantityInference store.QuantityInference
	Tier3             Tier3Preview
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

// Tier3Candidate is one ranked emission factor candidate for a Tier 3 reply.
type Tier3Candidate struct {
	EF              store.EmissionFactor
	ConvertedAmount float64
	CO2eKg          float64
	Compatible      bool
	UnitError       string
}

// Tier3Preview holds the parsed Tier 3 activity data and ranked EF options.
type Tier3Preview struct {
	Available   bool
	Description string
	Amount      float64
	Unit        string
	Candidates  []Tier3Candidate
}

// IngestPlan summarizes what ingest will write.
type IngestPlan struct {
	Tier               int
	AvailableTiers     []int
	EmissionSourceName string
	TotalCO2eKg        float64
	ActivityRows       int
}

func (s *Service) buildPreview(ctx context.Context, q *store.Questionnaire, t Template,
	questions map[string]store.Question, parsed []ParsedAnswer, warnings []Warning) Preview {
	byPosition := make(map[string]ParsedAnswer, len(parsed))
	for _, a := range parsed {
		byPosition[a.Position] = a
	}
	available := availableTiers(t, byPosition)
	selected := 0
	if len(available) > 0 {
		selected = available[0]
	}

	preview := Preview{
		QuestionnaireID: q.ID,
		TemplateKind:    t.Kind,
		SupplierName:    q.CustomerName,
		Tier1Unit:       t.Tier1Unit,
		Warnings:        warnings,
	}

	if hasTier(available, 1) && t.Tier1Unit != "" {
		if inf, err := s.Store.InferInboundQuantity(ctx, q.CustomerName, t.GHGProtocolPath,
			t.Tier1Unit, q.ReportingYear); err == nil {
			preview.QuantityInference = inf
		}
	}
	if hasTier(available, 3) {
		preview.Tier3 = s.buildTier3Preview(ctx, t, byPosition)
	}

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
		} else if selected == 3 && tq.Position == "tier3.2" && a.IsNumeric {
			if candidate, ok := firstCompatibleCandidate(preview.Tier3.Candidates); ok {
				value := candidate.CO2eKg
				item.ProposedCO2eKg = &value
				total += value
				rows++
			}
		}
		preview.Answers = append(preview.Answers, item)
	}
	suffix := t.SourceSuffixEN
	if suffix == "" {
		suffix = "purchased goods"
	}
	preview.Plan = IngestPlan{
		Tier: selected, AvailableTiers: available,
		EmissionSourceName: fmt.Sprintf("%s — %s (%d)", q.CustomerName, suffix, q.ReportingYear),
		TotalCO2eKg:        total,
		ActivityRows:       rows,
	}
	return preview
}

func (s *Service) buildTier3Preview(ctx context.Context, t Template, answers map[string]ParsedAnswer) Tier3Preview {
	desc := strings.TrimSpace(answers["tier3.1"].Text)
	qty := answers["tier3.2"]
	unit := resolveTier3Unit(t, answers)
	out := Tier3Preview{
		Available:   true,
		Description: desc,
		Amount:      qty.Number,
		Unit:        unit,
	}
	candidates, err := s.Store.ListEmissionFactors(ctx, store.EFFilter{
		Scope: t.Scope, Category: t.EFCategory, Limit: 500,
	})
	if err != nil {
		return out
	}
	if len(candidates) == 0 && t.EFCategory != "" {
		candidates, _ = s.Store.ListEmissionFactors(ctx, store.EFFilter{
			Scope: t.Scope, Limit: 500,
		})
	}
	hint := strings.TrimSpace(desc + " " + unit)
	ranked := s.Store.RankEmissionFactors(ctx, candidates, hint)
	if len(ranked) > 20 {
		ranked = ranked[:20]
	}
	out.Candidates = make([]Tier3Candidate, 0, len(ranked))
	for _, ef := range ranked {
		cand := Tier3Candidate{EF: ef}
		converted, convErr := s.Store.ConvertAmount(ctx, qty.Number, unit, ef.InputUnit, "")
		if convErr != nil {
			cand.UnitError = convErr.Error()
		} else {
			cand.Compatible = true
			cand.ConvertedAmount = converted
			cand.CO2eKg = store.EmissionCO2eKg(converted, ef)
		}
		out.Candidates = append(out.Candidates, cand)
	}
	return out
}

// IngestRequest accepts a reviewed reply.
type IngestRequest struct {
	QuestionnaireID string
	Accepted        []string
	Tier1Quantity   *float64
	TierOverride    int
	Tier3EF         *store.EmissionFactorKey
}

// IngestResult names the inventory rows written.
type IngestResult struct {
	ActivityIDs      []string
	EmissionSourceID string
	Ingested         bool
	CO2eKg           float64
}

var (
	// ErrQuantityRequired is returned when a Tier 1 reply is accepted without
	// the purchase quantity the per-unit footprint must be multiplied by.
	ErrQuantityRequired = errors.New("inbound: tier 1 ingest requires a purchased quantity")
	// ErrTier3EFRequired is returned when a Tier 3 reply has no compatible
	// emission factor selected or available.
	ErrTier3EFRequired = errors.New("inbound: tier 3 ingest requires a compatible emission factor")
)

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
	t, ok, err := s.resolveTemplateForQuestionnaire(ctx, q)
	if err != nil {
		return IngestResult{}, err
	}
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

	acceptedIDs := make([]string, 0, len(allowed))
	for _, question := range allowed {
		acceptedIDs = append(acceptedIDs, question.ID)
	}

	var chosen store.Question
	var input store.InboundActivityInput
	if tier == 3 {
		qtyRow, ok := allowed["tier3.2"]
		if !ok {
			return IngestResult{}, errors.New("inbound: tier 3 quantity row is missing")
		}
		amount, err := strconv.ParseFloat(strings.TrimSpace(qtyRow.AnswerValue), 64)
		if err != nil || amount <= 0 {
			return IngestResult{}, errors.New("inbound: tier 3 quantity is not a positive number")
		}
		unit := resolveTier3UnitFromStore(t, allowed)
		if unit == "" {
			return IngestResult{}, errors.New("inbound: tier 3 unit is missing")
		}
		efKey := in.Tier3EF
		if efKey == nil {
			preview := s.buildTier3Preview(ctx, t, answersFromQuestions(allowed))
			cand, ok := firstCompatibleCandidate(preview.Candidates)
			if !ok {
				return IngestResult{}, ErrTier3EFRequired
			}
			efKey = &store.EmissionFactorKey{
				FactorCode: cand.EF.FactorCode, Year: cand.EF.Year,
				Source: cand.EF.Source, Geography: cand.EF.Geography,
				DatasetVersion: cand.EF.DatasetVersion,
			}
		}
		chosen = qtyRow
		input = store.InboundActivityInput{
			QuestionnaireID:     in.QuestionnaireID,
			AcceptedQuestionIDs: acceptedIDs,
			InboundQuestionID:   chosen.ID,
			InboundTier:         3,
			EF:                  efKey,
			Amount:              amount,
			Unit:                unit,
			Scope:               t.Scope,
			Category:            t.Category,
			GHGProtocolPath:     t.GHGProtocolPath,
			SourceSuffix:        t.SourceSuffixEN,
		}
	} else {
		var amount float64
		chosen, amount, err = tierAmount(allowed, tier, in.Tier1Quantity, in.QuestionnaireID)
		if err != nil {
			return IngestResult{}, err
		}
		input = store.InboundActivityInput{
			QuestionnaireID:     in.QuestionnaireID,
			AcceptedQuestionIDs: acceptedIDs,
			InboundQuestionID:   chosen.ID,
			InboundTier:         tier,
			AmountCO2eKg:        amount,
			Scope:               t.Scope,
			Category:            t.Category,
			GHGProtocolPath:     t.GHGProtocolPath,
			SourceSuffix:        t.SourceSuffixEN,
		}
	}

	note := noteFromSummary(chosen.AnswerSourceSummary)
	base := fmt.Sprintf("来自 %s 供应商问卷 (%d)", q.CustomerName, q.ReportingYear)
	notes := base
	if note != "" {
		notes = base + "；供应商备注：" + note
	}
	input.Notes = notes

	result, err := s.Store.IngestInbound(ctx, input)
	if err != nil {
		return IngestResult{}, err
	}
	return IngestResult{
		ActivityIDs:      []string{result.ActivityID},
		EmissionSourceID: result.EmissionSourceID,
		Ingested:         true,
		CO2eKg:           result.CO2eKg,
	}, nil
}

// Delete removes one inbound questionnaire and its ingested inventory rows.
func (s *Service) Delete(ctx context.Context, questionnaireID string) (int, error) {
	return s.Store.DeleteInboundQuestionnaire(ctx, questionnaireID)
}

func tierAmount(questions map[string]store.Question, tier int,
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
// order (Tier 1 > Tier 2 > Tier 3).
func availableTiers(t Template, answers map[string]ParsedAnswer) []int {
	var out []int
	for _, q := range t.Questions {
		if q.Tier != 1 || q.Kind != "numerical" {
			continue
		}
		a, ok := answers[q.Position]
		if ok && !a.IsBlank && a.IsNumeric && a.Number > 0 {
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
			a, ok := answers[q.Position]
			if !ok || a.IsBlank {
				all = false
				break
			}
			if q.Position == "tier2.3" && (!a.IsNumeric || a.Number <= 0) {
				all = false
				break
			}
		}
		if all {
			out = append(out, 2)
		}
	}
	if a, ok := answers["tier3.2"]; ok && !a.IsBlank && a.IsNumeric && a.Number > 0 {
		if resolveTier3Unit(t, answers) != "" {
			out = append(out, 3)
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
		if n, err := strconv.ParseFloat(strings.TrimSpace(row.AnswerValue), 64); err == nil && n > 0 {
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
			continue
		}
		if q.Position == "tier2.3" {
			if n, err := strconv.ParseFloat(strings.TrimSpace(row.AnswerValue), 64); err != nil || n <= 0 {
				tier2 = false
			}
		}
	}
	if seen && tier2 {
		tiers = append(tiers, 2)
	}
	if row, ok := questions["tier3.2"]; ok {
		if n, err := strconv.ParseFloat(strings.TrimSpace(row.AnswerValue), 64); err == nil && n > 0 {
			if resolveTier3UnitFromStore(t, questions) != "" {
				tiers = append(tiers, 3)
			}
		}
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

func (s *Service) resolveTemplate(ctx context.Context, kind string) (Template, bool, error) {
	if strings.TrimSpace(kind) == "" {
		return Cat1, true, nil
	}
	if t, ok := TemplateByKind(kind); ok {
		return t, true, nil
	}
	if s.Store != nil {
		custom, err := s.Store.InboundTemplateByKind(ctx, kind)
		if err != nil {
			return Template{}, false, err
		}
		if custom != nil {
			return FromStoreTemplate(*custom), true, nil
		}
	}
	return Template{}, false, nil
}

func (s *Service) resolveTemplateForQuestionnaire(ctx context.Context, q *store.Questionnaire) (Template, bool, error) {
	t, ok, err := s.resolveTemplate(ctx, q.TemplateKind)
	if err != nil || ok {
		return t, ok, err
	}
	// If a custom template was deleted after a draft was created, reconstruct
	// its sheet layout deterministically from the questionnaire's own rows.
	if strings.HasPrefix(q.TemplateKind, "custom:") && s.Store != nil {
		rows, err := s.Store.ListQuestions(ctx, q.ID)
		if err != nil {
			return Template{}, false, err
		}
		if len(rows) > 0 {
			counts := map[int]int{}
			qs := make([]Question, 0, len(rows))
			for _, r := range rows {
				counts[r.Tier]++
				sheet := "metadata"
				switch r.Tier {
				case 1:
					sheet = "tier1"
				case 2:
					sheet = "tier2"
				case 3:
					sheet = "tier3"
				}
				cellRef := fmt.Sprintf("%s!B%d", sheet, 5+(counts[r.Tier]-1)*2)
				qs = append(qs, Question{
					Position: r.Position, Tier: r.Tier, Kind: r.QuestionKind,
					RawZH: r.RawText, RawEN: r.RawText, ExpectedUnit: r.ExpectedUnit,
					CellRef: cellRef,
				})
			}
			return Template{
				Custom: true, Kind: q.TemplateKind, Version: TemplateVersion,
				Scope: 3, Category: "purchased_goods", GHGProtocolPath: "scope3.cat1_purchased_goods",
				EFCategory: "purchase", SourceSuffixEN: "purchased goods",
				Tier1Unit: "kg", DefaultUnit: "kg", Questions: qs,
			}, true, nil
		}
	}
	return Template{}, false, nil
}

func resolveTier3Unit(t Template, answers map[string]ParsedAnswer) string {
	if u := strings.TrimSpace(answers["tier3.3"].Text); u != "" {
		return u
	}
	if u := strings.TrimSpace(answers["tier3.2"].UnitSuffix); u != "" {
		return u
	}
	if q, ok := t.QuestionByPosition("tier3.2"); ok && strings.TrimSpace(q.ExpectedUnit) != "" {
		return strings.TrimSpace(q.ExpectedUnit)
	}
	return t.DefaultUnit
}

func resolveTier3UnitFromStore(t Template, questions map[string]store.Question) string {
	if row, ok := questions["tier3.3"]; ok && strings.TrimSpace(row.AnswerValue) != "" {
		return strings.TrimSpace(row.AnswerValue)
	}
	if row, ok := questions["tier3.2"]; ok && strings.TrimSpace(row.AnswerUnit) != "" {
		return strings.TrimSpace(row.AnswerUnit)
	}
	if q, ok := t.QuestionByPosition("tier3.2"); ok && strings.TrimSpace(q.ExpectedUnit) != "" {
		return strings.TrimSpace(q.ExpectedUnit)
	}
	return t.DefaultUnit
}

func answersFromQuestions(questions map[string]store.Question) map[string]ParsedAnswer {
	out := make(map[string]ParsedAnswer, len(questions))
	for pos, q := range questions {
		a := ParsedAnswer{Position: pos, Raw: q.AnswerValue, IsBlank: strings.TrimSpace(q.AnswerValue) == ""}
		if q.QuestionKind == "numerical" {
			if n, err := strconv.ParseFloat(strings.TrimSpace(q.AnswerValue), 64); err == nil {
				a.Number, a.IsNumeric = n, true
			}
			a.UnitSuffix = q.AnswerUnit
		} else {
			a.Text = strings.TrimSpace(q.AnswerValue)
		}
		out[pos] = a
	}
	return out
}

func firstCompatibleCandidate(candidates []Tier3Candidate) (Tier3Candidate, bool) {
	for _, cand := range candidates {
		if cand.Compatible {
			return cand, true
		}
	}
	return Tier3Candidate{}, false
}

func hasTier(tiers []int, target int) bool {
	for _, tier := range tiers {
		if tier == target {
			return true
		}
	}
	return false
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
