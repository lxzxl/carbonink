package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
)

// runReadQuery opens the workspace read-only for one tool call, so a workspace
// switch in the app is picked up on the next call with no stale handle.
func runReadQuery(ctx context.Context, path, name string, raw json.RawMessage) (any, error) {
	opened, err := store.OpenReadOnly(ctx, path)
	if err != nil {
		return nil, err
	}
	defer opened.Close()
	db := opened.DB()

	switch name {
	case "list_questionnaires":
		return listQuestionnaires(ctx, db)
	case "get_questionnaire":
		var args struct {
			ID string `json:"id"`
		}
		if err := decodeArgs(raw, &args); err != nil {
			return nil, err
		}
		if strings.TrimSpace(args.ID) == "" {
			return nil, errors.New("id is required")
		}
		return getQuestionnaire(ctx, db, args.ID)
	case "list_questions":
		var args struct {
			QuestionnaireID string `json:"questionnaire_id"`
		}
		if err := decodeArgs(raw, &args); err != nil {
			return nil, err
		}
		if strings.TrimSpace(args.QuestionnaireID) == "" {
			return nil, errors.New("questionnaire_id is required")
		}
		return readRows(ctx, db,
			`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position, id`,
			args.QuestionnaireID)
	case "get_answer":
		var args struct {
			QuestionID string `json:"question_id"`
		}
		if err := decodeArgs(raw, &args); err != nil {
			return nil, err
		}
		if strings.TrimSpace(args.QuestionID) == "" {
			return nil, errors.New("question_id is required")
		}
		return readOne(ctx, db, `SELECT * FROM answer WHERE question_id = ?`, args.QuestionID)
	case "list_activities":
		var args struct {
			ReportingPeriodID string   `json:"reporting_period_id"`
			Year              *float64 `json:"year"`
		}
		if err := decodeArgs(raw, &args); err != nil {
			return nil, err
		}
		switch {
		case strings.TrimSpace(args.ReportingPeriodID) != "":
			return readRows(ctx, db,
				`SELECT * FROM activity_data WHERE reporting_period_id = ?`,
				args.ReportingPeriodID)
		case args.Year != nil:
			return readRows(ctx, db,
				`SELECT a.* FROM activity_data a
				   JOIN reporting_period rp ON rp.id = a.reporting_period_id
				  WHERE rp.year = ?`, int(*args.Year))
		default:
			return readRows(ctx, db, `SELECT * FROM activity_data`)
		}
	case "list_emission_sources":
		var args struct {
			OrganizationID string `json:"organization_id"`
		}
		if err := decodeArgs(raw, &args); err != nil {
			return nil, err
		}
		if strings.TrimSpace(args.OrganizationID) != "" {
			return readRows(ctx, db, `SELECT es.*
				  FROM emission_source es
				  JOIN site s ON s.id = es.site_id
				 WHERE s.organization_id = ?
				 ORDER BY es.scope ASC, es.name ASC, es.id ASC`, args.OrganizationID)
		}
		return readRows(ctx, db, `SELECT * FROM emission_source`)
	}
	return nil, errors.New("Unknown tool: " + name)
}

func decodeArgs(raw json.RawMessage, out any) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return errors.New("invalid tool arguments: " + err.Error())
	}
	return nil
}

func listQuestionnaires(ctx context.Context, db *sql.DB) (any, error) {
	return readRows(ctx, db, `
		SELECT q.id,
		       c.name AS customer_name,
		       q.reporting_year,
		       q.status,
		       (SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id) AS question_count
		  FROM questionnaire q
		  JOIN customer c ON c.id = q.customer_id
		 ORDER BY q.created_at DESC`)
}

func getQuestionnaire(ctx context.Context, db *sql.DB, id string) (any, error) {
	questionnaire, err := readOne(ctx, db, `SELECT * FROM questionnaire WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	if questionnaire == nil {
		return nil, nil
	}
	customerID, _ := questionnaire["customer_id"].(string)
	documentID, _ := questionnaire["document_id"].(string)
	customer, err := readOne(ctx, db, `SELECT * FROM customer WHERE id = ?`, customerID)
	if err != nil {
		return nil, err
	}
	document, err := readOne(ctx, db, `SELECT * FROM document WHERE id = ?`, documentID)
	if err != nil {
		return nil, err
	}
	questions, err := readRows(ctx, db,
		`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position, id`, id)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"questionnaire": questionnaire,
		"customer":      customer,
		"document":      document,
		"questions":     questions,
	}, nil
}

// inventoryTotals is the inventory://{year} resource.
type inventoryTotals struct {
	TotalCO2eKg   float64 `json:"total_co2e_kg"`
	Scope1Kg      float64 `json:"scope1_kg"`
	Scope2Kg      float64 `json:"scope2_kg"`
	Scope3Kg      float64 `json:"scope3_kg"`
	ActivityCount int     `json:"activity_count"`
}

func inventoryTotalsForYear(ctx context.Context, db *sql.DB, year int) (*inventoryTotals, error) {
	var totals inventoryTotals
	err := db.QueryRowContext(ctx, `
		SELECT
		  COALESCE(SUM(a.computed_co2e_kg), 0) AS total_co2e_kg,
		  COALESCE(SUM(CASE WHEN es.scope = 1 THEN a.computed_co2e_kg ELSE 0 END), 0) AS scope1_kg,
		  COALESCE(SUM(CASE WHEN es.scope = 2 THEN a.computed_co2e_kg ELSE 0 END), 0) AS scope2_kg,
		  COALESCE(SUM(CASE WHEN es.scope = 3 THEN a.computed_co2e_kg ELSE 0 END), 0) AS scope3_kg,
		  COUNT(a.id) AS activity_count
		  FROM activity_data a
		  JOIN emission_source es ON es.id = a.emission_source_id
		  JOIN reporting_period rp ON rp.id = a.reporting_period_id
		 WHERE rp.year = ?`, year).
		Scan(&totals.TotalCO2eKg, &totals.Scope1Kg, &totals.Scope2Kg, &totals.Scope3Kg,
			&totals.ActivityCount)
	if err != nil {
		return nil, err
	}
	return &totals, nil
}

func readRows(ctx context.Context, db *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, 16)
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i := range values {
		pointers[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(columns))
		for i, column := range columns {
			switch value := values[i].(type) {
			case []byte:
				row[column] = string(value)
			default:
				row[column] = value
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func readOne(ctx context.Context, db *sql.DB, query string, args ...any) (map[string]any, error) {
	rows, err := readRows(ctx, db, query+" LIMIT 1", args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// yearFromPath parses the four-digit year in inventory://{year}.
func yearFromPath(path string) (int, bool) {
	year, err := strconv.Atoi(path)
	if err != nil || year < 1000 || year > 9999 {
		return 0, false
	}
	return year, true
}
