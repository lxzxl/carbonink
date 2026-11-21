package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"app.carbonink.desktop/internal/store"
)

func (s *Server) listResources() (any, *rpcError, bool) {
	ctx := context.Background()
	path, err := s.DBPath()
	if err != nil {
		return nil, &rpcError{Code: -32603, Message: err.Error()}, true
	}
	opened, err := store.OpenReadOnly(ctx, path)
	if err != nil {
		return nil, &rpcError{Code: -32603, Message: err.Error()}, true
	}
	defer opened.Close()
	db := opened.DB()

	years, err := readRows(ctx, db,
		`SELECT DISTINCT year FROM reporting_period ORDER BY year DESC`)
	if err != nil {
		return nil, &rpcError{Code: -32603, Message: err.Error()}, true
	}
	questionnaires, err := listQuestionnaires(ctx, db)
	if err != nil {
		return nil, &rpcError{Code: -32603, Message: err.Error()}, true
	}
	listed, _ := questionnaires.([]map[string]any)

	resources := make([]map[string]any, 0, len(years)+len(listed))
	for _, row := range years {
		year := fmt.Sprint(row["year"])
		resources = append(resources, map[string]any{
			"uri":         "inventory://" + year,
			"name":        "Inventory " + year,
			"description": "Aggregated emissions totals for reporting year " + year,
			"mimeType":    "application/json",
		})
	}
	for _, questionnaire := range listed {
		id, _ := questionnaire["id"].(string)
		customer, _ := questionnaire["customer_name"].(string)
		year := fmt.Sprint(questionnaire["reporting_year"])
		resources = append(resources, map[string]any{
			"uri":         "questionnaire://" + id,
			"name":        "Questionnaire " + customer + " " + year,
			"description": "Full questionnaire detail for " + customer + " " + year,
			"mimeType":    "application/json",
		})
	}
	return map[string]any{"resources": resources}, nil, true
}

func (s *Server) readResource(raw json.RawMessage) (any, *rpcError, bool) {
	var params struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(raw, &params); err != nil || params.URI == "" {
		return nil, &rpcError{Code: -32602, Message: "Invalid resources/read parameters"}, true
	}
	ctx := context.Background()
	path, err := s.DBPath()
	if err != nil {
		return nil, &rpcError{Code: -32603, Message: err.Error()}, true
	}
	opened, err := store.OpenReadOnly(ctx, path)
	if err != nil {
		return nil, &rpcError{Code: -32603, Message: err.Error()}, true
	}
	defer opened.Close()
	db := opened.DB()

	switch {
	case strings.HasPrefix(params.URI, "inventory://"):
		year, ok := yearFromPath(strings.TrimPrefix(params.URI, "inventory://"))
		if !ok {
			return nil, &rpcError{Code: -32602,
				Message: "Unsupported resource URI: " + params.URI}, true
		}
		totals, err := inventoryTotalsForYear(ctx, db, year)
		if err != nil {
			return nil, &rpcError{Code: -32603, Message: err.Error()}, true
		}
		text, err := json.MarshalIndent(totals, "", "  ")
		if err != nil {
			return nil, &rpcError{Code: -32603, Message: err.Error()}, true
		}
		return resourceContents(params.URI, text), nil, true

	case strings.HasPrefix(params.URI, "questionnaire://"):
		id := strings.TrimPrefix(params.URI, "questionnaire://")
		if id == "" {
			return nil, &rpcError{Code: -32602,
				Message: "Unsupported resource URI: " + params.URI}, true
		}
		detail, err := getQuestionnaire(ctx, db, id)
		if err != nil {
			return nil, &rpcError{Code: -32603, Message: err.Error()}, true
		}
		if detail == nil {
			return nil, &rpcError{Code: -32602,
				Message: "Questionnaire not found: " + id}, true
		}
		text, err := json.MarshalIndent(detail, "", "  ")
		if err != nil {
			return nil, &rpcError{Code: -32603, Message: err.Error()}, true
		}
		return resourceContents(params.URI, text), nil, true
	}
	return nil, &rpcError{Code: -32602,
		Message: "Unsupported resource URI: " + params.URI}, true
}

func resourceContents(uri string, text []byte) map[string]any {
	return map[string]any{
		"contents": []any{map[string]any{
			"uri": uri, "mimeType": "application/json", "text": string(text),
		}},
	}
}
