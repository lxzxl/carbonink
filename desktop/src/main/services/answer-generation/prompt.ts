/**
 * Prompt builders + structured-output schema for the answer-generation
 * service. Extracted from `./index.ts` so the legacy single-shot path
 * (still wired up in `index.ts`) and the new agent path (`./agent-loop.ts`)
 * share one source of truth for question/inventory shape and per-kind
 * tail text.
 *
 * `buildAnswerPrompt` is the legacy single-shot user prompt — it dumps
 * inventory totals + the activities summary verbatim. `buildAgentUserPrompt`
 * is the trimmed agent variant: it strips the activity dump because the
 * agent fetches what it needs through `list_activities` / `sum_co2e`
 * (see `./tools.ts`). The system prompt
 * (`AGENT_SYSTEM_PROMPT`) carries the cite-from-tool-results discipline
 * that keeps the model from fabricating numbers.
 */
import { type ZodSchema, z } from 'zod';

/**
 * Per-question-kind tail of the system prompt. Kept inline (rather than in a
 * data file) because the wording is tightly coupled to the schema validators
 * below — e.g. the narrative `valueMax = 2000` mirrors the "≤300 字" guidance.
 */
export const KIND_INSTRUCTIONS: Record<'numerical' | 'categorical' | 'narrative', string> = {
  numerical: '请返回数字字符串 + 单位。优先从 inventory 总排放 / 活动数据中推算。',
  categorical: '请返回一个短词答案（≤10 字），如"是"/"否"/"部分"/"不适用"或行业代码/类型名。',
  narrative: '请返回 1-3 句中文叙述（≤300 字），结合 inventory 给出可审计的回答。',
};

export interface InventoryContext {
  year: number;
  activity_count: number;
  activities_summary: string;
  totals: {
    total_co2e_kg: number;
    scope1_kg?: number;
    scope2_kg?: number;
    scope3_kg?: number;
  } | null;
}

export interface QuestionContext {
  raw_text: string;
  expected_unit?: string | null;
  question_kind: 'numerical' | 'categorical' | 'narrative';
}

/**
 * Shape of the structured answer the LLM (single-shot or agent) returns.
 * Surfaced as a type alias so callers can name the result without rebuilding
 * the schema.
 */
export interface AnswerOutput {
  value: string;
  unit: string | null;
  source_summary: string;
}

/**
 * Build the schema for the LLM's structured response. `valueMax` depends on
 * the question kind so narrative answers get headroom while numerical/
 * categorical answers are kept terse.
 */
export function buildAnswerSchema(
  question_kind: 'numerical' | 'categorical' | 'narrative',
): ZodSchema<AnswerOutput> {
  const valueMax = question_kind === 'narrative' ? 2000 : 50;
  return z.object({
    value: z.string().max(valueMax),
    unit: z.string().nullable(),
    source_summary: z.string().max(500),
  });
}

/**
 * Render the answer-generation prompt for the legacy single-shot path.
 * Lives in the service (not the AiClient) so the AiClient stays a dumb
 * conduit — services own their prompts, the client only sends bytes.
 * Matches the broader pi-ai migration pattern.
 */
export function buildAnswerPrompt(question: QuestionContext, inventory: InventoryContext): string {
  return `你是一名碳核算助理。下面是一道供应商问卷的题目，以及当前组织 ${inventory.year} 年度的 inventory 数据。请基于 inventory 给出答案。

题目类型：${question.question_kind}
${KIND_INSTRUCTIONS[question.question_kind]}

<question>
${question.raw_text}
${question.expected_unit ? `期望单位：${question.expected_unit}` : ''}
</question>

<inventory>
活动数据行数：${inventory.activity_count}
活动数据摘要：${inventory.activities_summary}
${inventory.totals ? `总排放：${JSON.stringify(inventory.totals)}` : '无总排放快照。'}
</inventory>

返回 JSON: { value: <答案字符串，可以是数字字符串或文本>, unit: <单位字符串，若题面有要求；否则 null>, source_summary: <1-2 句中文，说明答案是从 inventory 哪部分推出来的> }

如果 inventory 里没有相关数据，value 用空字符串 ""，source_summary 解释为何无法回答。`;
}

/**
 * System prompt for the tool-using agent loop. Encodes the
 * cite-from-tool-results discipline: every number must come from a tool
 * call, source_summary must reference activity IDs or EF factor codes,
 * and the agent must finalize via `submit_response` exactly once.
 *
 * Kept bilingual on purpose — questions are bilingual (zh-CN + EN), and
 * the existing single-shot prompt is mostly Chinese; this prompt mirrors
 * that voice while keeping critical rules in English for emphasis.
 */
export const AGENT_SYSTEM_PROMPT = `You are a carbon-accounting analyst answering questionnaire questions about a Chinese company's GHG inventory.

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
6. Answers should be terse (numerical/categorical ≤ 50 chars; narrative ≤ 2000 chars).`;

/**
 * Render the trimmed user prompt for the agent path. Deliberately omits the
 * activity dump that lives in `buildAnswerPrompt` — the agent fetches what
 * it needs via `list_activities` / `sum_co2e`. Inventory headline (year +
 * count + totals) is kept so the agent knows whether the inventory is
 * empty before issuing a query.
 */
export function buildAgentUserPrompt(
  question: QuestionContext,
  inventory: InventoryContext,
): string {
  return `题目类型：${question.question_kind}
${KIND_INSTRUCTIONS[question.question_kind]}

<question>
${question.raw_text}
${question.expected_unit ? `期望单位：${question.expected_unit}` : ''}
</question>

<inventory_headline>
年度：${inventory.year}
活动数据行数：${inventory.activity_count}
${inventory.totals ? `总排放（kg co2e）：${JSON.stringify(inventory.totals)}` : '无总排放快照。'}
</inventory_headline>

使用工具查询具体活动数据（list_activities、sum_co2e 等），然后用 submit_response 给出最终答案。`;
}
