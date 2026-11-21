package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	gwpCH4 = 27.9
	gwpN2O = 273.0
)

// ActivityInput creates one ledger row. The store validates the source,
// pins the factor, converts units, computes CO2e, and writes the audit event
// in one transaction.
type ActivityInput struct {
	EmissionSourceID   string
	ReportingPeriodID  string
	OccurredAtStart    string
	OccurredAtEnd      string
	Amount             float64
	Unit               string
	EF                 EmissionFactorKey
	FuelCode           string
	Notes              string
	ExtractionID       string
	EvidenceDocumentID string
}

// AuditEvent is one append-only audit row.
type AuditEvent struct {
	ID         string
	Kind       string
	Payload    string
	OccurredAt string
}

const activitySelect = `SELECT a.id, a.site_id,
		coalesce(nullif(site.name_zh, ''), nullif(site.name_en, ''), ''),
		a.emission_source_id, es.name, a.reporting_period_id,
		a.occurred_at_start, a.occurred_at_end, a.amount, a.unit,
		a.ef_factor_code, a.ef_year, a.ef_source, a.ef_geography, a.ef_dataset_version,
		a.computed_co2e_kg, a.computed_at, coalesce(a.fuel_code, ''), coalesce(a.notes, ''), es.scope,
		coalesce(a.extraction_id, '')
	FROM activity_data a
	JOIN site ON site.id = a.site_id
	JOIN emission_source es ON es.id = a.emission_source_id`

// CreateActivity writes a validated ledger row and its audit event.
func (s *Store) CreateActivity(ctx context.Context, in ActivityInput) (*Activity, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	id, err := insertActivity(ctx, tx, in)
	if err != nil {
		return nil, err
	}
	created, err := activityByID(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

// insertActivity validates, pins, computes, inserts, and audits one row in the
// caller's transaction.
func insertActivity(ctx context.Context, q queryer, in ActivityInput) (string, error) {
	sourceID := strings.TrimSpace(in.EmissionSourceID)
	periodID := strings.TrimSpace(in.ReportingPeriodID)
	unit := strings.TrimSpace(in.Unit)
	startText := strings.TrimSpace(in.OccurredAtStart)
	endText := strings.TrimSpace(in.OccurredAtEnd)
	fuelCode := strings.TrimSpace(in.FuelCode)
	notes := strings.TrimSpace(in.Notes)
	extractionID := strings.TrimSpace(in.ExtractionID)
	evidenceID := strings.TrimSpace(in.EvidenceDocumentID)

	if sourceID == "" {
		return "", errors.New("emission source is required")
	}
	if periodID == "" {
		return "", errors.New("reporting period is required")
	}
	if !validFinite(in.Amount) || in.Amount <= 0 {
		return "", errors.New("amount must be a positive number")
	}
	if unit == "" {
		return "", errors.New("unit is required")
	}
	if len([]rune(unit)) > 50 {
		return "", errors.New("unit is too long")
	}
	if len([]rune(fuelCode)) > 100 || len([]rune(extractionID)) > 100 || len([]rune(evidenceID)) > 100 {
		return "", errors.New("reference is too long")
	}
	if len([]rune(notes)) > 2000 {
		return "", errors.New("notes are too long")
	}
	start, err := parseActivityTime(startText)
	if err != nil {
		return "", fmt.Errorf("start date: %w", err)
	}
	end, err := parseActivityTime(endText)
	if err != nil {
		return "", fmt.Errorf("end date: %w", err)
	}
	if end.Before(start) {
		return "", errors.New("end date cannot be before start date")
	}
	if err := validateEFKey(in.EF); err != nil {
		return "", err
	}

	var siteID string
	var active int
	err = q.QueryRowContext(ctx, `SELECT site_id, is_active FROM emission_source WHERE id = ?`, sourceID).
		Scan(&siteID, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("emission source not found: %s", sourceID)
	}
	if err != nil {
		return "", err
	}
	if active != 1 {
		return "", fmt.Errorf("emission source is inactive: %s", sourceID)
	}
	var periodExists int
	if err := q.QueryRowContext(ctx, `SELECT count(*) FROM reporting_period WHERE id = ?`, periodID).
		Scan(&periodExists); err != nil {
		return "", err
	}
	if periodExists == 0 {
		return "", fmt.Errorf("reporting period not found: %s", periodID)
	}
	if evidenceID != "" {
		var documentExists int
		if err := q.QueryRowContext(ctx, `SELECT count(*) FROM document WHERE id = ?`, evidenceID).
			Scan(&documentExists); err != nil {
			return "", err
		}
		if documentExists == 0 {
			return "", fmt.Errorf("evidence document not found: %s", evidenceID)
		}
	}

	ef, err := emissionFactorByKey(ctx, q, in.EF)
	if err != nil {
		return "", err
	}
	if ef == nil {
		return "", fmt.Errorf("emission factor not found: %s/%d/%s/%s/%s",
			in.EF.FactorCode, in.EF.Year, in.EF.Source, in.EF.Geography, in.EF.DatasetVersion)
	}
	if err := pinEmissionFactor(ctx, q, ef); err != nil {
		return "", err
	}
	amountInEFUnit, err := convertAmount(ctx, q, in.Amount, unit, ef.InputUnit, fuelCode)
	if err != nil {
		return "", err
	}
	computed := amountInEFUnit * ef.CO2eKgPerUnit
	if ef.CH4KgPerUnit != nil {
		computed += amountInEFUnit * *ef.CH4KgPerUnit * gwpCH4
	}
	if ef.N2OKgPerUnit != nil {
		computed += amountInEFUnit * *ef.N2OKgPerUnit * gwpN2O
	}

	id := newID()
	ts := now()
	_, err = q.ExecContext(ctx, `INSERT INTO activity_data (
			id, site_id, emission_source_id, reporting_period_id,
			occurred_at_start, occurred_at_end, amount, unit,
			ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
			computed_co2e_kg, computed_at, fuel_code, extraction_id, notes, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, siteID, sourceID, periodID, startText, endText, in.Amount, unit,
		ef.FactorCode, ef.Year, ef.Source, ef.Geography, ef.DatasetVersion,
		computed, ts, nullIfEmpty(fuelCode), nullIfEmpty(extractionID), nullIfEmpty(notes), ts, ts)
	if err != nil {
		return "", err
	}
	if evidenceID != "" {
		if _, err := q.ExecContext(ctx, `INSERT INTO evidence_attachment
				(id, activity_data_id, document_id, created_at) VALUES (?, ?, ?, ?)`,
			newID(), id, evidenceID, ts); err != nil {
			return "", fmt.Errorf("attach evidence: %w", err)
		}
	}
	if err := writeAudit(ctx, q, "activity_data.created", ts, map[string]any{
		"activity_id":          id,
		"site_id":              siteID,
		"emission_source_id":   sourceID,
		"reporting_period_id":  periodID,
		"amount":               in.Amount,
		"unit":                 unit,
		"ef":                   auditEF(in.EF),
		"computed_co2e_kg":     computed,
		"fuel_code":            emptyToNil(fuelCode),
		"provenance":           provenance(extractionID),
		"extraction_id":        emptyToNil(extractionID),
		"evidence_document_id": emptyToNil(evidenceID),
	}); err != nil {
		return "", err
	}
	return id, nil
}

// ImportFailure is one skipped row in a batch import.
type ImportFailure struct {
	Index int
	Error string
}

// ImportResult counts a batch import and reports the first failures.
type ImportResult struct {
	Imported int
	Failed   int
	Failures []ImportFailure
}

// ImportActivities inserts many rows in one transaction. Each row gets its own
// savepoint, so a bad row is skipped without discarding the rest; every
// imported row keeps its own audit event.
func (s *Store) ImportActivities(ctx context.Context, inputs []ActivityInput) (ImportResult, error) {
	var result ImportResult
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	for i, in := range inputs {
		savepoint := fmt.Sprintf("import_row_%d", i)
		if _, err := tx.ExecContext(ctx, "SAVEPOINT "+savepoint); err != nil {
			return result, err
		}
		if _, err := insertActivity(ctx, tx, in); err != nil {
			if _, rbErr := tx.ExecContext(ctx, "ROLLBACK TO "+savepoint); rbErr != nil {
				return result, rbErr
			}
			if _, rbErr := tx.ExecContext(ctx, "RELEASE "+savepoint); rbErr != nil {
				return result, rbErr
			}
			result.Failed++
			if len(result.Failures) < 200 {
				result.Failures = append(result.Failures, ImportFailure{Index: i, Error: err.Error()})
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, "RELEASE "+savepoint); err != nil {
			return result, err
		}
		result.Imported++
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

// UpdateActivity replaces a ledger row's editable fields, pins the selected
// factor, recomputes CO2e, and writes an audit event. Free-text notes stay out
// of the audit payload.
func (s *Store) UpdateActivity(ctx context.Context, id string, in ActivityInput) (*Activity, error) {
	sourceID := strings.TrimSpace(in.EmissionSourceID)
	periodID := strings.TrimSpace(in.ReportingPeriodID)
	unit := strings.TrimSpace(in.Unit)
	startText := strings.TrimSpace(in.OccurredAtStart)
	endText := strings.TrimSpace(in.OccurredAtEnd)
	fuelCode := strings.TrimSpace(in.FuelCode)
	notes := strings.TrimSpace(in.Notes)
	extractionID := strings.TrimSpace(in.ExtractionID)
	if sourceID == "" || periodID == "" {
		return nil, errors.New("emission source and reporting period are required")
	}
	if !validFinite(in.Amount) || in.Amount <= 0 {
		return nil, errors.New("amount must be a positive number")
	}
	if unit == "" {
		return nil, errors.New("unit is required")
	}
	if len([]rune(unit)) > 50 || len([]rune(fuelCode)) > 100 || len([]rune(extractionID)) > 100 {
		return nil, errors.New("unit or reference is too long")
	}
	if len([]rune(notes)) > 2000 {
		return nil, errors.New("notes are too long")
	}
	start, err := parseActivityTime(startText)
	if err != nil {
		return nil, fmt.Errorf("start date: %w", err)
	}
	end, err := parseActivityTime(endText)
	if err != nil {
		return nil, fmt.Errorf("end date: %w", err)
	}
	if end.Before(start) {
		return nil, errors.New("end date cannot be before start date")
	}
	if err := validateEFKey(in.EF); err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := activityByID(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, fmt.Errorf("activity not found: %s", id)
	}

	var siteID string
	var active int
	err = tx.QueryRowContext(ctx, `SELECT site_id, is_active FROM emission_source WHERE id = ?`, sourceID).
		Scan(&siteID, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("emission source not found: %s", sourceID)
	}
	if err != nil {
		return nil, err
	}
	if active != 1 {
		return nil, fmt.Errorf("emission source is inactive: %s", sourceID)
	}
	var periodExists int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM reporting_period WHERE id = ?`, periodID).
		Scan(&periodExists); err != nil {
		return nil, err
	}
	if periodExists == 0 {
		return nil, fmt.Errorf("reporting period not found: %s", periodID)
	}
	ef, err := emissionFactorByKey(ctx, tx, in.EF)
	if err != nil {
		return nil, err
	}
	if ef == nil {
		return nil, fmt.Errorf("emission factor not found: %s/%d/%s/%s/%s",
			in.EF.FactorCode, in.EF.Year, in.EF.Source, in.EF.Geography, in.EF.DatasetVersion)
	}
	if err := pinEmissionFactor(ctx, tx, ef); err != nil {
		return nil, err
	}
	amountInEFUnit, err := convertAmount(ctx, tx, in.Amount, unit, ef.InputUnit, fuelCode)
	if err != nil {
		return nil, err
	}
	computed := amountInEFUnit * ef.CO2eKgPerUnit
	if ef.CH4KgPerUnit != nil {
		computed += amountInEFUnit * *ef.CH4KgPerUnit * gwpCH4
	}
	if ef.N2OKgPerUnit != nil {
		computed += amountInEFUnit * *ef.N2OKgPerUnit * gwpN2O
	}
	ts := now()
	if _, err := tx.ExecContext(ctx, `UPDATE activity_data SET
			site_id = ?, emission_source_id = ?, reporting_period_id = ?,
			occurred_at_start = ?, occurred_at_end = ?, amount = ?, unit = ?,
			ef_factor_code = ?, ef_year = ?, ef_source = ?, ef_geography = ?, ef_dataset_version = ?,
			computed_co2e_kg = ?, computed_at = ?, fuel_code = ?, extraction_id = ?, notes = ?, updated_at = ?
		WHERE id = ?`,
		siteID, sourceID, periodID, startText, endText, in.Amount, unit,
		ef.FactorCode, ef.Year, ef.Source, ef.Geography, ef.DatasetVersion,
		computed, ts, nullIfEmpty(fuelCode), nullIfEmpty(extractionID), nullIfEmpty(notes), ts, id); err != nil {
		return nil, err
	}
	oldEF := EmissionFactorKey{
		FactorCode: current.EFFactorCode, Year: current.EFYear, Source: current.EFSource,
		Geography: current.EFGeography, DatasetVersion: current.EFDatasetVersion,
	}
	kind := "activity_data.updated"
	if oldEF != in.EF {
		kind = "activity_rebind_ef"
	}
	if err := writeAudit(ctx, tx, kind, ts, map[string]any{
		"activity_id":          id,
		"old_ef":               auditEF(oldEF),
		"new_ef":               auditEF(in.EF),
		"old_amount":           current.Amount,
		"old_unit":             current.Unit,
		"old_computed_co2e_kg": current.CO2eKg,
		"new_amount":           in.Amount,
		"new_unit":             unit,
		"new_computed_co2e_kg": computed,
		"emission_source_id":   sourceID,
		"reporting_period_id":  periodID,
		"fuel_code":            emptyToNil(fuelCode),
	}); err != nil {
		return nil, err
	}
	updated, err := activityByID(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return updated, nil
}

// ActivityByID reads one ledger row.
func (s *Store) ActivityByID(ctx context.Context, id string) (*Activity, error) {
	return activityByID(ctx, s.db, id)
}

func activityByID(ctx context.Context, q queryer, id string) (*Activity, error) {
	row := q.QueryRowContext(ctx, activitySelect+` WHERE a.id = ?`, id)
	a, err := scanActivity(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// DeleteActivity removes a ledger row unless a questionnaire answer still
// references it. Evidence links are removed with the row; source documents
// remain. The deletion is audited.
func (s *Store) DeleteActivity(ctx context.Context, id string) error {
	var refs int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM answer WHERE source_activity_data_id = ?`, id).Scan(&refs); err != nil {
		return err
	}
	if refs > 0 {
		return fmt.Errorf("activity is referenced by %d questionnaire answer(s)", refs)
	}
	row, err := s.ActivityByID(ctx, id)
	if err != nil {
		return err
	}
	if row == nil {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var evidence int64
	result, err := tx.ExecContext(ctx, `DELETE FROM evidence_attachment WHERE activity_data_id = ?`, id)
	if err != nil {
		return err
	}
	evidence, _ = result.RowsAffected()
	if _, err := tx.ExecContext(ctx, `DELETE FROM activity_data WHERE id = ?`, id); err != nil {
		return err
	}
	if err := writeAudit(ctx, tx, "activity_data.deleted", now(), map[string]any{
		"activity_id":            id,
		"emission_source_id":     row.EmissionSourceID,
		"reporting_period_id":    row.ReportingPeriodID,
		"amount":                 row.Amount,
		"unit":                   row.Unit,
		"computed_co2e_kg":       row.CO2eKg,
		"evidence_removed_count": evidence,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

// AuditEvents returns the newest audit rows.
func (s *Store) AuditEvents(ctx context.Context, limit int) ([]AuditEvent, error) {
	return s.QueryAuditEvents(ctx, AuditQuery{Limit: limit})
}

// AuditQuery filters the append-only log. Since and Until are date-only
// (YYYY-MM-DD); BeforeTime/BeforeID form a keyset cursor for older pages.
type AuditQuery struct {
	Kind       string
	Since      string
	Until      string
	BeforeTime string
	BeforeID   string
	Limit      int
}

// QueryAuditEvents returns matching rows newest first.
func (s *Store) QueryAuditEvents(ctx context.Context, q AuditQuery) ([]AuditEvent, error) {
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 10_000 {
		limit = 10_000
	}
	clauses := []string{"1 = 1"}
	var args []any
	if kind := strings.TrimSpace(q.Kind); kind != "" {
		clauses = append(clauses, "event_kind = ?")
		args = append(args, kind)
	}
	if since := strings.TrimSpace(q.Since); since != "" {
		clauses = append(clauses, "substr(occurred_at, 1, 10) >= ?")
		args = append(args, since)
	}
	if until := strings.TrimSpace(q.Until); until != "" {
		clauses = append(clauses, "substr(occurred_at, 1, 10) <= ?")
		args = append(args, until)
	}
	if q.BeforeTime != "" {
		clauses = append(clauses, "(occurred_at < ? OR (occurred_at = ? AND id < ?))")
		args = append(args, q.BeforeTime, q.BeforeTime, q.BeforeID)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, event_kind, payload, occurred_at FROM audit_event WHERE `+
			strings.Join(clauses, " AND ")+
			` ORDER BY occurred_at DESC, id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEvent
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.Kind, &e.Payload, &e.OccurredAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func scanActivity(row rowScanner) (Activity, error) {
	var a Activity
	err := row.Scan(&a.ID, &a.SiteID, &a.Site, &a.EmissionSourceID, &a.Source, &a.ReportingPeriodID,
		&a.OccurredAt, &a.OccurredAtEnd, &a.Amount, &a.Unit, &a.EFFactorCode, &a.EFYear, &a.EFSource,
		&a.EFGeography, &a.EFDatasetVersion, &a.CO2eKg, &a.ComputedAt, &a.FuelCode, &a.Notes, &a.Scope,
		&a.ExtractionID)
	return a, err
}

func validateEFKey(key EmissionFactorKey) error {
	if strings.TrimSpace(key.FactorCode) == "" || key.Year == 0 ||
		strings.TrimSpace(key.Source) == "" || strings.TrimSpace(key.Geography) == "" ||
		strings.TrimSpace(key.DatasetVersion) == "" {
		return errors.New("a complete emission factor is required")
	}
	return nil
}

func pinEmissionFactor(ctx context.Context, q queryer, ef *EmissionFactor) error {
	_, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO pinned_emission_factor (
			factor_code, year, source, geography, dataset_version, scope, category,
			ghg_protocol_path, input_unit, co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
			gwp_basis, name_zh, name_en, citation_url, pinned_at, pinned_from
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ef.FactorCode, ef.Year, ef.Source, ef.Geography, ef.DatasetVersion, ef.Scope,
		nullIfEmpty(ef.Category), nullIfEmpty(ef.GHGProtocolPath), ef.InputUnit, ef.CO2eKgPerUnit,
		floatPtrValue(ef.CH4KgPerUnit), floatPtrValue(ef.N2OKgPerUnit), ef.GWPBasis,
		nullIfEmpty(ef.NameZH), nullIfEmpty(ef.NameEN), nullIfEmpty(ef.CitationURL), now(), "app.sqlite")
	return err
}

func writeAudit(ctx context.Context, q queryer, kind, ts string, payload map[string]any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx,
		`INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
		newID(), kind, string(data), ts)
	return err
}

type unitDef struct {
	Unit            string
	Family          string
	MultiplyOfRatio float64
	DivideOfRatio   float64
}

type fuelProperty struct {
	DensityKgPerL            *float64
	DensityKgPerM3           *float64
	LowerHeatingValueMJPerKg *float64
	LowerHeatingValueMJPerM3 *float64
}

func convertAmount(ctx context.Context, q queryer, amount float64, from, to, fuelCode string) (float64, error) {
	if fuelCode != "" {
		return convertWithFuel(ctx, q, amount, from, to, fuelCode)
	}
	return convertUnit(ctx, q, amount, from, to)
}

func convertUnit(ctx context.Context, q queryer, amount float64, from, to string) (float64, error) {
	fromDef, err := normalizeUnit(ctx, q, from)
	if err != nil {
		return 0, err
	}
	toDef, err := normalizeUnit(ctx, q, to)
	if err != nil {
		return 0, err
	}
	if fromDef.Family != toDef.Family {
		return 0, fmt.Errorf("cannot convert %s (%s) to %s (%s) without a fuel binding",
			from, fromDef.Family, to, toDef.Family)
	}
	return convertCanonical(amount, fromDef, toDef), nil
}

func convertWithFuel(ctx context.Context, q queryer, amount float64, from, to, fuelCode string) (float64, error) {
	fuel, err := getFuelProperty(ctx, q, fuelCode)
	if err != nil {
		return 0, err
	}
	fromDef, err := normalizeUnit(ctx, q, from)
	if err != nil {
		return 0, err
	}
	toDef, err := normalizeUnit(ctx, q, to)
	if err != nil {
		return 0, err
	}
	if fromDef.Family == toDef.Family {
		return convertCanonical(amount, fromDef, toDef), nil
	}

	var kg, mj *float64
	set := func(v float64) *float64 { return &v }
	switch fromDef.Family {
	case "volume":
		liters, err := convertUnit(ctx, q, amount, from, "L")
		if err != nil {
			return 0, err
		}
		if fuel.DensityKgPerL != nil {
			kg = set(liters * *fuel.DensityKgPerL)
		} else if fuel.DensityKgPerM3 != nil {
			kg = set(liters / 1000 * *fuel.DensityKgPerM3)
		}
		if fuel.LowerHeatingValueMJPerM3 != nil {
			mj = set(liters / 1000 * *fuel.LowerHeatingValueMJPerM3)
		} else if kg != nil && fuel.LowerHeatingValueMJPerKg != nil {
			mj = set(*kg * *fuel.LowerHeatingValueMJPerKg)
		}
	case "mass":
		value, err := convertUnit(ctx, q, amount, from, "kg")
		if err != nil {
			return 0, err
		}
		kg = set(value)
		if fuel.LowerHeatingValueMJPerKg != nil {
			mj = set(value * *fuel.LowerHeatingValueMJPerKg)
		}
	case "energy":
		value, err := convertUnit(ctx, q, amount, from, "MJ")
		if err != nil {
			return 0, err
		}
		mj = set(value)
		if fuel.LowerHeatingValueMJPerKg != nil {
			kg = set(value / *fuel.LowerHeatingValueMJPerKg)
		}
	default:
		return 0, fmt.Errorf("cannot convert family %s through a fuel binding", fromDef.Family)
	}

	switch toDef.Family {
	case "mass":
		if kg == nil {
			return 0, fmt.Errorf("cannot derive mass from %s via fuel %s", from, fuelCode)
		}
		return convertUnit(ctx, q, *kg, "kg", to)
	case "volume":
		if kg == nil || fuel.DensityKgPerL == nil {
			return 0, fmt.Errorf("cannot derive volume from %s via fuel %s", from, fuelCode)
		}
		return convertUnit(ctx, q, *kg / *fuel.DensityKgPerL, "L", to)
	case "energy":
		if mj == nil {
			return 0, fmt.Errorf("cannot derive energy from %s via fuel %s", from, fuelCode)
		}
		return convertUnit(ctx, q, *mj, "MJ", to)
	default:
		return 0, fmt.Errorf("cannot convert to family %s", toDef.Family)
	}
}

func normalizeUnit(ctx context.Context, q queryer, value string) (unitDef, error) {
	var out unitDef
	err := q.QueryRowContext(ctx,
		`SELECT unit, family, multiply_of_ratio, divide_of_ratio FROM unit_definition WHERE unit = ?`,
		value).Scan(&out.Unit, &out.Family, &out.MultiplyOfRatio, &out.DivideOfRatio)
	if err == nil {
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	err = q.QueryRowContext(ctx, `SELECT u.unit, u.family, u.multiply_of_ratio, u.divide_of_ratio
		FROM unit_alias a JOIN unit_definition u ON a.canonical_unit = u.unit
		WHERE a.alias = ?`, value).Scan(&out.Unit, &out.Family, &out.MultiplyOfRatio, &out.DivideOfRatio)
	if errors.Is(err, sql.ErrNoRows) {
		return out, fmt.Errorf("unknown unit: %s", value)
	}
	return out, err
}

func convertCanonical(amount float64, from, to unitDef) float64 {
	canonical := amount * from.MultiplyOfRatio / from.DivideOfRatio
	return canonical * to.DivideOfRatio / to.MultiplyOfRatio
}

func getFuelProperty(ctx context.Context, q queryer, fuelCode string) (fuelProperty, error) {
	var out fuelProperty
	var densityL, densityM3, lhvKg, lhvM3 sql.NullFloat64
	err := q.QueryRowContext(ctx, `SELECT density_kg_per_L, density_kg_per_m3,
		lower_heating_value_MJ_per_kg, lower_heating_value_MJ_per_m3
		FROM fuel_property WHERE fuel_code = ?`, fuelCode).
		Scan(&densityL, &densityM3, &lhvKg, &lhvM3)
	if errors.Is(err, sql.ErrNoRows) {
		return out, fmt.Errorf("unknown fuel_code: %s", fuelCode)
	}
	if err != nil {
		return out, err
	}
	out.DensityKgPerL = nullFloatPtr(densityL)
	out.DensityKgPerM3 = nullFloatPtr(densityM3)
	out.LowerHeatingValueMJPerKg = nullFloatPtr(lhvKg)
	out.LowerHeatingValueMJPerM3 = nullFloatPtr(lhvM3)
	return out, nil
}

func parseActivityTime(value string) (time.Time, error) {
	for _, layout := range []string{"2006-01-02", time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, value); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized date %q", value)
}

func floatPtrValue(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func nullFloatPtr(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

func emptyToNil(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func provenance(extractionID string) string {
	if strings.TrimSpace(extractionID) == "" {
		return "manual"
	}
	return "extraction"
}

func auditEF(key EmissionFactorKey) map[string]any {
	return map[string]any{
		"factor_code":     key.FactorCode,
		"year":            key.Year,
		"source":          key.Source,
		"geography":       key.Geography,
		"dataset_version": key.DatasetVersion,
	}
}

func roundForStorage(v float64) float64 { return math.Round(v*1e12) / 1e12 }
