/**
 * Orchestrator that drives `AiAgent.run()` for one answer-generation
 * question. Glues the trimmed user prompt (`buildAgentUserPrompt`) +
 * structured-output schema (`buildAnswerSchema`) + the read-only inventory
 * toolbox (`buildAnswerTools`, passed in by the caller) onto the generic
 * agent service.
 *
 * Failures (`AgentMaxTurns`, `AgentStalled`, any `AiErr`) propagate
 * unchanged — the caller in `./index.ts` (rewired in Task 7) decides
 * whether to fall back to the single-shot path or surface as a typed
 * service error.
 */
import { type AgentTool, type AgentTrace, AiAgentTag } from '@main/llm/ai-agent.js';
import type { AgentMaxTurns, AgentStalled, AiErr } from '@main/llm/errors.js';
import { Effect } from 'effect';
import {
  AGENT_SYSTEM_PROMPT,
  type AnswerOutput,
  buildAgentUserPrompt,
  buildAnswerSchema,
  type InventoryContext,
  type QuestionContext,
} from './prompt.js';

export interface AgentRunResult {
  answer: AnswerOutput;
  trace: AgentTrace;
}

/**
 * Turn budget for the answer-generation agent. Tighter than the
 * `AiAgent` default (20) because a single questionnaire answer should
 * never need many turns — read one or two filters, optionally pull an
 * EF, submit. If the model burns 6 turns without finalizing, it's
 * usually thrashing and falling back to single-shot is the right call.
 *
 * Overridable via the `ANSWER_AGENT_MAX_TURNS` env var — primarily so
 * manual smoke can force the fallback path by setting it to `1` (the
 * agent can't finalize in a single turn since it must call a tool first,
 * so it always exhausts the budget → AgentMaxTurns → single-shot). An
 * invalid / non-positive value falls back to the default 6.
 */
const ANSWER_AGENT_MAX_TURNS = (() => {
  const raw = process.env.ANSWER_AGENT_MAX_TURNS;
  if (raw === undefined) return 6;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 6;
})();

/**
 * Wall-clock budget per question. 90s is generous for the kind of
 * 1–3 tool calls this loop should require; it also gives room for the
 * provider to retry an EF lookup on a slow connection. Beyond that
 * the user is better off with the single-shot fallback.
 */
const ANSWER_AGENT_TIMEOUT_MS = 90_000;

/**
 * Run the agent turn-loop for one question. Returns the parsed answer +
 * a trace summarizing the agent's decisions. Failures (AgentMaxTurns,
 * AgentStalled, AiTimeout, other AiErr) propagate up — the caller in
 * `./index.ts` decides whether to fall back to single-shot.
 */
export function runAgent(
  question: QuestionContext,
  inventory: InventoryContext,
  tools: AgentTool[],
): Effect.Effect<AgentRunResult, AiErr | AgentMaxTurns | AgentStalled, AiAgentTag> {
  return Effect.gen(function* () {
    const agent = yield* AiAgentTag;
    const schema = buildAnswerSchema(question.question_kind);

    const { result, trace } = yield* agent.run({
      systemPrompt: AGENT_SYSTEM_PROMPT,
      userPrompt: buildAgentUserPrompt(question, inventory),
      schema,
      tools,
      maxTurns: ANSWER_AGENT_MAX_TURNS,
      timeoutMs: ANSWER_AGENT_TIMEOUT_MS,
    });

    return { answer: result, trace };
  });
}
