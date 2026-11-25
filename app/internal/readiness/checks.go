package readiness

import (
	"context"
	"database/sql"
	"errors"

	"app.carbonink.desktop/internal/activityimport"
)

// C1 — an active emission source with nothing recorded against it this
// period. Usually means data was never collected, so the inventory is
// understated; a dormant source is legitimate, hence a warning.
func c1SourceWithoutActivity(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT es.id, es.name, es.scope
		FROM emission_source es
		JOIN site s ON s.id = es.site_id
		WHERE s.organization_id = ? AND es.is_active = 1
		  AND NOT EXISTS (
		    SELECT 1 FROM activity_data ad
		    WHERE ad.emission_source_id = es.id AND ad.reporting_period_id = ?
		  )
		ORDER BY es.scope, es.name`, p.OrganizationID, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, name string
		var scope int
		if err := rows.Scan(&id, &name, &scope); err != nil {
			return nil, err
		}
		out = append(out, Finding{
			CheckID: "C1", Severity: SeverityWarning,
			Entity: Entity{Type: "emission_source", ID: id},
			Facts:  map[string]any{"source_name": name, "scope": scope, "year": p.Year},
		})
	}
	return out, rows.Err()
}

// C3 — an activity dated outside the period it is filed under. It misstates
// two periods at once, so it blocks.
func c3ActivityOutsidePeriod(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT ad.id, ad.occurred_at_start, ad.occurred_at_end,
			es.name
		FROM activity_data ad
		JOIN emission_source es ON es.id = ad.emission_source_id
		WHERE ad.reporting_period_id = ?
		  AND (ad.occurred_at_start < ? OR ad.occurred_at_end > ?)
		ORDER BY ad.occurred_at_start`, p.ID, p.StartsAt, p.EndsAt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, start, end, source string
		if err := rows.Scan(&id, &start, &end, &source); err != nil {
			return nil, err
		}
		out = append(out, Finding{
			CheckID: "C3", Severity: SeverityBlocker,
			Entity: Entity{Type: "activity_data", ID: id},
			Facts: map[string]any{
				"source_name": source,
				"occurred":    start + "~" + end,
				"period":      p.StartsAt + "~" + p.EndsAt,
			},
		})
	}
	return out, rows.Err()
}

// C5 — an unanswered outbound question. Inbound questions are the supplier's
// homework and are covered by D3 instead.
func c5QuestionWithoutAnswer(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT q.id, q.questionnaire_id,
			COALESCE(q.raw_text, q.normalized_text), c.name
		FROM question q
		JOIN questionnaire qn ON qn.id = q.questionnaire_id
		JOIN counterparty c ON c.id = qn.counterparty_id
		LEFT JOIN answer a ON a.question_id = q.id
		WHERE qn.reporting_year = ? AND qn.direction = 'outbound' AND a.id IS NULL
		ORDER BY qn.id, q.position`, p.Year)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, questionnaireID, text, customer string
		if err := rows.Scan(&id, &questionnaireID, &text, &customer); err != nil {
			return nil, err
		}
		out = append(out, Finding{
			CheckID: "C5", Severity: SeverityWarning,
			Entity: Entity{Type: "question", ID: id},
			Facts: map[string]any{
				"customer_name":    customer,
				"question_text":    truncateRunes(text, 120),
				"questionnaire_id": questionnaireID,
			},
		})
	}
	return out, rows.Err()
}

// N1 — the activity unit and the pinned factor's input unit are in different
// families with no fuel binding to convert between them: an arithmetic error.
func n1UnitDimensionMismatch(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT ad.id, ad.unit, ad.amount, pef.input_unit, es.name
		FROM activity_data ad
		JOIN pinned_emission_factor pef
		  ON pef.factor_code = ad.ef_factor_code
		 AND pef.year = ad.ef_year
		 AND pef.source = ad.ef_source
		 AND pef.geography = ad.ef_geography
		 AND pef.dataset_version = ad.ef_dataset_version
		JOIN emission_source es ON es.id = ad.emission_source_id
		WHERE ad.reporting_period_id = ? AND ad.fuel_code IS NULL`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		id, unit, inputUnit, source string
		amount                      float64
	}
	var candidates []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.unit, &r.amount, &r.inputUnit, &r.source); err != nil {
			return nil, err
		}
		candidates = append(candidates, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []Finding
	for _, r := range candidates {
		from, ok, err := unitFamily(ctx, q, r.unit)
		if err != nil || !ok {
			continue
		}
		to, ok, err := unitFamily(ctx, q, r.inputUnit)
		if err != nil || !ok {
			continue
		}
		if from == to {
			continue
		}
		out = append(out, Finding{
			CheckID: "N1", Severity: SeverityBlocker,
			Entity: Entity{Type: "activity_data", ID: r.id},
			Facts: map[string]any{
				"source_name": r.source, "amount": r.amount,
				"unit": r.unit, "ef_input_unit": r.inputUnit,
			},
		})
	}
	return out, nil
}

// N2 — an amount far from its group median, using the same detector and
// per-workspace multiplier as batch import.
func n2AmountOutlier(ctx context.Context, q queryer, p period, opts Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT ad.id, ad.amount, ad.unit, ad.emission_source_id,
			es.name
		FROM activity_data ad
		JOIN emission_source es ON es.id = ad.emission_source_id
		WHERE ad.reporting_period_id = ?
		ORDER BY ad.created_at`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		id, unit, sourceID, source string
		amount                     float64
	}
	var ledger []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.amount, &r.unit, &r.sourceID, &r.source); err != nil {
			return nil, err
		}
		ledger = append(ledger, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	importRows := make([]activityimport.ResolvedRow, 0, len(ledger))
	for i, r := range ledger {
		importRows = append(importRows, activityimport.ResolvedRow{
			ValidRow: activityimport.ValidRow{
				Row: i + 1, SourceName: r.source, Description: r.source,
				Amount: r.amount, Unit: r.unit,
			},
			SourceID: r.sourceID,
		})
	}
	issues := activityimport.DetectOutliers(importRows, opts.ImportOutlierRatio)
	var out []Finding
	for _, issue := range issues {
		if issue.Row < 1 || issue.Row > len(ledger) {
			continue
		}
		r := ledger[issue.Row-1]
		out = append(out, Finding{
			CheckID: "N2", Severity: SeverityWarning,
			Entity: Entity{Type: "activity_data", ID: r.id},
			Facts: map[string]any{
				"source_name": r.source, "amount": r.amount, "unit": r.unit,
				"detail": issue.Detail, "ratio": opts.ImportOutlierRatio,
			},
		})
	}
	return out, nil
}

// N3 — the same source, dates, amount and unit more than once. Reports only
// the later rows, so acting on every finding leaves one standing.
func n3SuspectedDuplicate(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT ad.id, ad.amount, ad.unit,
			ad.occurred_at_start, ad.occurred_at_end, es.name,
			FIRST_VALUE(ad.id) OVER (
			  PARTITION BY ad.emission_source_id, ad.occurred_at_start,
			               ad.occurred_at_end, ad.amount, ad.unit
			  ORDER BY ad.created_at, ad.id
			) AS keeper_id,
			COUNT(*) OVER (
			  PARTITION BY ad.emission_source_id, ad.occurred_at_start,
			               ad.occurred_at_end, ad.amount, ad.unit
			) AS dupe_count
		FROM activity_data ad
		JOIN emission_source es ON es.id = ad.emission_source_id
		WHERE ad.reporting_period_id = ?`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, unit, start, end, source, keeper string
		var amount float64
		var dupes int
		if err := rows.Scan(&id, &amount, &unit, &start, &end, &source, &keeper, &dupes); err != nil {
			return nil, err
		}
		if dupes <= 1 || id == keeper {
			continue
		}
		out = append(out, Finding{
			CheckID: "N3", Severity: SeverityWarning,
			Entity: Entity{Type: "activity_data", ID: id},
			Facts: map[string]any{
				"source_name": source, "amount": amount, "unit": unit,
				"occurred": start + "~" + end, "duplicate_of": keeper,
			},
		})
	}
	return out, rows.Err()
}

// N5 — AR5 and AR6 factors mixed in one period. Totals on two GWP bases are
// not additive.
func n5MixedGwpBasis(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT DISTINCT pef.gwp_basis
		FROM activity_data ad
		JOIN pinned_emission_factor pef
		  ON pef.factor_code = ad.ef_factor_code
		 AND pef.year = ad.ef_year
		 AND pef.source = ad.ef_source
		 AND pef.geography = ad.ef_geography
		 AND pef.dataset_version = ad.ef_dataset_version
		WHERE ad.reporting_period_id = ?
		ORDER BY pef.gwp_basis`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var bases []string
	for rows.Next() {
		var basis string
		if err := rows.Scan(&basis); err != nil {
			return nil, err
		}
		bases = append(bases, basis)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(bases) < 2 {
		return nil, nil
	}
	return []Finding{{
		CheckID: "N5", Severity: SeverityBlocker,
		Entity: Entity{Type: "period", ID: p.ID},
		Facts:  map[string]any{"year": p.Year, "bases": joinStrings(bases, ", ")},
	}}, nil
}

// T1 — how much of the period rests on rows with no extraction, no inbound
// answer and no attachment. One period-level finding, not one per row.
func t1ActivityWithoutEvidence(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	var total, unevidenced int
	var totalCO2e, unevidencedCO2e float64
	err := q.QueryRowContext(ctx, `SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN unevidenced THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(computed_co2e_kg), 0),
			COALESCE(SUM(CASE WHEN unevidenced THEN computed_co2e_kg ELSE 0 END), 0)
		FROM (
		  SELECT ad.computed_co2e_kg,
		         (ad.extraction_id IS NULL AND ad.inbound_question_id IS NULL
		          AND NOT EXISTS (
		            SELECT 1 FROM evidence_attachment ea WHERE ea.activity_data_id = ad.id
		          )) AS unevidenced
		  FROM activity_data ad
		  WHERE ad.reporting_period_id = ?
		)`, p.ID).Scan(&total, &unevidenced, &totalCO2e, &unevidencedCO2e)
	if err != nil {
		return nil, err
	}
	if unevidenced == 0 {
		return nil, nil
	}
	share := 0.0
	if totalCO2e > 0 {
		share = unevidencedCO2e / totalCO2e * 100
	}
	return []Finding{{
		CheckID: "T1", Severity: SeverityInfo,
		Entity: Entity{Type: "period", ID: p.ID},
		Facts: map[string]any{
			"unevidenced_count": unevidenced, "total_count": total,
			"co2e_share_pct": rounded(share, 1),
		},
	}}, nil
}

// T2 — an activity with no `activity_data.created` audit event. Its origin is
// unknowable, which this product promises never to be true.
func t2ActivityWithoutAuditTrail(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT ad.id, ad.created_at, es.name
		FROM activity_data ad
		JOIN emission_source es ON es.id = ad.emission_source_id
		WHERE ad.reporting_period_id = ?
		  AND NOT EXISTS (
		    SELECT 1 FROM audit_event ae
		    WHERE ae.event_kind = 'activity_data.created'
		      AND json_extract(ae.payload, '$.activity_id') = ad.id
		  )
		ORDER BY ad.created_at`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, created, source string
		if err := rows.Scan(&id, &created, &source); err != nil {
			return nil, err
		}
		out = append(out, Finding{
			CheckID: "T2", Severity: SeverityBlocker,
			Entity: Entity{Type: "activity_data", ID: id},
			Facts:  map[string]any{"source_name": source, "created_at": created},
		})
	}
	return out, rows.Err()
}

// T3 — the pinned factor's vintage is more than two years from the reporting
// year. Whether that is defensible depends on what has been published.
func t3StaleEfVintage(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT ad.id, ad.ef_factor_code, ad.ef_year, es.name
		FROM activity_data ad
		JOIN emission_source es ON es.id = ad.emission_source_id
		WHERE ad.reporting_period_id = ? AND ABS(ad.ef_year - ?) > 2
		ORDER BY ABS(ad.ef_year - ?) DESC`, p.ID, p.Year, p.Year)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, code, source string
		var efYear int
		if err := rows.Scan(&id, &code, &efYear, &source); err != nil {
			return nil, err
		}
		out = append(out, Finding{
			CheckID: "T3", Severity: SeverityWarning,
			Entity: Entity{Type: "activity_data", ID: id},
			Facts: map[string]any{
				"source_name": source, "factor_code": code,
				"ef_year": efYear, "reporting_year": p.Year,
			},
		})
	}
	return out, rows.Err()
}

// T4 — pinned to a user-imported factor whose library was deleted. The number
// is right; its provenance can no longer be shown.
func t4OrphanedUserLibraryFactor(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT DISTINCT ad.id, ad.ef_source, ad.ef_factor_code, es.name
		FROM activity_data ad
		JOIN emission_source es ON es.id = ad.emission_source_id
		WHERE ad.reporting_period_id = ?
		  AND ad.ef_source LIKE 'user:%'
		  AND NOT EXISTS (SELECT 1 FROM user_ef_library lib WHERE lib.source = ad.ef_source)
		ORDER BY ad.ef_source`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, source, code, sourceName string
		if err := rows.Scan(&id, &source, &code, &sourceName); err != nil {
			return nil, err
		}
		out = append(out, Finding{
			CheckID: "T4", Severity: SeverityWarning,
			Entity: Entity{Type: "activity_data", ID: id},
			Facts: map[string]any{
				"source_name": sourceName, "ef_source": source, "factor_code": code,
			},
		})
	}
	return out, rows.Err()
}

// D1 — the organization has no base year, so year-over-year has nothing to
// anchor to.
func d1NoBaseYear(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	var id string
	var base sql.NullString
	err := q.QueryRowContext(ctx, `SELECT id, base_year_period_id
		FROM organization WHERE id = ?`, p.OrganizationID).Scan(&id, &base)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if base.Valid {
		return nil, nil
	}
	return []Finding{{
		CheckID: "D1", Severity: SeverityWarning,
		Entity: Entity{Type: "organization", ID: id},
		Facts:  map[string]any{"year": p.Year},
	}}, nil
}

// D2 — a frozen snapshot line no longer matches the live row, or the row was
// deleted. Something already left the building.
func d2SnapshotDivergedFromLedger(ctx context.Context, q queryer, p period, _ Options) ([]Finding, error) {
	rows, err := q.QueryContext(ctx, `SELECT csl.original_activity_data_id,
			csl.emission_source_name_at_freeze, csl.amount, csl.unit,
			csl.computed_co2e_kg, csl.ef_factor_code,
			ad.id, ad.amount, ad.unit, ad.computed_co2e_kg, ad.ef_factor_code
		FROM calculation_snapshot_line csl
		JOIN calculation_snapshot cs ON cs.id = csl.calculation_snapshot_id
		LEFT JOIN activity_data ad ON ad.id = csl.original_activity_data_id
		WHERE cs.reporting_period_id = ?`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var activityID, frozenSource, frozenUnit, frozenCode sql.NullString
		var liveID, liveUnit, liveCode sql.NullString
		var frozenAmount, frozenCO2e, liveAmount, liveCO2e sql.NullFloat64
		if err := rows.Scan(&activityID, &frozenSource, &frozenAmount, &frozenUnit,
			&frozenCO2e, &frozenCode, &liveID, &liveAmount, &liveUnit, &liveCO2e,
			&liveCode); err != nil {
			return nil, err
		}
		if !activityID.Valid {
			continue
		}
		if !liveID.Valid {
			out = append(out, Finding{
				CheckID: "D2", Severity: SeverityBlocker,
				Entity: Entity{Type: "activity_data", ID: activityID.String},
				Facts: map[string]any{
					"source_name": frozenSource.String, "reason": "deleted",
					"frozen_co2e_kg": frozenCO2e.Float64,
				},
			})
			continue
		}
		if liveAmount.Float64 == frozenAmount.Float64 &&
			liveUnit.String == frozenUnit.String &&
			liveCO2e.Float64 == frozenCO2e.Float64 &&
			liveCode.String == frozenCode.String {
			continue
		}
		out = append(out, Finding{
			CheckID: "D2", Severity: SeverityBlocker,
			Entity: Entity{Type: "activity_data", ID: activityID.String},
			Facts: map[string]any{
				"source_name": frozenSource.String, "reason": "edited",
				"frozen_co2e_kg": frozenCO2e.Float64, "live_co2e_kg": liveCO2e.Float64,
			},
		})
	}
	return out, rows.Err()
}

// D3 — a sent inbound disclosure past its due date in local time.
func d3OverdueSupplierDisclosure(ctx context.Context, q queryer, p period, opts Options) ([]Finding, error) {
	today := opts.Now.Format("2006-01-02")
	rows, err := q.QueryContext(ctx, `SELECT qn.id, qn.due_date, c.name
		FROM questionnaire qn
		JOIN counterparty c ON c.id = qn.counterparty_id
		WHERE qn.direction = 'inbound' AND qn.status = 'sent'
		  AND qn.reporting_year = ? AND qn.due_date IS NOT NULL AND qn.due_date < ?
		ORDER BY qn.due_date`, p.Year, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Finding
	for rows.Next() {
		var id, due, supplier string
		if err := rows.Scan(&id, &due, &supplier); err != nil {
			return nil, err
		}
		out = append(out, Finding{
			CheckID: "D3", Severity: SeverityWarning,
			Entity: Entity{Type: "questionnaire", ID: id},
			Facts:  map[string]any{"supplier_name": supplier, "due_date": due},
		})
	}
	return out, rows.Err()
}

func unitFamily(ctx context.Context, q queryer, unit string) (string, bool, error) {
	var family string
	err := q.QueryRowContext(ctx,
		`SELECT family FROM unit_definition WHERE unit = ?`, unit).Scan(&family)
	if err == nil {
		return family, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}
	err = q.QueryRowContext(ctx, `SELECT u.family
		FROM unit_alias a JOIN unit_definition u ON a.canonical_unit = u.unit
		WHERE a.alias = ?`, unit).Scan(&family)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return family, true, nil
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func rounded(value float64, digits int) float64 {
	factor := 1.0
	for i := 0; i < digits; i++ {
		factor *= 10
	}
	return float64(int64(value*factor+0.5)) / factor
}

func joinStrings(values []string, sep string) string {
	if len(values) == 0 {
		return ""
	}
	out := values[0]
	for _, value := range values[1:] {
		out += sep + value
	}
	return out
}
