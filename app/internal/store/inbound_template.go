package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// InboundTemplateQuestion is one question inside a user-authored inbound
// supplier disclosure template.
type InboundTemplateQuestion struct {
	Position     string `json:"position"`
	Tier         int    `json:"tier"`
	Kind         string `json:"kind"`
	RawZH        string `json:"raw_zh"`
	RawEN        string `json:"raw_en"`
	ExpectedUnit string `json:"expected_unit,omitempty"`
	CellRef      string `json:"cell_ref"`
}

// InboundTemplate is one saved user-authored disclosure template.
type InboundTemplate struct {
	ID              string
	Kind            string
	LabelZH         string
	LabelEN         string
	Scope           int
	Category        string
	GHGProtocolPath string
	EFCategory      string
	Tier1Unit       string
	DefaultUnit     string
	Questions       []InboundTemplateQuestion
	CreatedAt       string
	UpdatedAt       string
}

// InboundTemplateInput creates or updates one custom inbound template.
type InboundTemplateInput struct {
	ID              string
	LabelZH         string
	LabelEN         string
	Category        string
	GHGProtocolPath string
	EFCategory      string
	Tier1Unit       string
	DefaultUnit     string
	Questions       []InboundTemplateQuestion
}

const inboundTemplateSelect = `SELECT id, kind, label_zh, label_en, scope, category,
		ghg_protocol_path, coalesce(ef_category, ''), coalesce(tier1_unit, ''),
		coalesce(default_unit, ''), questions_json, created_at, updated_at
	FROM inbound_template`

func scanInboundTemplate(row rowScanner) (InboundTemplate, error) {
	var t InboundTemplate
	var qjson string
	err := row.Scan(&t.ID, &t.Kind, &t.LabelZH, &t.LabelEN, &t.Scope, &t.Category,
		&t.GHGProtocolPath, &t.EFCategory, &t.Tier1Unit, &t.DefaultUnit, &qjson,
		&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return t, err
	}
	if err := json.Unmarshal([]byte(qjson), &t.Questions); err != nil {
		return t, fmt.Errorf("decode template questions: %w", err)
	}
	return t, nil
}

// ListInboundTemplates returns every user-authored inbound template newest
// updated first.
func (s *Store) ListInboundTemplates(ctx context.Context) ([]InboundTemplate, error) {
	rows, err := s.db.QueryContext(ctx, inboundTemplateSelect+` ORDER BY updated_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []InboundTemplate
	for rows.Next() {
		t, err := scanInboundTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// InboundTemplateByKind reads one custom template by its kind string, or nil.
func (s *Store) InboundTemplateByKind(ctx context.Context, kind string) (*InboundTemplate, error) {
	row := s.db.QueryRowContext(ctx, inboundTemplateSelect+` WHERE kind = ?`, kind)
	t, err := scanInboundTemplate(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// InboundTemplateByID reads one custom template by id, or nil.
func (s *Store) InboundTemplateByID(ctx context.Context, id string) (*InboundTemplate, error) {
	row := s.db.QueryRowContext(ctx, inboundTemplateSelect+` WHERE id = ?`, id)
	t, err := scanInboundTemplate(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// SaveInboundTemplate creates or updates a custom inbound template, normalizing
// positions and Excel cell coordinates deterministically.
func (s *Store) SaveInboundTemplate(ctx context.Context, in InboundTemplateInput) (*InboundTemplate, error) {
	labelZH := strings.TrimSpace(in.LabelZH)
	labelEN := strings.TrimSpace(in.LabelEN)
	if labelZH == "" && labelEN == "" {
		return nil, errors.New("template name is required")
	}
	if labelZH == "" {
		labelZH = labelEN
	}
	if labelEN == "" {
		labelEN = labelZH
	}
	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "purchased_goods"
	}
	ghgPath := strings.TrimSpace(in.GHGProtocolPath)
	if ghgPath == "" {
		ghgPath = "scope3.cat1_purchased_goods"
	}
	normalized, err := normalizeTemplateQuestions(in.Questions)
	if err != nil {
		return nil, err
	}
	qjson, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	stamp := now()
	id := strings.TrimSpace(in.ID)
	created := false
	var kind string
	if id == "" {
		id = newID()
		kind = "custom:" + id
		created = true
		if _, err := tx.ExecContext(ctx, `INSERT INTO inbound_template
			(id, kind, label_zh, label_en, scope, category, ghg_protocol_path,
			 ef_category, tier1_unit, default_unit, questions_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, 3, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, kind, labelZH, labelEN, category, ghgPath,
			nullIfEmpty(strings.TrimSpace(in.EFCategory)),
			nullIfEmpty(strings.TrimSpace(in.Tier1Unit)),
			nullIfEmpty(strings.TrimSpace(in.DefaultUnit)),
			string(qjson), stamp, stamp); err != nil {
			return nil, err
		}
	} else {
		err := tx.QueryRowContext(ctx, `SELECT kind FROM inbound_template WHERE id = ?`, id).Scan(&kind)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("inbound template not found: %s", id)
		}
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE inbound_template
			SET label_zh = ?, label_en = ?, category = ?, ghg_protocol_path = ?,
			    ef_category = ?, tier1_unit = ?, default_unit = ?,
			    questions_json = ?, updated_at = ?
			WHERE id = ?`,
			labelZH, labelEN, category, ghgPath,
			nullIfEmpty(strings.TrimSpace(in.EFCategory)),
			nullIfEmpty(strings.TrimSpace(in.Tier1Unit)),
			nullIfEmpty(strings.TrimSpace(in.DefaultUnit)),
			string(qjson), stamp, id); err != nil {
			return nil, err
		}
	}
	if err := writeAudit(ctx, tx, "inbound_template.saved", stamp, map[string]any{
		"template_id":    id,
		"template_kind":  kind,
		"created":        created,
		"question_count": len(normalized),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.InboundTemplateByID(ctx, id)
}

// DeleteInboundTemplate deletes one custom template. Existing questionnaires
// retain their materialized questions.
func (s *Store) DeleteInboundTemplate(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var kind string
	err = tx.QueryRowContext(ctx, `SELECT kind FROM inbound_template WHERE id = ?`, id).Scan(&kind)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("inbound template not found: %s", id)
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM inbound_template WHERE id = ?`, id); err != nil {
		return err
	}
	if err := writeAudit(ctx, tx, "inbound_template.deleted", now(), map[string]any{
		"template_id":   id,
		"template_kind": kind,
	}); err != nil {
		return err
	}
	return tx.Commit()
}

func normalizeTemplateQuestions(raw []InboundTemplateQuestion) ([]InboundTemplateQuestion, error) {
	if len(raw) == 0 {
		return nil, errors.New("at least one question is required")
	}
	counts := map[int]int{}
	out := make([]InboundTemplateQuestion, 0, len(raw))
	for i, q := range raw {
		if q.Tier < 0 || q.Tier > 3 {
			return nil, fmt.Errorf("question %d has invalid tier %d", i+1, q.Tier)
		}
		switch q.Kind {
		case "numerical", "categorical", "narrative":
		default:
			return nil, fmt.Errorf("question %d has invalid kind %q", i+1, q.Kind)
		}
		zh := strings.TrimSpace(q.RawZH)
		en := strings.TrimSpace(q.RawEN)
		if zh == "" && en == "" {
			return nil, fmt.Errorf("question %d prompt is required", i+1)
		}
		if zh == "" {
			zh = en
		}
		if en == "" {
			en = zh
		}
		counts[q.Tier]++
		idx := counts[q.Tier]
		sheet := "metadata"
		prefix := "meta"
		switch q.Tier {
		case 1:
			sheet, prefix = "tier1", "tier1"
		case 2:
			sheet, prefix = "tier2", "tier2"
		case 3:
			sheet, prefix = "tier3", "tier3"
		}
		rowNum := 5 + (idx-1)*2
		out = append(out, InboundTemplateQuestion{
			Position:     fmt.Sprintf("%s.%d", prefix, idx),
			Tier:         q.Tier,
			Kind:         q.Kind,
			RawZH:        zh,
			RawEN:        en,
			ExpectedUnit: strings.TrimSpace(q.ExpectedUnit),
			CellRef:      fmt.Sprintf("%s!B%d", sheet, rowNum),
		})
	}
	return out, nil
}
