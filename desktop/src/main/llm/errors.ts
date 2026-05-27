import { Data } from 'effect';

/**
 * Tagged-error union for all `AiClient` failures.
 *
 * Each subclass extends `Data.TaggedError` so consumers can pattern-match
 * with `Effect.catchTag('AiAuthError', ...)` etc. Keep the payload small and
 * actionable — these are surfaced into the IPC layer's sanitize step before
 * reaching the renderer.
 *
 * Why a flat union (not a single error class with a discriminant): the Effect
 * type system can narrow on `_tag`, so `Effect.Effect<T, AiAuthError | AiNoData, never>`
 * is a strictly more useful type than `Effect.Effect<T, AiErr, never>` when
 * only a subset of failure modes is possible.
 */

/** Provider rejected the request because the API key is missing or invalid (HTTP 401/403). */
export class AiAuthError extends Data.TaggedError('AiAuthError')<{ provider: string }> {}

/** Provider returned HTTP 429. `retryAfter` is seconds when the provider sends a Retry-After header. */
export class AiRateLimited extends Data.TaggedError('AiRateLimited')<{ retryAfter?: number }> {}

/**
 * Provider returned a response that did not match the requested zod schema.
 * `raw` carries the raw JSON-stringified payload (truncated by caller if needed)
 * so the UI can show a useful preview without re-running the request.
 */
export class AiSchemaMismatch extends Data.TaggedError('AiSchemaMismatch')<{
  raw: string;
  cause?: unknown;
}> {}

/** Request exceeded `timeoutMs`. The Effect was interrupted before a response arrived. */
export class AiTimeout extends Data.TaggedError('AiTimeout')<{ timeoutMs: number }> {}

/**
 * Provider returned a 2xx response, but the assistant message contained no
 * tool-call / no parsable content. Distinct from `AiSchemaMismatch` (which
 * means content was present but malformed) so the caller can decide whether
 * to retry, fall back, or surface differently.
 */
export class AiNoData extends Data.TaggedError('AiNoData')<Record<string, never>> {}

/**
 * Catch-all for non-auth HTTP failures (5xx, network errors, malformed responses).
 * `status` is filled in when the failure originated from an HTTP status code;
 * `cause` carries the underlying error/payload for logging.
 */
export class AiProviderError extends Data.TaggedError('AiProviderError')<{
  status?: number;
  cause?: unknown;
}> {}

/** Union of every error `AiClient` methods may produce. */
export type AiErr =
  | AiAuthError
  | AiRateLimited
  | AiSchemaMismatch
  | AiTimeout
  | AiNoData
  | AiProviderError;

// ---------------------------------------------------------------------------
// AiAgent tagged errors (Item 4)
// ---------------------------------------------------------------------------
//
// These flow alongside `AiErr` through `AiAgent.run()`'s signature — they are
// NOT part of the `AiErr` union because they're agent-loop concerns (turn
// budget, no-progress detection) rather than per-request provider failures.
// Consumers handle them via
// `Effect.catchTags({AgentMaxTurns: ..., AgentStalled: ..., AiTimeout: ...})`.

/**
 * The agent loop reached its `maxTurns` budget without producing a final
 * answer. `turnCount` is the number of completed assistant turns; `lastTool`
 * is the name of the most recently invoked tool, useful for surfacing what
 * the model was attempting when the budget ran out.
 */
export class AgentMaxTurns extends Data.TaggedError('AgentMaxTurns')<{
  turnCount: number;
  lastTool?: string;
}> {}

/**
 * The agent loop detected a no-progress pattern (e.g. the same tool invoked
 * with structurally identical arguments across consecutive turns) and gave
 * up rather than burn the rest of its turn budget on a loop. `tool` carries
 * the offending tool name; `turnCount` is the turn at which the stall was
 * detected.
 */
export class AgentStalled extends Data.TaggedError('AgentStalled')<{
  tool: string;
  turnCount: number;
}> {}
