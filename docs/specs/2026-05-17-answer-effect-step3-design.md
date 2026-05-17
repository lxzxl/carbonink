# Effect Step 3: retry + concurrent forEach — Design

**Date:** 2026-05-17
**Phase:** 2.2b-followup (Effect Step 3)
**Status:** Approved by user 2026-05-17; ready for plan.
**Predecessor:** `2026-05-16-answer-effect-step2-design.md` (Tag + Layer refactor, shipped at `e85439f`).
**Successor:** Phase 2.2c — Excel write-back + export.

## Why

Step 1 introduced `Effect.gen + Data.TaggedError`. Step 2 introduced `Context.Tag + Layer`. Step 3 introduces **operators that compose on top of those primitives**: `Effect.retry` (declarative resilience) and `Effect.forEach({ concurrency })` (declarative parallelism with bounded fan-out). This is where Effect's value over Promise becomes most obvious — these operators **are one-line transformations** on existing Effects, with full type-level error filtering and structured cancellation built in.

Two new behaviors land in production:

1. **The LLM call retries transient failures.** If `llmClient.generateAnswer` rejects with anything that maps to `LLMCallFailed` (network error, 5xx, rate limit), Effect retries with exponential backoff up to 2 additional attempts. Other errors (`LLMSchemaMismatch`, `QuestionNotFound`, `InventoryEmpty`, etc.) short-circuit immediately.
2. **A new "Generate all unanswered" button** runs `generate` across every unanswered question in a questionnaire, with concurrency capped at 3. Per-item failures are isolated (`Effect.either`) — one question erroring doesn't kill the batch; the result is a list of `Either<GenErr, Answer>` that the UI surfaces as "8 generated, 2 failed".

## Scope

**In scope:**
- Add `Effect.retry` with `Schedule.exponential('100 millis').pipe(Schedule.compose(Schedule.recurs(2)))` to the LLM call inside `generate`, filtered by `LLMCallFailed._tag`.
- New module function `generateAllUnanswered(questionnaireId, config)` using `Effect.forEach + Effect.either + concurrency: 3`.
- New IPC channel `answer:generate-all-unanswered` + handler + renderer API.
- New "Generate all" button on `/questionnaires/$id` route + toast feedback.
- 4 i18n keys.

**Out of scope:**
- Configurable retry policy (`maxRetries` / `baseDelay` as user setting). Hardcoded for now; revisit if real usage shows the defaults are wrong.
- Per-question retry on `LLMSchemaMismatch` (user chose conservative policy).
- Progress streaming during bulk generate (returns the full array at end, no per-item progress). Spawning an Effect.Stream + IPC channel for live progress is a future enhancement.
- "Generate all" for questionnaires across organizations (single questionnaire only).
- Cancellation UX (a "Stop" button while bulk is running). Effect.forEach IS cancellable, but exposing that to the user needs more thought.

## Design

### Retry — applied INSIDE `generate`

```ts
// src/main/services/answer-generation/index.ts
import { Schedule } from 'effect'

const RETRY_SCHEDULE = Schedule.exponential('100 millis').pipe(
  Schedule.compose(Schedule.recurs(2)),
)

export function generate(
  questionId: string,
  config: ProviderConfig,
): Effect.Effect<Answer, GenErr, AnswerR> {
  return Effect.gen(function* () {
    // ... read question, idempotency, questionnaire, inventory unchanged ...

    const llmResult = yield* Effect.tryPromise({
      try: () => llmClient.generateAnswer(config, {...}, inventory),
      catch: (cause): GenErr =>
        cause instanceof ProviderNotConfiguredError ? new ProviderNotConfigured()
        : cause instanceof SchemaMismatchError ? new LLMSchemaMismatch({ raw: cause.rawText ?? '' })
        : new LLMCallFailed({ cause }),
    }).pipe(
      Effect.retry({
        schedule: RETRY_SCHEDULE,
        while: (err): err is LLMCallFailed => err._tag === 'LLMCallFailed',
      }),
    )

    // ... insert unchanged ...
  })
}
```

**Why `Schedule.exponential('100 millis')` with base 100ms?** Production-relevant (exponential is the canonical retry policy for transient API errors) AND fast enough that tests pay <1s per retry-test. With 3 retry-related tests, total test-time growth is sub-second. Trade-off resolved in favor of pedagogy + speed; production retries are still meaningful (100ms → 200ms wait between attempts is enough to dodge a momentary 503).

**Why `while`-filter on `_tag`?** `Effect.retry` accepts a `while` predicate that controls "should I retry this error or short-circuit?" Filtering by `_tag === 'LLMCallFailed'` means:
- Network blip / 5xx → retry up to 2 times → eventually surface as `LLMCallFailed` if all 3 attempts fail.
- LLM gives wrong JSON shape → `LLMSchemaMismatch` → NOT retried → bubbles up immediately. (User chose this policy: schema mismatch usually signals a prompt or model issue, retry won't help.)
- All other typed errors (`QuestionNotFound`, `InventoryEmpty`, etc.) → also NOT retried because their `_tag` doesn't match.

**Why retry is applied to the `Effect.tryPromise` block only, not the whole generator?** Because `readQuestion / readAnswerByQuestion / readQuestionnaire / loadInventoryContext` are pure sync DB reads — retrying them is pointless (they'll fail or succeed deterministically). Only the LLM call has transient-failure semantics. Scoping retry tightly matches the operation that actually benefits.

### `generateAllUnanswered` — bounded concurrency + per-item isolation

```ts
import { Either } from 'effect'

export type GenerateResult = Either.Either<GenErr, Answer>

export function generateAllUnanswered(
  questionnaireId: string,
  config: ProviderConfig,
): Effect.Effect<readonly GenerateResult[], never, AnswerR> {
  return Effect.gen(function* () {
    const db = yield* DbTag
    const unanswered = readUnansweredQuestions(db, questionnaireId)
    return yield* Effect.forEach(
      unanswered,
      (q) => generate(q.id, config).pipe(Effect.either),
      { concurrency: 3 },
    )
  })
}

function readUnansweredQuestions(db: Database, questionnaireId: string): readonly Question[] {
  return db.prepare(`
    SELECT q.* FROM question q
    LEFT JOIN answer a ON a.question_id = q.id
    WHERE q.questionnaire_id = ? AND a.id IS NULL
    ORDER BY q.position
  `).all(questionnaireId) as Question[]
}
```

**Why `Effect.either`?** Without it, the first `generate` failure would short-circuit the whole batch (`Effect.forEach` defaults to fail-fast). `Effect.either(eff): Effect<Either<E, A>, never>` swaps the error track into the success track — now each `generate` call yields `Right<Answer>` or `Left<GenErr>`. The outer Effect succeeds with the array regardless of individual outcomes. The UI inspects each `Either` and renders accordingly.

**Why `concurrency: 3`?**
- LLM providers (OpenAI, Anthropic, Azure) typically allow ~3-10 concurrent requests for individual API keys before rate-limiting.
- Higher concurrency = more parallelism but more rate-limit hits = more `LLMCallFailed` retries = doesn't actually save time.
- 3 is a sane default that scales with what one user can reasonably use.
- Hardcoded for now; future setting if usage demands it.

**Why is the return type `Effect.Effect<..., never, ...>` (never error)?** Because `Effect.either` absorbs the error track. `generateAllUnanswered` itself **cannot fail** — it always succeeds with an array (which may contain Left/Right). This is a deliberate design choice: bulk operations report partial-success, not all-or-nothing. The IPC layer doesn't need to special-case errors; the renderer just inspects each Either.

### IPC channel + renderer

```ts
// types.ts
'answer:generate-all-unanswered': (input: { questionnaire_id: string })
  => Promise<{ ok: boolean; result: { value?: Answer; error?: { _tag: string; message: string } } }[]>
```

The IPC return type **flattens `Either` to a wire-friendly tagged-union** (Either's class instance doesn't serialize cleanly across IPC). Each item is either `{ ok: true, result: { value: Answer } }` or `{ ok: false, result: { error: {_tag, message} } }`. The handler maps `Either.match` to this shape.

```ts
// handler
'answer:generate-all-unanswered': async (input) => {
  const parsed = qidInput.parse(input)
  const results = await Effect.runPromise(
    answerSvc
      .generateAllUnanswered(parsed.questionnaire_id, ctx.providerConfig)
      .pipe(Effect.provide(ctx.answerLayer)),
  )
  return results.map((r) =>
    Either.match(r, {
      onRight: (value) => ({ ok: true as const, result: { value } }),
      onLeft: (error) => ({ ok: false as const, result: { error: { _tag: error._tag, message: 'message' in error ? String(error.message) : '' } } }),
    }),
  )
}
```

```ts
// renderer client
generateAllUnanswered: (input) => invoke('answer:generate-all-unanswered', input)
```

```ts
// detail route
const generateAll = useMutation({
  mutationFn: () => answerApi.generateAllUnanswered({ questionnaire_id: id }),
  onSuccess: (results) => {
    const ok = results.filter((r) => r.ok).length
    const failed = results.length - ok
    toast.success(m.answer_generate_all_done({ ok, failed }))
    queryClient.invalidateQueries({ queryKey: ['answer:list-by-questionnaire', id] })
  },
  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
})

// button next to "Finalize answers":
<Button onClick={() => generateAll.mutate()} disabled={generateAll.isPending}>
  {generateAll.isPending ? m.answer_generate_all_running() : m.answer_generate_all_button()}
</Button>
```

### i18n keys

- `answer_generate_all_button` — "Generate all unanswered" / "批量生成未答"
- `answer_generate_all_running` — "Generating…" / "生成中…"
- `answer_generate_all_done` — "{ok} answered, {failed} failed" / "已生成 {ok} 条，{failed} 条失败"
- `answer_generate_all_empty` — "All questions already answered." / "所有题目均已回答。"

## Decision points (and rationale)

| Decision | Choice | Why |
|---|---|---|
| Retry scope | Only `LLMCallFailed` | User-chosen conservative policy; schema mismatch isn't a transient failure |
| Retry schedule | `Schedule.exponential('100 millis') + recurs(2)` | Production-meaningful + test-fast |
| Retry placement | Inside `generate`, wrapping `Effect.tryPromise` only | Sync DB reads aren't retry candidates |
| Concurrency | `3`, hardcoded | LLM rate limits favor moderate parallelism; user can tune later if needed |
| Per-item isolation | `Effect.either` inside `forEach` | Batch should report partial success, not abort on first failure |
| Return type of bulk | `Effect<readonly Either[], never, R>` | Bulk cannot fail; individual items can |
| IPC serialization | Flatten Either to `{ok, result}` discriminated object | Either instance doesn't serialize cleanly across IPC |
| Progress streaming | Out of scope | Full array at end is sufficient for v1; streaming = future |
| Cancellation UX | Out of scope | Effect.forEach IS cancellable, but UX needs more thought |

## Risk + rollback

**Risk 1 — retry-test flakiness.** The exponential schedule introduces wall-clock waits. With base 100ms + recurs(2), worst case is 100ms + 200ms = 300ms per retry-test. Three retry tests = <1s added test time. Acceptable. Mitigation: if flake appears, switch to `TestClock` (Effect's virtual clock) — more setup but eliminates wall-clock dependence.

**Risk 2 — LLM rate limits hit during bulk.** Even with concurrency 3, a questionnaire with 50 questions could trigger throttling. Mitigation: retries help; if real usage shows persistent failures, downshift concurrency or add per-provider rate-limit awareness. Out of scope for v1.

**Risk 3 — IPC payload size.** A bulk result for 50 questions returns ~50KB of JSON (each Answer has multiple fields). Electron IPC handles this fine; only matters at 1000+ questions.

**Rollback:** Each task is a separate commit. Revert `T1` removes retry; revert `T2` removes the bulk function; revert `T3-T4` removes IPC + UI. Service signatures are additive — nothing existing breaks.

## Closeout criteria

- `Effect.retry` lives in `generate` with the documented schedule and `while`-filter.
- `generateAllUnanswered` exported from `@main/services/answer-generation`.
- New IPC channel + handler + renderer client landed.
- "Generate all unanswered" button on detail route + 4 i18n keys.
- All existing 503 tests still pass; ~6 new tests added (3 retry + 2 bulk + 1 handler). Target ~509 tests.
- `pnpm typecheck` clean.

## What this unlocks for Phase 2.2c

When 2.2c (Excel write-back) needs "write answers into the .xlsx for ALL questions," it can call `generateAllUnanswered` first to fill any gaps, then export. The bulk function is reusable beyond the UI button.
