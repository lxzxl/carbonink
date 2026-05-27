# Agent-Driven Answer Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `answer-generation/index.ts::generate()` from a single-shot `ai.generateObject` call to a pi-agent-core turn loop with 5 read-only inventory tools. Same public API. Fallback to existing single-shot path on `AgentMaxTurns` / `AgentStalled` / `AiTimeout`. Audit row per call.

**Architecture:** New `src/main/llm/ai-agent.ts` (Effect-wrapped pi-agent-core, mirrors `ai-client.ts`). `answer-generation/` splits into `agent-loop.ts` + `tools.ts` + `fallback.ts` (extracted from current index.ts) + `audit.ts` + thinned-down `index.ts` orchestrator.

**Tech stack increment:** + `@earendil-works/pi-agent-core` dep. No other new deps.

**Spec:** [docs/specs/2026-05-27-pi-agent-answer-generation.md](../specs/2026-05-27-pi-agent-answer-generation.md)

**Scope:**
- ✅ AiAgent Effect service (parallel to AiClient)
- ✅ 5 read-only tools: list_activities / sum_co2e / list_emission_sources / get_emission_factor / read_questionnaire_context
- ✅ Single-question scope (signature unchanged)
- ✅ Fallback to single-shot with `【单 shot fallback】` source_summary prefix
- ✅ Audit event `agent_answer.generate` per call (no prompt content, only path)
- ❌ Write tools / cross-question batch / external tools / streaming UI / agent-trace viewer (out of v1)

**Verification gate (every task):**
```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check <changed files>
```

---

## File structure

**New:**
- `src/main/llm/ai-agent.ts` + `tests/main/llm/ai-agent.test.ts`
- `src/main/services/answer-generation/tools.ts` + test
- `src/main/services/answer-generation/agent-loop.ts` + test
- `src/main/services/answer-generation/fallback.ts` (extracted, no new tests; covered via integration)
- `src/main/services/answer-generation/audit.ts` + test
- `src/main/services/answer-generation/prompt.ts` (extracted prompt builders)

**Modified:**
- `src/main/services/answer-generation/index.ts` (orchestrator-only)
- `src/main/services/answer-generation/tags.ts` (add AiAgentTag re-export)
- `src/main/services/answer-generation/errors.ts` (add AgentMaxTurns, AgentStalled)
- `src/main/ipc/context.ts` (build AiAgentLayer alongside AiClientLayer)
- `desktop/package.json` (add pi-agent-core)
- `desktop/electron.vite.config.ts` (exclude pi-agent-core from externalize — pi-ai sibling)
- Possibly: existing service methods may need new query shapes (sumCo2e by scope, etc)

**Tests modified:**
- `tests/main/services/answer-generation-service.test.ts` (mock AiAgent instead of AiClient for agent path; keep AiClient mock for fallback assertions)

---

## Types

Defined in `ai-agent.ts` (and re-exported to consumers):

```ts
export interface AgentTool {
  name: string;
  description: string;
  parameters: TSchema;  // TypeBox / JSON Schema
  execute: (args: unknown) => Promise<unknown>;
}

export interface AgentTrace {
  turnCount: number;
  toolCalls: Array<{ tool: string; argsHash: string; durationMs: number }>;
  totalTokens: { input: number; output: number };
  totalDurationMs: number;
  stopReason: 'completed' | 'max_turns' | 'stalled' | 'aborted';
}

export class AgentMaxTurns extends Data.TaggedError('AgentMaxTurns')<{
  turnCount: number;
  lastTool?: string;
}> {}

export class AgentStalled extends Data.TaggedError('AgentStalled')<{
  tool: string;
  turnCount: number;
}> {}

export interface AiAgent {
  run<T>(args: {
    systemPrompt: string;
    userPrompt: string;
    schema: ZodSchema<T>;
    tools: AgentTool[];
    maxTurns?: number;
    timeoutMs?: number;
  }): Effect.Effect<
    { result: T; trace: AgentTrace },
    AiErr | AgentMaxTurns | AgentStalled,
    never
  >;
}
```

---

### Task 1: AiAgent scaffold + dep + Layer + errors

**Files:**
- Modify: `desktop/package.json` (add `@earendil-works/pi-agent-core`)
- Modify: `desktop/electron.vite.config.ts` (exclude pi-agent-core from externalize, mirror pi-ai)
- Create: `desktop/src/main/llm/ai-agent.ts` (scaffold + types + Tag + Layer skeleton; `run()` stubbed to `Effect.die("Task 2")`)
- Create: `desktop/tests/main/llm/ai-agent.test.ts` (Tag/Layer wiring smoke)

- [ ] **Step 1: Install dep**

```bash
cd /Users/lxz/ws/personal/carbonbook/desktop
pnpm add @earendil-works/pi-agent-core
```

Pin to current minor. Verify the installed version matches pi-ai's major (both 0.75.x).

- [ ] **Step 2: Exclude from externalize**

In `desktop/electron.vite.config.ts`, the existing `externalizeDepsPlugin({ exclude: ['@earendil-works/pi-ai'] })` (in both `main` and `preload`) gets `'@earendil-works/pi-agent-core'` appended.

- [ ] **Step 3: Build to verify the bundling works**

```bash
pnpm --filter carbonink exec electron-vite build
```

Expected: succeeds without ESM/CJS errors. Bundle may grow modestly.

- [ ] **Step 4: Write the scaffold test**

Smoke test the Layer + Tag wiring. The `run()` stub should throw `Effect.die("Task 2")` so the test pattern is "build layer + yield Tag + assert it's the AiAgent shape".

- [ ] **Step 5: Implement scaffold**

```ts
// src/main/llm/ai-agent.ts
import { Context, Effect, Layer } from 'effect';
import { Data } from 'effect';
// imports from pi-agent-core
import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfigV2 } from '@shared/types.js';
import type { AiErr } from './errors.js';

export class AgentMaxTurns extends Data.TaggedError('AgentMaxTurns')<{...}> {}
export class AgentStalled extends Data.TaggedError('AgentStalled')<{...}> {}

export interface AgentTool {...}
export interface AgentTrace {...}
export interface AiAgent {...}
export class AiAgentTag extends Context.Tag('llm/AiAgent')<AiAgentTag, AiAgent>() {}

export function buildAiAgentLayer(deps: {
  config: ProviderConfigV2;
  credentials: CredentialService;
  overrideKey?: string;
}): Layer.Layer<AiAgentTag> {
  // Stub: returns a layer whose run() Effect.dies
}
```

- [ ] **Step 6: Verification + commit**

```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check src/main/llm/ai-agent.ts tests/main/llm/ai-agent.test.ts desktop/package.json desktop/electron.vite.config.ts
```

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/package.json pnpm-lock.yaml desktop/electron.vite.config.ts desktop/src/main/llm/ai-agent.ts desktop/tests/main/llm/ai-agent.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "$(cat <<'EOF'
feat(ai-agent): scaffold Effect-wrapped pi-agent-core + tagged errors

Mirrors ai-client.ts pattern. AiAgent.run() stubbed to Effect.die so
Task 2 wires the actual turn loop. AgentMaxTurns + AgentStalled tagged
errors join the AiErr family. pi-agent-core added as dep + excluded
from externalize (same ESM-only bundling as pi-ai).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: AiAgent.run() implementation

**Files:**
- Modify: `desktop/src/main/llm/ai-agent.ts`
- Modify: `desktop/tests/main/llm/ai-agent.test.ts`

Wire pi-agent-core's `Agent` class. Key parts:
- Convert each `AgentTool` to pi-agent-core's tool shape
- Inject the `submit_response` tool (forces structured output via the user's zod schema)
- Subscribe to events; collect turnCount, toolCalls, tokens, duration
- Detect stalled: same `tool + JSON.stringify(args)` repeated
- Apply maxTurns + timeoutMs caps
- Map pi-agent-core's failure modes to AgentMaxTurns / AgentStalled / AiTimeout / AiErr

- [ ] **Step 1: Write failing tests** covering:
  - happy path (3-turn agent ending with submit_response → parsed result)
  - max turns reached → AgentMaxTurns
  - same tool+args twice → AgentStalled
  - schema mismatch in submit_response → AiSchemaMismatch
  - tool execution throws → recovers (agent gets error in toolResult)
  - timeout → AiTimeout

- [ ] **Step 2: Implement using pi-agent-core's Agent class**

- [ ] **Step 3: All tests pass**

- [ ] **Step 4: Verification + commit**

```
feat(ai-agent): turn loop with tool execution + trace tracking

Wires @earendil-works/pi-agent-core Agent. submit_response tool
coerces structured output via zod schema (same trick as AiClient).
Stalled detection compares tool + argsHash across turns.
maxTurns + timeoutMs caps; pi-agent-core failures mapped to
AgentMaxTurns / AgentStalled / AiTimeout. Token usage + tool-call
list accumulated via agent.subscribe(event).
```

---

### Task 3: Answer-generation tools.ts

**Files:**
- Create: `desktop/src/main/services/answer-generation/tools.ts`
- Create: `desktop/tests/main/services/answer-generation/tools.test.ts`

5 read-only tools. For each:
- Define TSchema parameters (TypeBox or zod-converted JSON Schema)
- Implement `execute()` as thin wrapper over existing service methods
- Test verifies parameter shape + execute() returns expected shape

Some service methods may need new query overloads:
- `ActivityDataService.list({year?, scope?, emission_source_id?, limit?})` — check if exists; add if missing
- `ActivityDataService.sumCo2e({year?, scope?, emission_source_id?})` — likely needs to be added
- `OrganizationService.listEmissionSources(organization_id)` — check existing
- `EfService.getPinnedFor(activity_id)` — check existing
- `QuestionnaireService.getContext(questionnaire_id)` — read row + count questions

If a service method needs to be added/extended, do it minimally in this task.

- [ ] **Step 1: Audit existing service methods** — `grep -n "list\|sum\|count" desktop/src/main/services/{activity-data,organization,ef,questionnaire}-service.ts` to see what exists
- [ ] **Step 2: Add any missing service methods** + their unit tests
- [ ] **Step 3: Write tools.ts** + 5 tests
- [ ] **Step 4: Verification + commit**

```
feat(answer-gen): 5 read-only inventory tools for agent loop

list_activities, sum_co2e, list_emission_sources,
get_emission_factor, read_questionnaire_context. Each tool is
a thin wrapper over existing service methods (with [N] new methods
added for query shapes the agent needs). TypeBox parameter schemas
keep the agent honest about the inputs.
```

---

### Task 4: agent-loop.ts orchestrator

**Files:**
- Create: `desktop/src/main/services/answer-generation/agent-loop.ts`
- Create: `desktop/src/main/services/answer-generation/prompt.ts` (extracted prompt builders from current index.ts)
- Create: `desktop/tests/main/services/answer-generation/agent-loop.test.ts`

`runAgent(question, inventory, tools)` returns Effect with both AnswerOutput + AgentTrace.

System prompt + user prompt move into prompt.ts. User prompt is **trimmed** — only headline inventory data (year, activity_count, total_co2e_kg), no activity dump.

- [ ] Test: runAgent happy path → mocked AiAgent returns answer + trace
- [ ] Test: AgentMaxTurns propagates
- [ ] Commit

```
feat(answer-gen): agent-loop orchestrator + prompt extraction

Composes AiAgent + the 5 tools. New trimmed user prompt skips the
activity dump — agent queries on demand via list_activities. System
prompt instructs cite-via-tool-result discipline. prompt.ts holds
both builders; agent-loop.ts orchestrates the call.
```

---

### Task 5: fallback.ts (extracted single-shot)

**Files:**
- Create: `desktop/src/main/services/answer-generation/fallback.ts`

Move the existing single-shot `ai.generateObject({schema, prompt})` block from index.ts. Verbatim — no behavior change. Same prompt template (re-uses `buildAnswerPrompt` from prompt.ts).

- [ ] Extract function `singleShotFallback(question, inventory): Effect<AnswerOutput, AiErr, AiClientTag>`
- [ ] No new tests (this code's behavior is unchanged; integration test in Task 8 covers fallback path)
- [ ] Commit

```
refactor(answer-gen): extract single-shot path into fallback.ts

No behavior change — same buildAnswerPrompt + ai.generateObject.
Lifts the existing single-shot LLM call out of index.ts so Task 7
can wire it as the agent-loop fallback branch.
```

---

### Task 6: audit.ts

**Files:**
- Create: `desktop/src/main/services/answer-generation/audit.ts`
- Create: `desktop/tests/main/services/answer-generation/audit.test.ts`

`recordAgentAuditRow(deps)` writes to `audit_event` table.

Payload shape (no prompt content):
```ts
{
  questionId,
  isFallback,
  turnCount,
  toolCallSummary: trace.toolCalls.map(c => c.tool),
  tokens,
  durationMs,
  stopReason,
}
```

- [ ] Test: audit row written with expected event_kind + payload shape
- [ ] Commit

```
feat(answer-gen): audit row for each agent_answer.generate

audit_event row carries decision path only — no prompt content. Tool
calls reduced to names (args could be sensitive). isFallback flag
distinguishes agent-path from fallback-path generations.
```

---

### Task 7: index.ts rewrite as orchestrator

**Files:**
- Modify: `desktop/src/main/services/answer-generation/index.ts`
- Modify: `desktop/src/main/services/answer-generation/tags.ts` (add AiAgentTag dependency)
- Modify: `desktop/src/main/services/answer-generation/errors.ts` (add AgentMaxTurns, AgentStalled to GenErr union)
- Modify: `desktop/src/main/ipc/context.ts` (build AiAgentLayer alongside AiClientLayer; provide both to AnswerLayer)

Replaces the body of `generate()` with the orchestrator described in the spec:
- load question + inventory
- try runAgent → AnswerOutput + AgentTrace
- on AgentMaxTurns / AgentStalled / AiTimeout → fallback path; mark isFallback
- record audit
- write answer with `【单 shot fallback】` prefix on source_summary if fallback

- [ ] Update existing service test mocks (AiAgent stub for happy path; AiClient stub for fallback path)
- [ ] Test: fallback wiring fires when AgentMaxTurns thrown
- [ ] Test: audit row matches scenario (isFallback flag toggles)
- [ ] Verification + commit

```
refactor(answer-gen): index.ts is orchestrator-only — agent + fallback + audit

Try the agent loop first; fall back to single-shot on AgentMaxTurns /
AgentStalled / AiTimeout. Audit row recorded per call. source_summary
gets [single-shot fallback] prefix when fallback path used so audit
trail is human-readable. Public API (generate signature) unchanged.
```

---

### Task 8: Test consolidation + service integration

**Files:**
- Modify: `desktop/tests/main/services/answer-generation-service.test.ts`

Update existing tests to cover:
- Agent path happy: mock AiAgent returns success → answer written, audit row present, no fallback prefix
- Fallback path: mock AiAgent rejects with AgentMaxTurns → fallback called, audit row has isFallback: true, source_summary has prefix
- AiAuthError surfaces from agent path (does NOT fallback — bubbles up to caller)
- generateAllUnanswered loop still works (calls generate per question)

- [ ] All tests pass; integration shows both agent & fallback paths covered
- [ ] Commit

```
test(answer-gen): integration coverage for agent + fallback paths

Tests mock AiAgent + AiClient separately to exercise both branches.
generateAllUnanswered loop verified to delegate per-question without
agent-state cross-contamination.
```

---

### Task 9: Manual smoke (USER ACTION)

After Task 8 lands, restart dev. Walk through:

1. Open a real questionnaire → click Generate on a single question → wait → answer appears, source_summary references specific activity IDs (sign that agent queried via list_activities)
2. Force fallback: set `ANSWER_AGENT_MAX_TURNS=1` env var via dev terminal → restart → re-generate → answer's source_summary should be prefixed `【单 shot fallback】`
3. SQL check: `sqlite3 ~/Library/Application\ Support/CarbonInk/app.sqlite "SELECT event_kind, payload FROM audit_event WHERE event_kind = 'agent_answer.generate' ORDER BY occurred_at DESC LIMIT 3;"`
4. Batch generation: click "Generate all unanswered" on a small questionnaire (3-5 questions) → all complete within ~2 min; each gets its own audit row

Fill the result into the spec's Verified Smoke Run table. Commit.

---

## Definition of Done

- All 8 implementer tasks committed
- `pnpm test` passes (baseline 779 ± 20)
- `pnpm typecheck` clean
- `pnpm exec biome check <changed files>` clean
- `pnpm dist:mac` produces DMGs
- Manual smoke 4 steps verified
- `audit_event` has `agent_answer.generate` rows after generation
- Fallback verified by forcing maxTurns=1

## Known follow-ups (out of v1)

- Write tools (`write_answer`, `pin_emission_factor`)
- Agent-trace viewer in audit UI
- Token-cost rollup display
- Streaming UI for agent turns
- Cross-question agent (sees whole questionnaire)
- External tools (EF database, web search)
