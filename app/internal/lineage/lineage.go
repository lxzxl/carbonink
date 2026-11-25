// Package lineage assembles the provenance chain behind one ledger row or
// questionnaire answer. All links already exist as foreign keys; this package
// walks them in one read so the drawer needs a single call.
package lineage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"app.carbonink.desktop/internal/store"
)

// Source kinds.
const (
	SourceDocument = "document"
	SourceInbound  = "inbound"
	SourceManual   = "manual"
)

// SourceNode is the origin of an activity row.
type SourceNode struct {
	Kind            string
	DocumentID      string
	Filename        string
	ExtractionID    string
	QuestionnaireID string
	SupplierName    string
	QuestionID      string
	Tier            int
}

// PinnedEF is the frozen factor an activity was calculated with.
type PinnedEF struct {
	FactorCode     string
	Year           int
	Source         string
	Geography      string
	DatasetVersion string
	InputUnit      string
	CO2eKgPerUnit  float64
	GWPBasis       string
	PinnedAt       string
}

// AnswerRef is one downstream questionnaire answer sourced from an activity.
type AnswerRef struct {
	AnswerID        string
	QuestionID      string
	QuestionnaireID string
	QuestionText    string
	Value           string
	FinalizedAt     string
}

// SnapshotRef is one frozen report snapshot containing the activity.
type SnapshotRef struct {
	SnapshotID string
	FrozenAt   string
	Revision   int
}

// ActivityLineage is the full chain for one activity_data row.
type ActivityLineage struct {
	Entity             string
	Activity           store.Activity
	Source             SourceNode
	PinnedEF           *PinnedEF
	EmissionSourceName string
	Answers            []AnswerRef
	Snapshots          []SnapshotRef
	Evidence           []store.EvidenceAttachment
}

// QuestionnaireRef locates an answer's questionnaire.
type QuestionnaireRef struct {
	ID            string
	Direction     string
	ReportingYear int
	CustomerName  string
}

// AnswerLineage is the chain for one answer, including one upstream activity
// hop when the answer was mapped from the inventory.
type AnswerLineage struct {
	Entity         string
	Answer         store.Answer
	QuestionText   string
	Questionnaire  QuestionnaireRef
	SourceActivity *ActivityLineage
	Evidence       []store.EvidenceAttachment
}

// Get walks the chain for an activity or an answer.
func Get(ctx context.Context, db *store.Store, entity, id string) (any, error) {
	switch entity {
	case "activity_data":
		return Activity(ctx, db, id)
	case "answer":
		return Answer(ctx, db, id)
	default:
		return nil, fmt.Errorf("lineage: unknown entity %q", entity)
	}
}

// Activity assembles one activity row's origin, factor and consumers.
func Activity(ctx context.Context, db *store.Store, id string) (*ActivityLineage, error) {
	activity, err := db.ActivityByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if activity == nil {
		return nil, fmt.Errorf("activity_data not found: %s", id)
	}
	out := &ActivityLineage{
		Entity: "activity_data", Activity: *activity,
		EmissionSourceName: activity.Source,
	}
	out.Source, err = sourceNode(ctx, db, *activity)
	if err != nil {
		return nil, err
	}
	out.PinnedEF, err = pinnedEF(ctx, db, *activity)
	if err != nil {
		return nil, err
	}
	out.Answers, err = answers(ctx, db, id)
	if err != nil {
		return nil, err
	}
	out.Snapshots, err = snapshots(ctx, db, id)
	if err != nil {
		return nil, err
	}
	out.Evidence, err = db.ListEvidence(ctx, store.EvidenceTarget{ActivityDataID: id})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Answer assembles one answer's question, questionnaire and upstream activity.
func Answer(ctx context.Context, db *store.Store, id string) (*AnswerLineage, error) {
	answer, err := db.AnswerByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if answer == nil {
		return nil, fmt.Errorf("answer not found: %s", id)
	}
	out := &AnswerLineage{Entity: "answer", Answer: *answer}
	var direction sql.NullString
	var customerName sql.NullString
	err = db.DB().QueryRowContext(ctx, `SELECT COALESCE(q.raw_text, q.normalized_text),
			qn.id, qn.direction, qn.reporting_year, c.name
		FROM question q
		JOIN questionnaire qn ON qn.id = q.questionnaire_id
		LEFT JOIN counterparty c ON c.id = qn.counterparty_id
		WHERE q.id = ?`, answer.QuestionID).
		Scan(&out.QuestionText, &out.Questionnaire.ID, &direction,
			&out.Questionnaire.ReportingYear, &customerName)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("question not found for answer: %s", id)
	}
	if err != nil {
		return nil, err
	}
	out.Questionnaire.Direction = direction.String
	out.Questionnaire.CustomerName = customerName.String
	if answer.SourceActivityDataID != "" {
		out.SourceActivity, err = Activity(ctx, db, answer.SourceActivityDataID)
		if err != nil {
			return nil, err
		}
	}
	out.Evidence, err = db.ListEvidence(ctx, store.EvidenceTarget{AnswerID: id})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func sourceNode(ctx context.Context, db *store.Store, activity store.Activity) (SourceNode, error) {
	if activity.ExtractionID != "" {
		var node SourceNode
		err := db.DB().QueryRowContext(ctx, `SELECT e.id, d.id, d.filename
			FROM extraction e
			JOIN document d ON d.id = e.document_id
			WHERE e.id = ?`, activity.ExtractionID).
			Scan(&node.ExtractionID, &node.DocumentID, &node.Filename)
		if err == nil {
			node.Kind = SourceDocument
			return node, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return SourceNode{}, err
		}
	}
	if activity.InboundQuestionID != "" {
		var node SourceNode
		var supplier sql.NullString
		err := db.DB().QueryRowContext(ctx, `SELECT q.id, q.questionnaire_id, c.name
			FROM question q
			JOIN questionnaire qn ON qn.id = q.questionnaire_id
			LEFT JOIN counterparty c ON c.id = qn.counterparty_id
			WHERE q.id = ?`, activity.InboundQuestionID).
			Scan(&node.QuestionID, &node.QuestionnaireID, &supplier)
		if err == nil {
			node.Kind = SourceInbound
			node.SupplierName = supplier.String
			node.Tier = activity.InboundTier
			return node, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return SourceNode{}, err
		}
	}
	return SourceNode{Kind: SourceManual}, nil
}

func pinnedEF(ctx context.Context, db *store.Store, activity store.Activity) (*PinnedEF, error) {
	var ef PinnedEF
	err := db.DB().QueryRowContext(ctx, `SELECT factor_code, year, source, geography,
			dataset_version, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at
		FROM pinned_emission_factor
		WHERE factor_code = ? AND year = ? AND source = ? AND geography = ?
		  AND dataset_version = ?`, activity.EFFactorCode, activity.EFYear,
		activity.EFSource, activity.EFGeography, activity.EFDatasetVersion).
		Scan(&ef.FactorCode, &ef.Year, &ef.Source, &ef.Geography, &ef.DatasetVersion,
			&ef.InputUnit, &ef.CO2eKgPerUnit, &ef.GWPBasis, &ef.PinnedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ef, nil
}

func answers(ctx context.Context, db *store.Store, activityID string) ([]AnswerRef, error) {
	rows, err := db.DB().QueryContext(ctx, `SELECT a.id, a.question_id, q.questionnaire_id,
			COALESCE(q.raw_text, q.normalized_text), a.value, COALESCE(a.finalized_at, '')
		FROM answer a
		JOIN question q ON q.id = a.question_id
		WHERE a.source_activity_data_id = ?
		ORDER BY a.id`, activityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AnswerRef
	for rows.Next() {
		var ref AnswerRef
		if err := rows.Scan(&ref.AnswerID, &ref.QuestionID, &ref.QuestionnaireID,
			&ref.QuestionText, &ref.Value, &ref.FinalizedAt); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

func snapshots(ctx context.Context, db *store.Store, activityID string) ([]SnapshotRef, error) {
	rows, err := db.DB().QueryContext(ctx, `SELECT DISTINCT csl.calculation_snapshot_id,
			cs.frozen_at, cs.revision
		FROM calculation_snapshot_line csl
		JOIN calculation_snapshot cs ON cs.id = csl.calculation_snapshot_id
		WHERE csl.original_activity_data_id = ?
		ORDER BY cs.frozen_at DESC`, activityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SnapshotRef
	for rows.Next() {
		var ref SnapshotRef
		if err := rows.Scan(&ref.SnapshotID, &ref.FrozenAt, &ref.Revision); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}
