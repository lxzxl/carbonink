package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// EvidenceTarget names the record an attachment hangs off. Exactly one id
// must be set; the database CHECK enforces the same rule.
type EvidenceTarget struct {
	ActivityDataID string
	AnswerID       string
}

// EvidenceAttachment is one link row joined with its document metadata.
type EvidenceAttachment struct {
	ID             string
	ActivityDataID string
	AnswerID       string
	DocumentID     string
	Note           string
	CreatedAt      string
	Filename       string
	MIMEType       string
	SizeBytes      int64
	SHA256         string
}

const evidenceSelect = `SELECT ea.id, coalesce(ea.activity_data_id, ''),
		coalesce(ea.answer_id, ''), ea.document_id, coalesce(ea.note, ''), ea.created_at,
		d.filename, d.mime_type, d.size_bytes, d.sha256
	FROM evidence_attachment ea
	JOIN document d ON d.id = ea.document_id`

// AddEvidence uploads (or reuses by content hash) a document and links it to
// exactly one activity or answer. The audit payload carries ids and hashes
// only, never the note's text.
func (s *Store) AddEvidence(ctx context.Context, target EvidenceTarget,
	in DocumentInput, dataDir, note string) (*EvidenceAttachment, error) {
	if err := s.assertEvidenceTarget(ctx, target); err != nil {
		return nil, err
	}
	document, _, err := s.SaveDocument(ctx, in, dataDir)
	if err != nil {
		return nil, err
	}
	id := newID()
	activityID := strings.TrimSpace(target.ActivityDataID)
	answerID := strings.TrimSpace(target.AnswerID)
	if _, err := s.db.ExecContext(ctx, `INSERT INTO evidence_attachment
			(id, activity_data_id, answer_id, document_id, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`, id, nullIfEmpty(activityID), nullIfEmpty(answerID),
		document.ID, nullIfEmpty(note), now()); err != nil {
		return nil, fmt.Errorf("attach evidence: %w", err)
	}
	payload := map[string]any{
		"attachment_id": id, "document_id": document.ID, "sha256": document.SHA256,
		"mime_type": document.MIMEType, "size_bytes": document.SizeBytes,
	}
	if activityID != "" {
		payload["activity_id"] = activityID
	}
	if answerID != "" {
		payload["answer_id"] = answerID
	}
	if err := s.RecordAuditEvent(ctx, "evidence.attached", payload); err != nil {
		return nil, err
	}
	return s.EvidenceByID(ctx, id)
}

// ListEvidence returns a record's attachments newest first.
func (s *Store) ListEvidence(ctx context.Context, target EvidenceTarget) ([]EvidenceAttachment, error) {
	if err := assertExactlyOneTarget(target); err != nil {
		return nil, err
	}
	column, value := "activity_data_id", target.ActivityDataID
	if strings.TrimSpace(target.AnswerID) != "" {
		column, value = "answer_id", target.AnswerID
	}
	rows, err := s.db.QueryContext(ctx, evidenceSelect+`
		WHERE ea.`+column+` = ?
		ORDER BY ea.created_at DESC, ea.id DESC`, value)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EvidenceAttachment
	for rows.Next() {
		row, err := scanEvidence(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// EvidenceByID reads one attachment.
func (s *Store) EvidenceByID(ctx context.Context, id string) (*EvidenceAttachment, error) {
	row, err := scanEvidence(s.db.QueryRowContext(ctx, evidenceSelect+` WHERE ea.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// RemoveEvidence deletes the link row and audits it, keeping the document and
// its bytes. Removing an already-gone attachment is a no-op.
func (s *Store) RemoveEvidence(ctx context.Context, id string) error {
	existing, err := s.EvidenceByID(ctx, id)
	if err != nil || existing == nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM evidence_attachment WHERE id = ?`, id); err != nil {
		return err
	}
	payload := map[string]any{
		"attachment_id": id, "document_id": existing.DocumentID, "sha256": existing.SHA256,
	}
	if existing.ActivityDataID != "" {
		payload["activity_id"] = existing.ActivityDataID
	}
	if existing.AnswerID != "" {
		payload["answer_id"] = existing.AnswerID
	}
	return s.RecordAuditEvent(ctx, "evidence.removed", payload)
}

func (s *Store) assertEvidenceTarget(ctx context.Context, target EvidenceTarget) error {
	if err := assertExactlyOneTarget(target); err != nil {
		return err
	}
	if target.ActivityDataID != "" {
		var hit int
		if err := s.db.QueryRowContext(ctx,
			`SELECT count(*) FROM activity_data WHERE id = ?`, target.ActivityDataID).Scan(&hit); err != nil {
			return err
		}
		if hit == 0 {
			return fmt.Errorf("activity_data not found: %s", target.ActivityDataID)
		}
		return nil
	}
	var hit int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM answer WHERE id = ?`, target.AnswerID).Scan(&hit); err != nil {
		return err
	}
	if hit == 0 {
		return fmt.Errorf("answer not found: %s", target.AnswerID)
	}
	return nil
}

func assertExactlyOneTarget(target EvidenceTarget) error {
	activity := strings.TrimSpace(target.ActivityDataID) != ""
	answer := strings.TrimSpace(target.AnswerID) != ""
	if activity == answer {
		return errors.New("exactly one of activity_data_id or answer_id is required")
	}
	return nil
}

func scanEvidence(row rowScanner) (EvidenceAttachment, error) {
	var out EvidenceAttachment
	err := row.Scan(&out.ID, &out.ActivityDataID, &out.AnswerID, &out.DocumentID,
		&out.Note, &out.CreatedAt, &out.Filename, &out.MIMEType, &out.SizeBytes, &out.SHA256)
	return out, err
}
