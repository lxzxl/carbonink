import { randomUUID } from 'node:crypto';
import type { AgentTrace } from '@main/llm/ai-agent.js';
import type { Database } from 'better-sqlite3';
import { Effect } from 'effect';

export interface RecordAgentAuditDeps {
  db: Database;
  questionId: string;
  isFallback: boolean;
  trace: AgentTrace;
  now: () => string;
}

/**
 * Write one `agent_answer.generate` audit row per generate() call.
 *
 * Payload deliberately carries the decision path, not the prompt or
 * answer content:
 *   - questionId: links back to the answered question
 *   - isFallback: did the agent path fail and we used single-shot?
 *   - turnCount: how many turns the agent ran (0 for pure-fallback)
 *   - toolCallSummary: ordered list of tool NAMES (not args — args can
 *     contain sensitive user-data filter values)
 *   - tokens: input/output budget consumed
 *   - durationMs: total wall-clock
 *   - stopReason: completed / max_turns / stalled / aborted
 *
 * The row is for human triage + observability, not for compliance.
 */
export function recordAgentAudit(deps: RecordAgentAuditDeps): Effect.Effect<void, never, never> {
  return Effect.sync(() => {
    const payload = {
      questionId: deps.questionId,
      isFallback: deps.isFallback,
      turnCount: deps.trace.turnCount,
      toolCallSummary: deps.trace.toolCalls.map((c) => c.tool),
      tokens: deps.trace.totalTokens,
      durationMs: deps.trace.totalDurationMs,
      stopReason: deps.trace.stopReason,
    };
    deps.db
      .prepare(`INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`)
      .run(randomUUID(), 'agent_answer.generate', JSON.stringify(payload), deps.now());
  });
}
