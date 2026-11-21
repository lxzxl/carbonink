// Package answer drafts questionnaire answers from the workspace inventory.
// It mirrors the 1.x pipeline: a tool-using agent reads the ledger, falls back
// to one prompt-dump turn when the agent stalls, and never persists a blank
// answer.
package answer

import (
	"encoding/json"
	"fmt"

	"app.carbonink.desktop/internal/llm"
)

// InventoryContext is the headline the prompt carries.
type InventoryContext struct {
	Year              int     `json:"year"`
	ActivityCount     int     `json:"activity_count"`
	ActivitiesSummary string  `json:"activities_summary"`
	Totals            *Totals `json:"totals"`
}

// Totals aggregates the ledger's computed CO2e by scope.
type Totals struct {
	TotalCO2eKg float64  `json:"total_co2e_kg"`
	Scope1Kg    *float64 `json:"scope1_kg,omitempty"`
	Scope2Kg    *float64 `json:"scope2_kg,omitempty"`
	Scope3Kg    *float64 `json:"scope3_kg,omitempty"`
}

// QuestionContext is the question side of both prompts.
type QuestionContext struct {
	RawText      string `json:"raw_text"`
	ExpectedUnit string `json:"expected_unit"`
	QuestionKind string `json:"question_kind"`
}

// AnswerOutput is the structured answer both paths return.
type AnswerOutput struct {
	Value         string  `json:"value"`
	Unit          *string `json:"unit"`
	SourceSummary string  `json:"source_summary"`
}

// KindInstructions is the per-kind prompt tail.
var KindInstructions = map[string]string{
	"numerical":   "请返回数字字符串 + 单位。优先从 inventory 总排放 / 活动数据中推算。",
	"categorical": "请返回一个短词答案（≤10 字），如\"是\"/\"否\"/\"部分\"/\"不适用\"或行业代码/类型名。",
	"narrative":   "请返回 1-3 句中文叙述（≤300 字），结合 inventory 给出可审计的回答。",
}

// AgentSystemPrompt is the 1.x system prompt for the tool loop.
const AgentSystemPrompt = `You are a carbon-accounting analyst answering questionnaire questions about a Chinese company's GHG inventory.

You have read-only tools to query the user's inventory:
- list_activities — filtered by year/scope/source
- sum_co2e — aggregate totals
- list_emission_sources — list sources
- get_emission_factor — look up the EF pinned to an activity
- read_questionnaire_context — questionnaire metadata

CRITICAL RULES:
1. Never fabricate numbers. Every number in your answer must come from a tool result.
2. Cite specific activity IDs or EF factor codes in source_summary so the user can audit your reasoning.
3. If the inventory genuinely lacks the data, return value="" and explain in source_summary.
4. Don't over-call tools. Plan: think about which one query gets you the answer; call it; submit.
5. Use submit_response to deliver your final answer — only call it once.
6. Answers should be terse (numerical/categorical ≤ 50 chars; narrative ≤ 2000 chars).`

// SingleShotSystemPrompt is the fallback's system message: no tools are
// offered there except the terminal submit_response call.
const SingleShotSystemPrompt = `You answer one supplier questionnaire question from the ` +
	`company's GHG inventory. Never invent numbers. Return the answer by calling the provided tool.`

// BuildAgentUserPrompt is the trimmed agent prompt: no activity dump.
func BuildAgentUserPrompt(q QuestionContext, inventory InventoryContext) string {
	expected := ""
	if q.ExpectedUnit != "" {
		expected = "期望单位：" + q.ExpectedUnit
	}
	totals := "无总排放快照。"
	if inventory.Totals != nil {
		encoded, _ := json.Marshal(inventory.Totals)
		totals = "总排放（kg co2e）：" + string(encoded)
	}
	return fmt.Sprintf(`题目类型：%s
%s

<question>
%s
%s
</question>

<inventory_headline>
年度：%d
活动数据行数：%d
%s
</inventory_headline>

使用工具查询具体活动数据（list_activities、sum_co2e 等），然后用 submit_response 给出最终答案。`,
		q.QuestionKind, KindInstructions[q.QuestionKind], q.RawText, expected,
		inventory.Year, inventory.ActivityCount, totals)
}

// BuildSingleShotPrompt is the legacy prompt-dump path used as the fallback.
func BuildSingleShotPrompt(q QuestionContext, inventory InventoryContext) string {
	expected := ""
	if q.ExpectedUnit != "" {
		expected = "期望单位：" + q.ExpectedUnit
	}
	totals := "无总排放快照。"
	if inventory.Totals != nil {
		encoded, _ := json.Marshal(inventory.Totals)
		totals = "总排放：" + string(encoded)
	}
	return fmt.Sprintf(`你是一名碳核算助理。下面是一道供应商问卷的题目，以及当前组织 %d 年度的 inventory 数据。请基于 inventory 给出答案。

题目类型：%s
%s

<question>
%s
%s
</question>

<inventory>
活动数据行数：%d
活动数据摘要：%s
%s
</inventory>

返回 JSON: { value: <答案字符串，可以是数字字符串或文本>, unit: <单位字符串，若题面有要求；否则 null>, source_summary: <1-2 句中文，说明答案是从 inventory 哪部分推出来的> }

如果 inventory 里没有相关数据，value 用空字符串 ""，source_summary 解释为何无法回答。`,
		inventory.Year, q.QuestionKind, KindInstructions[q.QuestionKind], q.RawText, expected,
		inventory.ActivityCount, inventory.ActivitiesSummary, totals)
}

// AnswerSchema is the structured-output schema for one question kind.
func AnswerSchema(kind string) json.RawMessage {
	valueMax := 50
	if kind == "narrative" {
		valueMax = 2000
	}
	return json.RawMessage(fmt.Sprintf(`{
  "type": "object",
  "required": ["value", "unit", "source_summary"],
  "additionalProperties": false,
  "properties": {
    "value": {"type": "string", "maxLength": %d},
    "unit": {"type": ["string", "null"]},
    "source_summary": {"type": "string", "maxLength": 500}
  }
}`, valueMax))
}

// FinishTool is the terminal tool both paths answer with.
func FinishTool(kind string) llm.Tool {
	return llm.Tool{
		Name:        "submit_response",
		Description: "Deliver the final answer for this questionnaire question.",
		Schema:      AnswerSchema(kind),
	}
}
