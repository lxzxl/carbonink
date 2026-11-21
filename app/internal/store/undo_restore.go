package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// RestoreActivity re-inserts a captured activity row and its evidence links.
// It is the inverse of DeleteActivity: the pinned factor remains in place, so
// the original composite foreign key stays valid.
func (s *Store) RestoreActivity(ctx context.Context, a Activity, evidence []EvidenceAttachment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ts := now()
	var inboundTier any
	if a.InboundTier > 0 {
		inboundTier = a.InboundTier
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO activity_data (
			id, site_id, emission_source_id, reporting_period_id,
			occurred_at_start, occurred_at_end, amount, unit,
			ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
			computed_co2e_kg, computed_at, fuel_code, extraction_id, notes,
			created_at, updated_at, inbound_question_id, inbound_tier
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.SiteID, a.EmissionSourceID, a.ReportingPeriodID,
		a.OccurredAt, a.OccurredAtEnd, a.Amount, a.Unit,
		a.EFFactorCode, a.EFYear, a.EFSource, a.EFGeography, a.EFDatasetVersion,
		a.CO2eKg, a.ComputedAt, nullIfEmpty(a.FuelCode), nullIfEmpty(a.ExtractionID),
		nullIfEmpty(a.Notes), ts, ts, nullIfEmpty(a.InboundQuestionID), inboundTier); err != nil {
		return fmt.Errorf("restore activity: %w", err)
	}
	for _, item := range evidence {
		if _, err := tx.ExecContext(ctx, `INSERT INTO evidence_attachment
				(id, activity_data_id, answer_id, document_id, note, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`, item.ID, a.ID, nil, item.DocumentID,
			nullIfEmpty(item.Note), item.CreatedAt); err != nil {
			return fmt.Errorf("restore evidence %s: %w", item.ID, err)
		}
	}
	if err := writeAudit(ctx, tx, "activity_data.created", ts, map[string]any{
		"activity_id":         a.ID,
		"site_id":             a.SiteID,
		"emission_source_id":  a.EmissionSourceID,
		"reporting_period_id": a.ReportingPeriodID,
		"amount":              a.Amount,
		"unit":                a.Unit,
		"ef": auditEF(EmissionFactorKey{
			FactorCode: a.EFFactorCode, Year: a.EFYear, Source: a.EFSource,
			Geography: a.EFGeography, DatasetVersion: a.EFDatasetVersion,
		}),
		"computed_co2e_kg": a.CO2eKg,
		"provenance":       provenance(a.ExtractionID),
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteSource removes a source that has no activity rows. It is the inverse
// of RestoreSource for a freshly created source.
func (s *Store) DeleteSource(ctx context.Context, id string) error {
	return s.DeleteSources(ctx, []string{id})
}

// DeleteSources removes several sources in one transaction.
func (s *Store) DeleteSources(ctx context.Context, ids []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range ids {
		result, err := tx.ExecContext(ctx, `DELETE FROM emission_source WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if changed, err := result.RowsAffected(); err != nil {
			return err
		} else if changed == 0 {
			return fmt.Errorf("emission source not found: %s", id)
		}
	}
	return tx.Commit()
}

// RestoreSource re-inserts a captured source row.
func (s *Store) RestoreSource(ctx context.Context, src EmissionSource) error {
	return s.RestoreSources(ctx, []EmissionSource{src})
}

// RestoreSources re-inserts several captured source rows atomically.
func (s *Store) RestoreSources(ctx context.Context, rows []EmissionSource) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, src := range rows {
		if _, err := tx.ExecContext(ctx, `INSERT INTO emission_source
		(id, site_id, name, scope, category, ghg_protocol_path, default_ef_query,
		 template_origin, is_active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			src.ID, src.SiteID, src.Name, src.Scope, nullIfEmpty(src.Category),
			nullIfEmpty(src.GHGProtocolPath), nullIfEmpty(src.DefaultEFQuery),
			nullIfEmpty(src.TemplateOrigin), boolInt(src.IsActive)); err != nil {
			return fmt.Errorf("restore source %s: %w", src.ID, err)
		}
	}
	return tx.Commit()
}

// RestoreExtraction writes a captured extraction row back exactly. The unique
// cache key still applies, so restoring after a retry replaced the row fails
// instead of duplicating it.
func (s *Store) RestoreExtraction(ctx context.Context, x Extraction) error {
	var cost any
	if x.CostUSD != nil {
		cost = *x.CostUSD
	}
	result, err := s.db.ExecContext(ctx, `UPDATE extraction SET
			raw_response = ?, parsed_json = ?, error_json = ?, status = ?,
			reviewed_by_user_at = ?, cost_usd = ?, created_at = ?
		WHERE id = ?`,
		nullIfEmpty(x.RawResponse), nullIfEmpty(x.ParsedJSON), nullIfEmpty(x.ErrorJSON),
		x.Status, nullIfEmpty(x.ReviewedByUserAt), cost, x.CreatedAt, x.ID)
	if err != nil {
		return fmt.Errorf("restore extraction: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return fmt.Errorf("extraction not found: %s", x.ID)
	}
	return nil
}

// DeleteAnswer removes an answer and its evidence links. It is the inverse of
// creating an answer.
func (s *Store) DeleteAnswer(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM evidence_attachment WHERE answer_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM answer WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// RestoreAnswer writes a captured answer row back, updating it in place when
// it still exists so evidence links survive.
func (s *Store) RestoreAnswer(ctx context.Context, a Answer) error {
	return writeAnswer(ctx, s.db, a)
}

// RestoreAnswers writes several captured answers atomically.
func (s *Store) RestoreAnswers(ctx context.Context, answers []Answer) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, a := range answers {
		if err := writeAnswer(ctx, tx, a); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func writeAnswer(ctx context.Context, q queryer, a Answer) error {
	var summary any
	if strings.TrimSpace(a.SourceSummary) != "" {
		encoded, err := json.Marshal(a.SourceSummary)
		if err != nil {
			return err
		}
		summary = string(encoded)
	}
	var exists int
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM answer WHERE id = ?`, a.ID).
		Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		if _, err := q.ExecContext(ctx, `UPDATE answer SET
				question_id = ?, value = ?, unit = ?, source_kind = ?, source_summary = ?,
				finalized_at = ?, source_calculation_snapshot_id = ?,
				source_activity_data_id = ?, source_company_profile_key = ?,
				source_narrative_bank_id = ?
			WHERE id = ?`,
			a.QuestionID, a.Value, nullIfEmpty(a.Unit), a.SourceKind, summary,
			nullIfEmpty(a.FinalizedAt), nullIfEmpty(a.SourceCalculationID),
			nullIfEmpty(a.SourceActivityDataID), nullIfEmpty(a.SourceCompanyProfileID),
			nullIfEmpty(a.SourceNarrativeBankID), a.ID); err != nil {
			return fmt.Errorf("restore answer: %w", err)
		}
		return nil
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO answer
		(id, question_id, value, unit, source_kind, source_summary, finalized_at,
		 source_calculation_snapshot_id, source_activity_data_id,
		 source_company_profile_key, source_narrative_bank_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.QuestionID, a.Value, nullIfEmpty(a.Unit), a.SourceKind, summary,
		nullIfEmpty(a.FinalizedAt), nullIfEmpty(a.SourceCalculationID),
		nullIfEmpty(a.SourceActivityDataID), nullIfEmpty(a.SourceCompanyProfileID),
		nullIfEmpty(a.SourceNarrativeBankID)); err != nil {
		return fmt.Errorf("restore answer: %w", err)
	}
	return nil
}

// RestoreQuestionnaireStatus writes a captured questionnaire status.
func (s *Store) RestoreQuestionnaireStatus(ctx context.Context, id, status string) error {
	status = strings.TrimSpace(status)
	if status == "" {
		return fmt.Errorf("questionnaire status is required")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE questionnaire SET status = ? WHERE id = ?`, status, id)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return fmt.Errorf("questionnaire not found: %s", id)
	}
	return nil
}
