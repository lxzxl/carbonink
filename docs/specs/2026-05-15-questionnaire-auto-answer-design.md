# Questionnaire Auto-Answer + Review (Phase 2.2b) Design

**Date:** 2026-05-15
**Sub-project:** Phase 2.2b — second slice of Phase 2 main
**Predecessor:** Phase 2.2a (questionnaire upload + parse + extract) at `e082d3a`
**Successor:** Phase 2.2c (Excel write-back + export)
**Special:** First production code written in **Effect TS** — this sub-project lands Effect Step 1 patterns (`Effect.gen`, `Data.TaggedError`, `Effect.catchTag`) inside one service. Steps 2 (Layer + Context.Tag) and 3 (retry + concurrent forEach) follow as targeted refactors AFTER 2.2b ships.

## Goal

User opens a questionnaire's detail page → for each unanswered question, system auto-generates an answer from the inventory data + the question text → user reviews per-question + edits + confirms. Status transitions `mapping → answering`. Phase 2.2c reads the `answer` table to write back into the Excel.

**Scope guard (carried from 2.2a's brainstorm):**
- **Numerical questions only.** Categorical / narrative deferred.
- **One customer at a time.** No cross-customer mapping reuse via `question_mapping` table yet.
- **`source_kind = 'ai_suggested'`** for every auto-generated answer (the manual / mapped_inventory paths are Phase 2.x).

## Non-goals

- Excel write-back (Phase 2.2c).
- Mapping reuse / `question_mapping` table inserts (Phase 2.3+).
- Categorical / narrative question kinds.
- `narrative_bank` + `company_profile` integration (Phase 2.3+).
- Streaming responses or partial answer rendering.
- Multi-questionnaire batch operations.
- Effect TS **Layer/Context.Tag** wiring — that's Step 2, a separate refactor of THIS service after it lands.
- Effect TS **retry** and **concurrent forEach** — that's Step 3.

## Current state (relevant audit)

- **Schema (already migrated, 005):**
  - `answer` table: `id, question_id (UNIQUE), value, unit, source_kind, source_*_id, source_summary, finalized_at`. CHECK constraint enforces exactly one of the four `source_*_id` columns can be set (or none, for fully manual / AI-only with no inventory grounding).
- **Phase 2.2a output:** A questionnaire ends up in status `mapping` with N `question` rows (kind = `numerical`, position = cell ref).
- **Inventory side:**
  - `activity_data` table — what the user has confirmed during Phase 1 reviews.
  - `calculation_snapshot` table — aggregated CO2e per period/scope.
  - `emission_source` — the source rows the activity_data attaches to.
- **Effect TS:** `effect@3.21.2` installed (Step 0). Adoption rules in `docs/research/2026-05-15-effect-ts-adoption.md`.

## Architecture

```
┌─ Renderer ────────────────────────────────────────────────────────────┐
│  /questionnaires/$id (existing route)                                 │
│  ├─ status='mapping' → AnswerReviewPage (NEW)                         │
│  │   ├─ For each question:                                            │
│  │   │   ├─ "Generate answer" button (or auto on mount)               │
│  │   │   ├─ Show LLM-generated value / unit / source_summary          │
│  │   │   ├─ Editable value + unit + finalize-on-edit                  │
│  │   │   └─ Per-row "Save" → answer:save(question_id, value, unit)    │
│  │   └─ Page-level "Mark answering complete" → status -> 'answering'  │
│  └─ status='answering' → same UI, finalized rows highlighted          │
└───────────────────────────────────────────────────────────────────────┘
                              │ IPC
                              ▼
┌─ Main ────────────────────────────────────────────────────────────────┐
│  IPC handlers (zod-validated; Effect.runPromise boundary):            │
│  ├─ answer:generate(question_id) → AnswerGenerationService.generate   │
│  ├─ answer:save({question_id, value, unit, finalized}) → service      │
│  ├─ answer:list-by-questionnaire(qid) → service                       │
│  └─ questionnaire:finalize(qid) → status='answering' (or 'exported'   │
│                                    in 2.2c)                           │
│                                                                       │
│  AnswerGenerationService (Effect-based):                              │
│     class AnswerGenerationService {                                   │
│       constructor(deps: { db, llmClient, config, now })               │
│                                                                       │
│       generate(questionId): Effect<Answer, GenErr, never>             │
│       save(input): Effect<Answer, SaveErr, never>                     │
│       listByQuestionnaire(qid): Effect<Answer[], never, never>        │
│     }                                                                 │
└───────────────────────────────────────────────────────────────────────┘
```

The IPC handler is the **Effect boundary**:

```ts
'answer:generate': async (input) => {
  const parsed = idSchema.parse(input);
  const program = ctx.answerGenerationService.generate(parsed.question_id);
  // Single point of contact between Promise-world and Effect-world.
  return await Effect.runPromise(program);
}
```

If the Effect fails, the rejection propagates as a normal IPC error. Renderer's TanStack Query handles it like any other failed mutation.

## Component design

### `AnswerGenerationService` — the Effect service

File: `src/main/services/answer-generation-service.ts`

**Constructor (Step 1 style — plain DI, no Context.Tag yet):**

```ts
import { Effect, Data } from 'effect';

export class AnswerGenerationService {
  constructor(
    private readonly deps: {
      db: Database;
      llmClient: LLMClient;
      activityDataService: ActivityDataService;
      calculationService: CalculationService;
      config: ProviderConfig;
      now?: () => string;
    },
  ) {}

  generate(questionId: string): Effect.Effect<Answer, GenErr, never> { /* ... */ }
  save(input: SaveInput): Effect.Effect<Answer, SaveErr, never> { /* ... */ }
  listByQuestionnaire(qid: string): Effect.Effect<Answer[], never, never> { /* ... */ }
}
```

Note the return types `Effect<A, E, never>` — `never` means "no Context dependencies". Step 2 will change `never` to `LLMService | DbService | ...` (Context.Tag-based). This Step-1 service has dependencies bundled in `deps`, so the Effect type doesn't carry them.

**Typed errors (`Data.TaggedError`):**

```ts
class QuestionNotFound extends Data.TaggedError('QuestionNotFound')<{ id: string }> {}
class QuestionAlreadyAnswered extends Data.TaggedError('QuestionAlreadyAnswered')<{ id: string }> {}
class QuestionnaireNotFound extends Data.TaggedError('QuestionnaireNotFound')<{ id: string }> {}
class InventoryEmpty extends Data.TaggedError('InventoryEmpty')<{ year: number }> {}
class LLMSchemaMismatch extends Data.TaggedError('LLMSchemaMismatch')<{ raw: string }> {}
class LLMCallFailed extends Data.TaggedError('LLMCallFailed')<{ cause: unknown }> {}
class ProviderNotConfigured extends Data.TaggedError('ProviderNotConfigured')<{}> {}

type GenErr =
  | QuestionNotFound
  | QuestionAlreadyAnswered
  | QuestionnaireNotFound
  | InventoryEmpty
  | LLMSchemaMismatch
  | LLMCallFailed
  | ProviderNotConfigured;
```

Each error is a class with a `_tag` discriminator and structured payload. `Effect.catchTag('QuestionNotFound', handler)` matches by `_tag`. No `instanceof` fragility.

**`generate(questionId)` body — the orchestration in `Effect.gen`:**

```ts
generate(questionId: string): Effect.Effect<Answer, GenErr, never> {
  const self = this;
  return Effect.gen(function* () {
    // 1. Look up the question. Idempotency: if an answer already exists
    //    we short-circuit (the caller can use 'save' to update).
    const question = yield* readQuestion(self.deps.db, questionId);

    const existing = yield* readAnswerByQuestion(self.deps.db, questionId);
    if (existing) {
      return yield* Effect.fail(new QuestionAlreadyAnswered({ id: questionId }));
    }

    // 2. Find the questionnaire to know which reporting year + customer.
    const questionnaire = yield* readQuestionnaire(self.deps.db, question.questionnaire_id);

    // 3. Build the inventory context for that year.
    const inventory = yield* loadInventoryContext(
      self.deps.activityDataService,
      self.deps.calculationService,
      questionnaire.reporting_year,
    );
    if (inventory.activity_count === 0) {
      return yield* Effect.fail(new InventoryEmpty({ year: questionnaire.reporting_year }));
    }

    // 4. Call the LLM. tryPromise lifts the Promise-based AI SDK into Effect-land.
    const llmResult = yield* Effect.tryPromise({
      try: () => self.deps.llmClient.generateAnswer(self.deps.config, question, inventory),
      catch: (cause) =>
        cause instanceof ProviderNotConfiguredError
          ? new ProviderNotConfigured({})
          : cause instanceof SchemaMismatchError
            ? new LLMSchemaMismatch({ raw: cause.rawText ?? '' })
            : new LLMCallFailed({ cause }),
    });

    // 5. Persist the answer row.
    const now = (self.deps.now ?? (() => new Date().toISOString()))();
    const answer = yield* insertAnswer(self.deps.db, {
      question_id: questionId,
      value: llmResult.value,
      unit: llmResult.unit,
      source_kind: 'ai_suggested',
      source_summary: llmResult.source_summary,
      created_at: now,
    });

    return answer;
  });
}
```

The helpers (`readQuestion`, `loadInventoryContext`, `insertAnswer`) are top-level functions in the same file. They take the deps explicitly (db / service / etc.) and return Effects with typed errors:

```ts
function readQuestion(
  db: Database,
  id: string,
): Effect.Effect<Question, QuestionNotFound, never> {
  return Effect.sync(() => db.prepare('SELECT * FROM question WHERE id = ?').get(id) as Question | undefined)
    .pipe(
      Effect.flatMap((q) =>
        q ? Effect.succeed(q) : Effect.fail(new QuestionNotFound({ id })),
      ),
    );
}

function readAnswerByQuestion(
  db: Database,
  qid: string,
): Effect.Effect<Answer | null, never, never> {
  return Effect.sync(
    () => (db.prepare('SELECT * FROM answer WHERE question_id = ?').get(qid) as Answer | undefined) ?? null,
  );
}

function loadInventoryContext(
  activityDataService: ActivityDataService,
  calculationService: CalculationService,
  year: number,
): Effect.Effect<InventoryContext, never, never> {
  return Effect.sync(() => {
    const acts = activityDataService.listByYear(year);
    const calc = calculationService.snapshotByYear(year);
    return {
      year,
      activity_count: acts.length,
      activities_summary: summarize(acts),
      totals: calc?.totals ?? null,
    };
  });
}
```

(Better-sqlite3 calls are synchronous; `Effect.sync` wraps them. If a sync call could throw — e.g. an SQL constraint violation — use `Effect.try({ try, catch })` to catch into a typed error.)

**`LLMClient.generateAnswer` — new method (Promise-based, Effect lifts it):**

```ts
async generateAnswer(
  config: ProviderConfig,
  question: Question,
  inventory: InventoryContext,
): Promise<{ value: string; unit: string | null; source_summary: string }> {
  const schema = z.object({
    value: z.string(),
    unit: z.string().nullable(),
    source_summary: z.string().max(500),
  });

  const prompt = `你是一名碳核算助理。下面是一道供应商问卷的题目，以及当前组织 ${inventory.year} 年度的 inventory 数据。请基于 inventory 给出答案。

<question>
${question.raw_text}
${question.expected_unit ? `期望单位：${question.expected_unit}` : ''}
</question>

<inventory>
活动数据行数：${inventory.activity_count}
活动数据摘要：${inventory.activities_summary}
${inventory.totals ? `总排放：${JSON.stringify(inventory.totals)}` : ''}
</inventory>

返回 JSON: { value: <答案字符串，可以是数字或文本>, unit: <单位，若题面有要求；否则 null>, source_summary: <1-2 句中文，说明答案是从 inventory 哪部分推出来的> }
如果 inventory 里没有相关数据，value 用空字符串，source_summary 解释为何无法回答。`;

  return this.extract(config, schema, prompt);
}
```

The Promise-side error handling (`SchemaMismatchError`, `ProviderNotConfiguredError`) is already in place from Phase 1's LLMClient. The Effect side uses `Effect.tryPromise.catch` to translate those into our typed `GenErr` variants.

### `save` and `listByQuestionnaire`

Simpler — no LLM call. Both can be straight `Effect.sync` wrappers around SQL operations.

```ts
save(input: { question_id: string; value: string; unit: string | null; finalize: boolean }) {
  const self = this;
  return Effect.gen(function* () {
    const existing = yield* readAnswerByQuestion(self.deps.db, input.question_id);
    if (!existing) return yield* Effect.fail(new AnswerNotFound({ question_id: input.question_id }));
    const now = (self.deps.now ?? (() => new Date().toISOString()))();
    return yield* updateAnswer(self.deps.db, {
      ...existing,
      value: input.value,
      unit: input.unit,
      source_kind: 'manual',
      finalized_at: input.finalize ? now : existing.finalized_at,
    });
  });
}
```

`source_kind` flips to `'manual'` when the user edits the value — preserves provenance.

### IPC layer (the Effect → Promise boundary)

`src/main/ipc/handlers/answer.ts` (new file):

```ts
import { Effect } from 'effect';
import { z } from 'zod';
import type { IpcContext } from '../context.js';

const idInput = z.object({ question_id: z.string().min(1) });
const saveInput = z.object({
  question_id: z.string().min(1),
  value: z.string(),
  unit: z.string().nullable(),
  finalize: z.boolean(),
});
const qidInput = z.object({ questionnaire_id: z.string().min(1) });

export function answerHandlers(ctx: IpcContext) {
  return {
    'answer:generate': async (input: unknown) => {
      const parsed = idInput.parse(input);
      return Effect.runPromise(ctx.answerGenerationService.generate(parsed.question_id));
    },
    'answer:save': async (input: unknown) => {
      const parsed = saveInput.parse(input);
      return Effect.runPromise(ctx.answerGenerationService.save(parsed));
    },
    'answer:list-by-questionnaire': async (input: unknown) => {
      const parsed = qidInput.parse(input);
      return Effect.runPromise(ctx.answerGenerationService.listByQuestionnaire(parsed.questionnaire_id));
    },
  };
}
```

The pattern is identical across all 3 handlers: zod-parse → call service method → `Effect.runPromise`. This is the only place in main-process code where Effect "leaks out" — anyone reading the handler sees `Promise<Answer>` as the type, not `Effect<Answer, ...>`.

### Renderer changes

**`AnswerReviewCard` component (new):**

For each question, render:
- Question text (read-only)
- Cell ref + expected unit (small grey text)
- Status: "not yet generated" / "generated, not finalized" / "finalized"
- `<Generate>` button if no answer; loading state during call
- After answer exists: editable `<value>` input + `<unit>` input + `<source_summary>` (read-only italic)
- `<Save & finalize>` button → `answer:save` with `finalize: true`

**Replace the static question list on `questionnaires.$id.tsx`:**

When `questionnaire.status === 'mapping' || 'answering'`, the page renders the list of `AnswerReviewCard`s instead of the placeholder. A footer button "标记为已答题" / "Mark answering complete" calls `questionnaire:finalize` which transitions status `mapping → answering` (used by 2.2c to enable export).

### Tests

Per the Effect adoption boundary discipline, tests can run Effects with `Effect.runPromise` and assert on values OR run with `Effect.runPromiseExit` and assert on `Exit` shape (failure vs success).

For taggued-error assertions, the idiomatic check is:

```ts
const exit = await Effect.runPromiseExit(svc.generate('not-real'));
expect(exit._tag).toBe('Failure');
if (exit._tag === 'Failure') {
  // The cause carries the typed error; for simple unit tests this check is enough.
  expect(Cause.failureOption(exit.cause).pipe(Option.getOrNull)?._tag).toBe('QuestionNotFound');
}
```

Tests to write:
1. `generate` happy path — question + inventory present → answer row inserted, `source_kind='ai_suggested'`.
2. `generate` returns `QuestionNotFound` for unknown id.
3. `generate` returns `QuestionAlreadyAnswered` when an answer already exists.
4. `generate` returns `InventoryEmpty` when no activity_data for the year.
5. `generate` returns `LLMSchemaMismatch` when LLM throws SchemaMismatchError.
6. `save` updates value/unit + flips `source_kind` to 'manual' when user edits.
7. `save` marks `finalized_at` when `finalize: true`.
8. `listByQuestionnaire` returns answers ordered by question.position.

Plus handler tests (zod validation, Effect.runPromise translation).

Plus 2-3 renderer smoke tests for `AnswerReviewCard`.

Expected new tests: ~15. Target: ~499.

### Tasks (drives the implementation plan)

1. `LLMClient.generateAnswer` + tests (Promise-based; no Effect yet)
2. Effect helpers + typed errors module + tests
3. `AnswerGenerationService.generate` (Effect.gen) + tests
4. `AnswerGenerationService.save` + `listByQuestionnaire` + tests
5. IPC channels (`answer:*`) + handlers + renderer API client + tests
6. `AnswerReviewCard` component + tests
7. Refactor `/questionnaires/$id` to use the new card list
8. Sweep + i18n keys

~8 tasks. Each smaller than 2.2a's tasks because the schema work is done.

## Risks + safety net

| Risk | Caught by |
|---|---|
| LLM returns garbage for numerical questions when no inventory data | `InventoryEmpty` short-circuit early — no LLM call wasted. `source_summary` makes the LLM explain itself in fallback cases. |
| Effect compiler errors confuse a new agent | The doc + Step 0 warmup are the reference. Helpers in `effect/errors.ts` keep the public surface narrow. |
| LLM gives different answers each call (non-deterministic) | Tests mock `llmClient.generateAnswer`; deterministic input → deterministic insert. |
| User edits during async generate → races | `generate` is idempotent — `QuestionAlreadyAnswered` short-circuits. The UI hides "Generate" once an answer exists. |
| Bundle size from `effect` | Already accepted (~50 KB gzipped). |

## Expected end state

- New file `src/main/services/answer-generation-service.ts` (~150 LOC of Effect code).
- New file `src/main/llm/llm-client.ts` gains `generateAnswer` method.
- New IPC handler at `src/main/ipc/handlers/answer.ts`.
- New renderer component `AnswerReviewCard`.
- Updated `questionnaires.$id.tsx` to render the cards.
- `answer` table populated by 2.2b runs; `source_kind='ai_suggested'` for fresh runs, flipping to `'manual'` on user save.
- ~15 new vitest tests. Target: ~499.
- typecheck + lint clean.

After this lands:
- A user opens a questionnaire → sees one row per question → clicks Generate per row → sees auto-answer → edits if needed → saves.
- Status moves `mapping → answering` after they hit "Mark complete".
- Phase 2.2c reads `answer` rows + the original document, writes back into Excel cells using `position` (the cell ref from 2.2a).

## Out-of-scope follow-ups (deliberate)

- **Effect Step 2** — refactor THIS service to use `Context.Tag` + `Layer.effect` for dependencies. Spec: `docs/specs/2026-05-1X-effect-step-2-layer-refactor.md`. The refactor is internal — no behavior change, no test changes needed (or only test setup changes).
- **Effect Step 3** — add `Effect.retry(Schedule.exponential(...))` on the LLM call, and `Effect.forEach({ concurrency: 3 })` for a "Generate all unanswered" batch button.
- **Cross-customer mapping reuse** — when a question (by signature) was answered before for ANY customer, suggest the previous value via `question_mapping` lookup. Phase 2.3+.
- **Categorical + narrative kinds** — different LLM prompts, different review UX. Phase 2.3+.
- **`narrative_bank` + `company_profile`** — narrative drafts pull from these. Phase 2.3+.
- **Streaming LLM responses** — render tokens as they arrive instead of waiting for the full JSON. Worth doing when LLM latency becomes painful.
