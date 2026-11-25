package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Inbound questionnaire lifecycle states. They share the questionnaire
// status column with the outbound states.
const (
	QuestionnaireDraft    = "draft"
	QuestionnaireSent     = "sent"
	QuestionnaireReceived = "received"
	QuestionnaireIngested = "ingested"
)

// InboundQuestionInput is one template question staged into a draft.
type InboundQuestionInput struct {
	Signature      string
	NormalizedText string
	RawText        string
	Kind           string
	ExpectedUnit   string
	Position       string
	Tier           int
	Required       bool
}

// InboundDraftInput creates a supplier disclosure draft. Inbound drafts carry
// no source document: the workbook is generated from the template.
type InboundDraftInput struct {
	SupplierID    string
	TemplateKind  string
	ReportingYear int
	Questions     []InboundQuestionInput
}

// CreateInboundDraft writes one draft questionnaire and its template
// questions in a single transaction.
func (s *Store) CreateInboundDraft(ctx context.Context, in InboundDraftInput) (string, error) {
	if in.ReportingYear < 2020 || in.ReportingYear > 2030 {
		return "", errors.New("reporting year must be between 2020 and 2030")
	}
	if strings.TrimSpace(in.TemplateKind) == "" {
		return "", errors.New("template kind is required")
	}
	if len(in.Questions) == 0 {
		return "", errors.New("at least one question must be included")
	}
	for i, q := range in.Questions {
		if strings.TrimSpace(q.Signature) == "" || strings.TrimSpace(q.NormalizedText) == "" {
			return "", fmt.Errorf("question %d has no signature or text", i+1)
		}
		switch q.Kind {
		case "numerical", "categorical", "narrative":
		default:
			return "", fmt.Errorf("question %d has kind %q", i+1, q.Kind)
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	supplier, err := customerByRole(ctx, tx, in.SupplierID, "supplier")
	if err != nil {
		return "", err
	}
	if supplier == nil {
		return "", fmt.Errorf("supplier not found: %s", in.SupplierID)
	}

	id := newID()
	if _, err := tx.ExecContext(ctx, `INSERT INTO questionnaire
		(id, counterparty_id, document_id, template_kind, reporting_year, status, direction, due_date, created_at)
		VALUES (?, ?, NULL, ?, ?, ?, 'inbound', NULL, ?)`,
		id, supplier.ID, in.TemplateKind, in.ReportingYear, QuestionnaireDraft, now()); err != nil {
		return "", err
	}
	for _, q := range in.Questions {
		rawText := q.RawText
		if strings.TrimSpace(rawText) == "" {
			rawText = q.NormalizedText
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO question
			(id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text,
			 parsed_intent, question_kind, expected_unit, position, required, tier)
			VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
			newID(), id, q.Signature, SignatureVersion, q.NormalizedText, rawText,
			q.Kind, nullIfEmpty(q.ExpectedUnit), nullIfEmpty(q.Position),
			boolInt(q.Required), nullIfZero(q.Tier)); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}

// SetQuestionnaireStatus moves one questionnaire to status. It is only used
// by the inbound flow, whose transitions are draft → sent → received →
// ingested.
func (s *Store) SetQuestionnaireStatus(ctx context.Context, id, status string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE questionnaire SET status = ? WHERE id = ?`, status, id)
	if err != nil {
		return err
	}
	if changed, err := res.RowsAffected(); err == nil && changed == 0 {
		return fmt.Errorf("questionnaire not found: %s", id)
	}
	return nil
}

// MarkInboundExported moves a draft to sent and audits the first export.
// Re-exports pass wasDraft=false and only re-stamp the status.
func (s *Store) MarkInboundExported(ctx context.Context, id string, wasDraft bool,
	payload map[string]any) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE questionnaire SET status = ? WHERE id = ?`,
		QuestionnaireSent, id); err != nil {
		return err
	}
	if wasDraft {
		if payload == nil {
			payload = map[string]any{}
		}
		payload["questionnaire_id"] = id
		if err := writeAudit(ctx, tx, "inbound_questionnaire.exported", now(), payload); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// InboundAnswerInput is one tentative answer parsed from a supplier's file.
type InboundAnswerInput struct {
	QuestionID string
	Value      string
	Unit       string
	Summary    string
}

// ImportInboundAnswers wipes the questionnaire's unfinalized manual answers,
// writes the parsed set, moves the questionnaire to received, and audits the
// import in one transaction. The audit payload is supplied by the service and
// carries counts only.
func (s *Store) ImportInboundAnswers(ctx context.Context, questionnaireID string,
	answers []InboundAnswerInput, payload map[string]any) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM evidence_attachment
		WHERE answer_id IN (
			SELECT a.id FROM answer a JOIN question q ON q.id = a.question_id
			WHERE q.questionnaire_id = ? AND a.source_kind = 'manual'
			  AND a.finalized_at IS NULL)`, questionnaireID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM answer
		WHERE source_kind = 'manual' AND finalized_at IS NULL
		  AND question_id IN (SELECT id FROM question WHERE questionnaire_id = ?)`,
		questionnaireID); err != nil {
		return err
	}
	for _, a := range answers {
		summary := any(nil)
		if strings.TrimSpace(a.Summary) != "" {
			summary = a.Summary
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO answer
			(id, question_id, value, unit, source_kind, source_summary, finalized_at)
			VALUES (?, ?, ?, ?, 'manual', ?, NULL)`,
			newID(), a.QuestionID, a.Value, nullIfEmpty(a.Unit), summary); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE questionnaire SET status = ? WHERE id = ?`,
		QuestionnaireReceived, questionnaireID); err != nil {
		return err
	}
	if payload == nil {
		payload = map[string]any{}
	}
	payload["questionnaire_id"] = questionnaireID
	if err := writeAudit(ctx, tx, "inbound_questionnaire.imported", now(), payload); err != nil {
		return err
	}
	return tx.Commit()
}

// InboundActivityInput materializes one accepted disclosure into the
// inventory. For Tier 1/2, AmountCO2eKg is the reported CO2e and the sentinel
// factor converts 1:1. For Tier 3, EF + Amount + Unit are converted via
// ConvertAmount and pinned directly.
type InboundActivityInput struct {
	QuestionnaireID     string
	AcceptedQuestionIDs []string
	InboundQuestionID   string
	InboundTier         int
	AmountCO2eKg        float64
	EF                  *EmissionFactorKey
	Amount              float64
	Unit                string
	Scope               int
	Category            string
	GHGProtocolPath     string
	SourceSuffix        string
	Notes               string
	AuditPayload        map[string]any
}

// InboundIngestResult names the rows an ingest created.
type InboundIngestResult struct {
	ActivityID       string
	EmissionSourceID string
	CO2eKg           float64
}

// IngestInbound writes the activity row, finalizes the accepted answers,
// moves the questionnaire to ingested, and audits the transition in one
// transaction.
func (s *Store) IngestInbound(ctx context.Context, in InboundActivityInput) (InboundIngestResult, error) {
	var out InboundIngestResult
	if in.InboundTier == 3 {
		if in.EF == nil {
			return out, errors.New("tier 3 ingest requires an emission factor")
		}
		if err := validateEFKey(*in.EF); err != nil {
			return out, err
		}
		if !validFinite(in.Amount) || in.Amount <= 0 {
			return out, errors.New("reported activity amount must be positive")
		}
		if strings.TrimSpace(in.Unit) == "" {
			return out, errors.New("reported activity unit is required")
		}
	} else if !validFinite(in.AmountCO2eKg) || in.AmountCO2eKg <= 0 {
		return out, errors.New("reported emissions must be positive")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	qn, err := questionnaireTx(ctx, tx, in.QuestionnaireID)
	if err != nil {
		return out, err
	}
	if qn.Direction != "inbound" {
		return out, fmt.Errorf("questionnaire %s is not inbound", in.QuestionnaireID)
	}
	if qn.Status != QuestionnaireReceived {
		return out, fmt.Errorf("questionnaire %s is %q, not received", in.QuestionnaireID, qn.Status)
	}
	supplier, err := customerByRole(ctx, tx, qn.CustomerID, "supplier")
	if err != nil {
		return out, err
	}
	if supplier == nil {
		return out, fmt.Errorf("supplier not found: %s", qn.CustomerID)
	}
	var periodID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM reporting_period WHERE year = ?
		ORDER BY created_at LIMIT 1`, qn.ReportingYear).Scan(&periodID)
	if errors.Is(err, sql.ErrNoRows) {
		return out, fmt.Errorf("reporting period %d not found", qn.ReportingYear)
	}
	if err != nil {
		return out, err
	}
	var orgID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM organization LIMIT 1`).Scan(&orgID)
	if errors.Is(err, sql.ErrNoRows) {
		return out, errors.New("no organization found")
	}
	if err != nil {
		return out, err
	}
	var siteID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM site WHERE organization_id = ? AND is_active = 1
		ORDER BY created_at LIMIT 1`, orgID).Scan(&siteID)
	if errors.Is(err, sql.ErrNoRows) {
		return out, errors.New("no active site found")
	}
	if err != nil {
		return out, err
	}

	scope := in.Scope
	if scope == 0 {
		scope = 3
	}
	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "purchased_goods"
	}
	ghgPath := strings.TrimSpace(in.GHGProtocolPath)
	if ghgPath == "" {
		ghgPath = "scope3.cat1_purchased_goods"
	}
	suffix := strings.TrimSpace(in.SourceSuffix)
	if suffix == "" {
		suffix = "purchased goods"
	}

	stamp := now()
	var (
		ef             inboundFactor
		storedAmount   float64
		storedUnit     string
		computedCO2eKg float64
	)
	if in.InboundTier == 3 {
		chosen, err := emissionFactorByKey(ctx, tx, *in.EF)
		if err != nil {
			return out, err
		}
		if chosen == nil {
			return out, fmt.Errorf("emission factor not found: %s/%d/%s/%s/%s",
				in.EF.FactorCode, in.EF.Year, in.EF.Source, in.EF.Geography, in.EF.DatasetVersion)
		}
		if err := pinEmissionFactor(ctx, tx, chosen); err != nil {
			return out, err
		}
		converted, err := convertAmount(ctx, tx, in.Amount, strings.TrimSpace(in.Unit), chosen.InputUnit, "")
		if err != nil {
			return out, err
		}
		ef = inboundFactor{
			factorCode:     chosen.FactorCode,
			year:           chosen.Year,
			source:         chosen.Source,
			geography:      chosen.Geography,
			datasetVersion: chosen.DatasetVersion,
		}
		storedAmount = in.Amount
		storedUnit = strings.TrimSpace(in.Unit)
		computedCO2eKg = EmissionCO2eKg(converted, *chosen)
	} else {
		ef, err = findOrCreateInboundFactor(ctx, tx, supplier.ID, qn.ReportingYear, stamp,
			scope, category, ghgPath)
		if err != nil {
			return out, err
		}
		storedAmount = in.AmountCO2eKg
		storedUnit = "kgCO2e"
		computedCO2eKg = in.AmountCO2eKg
	}

	sourceName := fmt.Sprintf("%s — %s (%d)", supplier.Name, suffix, qn.ReportingYear)
	sourceID, err := findOrCreateInboundSource(ctx, tx, siteID, sourceName, scope, category, ghgPath)
	if err != nil {
		return out, err
	}
	out.EmissionSourceID = sourceID
	out.ActivityID = newID()
	out.CO2eKg = computedCO2eKg
	start := fmt.Sprintf("%d-01-01T00:00:00Z", qn.ReportingYear)
	end := fmt.Sprintf("%d-12-31T23:59:59Z", qn.ReportingYear)
	if _, err := tx.ExecContext(ctx, `INSERT INTO activity_data (
			id, site_id, emission_source_id, reporting_period_id,
			occurred_at_start, occurred_at_end, amount, unit,
			ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
			computed_co2e_kg, computed_at,
			extraction_id, notes, created_at, updated_at,
			inbound_question_id, inbound_tier)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
		out.ActivityID, siteID, sourceID, periodID, start, end, storedAmount, storedUnit,
		ef.factorCode, ef.year, ef.source, ef.geography, ef.datasetVersion,
		computedCO2eKg, stamp, nullIfEmpty(in.Notes), stamp, stamp,
		nullIfEmpty(in.InboundQuestionID), nullIfZero(in.InboundTier)); err != nil {
		return out, err
	}
	for _, questionID := range in.AcceptedQuestionIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE answer SET finalized_at = ?
			WHERE question_id = ?`, stamp, questionID); err != nil {
			return out, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE questionnaire SET status = ?
		WHERE id = ?`, QuestionnaireIngested, in.QuestionnaireID); err != nil {
		return out, err
	}
	payload := in.AuditPayload
	if payload == nil {
		payload = map[string]any{}
	}
	payload["questionnaire_id"] = in.QuestionnaireID
	payload["supplier_id"] = supplier.ID
	payload["tier_selected"] = in.InboundTier
	payload["activity_data_ids"] = []string{out.ActivityID}
	payload["emission_source_id"] = out.EmissionSourceID
	payload["total_co2e_kg"] = computedCO2eKg
	if err := writeAudit(ctx, tx, "inbound_questionnaire.ingested", stamp, payload); err != nil {
		return out, err
	}
	if err := tx.Commit(); err != nil {
		return out, err
	}
	return out, nil
}

type inboundFactor struct {
	factorCode     string
	year           int
	source         string
	geography      string
	datasetVersion string
}

func findOrCreateInboundFactor(ctx context.Context, q queryer, supplierID string, year int,
	stamp string, scope int, category, ghgPath string) (inboundFactor, error) {
	factorCode := fmt.Sprintf("supplier_direct.%s.%d", supplierID, year)
	if ghgPath != "" && ghgPath != "scope3.cat1_purchased_goods" {
		factorCode = fmt.Sprintf("supplier_direct.%s.%s.%d", supplierID, category, year)
	}
	ef := inboundFactor{
		factorCode:     factorCode,
		year:           year,
		source:         "inbound_questionnaire",
		geography:      "SUPPLIER",
		datasetVersion: "1.0",
	}
	var exists int
	if err := q.QueryRowContext(ctx, `SELECT count(*) FROM pinned_emission_factor
		WHERE factor_code = ? AND year = ? AND source = ? AND geography = ?
		  AND dataset_version = ?`, ef.factorCode, ef.year, ef.source, ef.geography,
		ef.datasetVersion).Scan(&exists); err != nil {
		return ef, err
	}
	if exists > 0 {
		return ef, nil
	}
	_, err := q.ExecContext(ctx, `INSERT INTO pinned_emission_factor (
			factor_code, year, source, geography, dataset_version,
			scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
			gwp_basis, name_zh, name_en, description_zh, description_en,
			pinned_at, pinned_from)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?,
			'kgCO2e', 1.0, 'AR6',
			'供应商直报排放', 'Supplier-reported direct emissions',
			'供应商问卷直接报送的 kgCO2e；amount 已是 CO2e。',
			'Supplier-reported direct emissions in kgCO2e; amount IS the CO2e value.',
			?, 'inbound_questionnaire')`,
		ef.factorCode, ef.year, ef.source, ef.geography, ef.datasetVersion,
		scope, category, ghgPath, stamp)
	return ef, err
}

func findOrCreateInboundSource(ctx context.Context, q queryer, siteID, name string,
	scope int, category, ghgPath string) (string, error) {
	var id string
	err := q.QueryRowContext(ctx, `SELECT id FROM emission_source WHERE site_id = ? AND name = ?`,
		siteID, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	id = newID()
	_, err = q.ExecContext(ctx, `INSERT INTO emission_source
		(id, site_id, name, scope, category, ghg_protocol_path, default_ef_query,
		 template_origin, is_active)
		VALUES (?, ?, ?, ?, ?, ?, NULL,
			'inbound_questionnaire', 1)`, id, siteID, name, scope, category, ghgPath)
	return id, err
}

func questionnaireTx(ctx context.Context, q queryer, id string) (*Questionnaire, error) {
	row := q.QueryRowContext(ctx, questionnaireSelect+` WHERE q.id = ?`, id)
	qn, err := scanQuestionnaire(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("questionnaire not found: %s", id)
	}
	if err != nil {
		return nil, err
	}
	return &qn, nil
}

// DeleteInboundQuestionnaire removes the questionnaire, its questions and
// answers, and any activity rows ingested from it. The supplier-specific
// factor and emission source stay behind: they may be shared with sibling
// disclosures. Returns the number of inventory rows removed.
func (s *Store) DeleteInboundQuestionnaire(ctx context.Context, id string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	qn, err := questionnaireTx(ctx, tx, id)
	if err != nil {
		return 0, err
	}
	if qn.Direction != "inbound" {
		return 0, fmt.Errorf("questionnaire %s is not inbound", id)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM evidence_attachment
		WHERE activity_data_id IN (SELECT id FROM activity_data
			WHERE inbound_question_id IN (SELECT id FROM question WHERE questionnaire_id = ?))`,
		id); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM evidence_attachment
		WHERE answer_id IN (SELECT a.id FROM answer a JOIN question q ON q.id = a.question_id
			WHERE q.questionnaire_id = ?)`, id); err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM activity_data
		WHERE inbound_question_id IN (SELECT id FROM question WHERE questionnaire_id = ?)`, id)
	if err != nil {
		return 0, err
	}
	removed := 0
	if n, err := res.RowsAffected(); err == nil {
		removed = int(n)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM answer
		WHERE question_id IN (SELECT id FROM question WHERE questionnaire_id = ?)`, id); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM question WHERE questionnaire_id = ?`, id); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM questionnaire WHERE id = ?`, id); err != nil {
		return 0, err
	}
	if err := writeAudit(ctx, tx, "inbound_questionnaire.deleted", now(), map[string]any{
		"questionnaire_id":      id,
		"supplier_id":           qn.CustomerID,
		"status_at_delete":      qn.Status,
		"deleted_activity_data": removed,
	}); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return removed, nil
}

// OverdueDisclosure is one sent disclosure past its due date.
type OverdueDisclosure struct {
	QuestionnaireID string
	SupplierName    string
	DueDate         string
}

// OverdueInbound returns sent inbound disclosures whose due date is before
// today (a local YYYY-MM-DD date), soonest first.
func (s *Store) OverdueInbound(ctx context.Context, today string) ([]OverdueDisclosure, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT q.id, c.name, q.due_date
		FROM questionnaire q JOIN counterparty c ON c.id = q.counterparty_id
		WHERE q.direction = 'inbound' AND q.status = 'sent'
		  AND q.due_date IS NOT NULL AND q.due_date < ?
		ORDER BY q.due_date, c.name`, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OverdueDisclosure
	for rows.Next() {
		var d OverdueDisclosure
		if err := rows.Scan(&d.QuestionnaireID, &d.SupplierName, &d.DueDate); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// InboundActivities lists the activity rows an ingested disclosure created.
func (s *Store) InboundActivities(ctx context.Context, questionnaireID string) ([]string, string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, emission_source_id FROM activity_data
		WHERE inbound_question_id IN (SELECT id FROM question WHERE questionnaire_id = ?)
		ORDER BY created_at, id`, questionnaireID)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	var ids []string
	sourceID := ""
	for rows.Next() {
		var id string
		if err := rows.Scan(&id, &sourceID); err != nil {
			return nil, "", err
		}
		ids = append(ids, id)
	}
	return ids, sourceID, rows.Err()
}

// Setting reads one app-level key/value row. A missing key is ("", false).
func (s *Store) Setting(ctx context.Context, key string) (string, bool, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM setting WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// SetSetting upserts one app-level key/value row.
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, now())
	return err
}

// DeleteSetting removes one app-level key/value row. A missing key is not an
// error.
func (s *Store) DeleteSetting(ctx context.Context, key string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM setting WHERE key = ?`, key)
	return err
}

// QuantityInference summarizes existing ledger quantities usable as the
// denominator for a Tier 1 per-unit footprint.
type QuantityInference struct {
	Unit           string
	MatchedAmount  float64
	MatchedRows    int
	CategoryAmount float64
	CategoryRows   int
}

// InferInboundQuantity sums non-inbound ledger quantities in the given year
// and GHG Protocol category that convert cleanly to targetUnit. Rows whose
// source name, notes, or extraction JSON mention supplierName go into
// MatchedAmount/MatchedRows; other convertible rows go into CategoryAmount.
func (s *Store) InferInboundQuantity(ctx context.Context, supplierName, ghgProtocolPath, targetUnit string, year int) (QuantityInference, error) {
	out := QuantityInference{Unit: strings.TrimSpace(targetUnit)}
	if out.Unit == "" || strings.TrimSpace(ghgProtocolPath) == "" || year == 0 {
		return out, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.amount, a.unit, es.name,
			coalesce(a.notes, ''), coalesce(ex.parsed_json, '')
		FROM activity_data a
		JOIN reporting_period rp ON rp.id = a.reporting_period_id
		JOIN emission_source es ON es.id = a.emission_source_id
		LEFT JOIN extraction ex ON ex.id = a.extraction_id
		WHERE rp.year = ?
		  AND a.inbound_question_id IS NULL
		  AND es.ghg_protocol_path = ?`, year, ghgProtocolPath)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	needle := strings.ToLower(strings.TrimSpace(supplierName))
	for rows.Next() {
		var amount float64
		var unit, sourceName, notes, parsedJSON string
		if err := rows.Scan(&amount, &unit, &sourceName, &notes, &parsedJSON); err != nil {
			return out, err
		}
		converted, err := convertUnit(ctx, s.db, amount, unit, out.Unit)
		if err != nil || !validFinite(converted) || converted <= 0 {
			continue
		}
		if needle != "" && (strings.Contains(strings.ToLower(sourceName), needle) ||
			strings.Contains(strings.ToLower(notes), needle) ||
			strings.Contains(strings.ToLower(parsedJSON), needle)) {
			out.MatchedAmount += converted
			out.MatchedRows++
		} else {
			out.CategoryAmount += converted
			out.CategoryRows++
		}
	}
	return out, rows.Err()
}

// QuestionByPosition reads one question by its template position.
func (s *Store) QuestionByPosition(ctx context.Context, questionnaireID, position string) (*Question, error) {
	row := s.db.QueryRowContext(ctx, questionSelect+` WHERE q.questionnaire_id = ? AND q.position = ?`,
		questionnaireID, position)
	q, err := scanQuestion(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &q, nil
}
