# Agent-Driven Answer Generation — Design

**Date:** 2026-05-27
**Status:** spec
**Trigger:** [Roadmap Item 4](../ROADMAP.md). v1 of [Item 3 (pi-ai integration)](2026-05-26-pi-ai-llm-client-replacement.md) shipped a single-shot `ai.generateObject({schema, prompt})` for answer generation. The prompt dumps a pre-computed inventory summary into the context window, which doesn't scale (large customers have thousands of activities) and gives no audit trail — `source_summary` is the model's self-narration, not a verifiable path. Switching to a pi-agent-core-driven turn loop with read-only tools lets the model query specifics on demand and gives us a real decision trace.

## Goal

Replace `desktop/src/main/services/answer-generation/index.ts::generate(questionId, config)`'s single-shot LLM call with a pi-agent-core turn loop. The agent has a small set of read-only inventory tools (`list_activities`, `sum_co2e`, `list_emission_sources`, `get_emission_factor`, `read_questionnaire_context`) and uses them to fetch only what each question needs. Fallback to the existing single-shot path when the agent stalls or times out, with a clear marker in `source_summary`. Write an audit-event row per generation with turn count, tool-call summary, token usage, and duration.

Public API of `generate()` is **unchanged** — same signature, same return type, same error union. The "agent vs single-shot" choice is internal; callers (IPC handler, batch `generateAllUnanswered`) don't know or care.

## Architecture

```
┌─ src/main/services/answer-generation/ ──────────────────┐
│   index.ts           ← generate() entry; same signature │
│   agent-loop.ts      ← new: pi-agent-core orchestrator  │
│   tools.ts           ← new: 5 read-only tool defs       │
│   fallback.ts        ← extracted: existing single-shot  │
│                        path (now the fallback branch)   │
│   prompt.ts          ← extracted: prompt builders       │
│   audit.ts           ← new: agent_answer.generate row   │
│   tags.ts            ← existing + new AnswerAgentTag    │
│   errors.ts          ← existing                         │
└─────────────────────────────────────────────────────────┘
                          ↓ delegates to
┌─ src/main/llm/ai-agent.ts ──────────────────────────────┐  ← new (mirrors ai-client.ts style)
│   buildAiAgentLayer({config, credentials, tools})       │
│      → Layer<AiAgentTag>                                 │
│   AiAgent.run(prompt, schema, maxTurns?) →              │
│      Effect<{result, trace}, AiErr, never>              │
└─────────────────────────────────────────────────────────┘
                          ↓ wraps
┌─ @earendil-works/pi-agent-core ─────────────────────────┐
│   Agent class with state, tool exec, event stream       │
└─────────────────────────────────────────────────────────┘
```

The agent-vs-fallback decision lives entirely inside `generate()`:

```
generate(qid, config) →
  Effect.gen(function*() {
    const question = ...
    const inventory = ... (precomputed summary, same as today — fallback uses it)
    const result = yield* agentLoop(question, inventory, tools)
      .pipe(Effect.catchTags({
        AgentMaxTurns: () => fallbackSingleShot(question, inventory),
        AgentStalled:  () => fallbackSingleShot(question, inventory),
        AiTimeout:     () => fallbackSingleShot(question, inventory),
        // AiAuthError / AiProviderError NOT recovered here — those are
        // legit "user must fix" errors that bubble to the IPC handler.
      }))
    yield* recordAuditRow(qid, result)
    yield* writeAnswer(qid, result.answer, isFallback ? '【单 shot fallback】 ' + summary : summary)
  })
```

## Components

### `src/main/llm/ai-agent.ts` (new)

Thin Effect-wrapped layer over pi-agent-core, mirroring `ai-client.ts`'s pattern:

```ts
export interface AgentTrace {
  turnCount: number;
  toolCalls: Array<{ tool: string; argsHash: string; durationMs: number }>;
  totalTokens: { input: number; output: number };
  totalDurationMs: number;
  stopReason: 'completed' | 'max_turns' | 'stalled' | 'aborted';
}

export interface AiAgent {
  run<T>(args: {
    systemPrompt: string;
    userPrompt: string;
    schema: ZodSchema<T>;
    tools: AgentTool[];
    maxTurns?: number;       // default 6
    timeoutMs?: number;       // default 120_000
  }): Effect.Effect<{ result: T; trace: AgentTrace }, AiErr | AgentMaxTurns | AgentStalled, never>;
}

export class AiAgentTag extends Context.Tag('llm/AiAgent')<AiAgentTag, AiAgent>() {}

export function buildAiAgentLayer(deps: {
  config: ProviderConfigV2;
  credentials: CredentialService;
  overrideKey?: string;
}): Layer.Layer<AiAgentTag>;
```

Internal implementation:
- Constructs pi-agent-core `Agent` with the model + system prompt
- Registers each `AgentTool` as a pi-agent-core tool
- Forces the final answer to come through a `submit_response` tool (same trick as `ai.generateObject` — see `ai-client.ts` Task 2)
- Tracks turn count, tool-call list, token usage via `agent.subscribe(event)` event stream
- Maps pi-agent-core's failure modes to tagged errors:
  - max_turns reached → `AgentMaxTurns({turnCount, lastToolCall?})`
  - same tool with same args called twice in a row → `AgentStalled({tool, turnCount})`
  - timeout → `AiTimeout` (reuses Item 3 error)
  - HTTP errors → same `AiErr` mapping as `ai-client`

`AgentTool` shape:

```ts
export interface AgentTool {
  name: string;
  description: string;
  parameters: TSchema;   // TypeBox / JSON Schema (zod → z.toJSONSchema)
  execute: (args: unknown) => Promise<unknown>;
}
```

### `answer-generation/tools.ts` (new)

Five read-only tools. Each takes a `deps: { db, orgService, activityDataService, efService }` closure and returns an `AgentTool`:

```ts
buildAnswerTools(deps): AgentTool[] {
  return [
    {
      name: 'list_activities',
      description: 'List activity rows filtered by reporting year, scope, or emission source. Returns id, source name, period, amount, unit, co2e_kg. Max 50 rows; use filters to narrow.',
      parameters: Type.Object({
        year: Type.Optional(Type.Integer()),
        scope: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])),
        emission_source_id: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      }),
      execute: async (args) => deps.activityDataService.list({...}),
    },
    {
      name: 'sum_co2e',
      description: 'Aggregate co2e in kg across activities. Filter by year, scope, or emission_source_id. Returns {total_kg, count}.',
      parameters: Type.Object({...}),
      execute: async (args) => deps.activityDataService.sumCo2e({...}),
    },
    {
      name: 'list_emission_sources',
      description: 'List emission sources for the organization. Returns id, name, scope, category.',
      parameters: Type.Object({...}),
      execute: async () => deps.orgService.listEmissionSources(...),
    },
    {
      name: 'get_emission_factor',
      description: 'Look up the emission factor pinned to an activity. Returns the EF tuple plus name.',
      parameters: Type.Object({ activity_id: Type.String() }),
      execute: async (args) => deps.efService.getPinnedFor(args.activity_id),
    },
    {
      name: 'read_questionnaire_context',
      description: "Read the questionnaire's customer + reporting year + total question count. Use to ground the answer in the right organizational scope.",
      parameters: Type.Object({ questionnaire_id: Type.String() }),
      execute: async (args) => deps.qSvc.getContext(args.questionnaire_id),
    },
  ];
}
```

**No `submit_response` here** — that's the implicit tool the agent layer injects to coerce structured output.

Tool implementations are thin wrappers over existing service methods. Some service methods (`sumCo2e`, `listEmissionSources`) might need small additions to expose the right query shape.

### `answer-generation/agent-loop.ts` (new)

Composes `AiAgent` + tools + prompts. Returns the structured answer + trace:

```ts
export function runAgent(
  question: QuestionContext,
  inventory: InventoryContext,
  tools: AgentTool[],
): Effect.Effect<
  { answer: AnswerOutput; trace: AgentTrace },
  AiErr | AgentMaxTurns | AgentStalled,
  AiAgentTag
> {
  return Effect.gen(function* () {
    const agent = yield* AiAgentTag;
    const systemPrompt = buildAgentSystemPrompt(); // tells agent: "use tools to query inventory; answer using submit_response"
    const userPrompt = buildAnswerPrompt(question, inventory); // same as today but trimmed — no activity dump
    return yield* agent.run({
      systemPrompt,
      userPrompt,
      schema: answerOutputSchema, // {value, unit, source_summary}
      tools,
      maxTurns: 6,
      timeoutMs: 90_000,
    });
  });
}
```

Prompt strategy:
- **System**: "You are a carbon-accounting analyst. Use the provided tools to query the user's inventory; cite specific activity IDs and EF factor codes in source_summary. Don't fabricate numbers — every number must trace back to a tool result."
- **User**: question text + minimal inventory headline (year, activity_count, total_co2e_kg) — NOT the full activity dump

This shrinks the initial prompt significantly. Agent decides what to query.

### `answer-generation/fallback.ts` (new — extracted from current index.ts)

The existing single-shot logic moves here. Function signature:

```ts
export function singleShotFallback(
  question: QuestionContext,
  inventory: InventoryContext,
): Effect.Effect<AnswerOutput, AiErr, AiClientTag>;
```

Body is verbatim the current `ai.generateObject(...)` block. No behavior change.

### `answer-generation/audit.ts` (new)

```ts
export function recordAgentAuditRow(deps: {
  db: Database;
  questionId: string;
  result: { answer: AnswerOutput; trace: AgentTrace };
  isFallback: boolean;
  now: () => string;
}): Effect.Effect<void, never, never>;
```

Writes a row to `audit_event`:

```ts
{
  id: randomUUID(),
  event_kind: 'agent_answer.generate',
  payload: JSON.stringify({
    questionId,
    isFallback,           // true when the agent path failed and we used fallback
    turnCount: trace.turnCount,
    toolCallSummary: trace.toolCalls.map(c => c.tool),  // just names, not args
    tokens: trace.totalTokens,
    durationMs: trace.totalDurationMs,
    stopReason: trace.stopReason,
  }),
  occurred_at: now(),
}
```

**No prompt content** in the payload — only the decision path. This keeps the audit table compact + avoids leaking sensitive data.

### `answer-generation/index.ts` (modified)

Becomes the orchestrator:

```ts
export function generate(questionId: string, _config: ProviderConfigV2): Effect.Effect<Answer, GenErr, AnswerR> {
  return Effect.gen(function* () {
    const { db, orgService, activityDataService, efService, qSvc, now } = yield* getDeps();
    const question = yield* readQuestion(db, questionId);
    const existing = yield* readAnswerByQuestion(db, questionId);
    if (existing) return yield* Effect.fail(new QuestionAlreadyAnswered({ id: questionId }));

    const questionnaire = yield* readQuestionnaire(db, question.questionnaire_id);
    const inventory = loadInventoryContext(orgService, activityDataService, questionnaire.reporting_year);
    if (inventory.activity_count === 0) {
      return yield* Effect.fail(new InventoryEmpty({ year: questionnaire.reporting_year }));
    }

    const tools = buildAnswerTools({ db, orgService, activityDataService, efService, qSvc });

    let isFallback = false;
    const out = yield* runAgent(toQuestionCtx(question), inventory, tools).pipe(
      Effect.catchTags({
        AgentMaxTurns: () => { isFallback = true; return singleShotFallback(toQuestionCtx(question), inventory).pipe(Effect.map(r => ({ answer: r, trace: emptyTrace('fallback_max_turns') }))); },
        AgentStalled:  () => { isFallback = true; return singleShotFallback(...).pipe(...); },
        AiTimeout:     () => { isFallback = true; return singleShotFallback(...).pipe(...); },
      }),
    );

    yield* recordAgentAuditRow({ db, questionId, result: out, isFallback, now });

    const finalSummary = isFallback ? `【单 shot fallback】 ${out.answer.source_summary}` : out.answer.source_summary;
    return yield* writeAnswer(db, { ...out.answer, source_summary: finalSummary, question_id: questionId, generated_at: now() });
  });
}
```

## Data flow

```
1. IPC handler `answer:generate` invoked
2. generate(questionId, config)
   ├─ Load question + questionnaire + inventory headline (precomputed totals only)
   ├─ Build 5 read-only tools (closures over services)
   ├─ Try runAgent(question, inventory, tools)  → AgentTrace + AnswerOutput
   │   ├─ Agent.prompt(userPrompt, systemPrompt, tools)
   │   ├─ pi-agent-core turn loop:
   │   │   - Turn 1: agent calls list_activities(year, scope)
   │   │   - Turn 2: agent calls sum_co2e(...)
   │   │   - Turn 3: agent calls submit_response({value, unit, source_summary})
   │   ├─ subscribe() collects trace (turn count, tool names, token usage, duration)
   │   └─ Returns AnswerOutput + AgentTrace
   ├─ (Or, on AgentMaxTurns / AgentStalled / AiTimeout)
   │   └─ singleShotFallback(question, inventory) → AnswerOutput (no trace)
   ├─ recordAgentAuditRow(...)  → audit_event row
   └─ writeAnswer(...)  → answer table row

3. IPC handler returns Answer to renderer
```

## Out of scope (v1)

- ❌ Write tools (`write_answer`, `pin_emission_factor`) — agent stays read-only
- ❌ Cross-question / batch-answer agent — single-question scope only
- ❌ External tools (online EF lookup, web search) — only local-DB tools
- ❌ Streaming UI for agent turns (could show "thinking… calling list_activities…" but v1 stays simple, single spinner)
- ❌ Agent-trace UI surface (the `audit_event` rows are present but no in-app viewer; CLI / SQL only)
- ❌ Cost reporting (token usage IS captured per trace but no UI rollup)
- ❌ Generic multi-tenant agent service — agent is purposed for answer-gen only
- ❌ Resuming a failed agent run (start fresh each call)
- ❌ User correction round-trip (agent doesn't ask user; user can always edit the final answer manually as today)

## Risks

| Risk | Mitigation |
|---|---|
| pi-agent-core 0.x API changes | Pin via caret range, wrap in `ai-agent.ts` so consumer call sites are stable |
| Agent loops on the same query (stalled detection imprecise) | Detect via "same tool + identical args repeated"; cap maxTurns at 6 default; fallback always available |
| Tool execution throws → agent confused | tools return `{ok:false, error}` shape on failure; agent sees error, can retry differently |
| Token usage spikes per answer | Trace records totalTokens; v1.x can hard-cap or warn |
| Large `list_activities` result blows context | Default limit 50; agent must filter — system prompt explicitly tells it so |
| Audit event payload too big | Only tool names, not args — args could be sensitive (filter values from user's data) |
| Fallback double-counts inventory loading | Inventory is loaded once at top of `generate()` and passed to both branches |

## Testing

### Unit — `tests/main/llm/ai-agent.test.ts` (new)

Faux pi-agent-core (or mock the turn loop):
- Single tool call → submit_response → returns parsed result + trace
- Max turns exceeded → `AgentMaxTurns` failure
- Same tool + args twice → `AgentStalled` failure
- Tool execution throws → agent receives error in toolResult, can recover
- 401 / 429 / 5xx through underlying pi-ai → `AiErr` subtypes
- Token usage accumulates across turns

### Unit — `tests/main/services/answer-generation/agent-loop.test.ts` (new)

- runAgent returns AnswerOutput when agent completes normally
- AgentMaxTurns propagates (caller handles fallback)

### Unit — `tests/main/services/answer-generation/tools.test.ts` (new)

For each of 5 tools: mock the underlying service, verify the tool's execute() returns the expected shape; verify the tool's parameter schema matches what's documented.

### Integration — `tests/main/services/answer-generation-service.test.ts` (existing — updated)

Two scenarios:
1. Agent succeeds → answer written with source_summary from agent; audit row recorded with turnCount ≥ 1
2. Agent times out → fallback path used; source_summary prefixed `【单 shot fallback】`; audit row recorded with isFallback: true

### Manual smoke (added to spec)

```
1. Generate one answer on a real customer's questionnaire → verify Agent loop actually queries (DevTools network or audit row)
2. Force fallback: set maxTurns=1 in env override → verify the answer still lands, source_summary is prefixed
3. Verify audit_event has agent_answer.generate row with reasonable token/duration values
4. Generate batch (generateAllUnanswered) for a small questionnaire → all answers complete; total time within reasonable bound
```

### Verified smoke run

| Date | Builder | Platform | 1 (agent runs) | 2 (fallback works) | 3 (audit row) | 4 (batch) |
|---|---|---|---|---|---|---|
| | | | | | | |

## References

- [Roadmap Item 4](../ROADMAP.md)
- [Item 3 spec (AiClient pattern reference)](2026-05-26-pi-ai-llm-client-replacement.md)
- [pi-agent-core README](https://github.com/earendil-works/pi/tree/main/packages/agent)
- [`ai-client.ts`](../../desktop/src/main/llm/ai-client.ts) — Effect-wrap + Layer pattern reference
- [`amap-client.ts`](../../desktop/src/main/services/routing/amap-client.ts) — Style B Effect service pattern
