package mcp

import "encoding/json"

// toolDef is one MCP tool listing entry.
type toolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// tools are the 1.x tool surface, verbatim in name, description, and schema.
func tools() []toolDef {
	return []toolDef{
		{
			Name:        "list_questionnaires",
			Description: "List all questionnaires (customer / reporting_year / status / question_count).",
			InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		},
		{
			Name:        "get_questionnaire",
			Description: "Get the full detail of one questionnaire (includes customer / document / questions[]).",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"id":{"type":"string","description":"questionnaire id"}},
				"required":["id"],
				"additionalProperties":false}`),
		},
		{
			Name:        "list_questions",
			Description: "List every question in a questionnaire.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"questionnaire_id":{"type":"string","description":"questionnaire id"}},
				"required":["questionnaire_id"],
				"additionalProperties":false}`),
		},
		{
			Name:        "get_answer",
			Description: "Get the answer to a question (returns null when unanswered).",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"question_id":{"type":"string","description":"question id"}},
				"required":["question_id"],
				"additionalProperties":false}`),
		},
		{
			Name:        "list_activities",
			Description: "List activity data, optionally filtered by reporting_period_id or year.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"reporting_period_id":{"type":"string","description":"reporting period id (optional)"},
					"year":{"type":"number","description":"reporting year, e.g. 2024 (optional)"}},
				"additionalProperties":false}`),
		},
		{
			Name:        "list_emission_sources",
			Description: "List emission sources, optionally filtered by organization_id.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"organization_id":{"type":"string","description":"organization id (optional)"}},
				"additionalProperties":false}`),
		},
		{
			Name: "set_answer",
			Description: "Create or update the answer to a question. Recorded as ai_suggested, not manual. " +
				"Requires the CarbonInk desktop app to be running.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"question_id":{"type":"string","description":"question id"},
					"value":{"type":"string","description":"answer text"},
					"unit":{"type":"string","description":"unit (optional)","nullable":true},
					"finalize":{"type":"boolean","description":"mark the answer finalized (sets finalized_at)"}},
				"required":["question_id","value"],
				"additionalProperties":false}`),
		},
		{
			Name: "create_activity",
			Description: "Create an activity data row. co2e is computed from the pinned emission factor, " +
				"converting the given unit into the factor's unit; a cross-family unit (e.g. " +
				"litres against a per-kg factor) fails unless fuel_code is supplied. If the EF " +
				"has not been pinned yet, use it once in the CarbonInk GUI first. Requires the " +
				"CarbonInk desktop app to be running.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"emission_source_id":{"type":"string"},
					"reporting_period_id":{"type":"string"},
					"occurred_at_start":{"type":"string","description":"ISO date string, e.g. 2024-01-01"},
					"occurred_at_end":{"type":"string","description":"ISO date string, e.g. 2024-12-31"},
					"amount":{"type":"number"},
					"unit":{"type":"string"},
					"ef_factor_code":{"type":"string"},
					"ef_year":{"type":"number"},
					"ef_source":{"type":"string"},
					"ef_geography":{"type":"string"},
					"ef_dataset_version":{"type":"string"},
					"fuel_code":{"type":"string","description":"Fuel binding for cross-family conversion (e.g. litres of diesel against a per-kg factor). Only needed when unit and the factor unit differ in family.","nullable":true},
					"notes":{"type":"string","nullable":true}},
				"required":["emission_source_id","reporting_period_id","occurred_at_start",
					"occurred_at_end","amount","unit","ef_factor_code","ef_year","ef_source",
					"ef_geography","ef_dataset_version"],
				"additionalProperties":false}`),
		},
		{
			Name:        "create_emission_source",
			Description: "Create an emission source. Requires the CarbonInk desktop app to be running.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"site_id":{"type":"string"},
					"name":{"type":"string"},
					"scope":{"type":"number","enum":[1,2,3]},
					"category":{"type":"string","nullable":true},
					"ghg_protocol_path":{"type":"string","nullable":true}},
				"required":["site_id","name","scope"],
				"additionalProperties":false}`),
		},
	}
}
