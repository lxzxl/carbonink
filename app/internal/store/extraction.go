package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Extraction statuses mirror the CHECK constraint in migration 003.
const (
	ExtractionPending      = "pending"
	ExtractionParsed       = "parsed"
	ExtractionReviewNeeded = "review_needed"
	ExtractionRejected     = "rejected"
)

// Extraction is one staged LLM result for a document. The cache key is
// (DocumentID, PromptVersion, LLMProvider, LLMModel); PromptVersion carries
// the stage id (for example "china_utility.v1").
type Extraction struct {
	ID               string
	DocumentID       string
	LLMProvider      string
	LLMModel         string
	PromptVersion    string
	RawResponse      string
	ParsedJSON       string
	ErrorJSON        string
	Status           string
	ReviewedByUserAt string
	CostUSD          *float64
	CreatedAt        string
}

// ExtractionKey names one cache entry.
type ExtractionKey struct {
	DocumentID    string
	PromptVersion string
	LLMProvider   string
	LLMModel      string
}

// ExtractionInput writes a completed model reply. Run always lands at
// review_needed; confirming promotes it to parsed.
type ExtractionInput struct {
	DocumentID    string
	LLMProvider   string
	LLMModel      string
	PromptVersion string
	RawResponse   string
	ParsedJSON    string
	CostUSD       *float64
}

// ExtractionDocumentStatus summarizes one document's extraction history.
type ExtractionDocumentStatus struct {
	DocumentID   string
	ActiveStatus string
	HasRejected  bool
}

const extractionSelect = `SELECT id, document_id, llm_provider, llm_model, prompt_version,
		coalesce(raw_response, ''), coalesce(parsed_json, ''), coalesce(error_json, ''),
		status, coalesce(reviewed_by_user_at, ''), cost_usd, created_at
	FROM extraction`

// InsertExtraction stores a review_needed row. A matching rejected row is
// removed first so a discard followed by a retry can reuse the same key.
func (s *Store) InsertExtraction(ctx context.Context, in ExtractionInput) (*Extraction, error) {
	key, err := cleanExtractionKey(ExtractionKey{
		DocumentID:    in.DocumentID,
		PromptVersion: in.PromptVersion,
		LLMProvider:   in.LLMProvider,
		LLMModel:      in.LLMModel,
	})
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.ParsedJSON) == "" {
		return nil, errors.New("extraction parsed json is required")
	}
	if err := validateJSONObject(in.ParsedJSON); err != nil {
		return nil, fmt.Errorf("extraction parsed json: %w", err)
	}
	raw := in.RawResponse
	if strings.TrimSpace(raw) == "" {
		raw = in.ParsedJSON
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM extraction
			WHERE document_id = ? AND prompt_version = ? AND llm_provider = ? AND llm_model = ?
			  AND status = 'rejected'`,
		key.DocumentID, key.PromptVersion, key.LLMProvider, key.LLMModel); err != nil {
		return nil, err
	}
	id := newID()
	ts := now()
	if _, err := tx.ExecContext(ctx, `INSERT INTO extraction
			(id, document_id, llm_provider, llm_model, prompt_version,
			 raw_response, parsed_json, error_json, status, created_at, cost_usd)
		VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'review_needed', ?, ?)`,
		id, key.DocumentID, key.LLMProvider, key.LLMModel, key.PromptVersion,
		raw, in.ParsedJSON, ts, in.CostUSD); err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, "extraction.created", ts, map[string]any{
		"extraction_id":  id,
		"document_id":    key.DocumentID,
		"prompt_version": key.PromptVersion,
		"llm_provider":   key.LLMProvider,
		"llm_model":      key.LLMModel,
		"status":         ExtractionReviewNeeded,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.ExtractionByID(ctx, id)
}

// ExtractionByID reads one row.
func (s *Store) ExtractionByID(ctx context.Context, id string) (*Extraction, error) {
	row := s.db.QueryRowContext(ctx, extractionSelect+` WHERE id = ?`, id)
	extraction, err := scanExtraction(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &extraction, nil
}

// FindExtraction returns the cached row for key, excluding rejected rows.
// Rejected rows are soft deletes: a retry with the same key must call the
// model again instead of returning the discarded snapshot.
func (s *Store) FindExtraction(ctx context.Context, key ExtractionKey) (*Extraction, error) {
	key, err := cleanExtractionKey(key)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRowContext(ctx, extractionSelect+`
		WHERE document_id = ? AND prompt_version = ? AND llm_provider = ? AND llm_model = ?
		  AND status != 'rejected'`,
		key.DocumentID, key.PromptVersion, key.LLMProvider, key.LLMModel)
	extraction, err := scanExtraction(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &extraction, nil
}

// ListExtractions returns one document's extractions, newest first.
func (s *Store) ListExtractions(ctx context.Context, documentID string) ([]Extraction, error) {
	rows, err := s.db.QueryContext(ctx, extractionSelect+`
		WHERE document_id = ? ORDER BY created_at DESC, id DESC`, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Extraction
	for rows.Next() {
		extraction, err := scanExtraction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, extraction)
	}
	return out, rows.Err()
}

// ListPendingExtractions returns rows waiting for review, oldest first.
func (s *Store) ListPendingExtractions(ctx context.Context, limit int) ([]Extraction, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, extractionSelect+`
		WHERE status = 'review_needed' ORDER BY created_at ASC, id ASC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Extraction
	for rows.Next() {
		extraction, err := scanExtraction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, extraction)
	}
	return out, rows.Err()
}

// ConfirmExtraction promotes a review_needed row to parsed.
func (s *Store) ConfirmExtraction(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ts := now()
	result, err := tx.ExecContext(ctx, `UPDATE extraction
		SET status = 'parsed', reviewed_by_user_at = ?
		WHERE id = ? AND status = 'review_needed'`, ts, id)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return fmt.Errorf("extraction not confirmable: %s (missing or not in review_needed)", id)
	}
	if err := writeAudit(ctx, tx, "extraction.confirmed", ts, map[string]any{
		"extraction_id": id,
		"status":        ExtractionParsed,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// DiscardExtraction rejects a review_needed row. Discarding an already
// rejected row is a no-op; parsed and pending rows are refused because they
// are not part of the review flow.
func (s *Store) DiscardExtraction(ctx context.Context, id string) error {
	existing, err := s.ExtractionByID(ctx, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return fmt.Errorf("extraction not discardable: %s (missing)", id)
	}
	if existing.Status == ExtractionRejected {
		return nil
	}
	if existing.Status != ExtractionReviewNeeded {
		return fmt.Errorf("extraction not discardable: %s (status=%s, expected review_needed)",
			id, existing.Status)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ts := now()
	if _, err := tx.ExecContext(ctx, `UPDATE extraction
		SET status = 'rejected', parsed_json = NULL, reviewed_by_user_at = ?
		WHERE id = ?`, ts, id); err != nil {
		return err
	}
	if err := writeAudit(ctx, tx, "extraction.discarded", ts, map[string]any{
		"extraction_id": id,
		"status":        ExtractionRejected,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// ExtractionStatusByDocument returns one row per document that has at least
// one extraction. ActiveStatus is the newest non-rejected status, or empty
// when every row is rejected.
func (s *Store) ExtractionStatusByDocument(ctx context.Context) ([]ExtractionDocumentStatus, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT
			e.document_id,
			coalesce((
				SELECT latest.status FROM extraction AS latest
				WHERE latest.document_id = e.document_id AND latest.status != 'rejected'
				ORDER BY latest.created_at DESC, latest.id DESC
				LIMIT 1
			), '') AS active_status,
			MAX(CASE WHEN e.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_flag
		FROM extraction AS e
		GROUP BY e.document_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExtractionDocumentStatus
	for rows.Next() {
		var item ExtractionDocumentStatus
		var rejected int
		if err := rows.Scan(&item.DocumentID, &item.ActiveStatus, &rejected); err != nil {
			return nil, err
		}
		item.HasRejected = rejected == 1
		out = append(out, item)
	}
	return out, rows.Err()
}

func cleanExtractionKey(key ExtractionKey) (ExtractionKey, error) {
	key.DocumentID = strings.TrimSpace(key.DocumentID)
	key.PromptVersion = strings.TrimSpace(key.PromptVersion)
	key.LLMProvider = strings.TrimSpace(key.LLMProvider)
	key.LLMModel = strings.TrimSpace(key.LLMModel)
	if key.DocumentID == "" {
		return key, errors.New("extraction document is required")
	}
	if key.PromptVersion == "" {
		return key, errors.New("extraction prompt version is required")
	}
	if key.LLMProvider == "" || key.LLMModel == "" {
		return key, errors.New("extraction provider and model are required")
	}
	return key, nil
}

func scanExtraction(row rowScanner) (Extraction, error) {
	var extraction Extraction
	err := row.Scan(&extraction.ID, &extraction.DocumentID, &extraction.LLMProvider,
		&extraction.LLMModel, &extraction.PromptVersion, &extraction.RawResponse,
		&extraction.ParsedJSON, &extraction.ErrorJSON, &extraction.Status,
		&extraction.ReviewedByUserAt, &extraction.CostUSD, &extraction.CreatedAt)
	return extraction, err
}

func validateJSONObject(raw string) error {
	var value map[string]any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return err
	}
	if value == nil {
		return errors.New("expected a JSON object")
	}
	return nil
}
