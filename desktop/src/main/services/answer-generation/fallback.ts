/**
 * The pre-Item-4 single-shot answer-generation path. Builds one big
 * prompt that dumps the inventory summary verbatim and asks
 * `ai.generateObject` for the structured answer in a single round-trip.
 *
 * Used as the fallback when the agent loop (`./agent-loop.ts`) fails —
 * when the LLM gets stuck (`AgentStalled`), exhausts its turn budget
 * (`AgentMaxTurns`), or times out we still need to give the user
 * SOMETHING, and the original prompt-dump path is the safe baseline.
 *
 * Behavior is identical to the prior in-line implementation in
 * `./index.ts` — only the location changed. Lifting it into its own
 * named function lets `index.ts` orchestrate "try agent → fallback"
 * cleanly once Task 7 wires the agent path in.
 */
import { AiClientTag } from '@main/llm/ai-client.js';
import type { AiErr } from '@main/llm/errors.js';
import { Effect } from 'effect';
import {
  type AnswerOutput,
  buildAnswerPrompt,
  buildAnswerSchema,
  type InventoryContext,
  type QuestionContext,
} from './prompt.js';

/**
 * Run the legacy single-shot answer-generation flow for one question.
 * Returns the LLM's parsed structured response unchanged — interpretation
 * (empty-value handling, unit normalization, persistence) is the caller's
 * job, so this function stays a pure prompt/schema → response shim.
 */
export function singleShotFallback(
  question: QuestionContext,
  inventory: InventoryContext,
): Effect.Effect<AnswerOutput, AiErr, AiClientTag> {
  return Effect.gen(function* () {
    const ai = yield* AiClientTag;
    const schema = buildAnswerSchema(question.question_kind);
    const prompt = buildAnswerPrompt(question, inventory);
    // AiClient is responsible for retry / timeout / typed-error mapping —
    // the service just consumes the parsed object or propagates the AiErr.
    return yield* ai.generateObject({ schema, prompt });
  });
}
