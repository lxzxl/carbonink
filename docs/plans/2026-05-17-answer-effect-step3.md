# Effect Step 3 Implementation Plan — retry + concurrent forEach

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add transient-failure retry on the LLM call inside `generate`, plus a new `generateAllUnanswered` bulk function with bounded concurrency + per-item failure isolation. Wire to UI as a "Generate all unanswered" button.

**Architecture:** Two new Effect operators land in production — `Effect.retry({ schedule, while })` on the `Effect.tryPromise` block inside `generate`, and `Effect.forEach + Effect.either + concurrency: 3` for the bulk function. New IPC channel `answer:generate-all-unanswered` returns a serialized `{ ok, result }[]` instead of native `Either[]`.

**Tech Stack:** Effect 3.21 (`Schedule.exponential`, `Schedule.recurs`, `Schedule.compose`, `Effect.retry`, `Effect.forEach`, `Effect.either`, `Either.match`). No new dependencies.

**Spec:** `docs/specs/2026-05-17-answer-effect-step3-design.md`

**Baseline:** 503 tests passing after Step 2 (`e85439f`). Target after Step 3: ~509 tests (+6 new — 3 retry, 2 bulk service, 1 handler).

---

## Task 1: Add `Effect.retry` to `generate` for `LLMCallFailed`

**Files:**
- Modify: `src/main/services/answer-generation/index.ts` — wrap `Effect.tryPromise` block with `.pipe(Effect.retry(...))`; add `RETRY_SCHEDULE` constant
- Modify: `tests/main/services/answer-generation-service.test.ts` — add 3 retry tests

The retry policy: `Schedule.exponential('100 millis').pipe(Schedule.compose(Schedule.recurs(2)))` — base 100ms exponential, max 2 retries. Filter: `while: (err): err is LLMCallFailed => err._tag === 'LLMCallFailed'`. Other typed errors short-circuit.

- [ ] **Step 1: Write the 3 failing tests**

Append to `tests/main/services/answer-generation-service.test.ts` inside the existing `describe('answer-generation.generate ...')`:

```ts
  it('retries LLMCallFailed up to 2 times then succeeds', async () => {
    const { testLayer, llmClient } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
    });
    vi.mocked(llmClient.generateAnswer)
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValueOnce({ value: '14820', unit: 'kWh', source_summary: 's' });
    const result = await Effect.runPromise(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('14820');
    expect(llmClient.generateAnswer).toHaveBeenCalledTimes(3);
  });

  it('gives up after 2 retries when LLMCallFailed persists', async () => {
    const { testLayer, llmClient } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
    });
    vi.mocked(llmClient.generateAnswer).mockRejectedValue(new Error('persistent'));
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('LLMCallFailed');
    expect(llmClient.generateAnswer).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does NOT retry LLMSchemaMismatch', async () => {
    const { testLayer, llmClient } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
    });
    // SchemaMismatchError comes from @main/llm/llm-client — import it
    const { SchemaMismatchError } = await import('@main/llm/llm-client');
    vi.mocked(llmClient.generateAnswer).mockRejectedValue(
      new SchemaMismatchError({ rawText: 'bad json', cause: new Error() }),
    );
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('LLMSchemaMismatch');
    expect(llmClient.generateAnswer).toHaveBeenCalledTimes(1); // no retry
  });
```

**Important:** the third test imports `SchemaMismatchError` from `@main/llm/llm-client`. Verify the class is exported and its constructor signature matches `new SchemaMismatchError({ rawText, cause })`. If signature differs, adapt the test instantiation but keep the assertion: `_tag === 'LLMSchemaMismatch'` and call count `=== 1`.

- [ ] **Step 2: Run tests, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads 2>&1 | tail -20
```
Expected: 3 new tests FAIL because retry logic isn't there yet. Existing 9 tests still pass.

- [ ] **Step 3: Implement retry**

Open `src/main/services/answer-generation/index.ts`. Add to imports:

```ts
import { Effect, Schedule } from 'effect';
```

(adjust existing import — `Effect` was already there; just add `Schedule`).

Add this constant near the top of the file (after imports, before exports):

```ts
const RETRY_SCHEDULE = Schedule.exponential('100 millis').pipe(
  Schedule.compose(Schedule.recurs(2)),
);
```

Then locate the `Effect.tryPromise({ try, catch })` block inside `generate`. Replace it with:

```ts
    const llmResult = yield* Effect.tryPromise({
      try: () =>
        llmClient.generateAnswer(
          config,
          {
            raw_text: question.raw_text,
            expected_unit: question.expected_unit,
            question_kind: question.question_kind,
          },
          inventory,
        ),
      catch: (cause): GenErr =>
        cause instanceof ProviderNotConfiguredError
          ? new ProviderNotConfigured()
          : cause instanceof SchemaMismatchError
            ? new LLMSchemaMismatch({ raw: cause.rawText ?? '' })
            : new LLMCallFailed({ cause }),
    }).pipe(
      Effect.retry({
        schedule: RETRY_SCHEDULE,
        while: (err): err is LLMCallFailed => err._tag === 'LLMCallFailed',
      }),
    );
```

**The only diff** is the `.pipe(Effect.retry({...}))` chained onto the `Effect.tryPromise(...)`. The `catch` mapping is unchanged. The `while` predicate is a TypeScript type guard so the retry condition is type-safe.

- [ ] **Step 4: Run tests, verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads 2>&1 | tail -10
```
Expected: typecheck clean, 12 service tests pass (9 existing + 3 new).

If typecheck fails:
- `Schedule.compose` arg-order: it composes left-to-right (`exponential.pipe(Schedule.compose(recurs(2)))` = "exponential, terminated by recurs(2)"). If TS complains, double-check via Effect docs that the pipe direction is correct.
- `while` type predicate: TS might fail to narrow if the `_tag` access path is wrong. The error union `GenErr` includes 7 tags; the predicate narrows to `LLMCallFailed`. Should work but is a place where Effect 3.x's type inference can be picky.

If tests fail:
- Test 1 (3 calls + success): if it says `toHaveBeenCalledTimes(1)`, retry isn't applied. If it says 4+, the `Schedule.recurs(2)` boundary is misread.
- Test 3 (no retry on SchemaMismatch): if it says 3 calls instead of 1, the `while` predicate isn't filtering correctly.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
git add src/main/services/answer-generation/index.ts tests/main/services/answer-generation-service.test.ts
git commit -m "feat(answer): retry LLMCallFailed with exponential backoff (Effect Step 3)"
git branch --show-current
```
Expected: 506 tests passing (503 + 3), branch `main`.

---

## Task 2: Add `generateAllUnanswered` with bounded concurrency

**Files:**
- Modify: `src/main/services/answer-generation/index.ts` — add `generateAllUnanswered` function + `readUnansweredQuestions` helper + `GenerateResult` type
- Modify: `tests/main/services/answer-generation-service.test.ts` — add 2 tests

- [ ] **Step 1: Write the 2 failing tests**

Append a new describe block to the test file:

```ts
describe('answer-generation.generateAllUnanswered', () => {
  it('generates for unanswered questions only; returns Right per success', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      activitiesForYear: 5,
    });
    // 3 questions, 1 already answered.
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-1', 'qn-1', 's1', 'v1', 'q1', 'q1', NULL, 'numerical', NULL, 'Sheet1!B2', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-2', 'qn-1', 's2', 'v1', 'q2', 'q2', NULL, 'numerical', NULL, 'Sheet1!B3', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-3', 'qn-1', 's3', 'v1', 'q3', 'q3', NULL, 'numerical', NULL, 'Sheet1!B4', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-1', 'q-1', 'existing', NULL, 'ai_suggested', NULL, NULL)`,
    ).run();
    const results = await Effect.runPromise(
      answerSvc.generateAllUnanswered('qn-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(results.length).toBe(2); // q-2 and q-3
    expect(results.every((r) => Either.isRight(r))).toBe(true);
  });

  it('isolates per-item failures: returns Left for failing items, Right for others', async () => {
    const { testLayer, db, llmClient } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      activitiesForYear: 5,
    });
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-1', 'qn-1', 's1', 'v1', 'q1', 'q1', NULL, 'numerical', NULL, 'Sheet1!B2', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-2', 'qn-1', 's2', 'v1', 'q2', 'q2', NULL, 'numerical', NULL, 'Sheet1!B3', 0)`,
    ).run();
    // First call succeeds, second call fails (persistently — outlasts retries).
    vi.mocked(llmClient.generateAnswer)
      .mockResolvedValueOnce({ value: 'ok', unit: null, source_summary: 's' })
      .mockRejectedValue(new Error('persistent'));
    const results = await Effect.runPromise(
      answerSvc.generateAllUnanswered('qn-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(results.length).toBe(2);
    const oks = results.filter(Either.isRight);
    const fails = results.filter(Either.isLeft);
    expect(oks.length).toBe(1);
    expect(fails.length).toBe(1);
    expect((fails[0]!.left as { _tag: string })._tag).toBe('LLMCallFailed');
  });
});
```

Also update the test file imports to include `Either`:

```ts
import { Cause, Effect, Either, Exit, Layer, Option } from 'effect';
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads 2>&1 | tail -15
```
Expected: 2 new tests FAIL ("generateAllUnanswered is not a function").

- [ ] **Step 3: Implement**

In `src/main/services/answer-generation/index.ts`:

Add `Either` to the imports:
```ts
import { Effect, Either, Schedule } from 'effect';
```

Add the type export near the top (alongside other type exports):
```ts
export type GenerateResult = Either.Either<Answer, GenErr>;
```

Note Effect's `Either.Either<R, L>` ordering: `Right` is the FIRST type param, `Left` is the SECOND. So `Either<Answer, GenErr>` = `Right<Answer> | Left<GenErr>`.

Add this function AFTER `generate` and BEFORE the helpers section:

```ts
export function generateAllUnanswered(
  questionnaireId: string,
  config: ProviderConfig,
): Effect.Effect<readonly GenerateResult[], never, AnswerR> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const unanswered = readUnansweredQuestions(db, questionnaireId);
    return yield* Effect.forEach(
      unanswered,
      (q) => Effect.either(generate(q.id, config)),
      { concurrency: 3 },
    );
  });
}
```

Add this helper alongside the others at the bottom (it returns plain data, not an Effect — same pattern as `loadInventoryContext`):

```ts
function readUnansweredQuestions(
  db: Database,
  questionnaireId: string,
): readonly Question[] {
  return db.prepare(`
    SELECT q.* FROM question q
    LEFT JOIN answer a ON a.question_id = q.id
    WHERE q.questionnaire_id = ? AND a.id IS NULL
    ORDER BY q.position
  `).all(questionnaireId) as Question[];
}
```

**Effect API gotcha:** `Effect.either(eff)` accepts an `Effect<A, E, R>` and returns `Effect<Either<A, E>, never, R>` — note the swap (`E` becomes Left, `A` stays Right). The error track is moved into the success track. If TS infers an odd shape, double-check the import: it should be `Effect.either` (lowercase static method), not `Either.either`.

- [ ] **Step 4: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads 2>&1 | tail -10
```
Expected: typecheck clean, 14 service tests pass (12 from T1 + 2 new).

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
git add src/main/services/answer-generation/index.ts tests/main/services/answer-generation-service.test.ts
git commit -m "feat(answer): generateAllUnanswered — bounded concurrency + per-item isolation"
git branch --show-current
```
Expected: 508 tests, branch `main`.

---

## Task 3: IPC channel + handler + renderer API

**Files:**
- Modify: `src/main/ipc/types.ts` — add `answer:generate-all-unanswered` entry
- Modify: `src/main/ipc/handlers/answer.ts` — new handler
- Modify: `src/preload/bridge.ts` — allowlist the new channel
- Modify: `tests/preload/bridge.test.ts` — update assertion
- Modify: `src/renderer/lib/api/answer.ts` — new client method
- Modify: `tests/main/ipc/answer-handlers.test.ts` — new test

The IPC payload **flattens `Either` to a wire-friendly tagged-union** because `Either` instance methods don't serialize cleanly across IPC. Each item is `{ ok: true, result: { value: Answer } }` or `{ ok: false, result: { error: { _tag, message } } }`.

- [ ] **Step 1: Add `IpcTypeMap` entry**

In `src/main/ipc/types.ts`, near the existing `answer:*` entries:

```ts
'answer:generate-all-unanswered': (input: { questionnaire_id: string }) => Promise<
  Array<
    | { ok: true; result: { value: Answer } }
    | { ok: false; result: { error: { _tag: string; message: string } } }
  >
>;
```

(Adjust syntax to match the file's existing `IpcTypeMap` shape — it may use function declarations or object-method syntax.)

- [ ] **Step 2: Write handler test**

Append to `tests/main/ipc/answer-handlers.test.ts`:

```ts
  it('answer:generate-all-unanswered returns serialized results', async () => {
    vi.mocked(answerSvc.generateAllUnanswered).mockReturnValue(
      Effect.succeed([
        Either.right(FAKE_ANSWER),
        Either.left({ _tag: 'LLMCallFailed', message: 'boom' } as never),
      ] as never) as never,
    );
    const handlers = answerHandlers(makeCtx());
    const result = await handlers['answer:generate-all-unanswered']!({
      questionnaire_id: 'qn-1',
    });
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ ok: true, result: { value: FAKE_ANSWER } });
    expect(result[1]).toMatchObject({ ok: false, result: { error: { _tag: 'LLMCallFailed' } } });
  });
```

Update the `vi.mock` factory at the top of the file to include `generateAllUnanswered`:

```ts
vi.mock('@main/services/answer-generation', async () => {
  const actual = await vi.importActual<typeof import('@main/services/answer-generation')>(
    '@main/services/answer-generation',
  );
  return {
    ...actual,
    generate: vi.fn(),
    save: vi.fn(),
    listByQuestionnaire: vi.fn(),
    generateAllUnanswered: vi.fn(),
  };
});
```

Also import `Either` from `effect` at the top.

- [ ] **Step 3: Implement handler**

In `src/main/ipc/handlers/answer.ts`, import `Either`:

```ts
import { Effect, Either } from 'effect';
```

Add the input schema near the others:

```ts
const qidInput = z.object({ questionnaire_id: z.string().min(1) });
// (already exists from prior tasks — reuse)
```

Add the handler entry:

```ts
    'answer:generate-all-unanswered': async (input) => {
      const parsed = qidInput.parse(input);
      const results = await Effect.runPromise(
        answerSvc
          .generateAllUnanswered(parsed.questionnaire_id, ctx.providerConfig)
          .pipe(Effect.provide(ctx.answerLayer)),
      );
      return results.map((r) =>
        Either.match(r, {
          onRight: (value) => ({ ok: true as const, result: { value } }),
          onLeft: (error) => ({
            ok: false as const,
            result: {
              error: {
                _tag: error._tag,
                message: 'cause' in error ? String(error.cause) : error._tag,
              },
            },
          }),
        }),
      );
    },
```

**Note:** The null-guard for `providerConfig` from `answer:generate` is not needed here — `generateAllUnanswered` would throw on the first `Effect.tryPromise` with a null config and `Effect.either` catches it as a Left. The renderer gets back an array of Lefts (one per question) instead of a generic error. That's actually a fine UX: the user sees "X failed: ProviderNotConfigured" and knows what to fix.

Actually — re-reading the spec, the LLM call is wrapped in `Effect.tryPromise` whose `catch` maps to typed errors. If `config` is null, `llmClient.generateAnswer(null, ...)` is the call that fails, which throws. The `catch` maps it to `LLMCallFailed` (since it's not `ProviderNotConfiguredError`). So users would see "X failed: LLMCallFailed" — less helpful. **DO add the null-guard at the top of the handler**, matching the pattern from `answer:generate`. Throw a clear error before entering the Effect, so the renderer's `onError` toasts a useful message.

```ts
    'answer:generate-all-unanswered': async (input) => {
      const parsed = qidInput.parse(input);
      if (!ctx.providerConfig) {
        throw new Error('AI provider not configured. Open Settings to set up.');
      }
      const results = await Effect.runPromise(...);
      // ...
    },
```

- [ ] **Step 4: Allowlist + renderer client + bridge test**

In `src/preload/bridge.ts`, add `'answer:generate-all-unanswered'` to the allowlist array.

In `tests/preload/bridge.test.ts`, update the allowlist assertion to include the new channel (it likely uses `.toEqual([...])` against a literal array — append the new channel name in the right alphabetical/grouped position).

In `src/renderer/lib/api/answer.ts`:

```ts
  generateAllUnanswered: (input: { questionnaire_id: string }) =>
    invoke('answer:generate-all-unanswered', input),
```

(Match the pattern of the other 3 methods.)

- [ ] **Step 5: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Expected: typecheck clean, 509 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "feat(ipc): answer:generate-all-unanswered channel + handler + renderer client"
git branch --show-current
```

---

## Task 4: "Generate all unanswered" button + i18n

**Files:**
- Modify: `src/renderer/routes/questionnaires.$id.tsx` — add button + mutation handler
- Modify: `messages/en.json` + `messages/zh-CN.json` — add 4 i18n keys
- Modify: `tests/renderer/questionnaires-detail.test.tsx` — add 1 smoke test for the button

- [ ] **Step 1: Add i18n keys**

`messages/en.json` + `messages/zh-CN.json` — add (alphabetically near other `answer_*` keys):

```
answer_generate_all_button       "Generate all unanswered"          / "批量生成未答"
answer_generate_all_running      "Generating…"                      / "生成中…"
answer_generate_all_done         "{ok} answered, {failed} failed"   / "已生成 {ok} 条，{failed} 条失败"
answer_generate_all_empty        "All questions already answered."  / "所有题目均已回答。"
```

Note `answer_generate_all_done` has params `{ok, failed}` — paraglide's syntax. Use the existing parameterized-message pattern from the codebase (look at any existing key with `{...}` placeholders to verify syntax).

- [ ] **Step 2: Add the button + mutation to the route**

In `src/renderer/routes/questionnaires.$id.tsx`, near the `finalizeMutation`:

```tsx
const generateAll = useMutation({
  mutationFn: () => answerApi.generateAllUnanswered({ questionnaire_id: id }),
  onSuccess: (results) => {
    if (results.length === 0) {
      toast.info(m.answer_generate_all_empty());
      return;
    }
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    toast.success(m.answer_generate_all_done({ ok, failed }));
    queryClient.invalidateQueries({ queryKey: ['answer:list-by-questionnaire', id] });
  },
  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
});
```

Render the button next to the existing finalize button (or in a sensible header position — match the page's existing button styling):

```tsx
<Button onClick={() => generateAll.mutate()} disabled={generateAll.isPending}>
  {generateAll.isPending ? m.answer_generate_all_running() : m.answer_generate_all_button()}
</Button>
```

If `toast.info` doesn't exist (only `success / error`), use `toast.success` or pick whatever neutral variant exists.

- [ ] **Step 3: Add a smoke test**

In `tests/renderer/questionnaires-detail.test.tsx`, add to the existing describe:

```ts
it('renders Generate all unanswered button', async () => {
  vi.mocked(questionnaireApi.getById).mockResolvedValue({
    questionnaire: FAKE_QUESTIONNAIRE,
    customer: FAKE_CUSTOMER,
    document: FAKE_DOCUMENT,
    questions: FAKE_QUESTIONS,
  });
  vi.mocked(answerApi.listByQuestionnaire).mockResolvedValue([]);
  render(<TestRouter />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /generate all/i })).toBeTruthy();
  });
});
```

Also add `generateAllUnanswered` to the `answerApi` mock at the top:

```ts
vi.mock('@renderer/lib/api/answer', () => ({
  answerApi: {
    generate: vi.fn(),
    save: vi.fn(),
    listByQuestionnaire: vi.fn().mockResolvedValue([]),
    generateAllUnanswered: vi.fn(),
  },
}));
```

- [ ] **Step 4: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Expected: ~510 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "feat(ui): Generate all unanswered button on questionnaire detail page"
git branch --show-current
```

---

## Task 5: Sweep + final verification

- [ ] **Step 1: Full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: ~510 tests passing.

- [ ] **Step 2: typecheck + format + lint**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -3
```

- [ ] **Step 3: Final commit + history**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A
git commit -m "chore: biome sweep for Effect Step 3" || true
git log --oneline -10
git branch --show-current
```

---

## Closeout

Effect Step 3 lands on `main`:

- `Effect.retry({ schedule: exponential + recurs, while: typed-error-filter })` is the canonical operator for transient-failure resilience.
- `Effect.forEach + Effect.either + concurrency` is the canonical pattern for "do N things in parallel, isolate failures, report partial success."
- Bulk-generate button gives users a way to fill an entire questionnaire in one click.

**Three more interview-grade insights this lands:**

1. **`Effect.retry` is declarative.** The schedule decides timing, the `while`-predicate decides applicability. Promise-based code achieves the same with manual `try/catch + setTimeout` loops; Effect makes both axes type-safe and composable.
2. **`Effect.either` is the partial-success switch.** It turns "fail the whole batch on first error" into "report each item's outcome individually." This is the single most-asked-about Effect pattern in interviews.
3. **`concurrency: 3` is bounded fan-out.** Promise-based `Promise.all` either runs all in parallel (no bound, hits rate limits) or you build a manual semaphore. Effect makes the bound a parameter.

**Next:** Phase 2.2c — Excel write-back + export. The bulk-generate function will be reusable there ("when exporting, optionally fill any remaining unanswered questions first").
