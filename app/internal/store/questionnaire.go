package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Questionnaire lifecycle states. The 1.x schema also carries the inbound
// supplier-disclosure states; they are accepted but not produced here yet.
const (
	QuestionnaireParsing   = "parsing"
	QuestionnaireMapping   = "mapping"
	QuestionnaireAnswering = "answering"
	QuestionnaireFinalized = "finalized"
	QuestionnaireExported  = "exported"
)

// SignatureVersion is the question-normalization contract. Bumping it
// invalidates reuse matches across questionnaires.
const SignatureVersion = "v1"

// Counterparty is an external organization (customer, supplier, or both).
type Counterparty struct {
	ID    string
	Name  string
	Notes string
	Role  string
	Email string
}

// Customer aliases Counterparty for callers scoped to the customer role.
type Customer = Counterparty

// Questionnaire is one customer workbook, outbound (customer-facing) or
// inbound (supplier disclosure).
type Questionnaire struct {
	ID            string
	CustomerID    string
	CustomerName  string
	DocumentID    string
	TemplateKind  string
	ReportingYear int
	Status        string
	Direction     string
	DueDate       string
	CreatedAt     string
	QuestionCount int
	AnsweredCount int
}

// Question is one row of a questionnaire plus its answer, when one exists.
type Question struct {
	ID                string
	QuestionnaireID   string
	QuestionSignature string
	SignatureVersion  string
	NormalizedText    string
	RawText           string
	ParsedIntent      string
	QuestionKind      string
	ExpectedUnit      string
	Position          string
	Required          bool
	Tier              int

	AnswerID                string
	AnswerValue             string
	AnswerUnit              string
	AnswerSourceKind        string
	AnswerSourceSummary     string
	AnswerFinalizedAt       string
	AnswerSourceSnapshotID  string
	AnswerSourceActivityID  string
	AnswerSourceProfileKey  string
	AnswerSourceNarrativeID string
	AnswerAgentTrace        string
}

// Answered reports whether the question has an answer row.
func (q Question) Answered() bool { return q.AnswerID != "" }

// Answer is one question's answer row.
type Answer struct {
	ID                     string
	QuestionID             string
	Value                  string
	Unit                   string
	SourceKind             string
	SourceSummary          string
	FinalizedAt            string
	SourceCalculationID    string
	SourceActivityDataID   string
	SourceCompanyProfileID string
	SourceNarrativeBankID  string
	AgentTrace             string
}

// QuestionInput is one question staged for a questionnaire import.
type QuestionInput struct {
	RawText        string
	NormalizedText string
	QuestionKind   string
	ExpectedUnit   string
	Position       string
	Required       bool
	Tier           int
}

// QuestionnaireInput creates a questionnaire, its customer when needed, its
// questions, and any reused answers in one transaction.
type QuestionnaireInput struct {
	// CustomerID wins when set. Otherwise CustomerName is get-or-created in
	// the conversation's customer role.
	CustomerID   string
	CustomerName string

	DocumentID    string
	TemplateKind  string
	ReportingYear int
	Status        string
	Direction     string
	DueDate       string
	Questions     []QuestionInput
}

// SaveAnswerInput upserts one answer. Finalize stamps finalized_at; an
// already-finalized answer keeps its stamp unless Finalize is set.
type SaveAnswerInput struct {
	QuestionID    string
	Value         string
	Unit          string
	SourceKind    string
	SourceSummary string
	AgentTrace    string
	Finalize      bool
}

// QuestionSignature is the v1 reuse key: the hex SHA-256 of the normalized
// question text.
func QuestionSignature(normalized string) string {
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

// CreateOrGetCustomer finds a customer-role row by exact name or creates one.
func (s *Store) CreateOrGetCustomer(ctx context.Context, name string) (*Customer, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("customer name is required")
	}
	return getOrCreateCustomer(ctx, s.db, name)
}

func getOrCreateCustomer(ctx context.Context, q queryer, name string) (*Customer, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("customer name is required")
	}
	row := q.QueryRowContext(ctx, `SELECT id, name, coalesce(notes, ''), role, coalesce(email, '')
		FROM counterparty WHERE name = ? AND role IN ('customer', 'both') LIMIT 1`, name)
	var c Customer
	err := row.Scan(&c.ID, &c.Name, &c.Notes, &c.Role, &c.Email)
	if err == nil {
		return &c, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	c = Customer{ID: newID(), Name: name, Role: "customer"}
	if _, err := q.ExecContext(ctx, `INSERT INTO counterparty (id, name, notes, role)
		VALUES (?, ?, NULL, 'customer')`, c.ID, c.Name); err != nil {
		return nil, err
	}
	return &c, nil
}

// ListCustomers returns customer-role rows (including role='both') ordered by name.
func (s *Store) ListCustomers(ctx context.Context) ([]Customer, error) {
	return listCustomersByRole(ctx, s.db, "customer")
}

// ListSuppliers returns supplier-role rows (including role='both') ordered by name.
func (s *Store) ListSuppliers(ctx context.Context) ([]Customer, error) {
	return listCustomersByRole(ctx, s.db, "supplier")
}

// ListCounterparties returns counterparties optionally filtered by role
// ('customer', 'supplier', 'both', or "" for all).
func (s *Store) ListCounterparties(ctx context.Context, role string) ([]Counterparty, error) {
	if role == "" {
		rows, err := s.db.QueryContext(ctx, `SELECT id, name, coalesce(notes, ''), role, coalesce(email, '')
			FROM counterparty ORDER BY name, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Counterparty
		for rows.Next() {
			var c Counterparty
			if err := rows.Scan(&c.ID, &c.Name, &c.Notes, &c.Role, &c.Email); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	}
	return listCustomersByRole(ctx, s.db, role)
}

func listCustomersByRole(ctx context.Context, q queryer, role string) ([]Customer, error) {
	var rows *sql.Rows
	var err error
	if role == "both" {
		rows, err = q.QueryContext(ctx, `SELECT id, name, coalesce(notes, ''), role, coalesce(email, '')
			FROM counterparty WHERE role = 'both' ORDER BY name, id`)
	} else {
		rows, err = q.QueryContext(ctx, `SELECT id, name, coalesce(notes, ''), role, coalesce(email, '')
			FROM counterparty WHERE role IN (?, 'both') ORDER BY name, id`, role)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Customer
	for rows.Next() {
		var c Customer
		if err := rows.Scan(&c.ID, &c.Name, &c.Notes, &c.Role, &c.Email); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CounterpartyByID reads one counterparty regardless of role.
func (s *Store) CounterpartyByID(ctx context.Context, id string) (*Counterparty, error) {
	var c Counterparty
	err := s.db.QueryRowContext(ctx, `SELECT id, name, coalesce(notes, ''), role, coalesce(email, '')
		FROM counterparty WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.Notes, &c.Role, &c.Email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// CustomerByID reads one customer-role (or both-role) row.
func (s *Store) CustomerByID(ctx context.Context, id string) (*Customer, error) {
	return customerByRole(ctx, s.db, id, "customer")
}

// SupplierByID reads one supplier-role (or both-role) row.
func (s *Store) SupplierByID(ctx context.Context, id string) (*Customer, error) {
	return customerByRole(ctx, s.db, id, "supplier")
}

func customerByRole(ctx context.Context, q queryer, id, role string) (*Customer, error) {
	var c Customer
	var err error
	if role == "both" {
		err = q.QueryRowContext(ctx, `SELECT id, name, coalesce(notes, ''), role, coalesce(email, '')
			FROM counterparty WHERE id = ? AND role = 'both'`, id).
			Scan(&c.ID, &c.Name, &c.Notes, &c.Role, &c.Email)
	} else {
		err = q.QueryRowContext(ctx, `SELECT id, name, coalesce(notes, ''), role, coalesce(email, '')
			FROM counterparty WHERE id = ? AND role IN (?, 'both')`, id, role).
			Scan(&c.ID, &c.Name, &c.Notes, &c.Role, &c.Email)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// CreateSupplier inserts a supplier row. Duplicate names are allowed: two
// legal entities may share a colloquial name.
func (s *Store) CreateSupplier(ctx context.Context, name, notes, email string) (*Customer, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("supplier name is required")
	}
	c := Customer{ID: newID(), Name: name, Notes: notes, Role: "supplier", Email: normalizeEmail(email)}
	var notesArg, emailArg any
	if strings.TrimSpace(c.Notes) != "" {
		notesArg = c.Notes
	}
	if c.Email != "" {
		emailArg = c.Email
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO counterparty (id, name, notes, role, email)
		VALUES (?, ?, ?, 'supplier', ?)`, c.ID, c.Name, notesArg, emailArg); err != nil {
		return nil, err
	}
	return &c, nil
}

// SetCounterpartyRole updates a counterparty's role ('customer', 'supplier', 'both').
func (s *Store) SetCounterpartyRole(ctx context.Context, id, role string) (*Counterparty, error) {
	switch role {
	case "customer", "supplier", "both":
	default:
		return nil, fmt.Errorf("invalid counterparty role %q", role)
	}
	res, err := s.db.ExecContext(ctx, `UPDATE counterparty SET role = ? WHERE id = ?`, role, id)
	if err != nil {
		return nil, err
	}
	if changed, err := res.RowsAffected(); err == nil && changed == 0 {
		return nil, nil
	}
	return s.CounterpartyByID(ctx, id)
}

// SetSupplierEmail sets or clears a supplier's email. A customer-only id is a
// miss, returned as (nil, nil).
func (s *Store) SetSupplierEmail(ctx context.Context, id, email string) (*Customer, error) {
	normalized := normalizeEmail(email)
	var arg any
	if normalized != "" {
		arg = normalized
	}
	res, err := s.db.ExecContext(ctx, `UPDATE counterparty SET email = ? WHERE id = ? AND role IN ('supplier', 'both')`,
		arg, id)
	if err != nil {
		return nil, err
	}
	if changed, err := res.RowsAffected(); err == nil && changed == 0 {
		return nil, nil
	}
	return s.SupplierByID(ctx, id)
}

func normalizeEmail(email string) string {
	return strings.TrimSpace(email)
}

// CreateQuestionnaire inserts the questionnaire, its questions, and any
// answers reused from the same customer's finalized history. It returns the
// number of questions and the number pre-filled from prior questionnaires.
func (s *Store) CreateQuestionnaire(ctx context.Context, in QuestionnaireInput) (string, int, error) {
	if in.ReportingYear < 2020 || in.ReportingYear > 2030 {
		return "", 0, errors.New("reporting year must be between 2020 and 2030")
	}
	if in.DocumentID == "" {
		return "", 0, errors.New("questionnaire document is required")
	}
	direction := in.Direction
	if direction == "" {
		direction = "outbound"
	}
	if direction != "outbound" && direction != "inbound" {
		return "", 0, fmt.Errorf("questionnaire direction %q is not supported", direction)
	}
	status := in.Status
	if status == "" {
		status = QuestionnaireMapping
	}
	for i, q := range in.Questions {
		if strings.TrimSpace(q.NormalizedText) == "" {
			return "", 0, fmt.Errorf("question %d has no normalized text", i+1)
		}
		switch q.QuestionKind {
		case "numerical", "categorical", "narrative":
		default:
			return "", 0, fmt.Errorf("question %d has kind %q", i+1, q.QuestionKind)
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", 0, err
	}
	defer tx.Rollback()

	customerID := in.CustomerID
	if customerID != "" {
		c, err := customerByRole(ctx, tx, customerID, "customer")
		if err != nil {
			return "", 0, err
		}
		if c == nil {
			return "", 0, fmt.Errorf("customer not found: %s", customerID)
		}
	} else {
		c, err := getOrCreateCustomer(ctx, tx, strings.TrimSpace(in.CustomerName))
		if err != nil {
			return "", 0, err
		}
		customerID = c.ID
	}

	id := newID()
	if _, err := tx.ExecContext(ctx, `INSERT INTO questionnaire
		(id, counterparty_id, document_id, template_kind, reporting_year, status, direction, due_date, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, customerID, in.DocumentID, nullIfEmpty(in.TemplateKind), in.ReportingYear, status,
		direction, nullIfEmpty(in.DueDate), now()); err != nil {
		return "", 0, err
	}

	usedPositions := map[string]bool{}
	inserted := make([]struct{ id, signature string }, 0, len(in.Questions))
	for _, q := range in.Questions {
		position := strings.TrimSpace(q.Position)
		if position != "" && usedPositions[position] {
			// The schema keeps positions unique per questionnaire. A model
			// that points two questions at one cell still yields both rows;
			// the second loses its cell binding rather than failing the import.
			position = ""
		}
		usedPositions[position] = true
		signature := QuestionSignature(q.NormalizedText)
		qid := newID()
		rawText := q.RawText
		if strings.TrimSpace(rawText) == "" {
			rawText = q.NormalizedText
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO question
			(id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text,
			 parsed_intent, question_kind, expected_unit, position, required, tier)
			VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
			qid, id, signature, SignatureVersion, q.NormalizedText, rawText,
			q.QuestionKind, nullIfEmpty(q.ExpectedUnit), nullIfEmpty(position), boolInt(q.Required),
			nullIfZero(q.Tier)); err != nil {
			return "", 0, err
		}
		inserted = append(inserted, struct{ id, signature string }{qid, signature})
	}

	reusedCount := 0
	for _, item := range inserted {
		var value, unit, summary string
		err := tx.QueryRowContext(ctx, `SELECT a.value, coalesce(a.unit, ''), coalesce(a.source_summary, '')
			FROM answer a
			JOIN question pq ON pq.id = a.question_id
			JOIN questionnaire pqn ON pqn.id = pq.questionnaire_id
			WHERE pqn.counterparty_id = ?
			  AND pq.question_signature = ?
			  AND pqn.id != ?
			  AND a.finalized_at IS NOT NULL
			ORDER BY pqn.created_at DESC, pqn.id DESC
			LIMIT 1`, customerID, item.signature, id).Scan(&value, &unit, &summary)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return "", 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO answer
			(id, question_id, value, unit, source_kind, source_summary, finalized_at)
			VALUES (?, ?, ?, ?, 'reused', ?, NULL)`,
			newID(), item.id, value, nullIfEmpty(unit), validJSONOrEmpty(summary)); err != nil {
			return "", 0, err
		}
		reusedCount++
	}

	if err := tx.Commit(); err != nil {
		return "", 0, err
	}
	return id, reusedCount, nil
}

// ListQuestionnaires returns every questionnaire newest first, including the
// inbound rows. Callers that want one direction filter the result.
func (s *Store) ListQuestionnaires(ctx context.Context) ([]Questionnaire, error) {
	rows, err := s.db.QueryContext(ctx, questionnaireSelect+
		` ORDER BY q.created_at DESC, q.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Questionnaire
	for rows.Next() {
		q, err := scanQuestionnaire(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// QuestionnaireByID reads one questionnaire with its customer name and counts.
func (s *Store) QuestionnaireByID(ctx context.Context, id string) (*Questionnaire, error) {
	row := s.db.QueryRowContext(ctx, questionnaireSelect+` WHERE q.id = ?`, id)
	q, err := scanQuestionnaire(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &q, nil
}

const questionnaireSelect = `SELECT q.id, q.counterparty_id, c.name, coalesce(q.document_id, ''),
		coalesce(q.template_kind, ''), q.reporting_year, q.status, q.direction,
		coalesce(q.due_date, ''), q.created_at,
		(SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id),
		(SELECT COUNT(*) FROM answer a JOIN question qu ON qu.id = a.question_id
			WHERE qu.questionnaire_id = q.id)
	FROM questionnaire q
	JOIN counterparty c ON c.id = q.counterparty_id`

func scanQuestionnaire(row rowScanner) (Questionnaire, error) {
	var q Questionnaire
	err := row.Scan(&q.ID, &q.CustomerID, &q.CustomerName, &q.DocumentID, &q.TemplateKind,
		&q.ReportingYear, &q.Status, &q.Direction, &q.DueDate, &q.CreatedAt,
		&q.QuestionCount, &q.AnsweredCount)
	return q, err
}

const questionSelect = `SELECT q.id, q.questionnaire_id, q.question_signature,
			q.signature_version, coalesce(q.normalized_text, ''), coalesce(q.raw_text, ''),
			coalesce(q.parsed_intent, ''), q.question_kind, coalesce(q.expected_unit, ''),
			coalesce(q.position, ''), q.required, coalesce(q.tier, 0),
			coalesce(a.id, ''), coalesce(a.value, ''), coalesce(a.unit, ''),
			coalesce(a.source_kind, ''), coalesce(a.source_summary, ''),
			coalesce(a.finalized_at, ''),
			coalesce(a.source_calculation_snapshot_id, ''),
			coalesce(a.source_activity_data_id, ''),
			coalesce(a.source_company_profile_key, ''),
			coalesce(a.source_narrative_bank_id, ''),
			coalesce(a.agent_trace, '')
		FROM question q
		LEFT JOIN answer a ON a.question_id = q.id`

// QuestionByID reads one question with its answer, when present.
func (s *Store) QuestionByID(ctx context.Context, id string) (*Question, error) {
	row := s.db.QueryRowContext(ctx, questionSelect+` WHERE q.id = ?`, id)
	q, err := scanQuestion(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &q, nil
}

// ListQuestions returns a questionnaire's questions in canonical order with
// their answers folded in.
func (s *Store) ListQuestions(ctx context.Context, questionnaireID string) ([]Question, error) {
	rows, err := s.db.QueryContext(ctx, questionSelect+`
		WHERE q.questionnaire_id = ?
		ORDER BY q.position, q.id`, questionnaireID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Question
	for rows.Next() {
		q, err := scanQuestion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

func scanQuestion(row rowScanner) (Question, error) {
	var q Question
	var required int
	err := row.Scan(&q.ID, &q.QuestionnaireID, &q.QuestionSignature, &q.SignatureVersion,
		&q.NormalizedText, &q.RawText, &q.ParsedIntent, &q.QuestionKind, &q.ExpectedUnit,
		&q.Position, &required, &q.Tier,
		&q.AnswerID, &q.AnswerValue, &q.AnswerUnit, &q.AnswerSourceKind,
		&q.AnswerSourceSummary, &q.AnswerFinalizedAt,
		&q.AnswerSourceSnapshotID, &q.AnswerSourceActivityID, &q.AnswerSourceProfileKey,
		&q.AnswerSourceNarrativeID, &q.AnswerAgentTrace)
	q.Required = required != 0
	q.AnswerSourceSummary = decodeSummary(q.AnswerSourceSummary)
	return q, err
}

// FinalizeQuestionnaire stamps every draft answer and moves the status to
// finalized, never regressing an exported questionnaire. It is idempotent.
func (s *Store) FinalizeQuestionnaire(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stamp := now()
	if _, err := tx.ExecContext(ctx, `UPDATE answer SET finalized_at = ?
		WHERE finalized_at IS NULL
		  AND question_id IN (SELECT id FROM question WHERE questionnaire_id = ?)`, stamp, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE questionnaire SET status = ?
		WHERE id = ? AND status NOT IN ('exported', 'ingested')`, QuestionnaireFinalized, id)
	if err != nil {
		return err
	}
	if changed, err := res.RowsAffected(); err == nil && changed == 0 {
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM questionnaire WHERE id = ?`, id).
			Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return fmt.Errorf("questionnaire not found: %s", id)
		}
	}
	return tx.Commit()
}

// MarkQuestionnaireExported moves a questionnaire to exported.
func (s *Store) MarkQuestionnaireExported(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE questionnaire SET status = ? WHERE id = ?`,
		QuestionnaireExported, id)
	return err
}

// AnswerByQuestion reads one question's answer, or nil.
func (s *Store) AnswerByQuestion(ctx context.Context, questionID string) (*Answer, error) {
	row := s.db.QueryRowContext(ctx, answerSelect+` WHERE a.question_id = ?`, questionID)
	a, err := scanAnswer(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// AnswerByID reads one answer by its own id.
func (s *Store) AnswerByID(ctx context.Context, id string) (*Answer, error) {
	row := s.db.QueryRowContext(ctx, answerSelect+` WHERE a.id = ?`, id)
	a, err := scanAnswer(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ListAnswers returns every answer of a questionnaire in question order.
func (s *Store) ListAnswers(ctx context.Context, questionnaireID string) ([]Answer, error) {
	rows, err := s.db.QueryContext(ctx, answerSelect+`
		JOIN question q ON q.id = a.question_id
		WHERE q.questionnaire_id = ?
		ORDER BY q.position, q.id`, questionnaireID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Answer
	for rows.Next() {
		a, err := scanAnswer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

const answerSelect = `SELECT a.id, a.question_id, a.value, coalesce(a.unit, ''),
		a.source_kind, coalesce(a.source_summary, ''), coalesce(a.finalized_at, ''),
		coalesce(a.source_calculation_snapshot_id, ''), coalesce(a.source_activity_data_id, ''),
		coalesce(a.source_company_profile_key, ''), coalesce(a.source_narrative_bank_id, ''),
		coalesce(a.agent_trace, '')
	FROM answer a`

func scanAnswer(row rowScanner) (Answer, error) {
	var a Answer
	err := row.Scan(&a.ID, &a.QuestionID, &a.Value, &a.Unit, &a.SourceKind, &a.SourceSummary,
		&a.FinalizedAt, &a.SourceCalculationID, &a.SourceActivityDataID,
		&a.SourceCompanyProfileID, &a.SourceNarrativeBankID, &a.AgentTrace)
	a.SourceSummary = decodeSummary(a.SourceSummary)
	return a, err
}

// SaveAnswer inserts or updates one manual / AI-suggested answer.
func (s *Store) SaveAnswer(ctx context.Context, in SaveAnswerInput) (*Answer, error) {
	questionID := strings.TrimSpace(in.QuestionID)
	if questionID == "" {
		return nil, errors.New("question id is required")
	}
	sourceKind := in.SourceKind
	if sourceKind == "" {
		sourceKind = "manual"
	}
	if sourceKind != "manual" && sourceKind != "ai_suggested" {
		return nil, fmt.Errorf("answer source kind %q is not editable", sourceKind)
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM question WHERE id = ?`, questionID).
		Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, fmt.Errorf("question not found: %s", questionID)
	}
	existing, err := s.AnswerByQuestion(ctx, questionID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		var finalized any
		if in.Finalize {
			finalized = now()
		}
		summary := any(nil)
		if strings.TrimSpace(in.SourceSummary) != "" {
			encoded, err := json.Marshal(in.SourceSummary)
			if err != nil {
				return nil, err
			}
			summary = string(encoded)
		}
		trace := validJSONOrEmpty(in.AgentTrace)
		if _, err := s.db.ExecContext(ctx, `INSERT INTO answer
			(id, question_id, value, unit, source_kind, source_summary, agent_trace, finalized_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			newID(), questionID, in.Value, nullIfEmpty(in.Unit), sourceKind, summary,
			trace, finalized); err != nil {
			return nil, err
		}
	} else {
		finalized := any(nil)
		switch {
		case in.Finalize:
			finalized = now()
		case existing.FinalizedAt != "":
			finalized = existing.FinalizedAt
		}
		trace := validJSONOrEmpty(in.AgentTrace)
		if trace == nil && existing.AgentTrace != "" {
			trace = validJSONOrEmpty(existing.AgentTrace)
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE answer
			SET value = ?, unit = ?, source_kind = ?, agent_trace = ?, finalized_at = ?
			WHERE question_id = ?`,
			in.Value, nullIfEmpty(in.Unit), sourceKind, trace, finalized, questionID); err != nil {
			return nil, err
		}
	}
	return s.AnswerByQuestion(ctx, questionID)
}

// UnfinalizeAnswer clears an answer's finalization stamp.
func (s *Store) UnfinalizeAnswer(ctx context.Context, questionID string) (*Answer, error) {
	if _, err := s.db.ExecContext(ctx, `UPDATE answer SET finalized_at = NULL WHERE question_id = ?`,
		questionID); err != nil {
		return nil, err
	}
	a, err := s.AnswerByQuestion(ctx, questionID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fmt.Errorf("answer not found: %s", questionID)
	}
	return a, nil
}

// QuestionDirection reports the direction of the questionnaire that owns the
// question, or ("", false) when the question does not exist.
func (s *Store) QuestionDirection(ctx context.Context, questionID string) (string, bool, error) {
	var direction string
	err := s.db.QueryRowContext(ctx, `SELECT q.direction FROM questionnaire q
		JOIN question qu ON qu.questionnaire_id = q.id WHERE qu.id = ?`, questionID).Scan(&direction)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return direction, true, nil
}

func nullIfZero(v int) any {
	if v == 0 {
		return nil
	}
	return v
}

// validJSONOrEmpty keeps source_summary within its CHECK constraint.
func validJSONOrEmpty(s string) any {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	if jsonValid(trimmed) {
		return trimmed
	}
	return nil
}

func jsonValid(s string) bool {
	var v any
	return json.Unmarshal([]byte(s), &v) == nil
}

// decodeSummary unwraps the JSON string the answer table stores. Rows written
// by other tools may carry a JSON object; those stay as-is.
func decodeSummary(s string) string {
	if s == "" {
		return ""
	}
	var text string
	if err := json.Unmarshal([]byte(s), &text); err == nil {
		return text
	}
	return s
}
