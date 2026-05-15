# Questionnaire Auto-Answer (Phase 2.2b) Implementation Plan — Effect Step 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkbox syntax.

**Goal:** Build `AnswerGenerationService` in Effect TS (Step 1: `Effect.gen` + `Data.TaggedError` + `Effect.catchTag`, deps via constructor). Wire it through IPC. Replace the read-only question list on `/questionnaires/$id` with an editable answer-review UI.

**Reference spec:** `docs/specs/2026-05-15-questionnaire-auto-answer-design.md`
**Reference learning doc:** `docs/research/2026-05-15-effect-ts-adoption.md`
**Reference warmup:** `tests/main/exploration/effect-warmup.test.ts` — Step 0 covered Effect.gen / Data.TaggedError / Effect.catchTag / Context.Tag + Layer / tryPromise.

**Baseline:** `commit e0a468e` on `main`. 484 vitest tests passing.

**Effect TS rules for this sub-project:**

- `Effect` lives ONLY inside `AnswerGenerationService` + its tests. Everything else (handler, renderer, other services) stays in async/await.
- IPC handler bridges Effect → Promise via `Effect.runPromise(svc.method(...))`. Single boundary.
- Step 1 = constructor DI (no `Context.Tag` / `Layer` yet). Step 2 refactors to layers in a separate sub-project.
- Better-sqlite3 sync calls wrap with `Effect.sync(() => ...)`. Don't use `Effect.tryPromise` for sync work.
- `function* ()` inside `Effect.gen` cannot capture `this` cleanly — declare `const self = this` outside the generator first.
- Use `Effect.runPromiseExit` + `Cause.failureOption` in tests to assert on typed-error tags.

**Pre-existing hazard:** if 184+ failures with `NODE_MODULE_VERSION 145`:
```
rm /Users/lxz/ws/personal/carbonbook/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && (cd /Users/lxz/ws/personal/carbonbook && pnpm rebuild better-sqlite3)
```

**Inventory lookup chain (used by T2):** questionnaire.reporting_year → `organizationService.getCurrentOrganization()` → `organizationService.listReportingPeriodsByOrganization(orgId)` → filter by `year === reporting_year` → `activityDataService.listByPeriod(period.id)` + `activityDataService.totalsByPeriod(period.id)`. There's no direct "by year" query — go through the period.

---

## Task 1: `LLMClient.generateAnswer` (Promise-based; no Effect yet)

**Files:**
- Modify: `src/main/llm/llm-client.ts` — add `generateAnswer`
- Create: `tests/main/llm/llm-client-generate-answer.test.ts`

This task is plain async/await — it adds a Promise-returning method to LLMClient. Effect comes in T2 when the service wraps this via `Effect.tryPromise`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/llm/llm-client-generate-answer.test.ts`:

```ts
import { LLMClient } from '@main/llm/llm-client';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const fakeConfig: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey',
};

const fakeQuestion = {
  id: 'q-1',
  questionnaire_id: 'qn-1',
  raw_text: '2026 年度总用电量 (kWh)?',
  normalized_text: '2026 total electricity',
  expected_unit: 'kWh',
  position: 'Sheet1!B5',
  question_kind: 'numerical' as const,
};
const fakeInventory = {
  year: 2026,
  activity_count: 12,
  activities_summary: '12 条电费抽取，总计 14820 kWh',
  totals: { total_co2e_kg: 8456.7, scope2_kg: 8456.7 },
};

describe('LLMClient.generateAnswer', () => {
  it('builds a structured-output call with the answer schema', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      value: '14820',
      unit: 'kWh',
      source_summary: '12 条电费 sum = 14820',
    } as unknown as never);

    const result = await client.generateAnswer(fakeConfig, fakeQuestion as never, fakeInventory);
    expect(result.value).toBe('14820');
    expect(result.unit).toBe('kWh');
    expect(stub).toHaveBeenCalledTimes(1);
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    expect(prompt).toContain('14820');
    expect(prompt).toContain('总用电量');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client-generate-answer.test.ts --pool=threads
```

- [ ] **Step 3: Implement**

Add to `LLMClient` class:

```ts
  /**
   * Generate an answer for one questionnaire question, grounded in the
   * org's inventory data for the requested year. Phase 2.2b.
   *
   * Returns a structured answer + a short Chinese source_summary explaining
   * which inventory facts the value was derived from. The caller persists
   * the result to the `answer` table.
   *
   * Returns `value=""` when inventory has no relevant data; the
   * source_summary explains why.
   */
  async generateAnswer(
    config: ProviderConfig,
    question: {
      raw_text: string;
      expected_unit?: string | null;
      question_kind: 'numerical' | 'categorical' | 'narrative';
    },
    inventory: {
      year: number;
      activity_count: number;
      activities_summary: string;
      totals: { total_co2e_kg: number; scope1_kg?: number; scope2_kg?: number; scope3_kg?: number } | null;
    },
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
${inventory.totals ? `总排放：${JSON.stringify(inventory.totals)}` : '无总排放快照。'}
</inventory>

返回 JSON: { value: <答案字符串，可以是数字字符串或文本>, unit: <单位字符串，若题面有要求；否则 null>, source_summary: <1-2 句中文，说明答案是从 inventory 哪部分推出来的> }

如果 inventory 里没有相关数据，value 用空字符串 ""，source_summary 解释为何无法回答。`;

    return this.extract(config, schema, prompt);
  }
```

- [ ] **Step 4: Run test + verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/llm/llm-client-generate-answer.test.ts --pool=threads
```
Expected: PASS, 1 test.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/llm/llm-client.ts tests/main/llm/llm-client-generate-answer.test.ts
git commit -m "feat(llm): LLMClient.generateAnswer — auto-fill numerical questionnaire answers"
git branch --show-current
```
Expected: 485 tests passing (484 + 1).

---

## Task 2: `AnswerGenerationService.generate` (Effect Step 1) ★ the learning task

**Files:**
- Create: `src/main/services/answer-generation-service.ts`
- Create: `tests/main/services/answer-generation-service.test.ts`
- Modify: `src/shared/types.ts` — add `Answer` type, `AnswerSaveInput` type if missing

This is the centerpiece of Step 1. Read `tests/main/exploration/effect-warmup.test.ts` for the patterns first (you wrote them; this task uses them in production).

- [ ] **Step 1: Add shared types**

In `src/shared/types.ts`, add (alphabetically positioned among entity types):

```ts
export type Answer = {
  id: string;
  question_id: string;
  value: string;
  unit: string | null;
  source_kind: 'mapped_inventory' | 'manual' | 'ai_suggested';
  source_calculation_snapshot_id: string | null;
  source_activity_data_id: string | null;
  source_company_profile_key: string | null;
  source_narrative_bank_id: string | null;
  source_summary: string | null;
  finalized_at: string | null;
};
```

- [ ] **Step 2: Write the failing tests**

Create `tests/main/services/answer-generation-service.test.ts`. The interesting bits are how to assert on typed Effect errors:

```ts
import { runMigrations } from '@main/db/migrate';
import { AnswerGenerationService } from '@main/services/answer-generation-service';
import type { Answer } from '@shared/types';
import Database from 'better-sqlite3';
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'fake',
} as never;

// Helper: read the typed-error _tag out of an Exit.Failure. This is the
// idiomatic way to assert on Data.TaggedError outcomes in vitest tests.
function failureTag<A>(exit: Exit.Exit<A, unknown>): string | null {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) return null;
  const err = failure.value as { _tag?: string };
  return err._tag ?? null;
}

function setup(opts?: {
  seedQuestionnaire?: { id: string; reporting_year: number; customer_name: string };
  seedQuestion?: { id: string; questionnaire_id: string; raw_text: string };
  seedAnswer?: Partial<Answer> & { id: string; question_id: string; value: string };
  activitiesForYear?: number;
  totalsForYear?: { total_co2e_kg: number } | null;
  llmAnswer?: { value: string; unit: string | null; source_summary: string };
  llmThrows?: Error;
}) {
  const db = new Database(':memory:');
  runMigrations(db);

  // Seed a customer + questionnaire if specified.
  if (opts?.seedQuestionnaire) {
    db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-1', ?, NULL)`).run(opts.seedQuestionnaire.customer_name);
    db.prepare(`INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at) VALUES ('doc-1', 'aa', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, '/tmp/q.xlsx', '2026-05-15T00:00:00Z')`).run();
    db.prepare(`INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at) VALUES (?, 'cu-1', 'doc-1', ?, 'mapping', NULL, '2026-05-15T00:00:00Z')`)
      .run(opts.seedQuestionnaire.id, opts.seedQuestionnaire.reporting_year);
  }
  if (opts?.seedQuestion) {
    db.prepare(`INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES (?, ?, 'sig', 'v1', 'q', ?, NULL, 'numerical', 'kWh', 'Sheet1!B5', 0)`)
      .run(opts.seedQuestion.id, opts.seedQuestion.questionnaire_id, opts.seedQuestion.raw_text);
  }
  if (opts?.seedAnswer) {
    const a = opts.seedAnswer;
    db.prepare(`INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES (?, ?, ?, NULL, 'ai_suggested', NULL, NULL)`)
      .run(a.id, a.question_id, a.value);
  }

  // Stub inventory + LLM dependencies.
  const orgService = {
    getCurrentOrganization: vi.fn().mockReturnValue({ id: 'org-1', name_zh: 'Test', name_en: null, industry: null, country_code: 'CN', boundary_kind: 'operational_control', created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z' }),
    listReportingPeriodsByOrganization: vi.fn().mockReturnValue(
      opts?.seedQuestionnaire
        ? [{ id: 'rp-1', organization_id: 'org-1', year: opts.seedQuestionnaire.reporting_year, granularity: 'annual', starts_at: '', ends_at: '', is_active: 1, created_at: '', updated_at: '' }]
        : [],
    ),
  };
  const activityDataService = {
    listByPeriod: vi.fn().mockReturnValue(new Array(opts?.activitiesForYear ?? 0).fill({})),
    totalsByPeriod: vi.fn().mockReturnValue(opts?.totalsForYear ?? null),
  };
  const llmClient = {
    generateAnswer: opts?.llmThrows
      ? vi.fn().mockRejectedValue(opts.llmThrows)
      : vi.fn().mockResolvedValue(opts?.llmAnswer ?? { value: '14820', unit: 'kWh', source_summary: 'sum of activities' }),
  };

  return {
    db,
    svc: new AnswerGenerationService({
      db,
      llmClient: llmClient as never,
      orgService: orgService as never,
      activityDataService: activityDataService as never,
      config: FAKE_CONFIG,
      now: () => '2026-05-15T12:00:00Z',
    }),
    llmClient,
  };
}

describe('AnswerGenerationService.generate (Effect Step 1)', () => {
  it('happy path: returns answer row + inserts to DB', async () => {
    const { svc, db, llmClient } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: '2026 total kWh?' },
      activitiesForYear: 12,
      totalsForYear: { total_co2e_kg: 8456.7 },
      llmAnswer: { value: '14820', unit: 'kWh', source_summary: 'sum of activities' },
    });
    const result = await Effect.runPromise(svc.generate('q-1'));
    expect(result.value).toBe('14820');
    expect(result.source_kind).toBe('ai_suggested');
    expect(llmClient.generateAnswer).toHaveBeenCalledTimes(1);
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1');
    expect(row).toBeTruthy();
  });

  it('QuestionNotFound when id does not exist', async () => {
    const { svc } = setup({});
    const exit = await Effect.runPromiseExit(svc.generate('not-real'));
    expect(failureTag(exit)).toBe('QuestionNotFound');
  });

  it('QuestionAlreadyAnswered when answer row already exists', async () => {
    const { svc } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: 'existing' },
      activitiesForYear: 1,
    });
    const exit = await Effect.runPromiseExit(svc.generate('q-1'));
    expect(failureTag(exit)).toBe('QuestionAlreadyAnswered');
  });

  it('InventoryEmpty when no activities for the year', async () => {
    const { svc } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 0,
    });
    const exit = await Effect.runPromiseExit(svc.generate('q-1'));
    expect(failureTag(exit)).toBe('InventoryEmpty');
  });

  it('LLMCallFailed when LLM rejects', async () => {
    const { svc } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      llmThrows: new Error('network down'),
    });
    const exit = await Effect.runPromiseExit(svc.generate('q-1'));
    expect(failureTag(exit)).toBe('LLMCallFailed');
  });
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads
```
Expected: FAIL ("Cannot find module").

- [ ] **Step 4: Implement the service**

Create `src/main/services/answer-generation-service.ts`. The whole file (including typed errors) — Step 2 will later extract errors into a shared module.

```ts
import type { LLMClient } from '@main/llm/llm-client';
import type { Answer, ProviderConfig, Question, Questionnaire } from '@shared/types';
import type { Database } from 'better-sqlite3';
import { Data, Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { ProviderNotConfiguredError, SchemaMismatchError } from '@main/llm/llm-client';
import type { ActivityDataService } from './activity-data-service';
import type { OrganizationService } from './organization-service';

// ---------------------------------------------------------------------------
// Typed errors (Effect Step 1)
// ---------------------------------------------------------------------------
// Each error is a Data.TaggedError class. The `_tag` discriminator (the first
// string arg) is how Effect.catchTag matches; the type parameter is the
// payload shape. Tests assert on the _tag via Cause.failureOption.

export class QuestionNotFound extends Data.TaggedError('QuestionNotFound')<{
  id: string;
}> {}

export class QuestionAlreadyAnswered extends Data.TaggedError('QuestionAlreadyAnswered')<{
  id: string;
}> {}

export class QuestionnaireNotFound extends Data.TaggedError('QuestionnaireNotFound')<{
  id: string;
}> {}

export class InventoryEmpty extends Data.TaggedError('InventoryEmpty')<{
  year: number;
}> {}

export class LLMSchemaMismatch extends Data.TaggedError('LLMSchemaMismatch')<{
  raw: string;
}> {}

export class LLMCallFailed extends Data.TaggedError('LLMCallFailed')<{
  cause: unknown;
}> {}

export class ProviderNotConfigured extends Data.TaggedError('ProviderNotConfigured')<{}> {}

export type GenErr =
  | QuestionNotFound
  | QuestionAlreadyAnswered
  | QuestionnaireNotFound
  | InventoryEmpty
  | LLMSchemaMismatch
  | LLMCallFailed
  | ProviderNotConfigured;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AnswerGenerationService {
  constructor(
    private readonly deps: {
      db: Database;
      llmClient: LLMClient;
      orgService: OrganizationService;
      activityDataService: ActivityDataService;
      config: ProviderConfig;
      now?: () => string;
    },
  ) {}

  /**
   * Generate an answer for one question. Idempotent: if an answer row
   * already exists, fails with QuestionAlreadyAnswered (caller uses `save`
   * to update).
   *
   * Effect Step 1 pattern: pure Effect.gen body, typed errors via
   * Data.TaggedError, dependencies passed via constructor (no Layer yet).
   */
  generate(questionId: string): Effect.Effect<Answer, GenErr, never> {
    // Capture `this` outside the generator. Generator bodies can't see
    // `this` from an enclosing class method cleanly — declare a stable
    // alias first. This is THE idiomatic pattern for Effect.gen inside
    // class methods.
    const { db, llmClient, orgService, activityDataService, config } = this.deps;
    const nowFn = this.deps.now ?? (() => new Date().toISOString());

    return Effect.gen(function* () {
      // 1. Read question row.
      const question = yield* readQuestion(db, questionId);

      // 2. Idempotency check.
      const existing = yield* readAnswerByQuestion(db, questionId);
      if (existing) {
        return yield* Effect.fail(new QuestionAlreadyAnswered({ id: questionId }));
      }

      // 3. Look up the questionnaire (need reporting_year for inventory ctx).
      const questionnaire = yield* readQuestionnaire(db, question.questionnaire_id);

      // 4. Build inventory context.
      const inventory = yield* loadInventoryContext(
        orgService,
        activityDataService,
        questionnaire.reporting_year,
      );
      if (inventory.activity_count === 0) {
        return yield* Effect.fail(new InventoryEmpty({ year: questionnaire.reporting_year }));
      }

      // 5. Call the LLM. tryPromise lifts the Promise-based API into
      //    Effect-land; the catch handler maps known Promise rejections
      //    to our typed errors.
      const llmResult = yield* Effect.tryPromise({
        try: () =>
          llmClient.generateAnswer(
            config,
            { raw_text: question.raw_text, expected_unit: question.expected_unit, question_kind: question.question_kind },
            inventory,
          ),
        catch: (cause): GenErr =>
          cause instanceof ProviderNotConfiguredError
            ? new ProviderNotConfigured({})
            : cause instanceof SchemaMismatchError
              ? new LLMSchemaMismatch({ raw: cause.rawText ?? '' })
              : new LLMCallFailed({ cause }),
      });

      // 6. Persist.
      const answer = yield* insertAnswer(db, {
        id: randomUUID(),
        question_id: questionId,
        value: llmResult.value,
        unit: llmResult.unit,
        source_summary: llmResult.source_summary,
        created_at: nowFn(),
      });

      return answer;
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers (top-level, take deps explicitly so they're easy to reuse + test).
// In Step 2 these may move into Layer-backed Tag service methods.
// ---------------------------------------------------------------------------

function readQuestion(
  db: Database,
  id: string,
): Effect.Effect<Question, QuestionNotFound, never> {
  return Effect.sync(
    () => db.prepare('SELECT * FROM question WHERE id = ?').get(id) as Question | undefined,
  ).pipe(
    Effect.flatMap((q) => (q ? Effect.succeed(q) : Effect.fail(new QuestionNotFound({ id })))),
  );
}

function readAnswerByQuestion(
  db: Database,
  qid: string,
): Effect.Effect<Answer | null, never, never> {
  return Effect.sync(
    () =>
      (db.prepare('SELECT * FROM answer WHERE question_id = ?').get(qid) as Answer | undefined) ?? null,
  );
}

function readQuestionnaire(
  db: Database,
  id: string,
): Effect.Effect<Questionnaire, QuestionnaireNotFound, never> {
  return Effect.sync(
    () =>
      db.prepare('SELECT * FROM questionnaire WHERE id = ?').get(id) as Questionnaire | undefined,
  ).pipe(
    Effect.flatMap((q) =>
      q ? Effect.succeed(q) : Effect.fail(new QuestionnaireNotFound({ id })),
    ),
  );
}

function loadInventoryContext(
  orgService: OrganizationService,
  activityDataService: ActivityDataService,
  year: number,
): Effect.Effect<
  {
    year: number;
    activity_count: number;
    activities_summary: string;
    totals: { total_co2e_kg: number; scope1_kg?: number; scope2_kg?: number; scope3_kg?: number } | null;
  },
  never,
  never
> {
  return Effect.sync(() => {
    const org = orgService.getCurrentOrganization();
    if (!org) return { year, activity_count: 0, activities_summary: '无组织', totals: null };
    const periods = orgService
      .listReportingPeriodsByOrganization(org.id)
      .filter((p) => p.year === year);
    const period = periods[0];
    if (!period) return { year, activity_count: 0, activities_summary: '无该年度报告期', totals: null };
    const activities = activityDataService.listByPeriod(period.id);
    const totals = activityDataService.totalsByPeriod(period.id);
    return {
      year,
      activity_count: activities.length,
      activities_summary: `${activities.length} 条活动数据`,
      totals,
    };
  });
}

function insertAnswer(
  db: Database,
  input: {
    id: string;
    question_id: string;
    value: string;
    unit: string | null;
    source_summary: string;
    created_at: string;
  },
): Effect.Effect<Answer, never, never> {
  return Effect.sync(() => {
    db.prepare(`
      INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
      VALUES (?, ?, ?, ?, 'ai_suggested', ?, NULL)
    `).run(input.id, input.question_id, input.value, input.unit, input.source_summary);
    return db.prepare(`SELECT * FROM answer WHERE id = ?`).get(input.id) as Answer;
  });
}
```

**Effect-specific gotchas to watch for during implementation:**

- `Effect.gen(function* () { ... })` — the inner is a generator function. Don't use arrow: `Effect.gen(() => ...)` is wrong.
- Use `yield*`, not `yield`. `yield*` delegates to the inner Effect; `yield` would yield the Effect as a value (wrong type).
- `const { db, ... } = this.deps` BEFORE the generator. Generators can't capture `this` cleanly across `function*()`.
- `Effect.tryPromise({ try, catch })` — both fields required; `catch` returns the typed error.
- Use `Effect.sync(() => syncFn())` for pure sync work; `Effect.try({ try, catch })` for fallible sync (e.g. SQL constraint violations).

- [ ] **Step 5: Run test + verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads
```
Expected: PASS, 5 tests.

Common failure modes if typecheck balks:
- `OrganizationService` may not export `getCurrentOrganization` / `listReportingPeriodsByOrganization` by those exact names — read the file + adjust.
- `Answer` type fields: re-check migration 005 vs the type declaration; the CHECK constraint requires source FKs to be either all null OR exactly one set, but for `ai_suggested` initial inserts none are set — that's fine per the constraint (the "at most one" branch).

- [ ] **Step 6: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/answer-generation-service.ts tests/main/services/answer-generation-service.test.ts src/shared/types.ts
git commit -m "feat(answer): AnswerGenerationService.generate — Effect Step 1 production code"
git branch --show-current
```
Expected: 490 tests passing (485 + 5).

---

## Task 3: `AnswerGenerationService.save` + `listByQuestionnaire`

**Files:**
- Modify: `src/main/services/answer-generation-service.ts` — add 2 methods + 2 typed errors
- Modify: `tests/main/services/answer-generation-service.test.ts` — add tests

- [ ] **Step 1: Failing tests**

Append to the test file:

```ts
describe('AnswerGenerationService.save', () => {
  it('updates value/unit + flips source_kind to manual on user edit', async () => {
    const { svc, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: '14820' },
    });
    const result = await Effect.runPromise(
      svc.save({ question_id: 'q-1', value: '15000', unit: 'kWh', finalize: false }),
    );
    expect(result.value).toBe('15000');
    expect(result.source_kind).toBe('manual');
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1') as { value: string; source_kind: string; finalized_at: string | null };
    expect(row.value).toBe('15000');
    expect(row.finalized_at).toBeNull();
  });

  it('sets finalized_at when finalize=true', async () => {
    const { svc, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: '14820' },
    });
    await Effect.runPromise(
      svc.save({ question_id: 'q-1', value: '15000', unit: 'kWh', finalize: true }),
    );
    const row = db.prepare(`SELECT finalized_at FROM answer WHERE question_id = ?`).get('q-1') as { finalized_at: string };
    expect(row.finalized_at).toBe('2026-05-15T12:00:00Z');
  });

  it('AnswerNotFound for unknown question_id', async () => {
    const { svc } = setup({});
    const exit = await Effect.runPromiseExit(
      svc.save({ question_id: 'not-real', value: 'v', unit: null, finalize: false }),
    );
    expect(failureTag(exit)).toBe('AnswerNotFound');
  });
});

describe('AnswerGenerationService.listByQuestionnaire', () => {
  it('returns answers for the questionnaire ordered by question position', async () => {
    const { svc, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
    });
    // Insert two questions with different positions + answers.
    db.prepare(`INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-1', 'qn-1', 's1', 'v1', 'q1', 'q1', NULL, 'numerical', NULL, 'Sheet1!B2', 0)`).run();
    db.prepare(`INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-2', 'qn-1', 's2', 'v1', 'q2', 'q2', NULL, 'numerical', NULL, 'Sheet1!B5', 0)`).run();
    db.prepare(`INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-1', 'q-1', 'v1', NULL, 'ai_suggested', NULL, NULL)`).run();
    db.prepare(`INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-2', 'q-2', 'v2', NULL, 'ai_suggested', NULL, NULL)`).run();
    const result = await Effect.runPromise(svc.listByQuestionnaire('qn-1'));
    expect(result.length).toBe(2);
    expect(result[0]?.question_id).toBe('q-1');
    expect(result[1]?.question_id).toBe('q-2');
  });
});
```

- [ ] **Step 2: Implement**

Append to `answer-generation-service.ts`:

```ts
export class AnswerNotFound extends Data.TaggedError('AnswerNotFound')<{
  question_id: string;
}> {}

export type SaveErr = AnswerNotFound;

export interface SaveInput {
  question_id: string;
  value: string;
  unit: string | null;
  finalize: boolean;
}
```

And inside the class:

```ts
  save(input: SaveInput): Effect.Effect<Answer, SaveErr, never> {
    const { db } = this.deps;
    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    return Effect.gen(function* () {
      const existing = yield* readAnswerByQuestion(db, input.question_id);
      if (!existing) return yield* Effect.fail(new AnswerNotFound({ question_id: input.question_id }));
      const finalizedAt = input.finalize ? nowFn() : existing.finalized_at;
      yield* Effect.sync(() => {
        db.prepare(`UPDATE answer SET value = ?, unit = ?, source_kind = 'manual', finalized_at = ? WHERE question_id = ?`)
          .run(input.value, input.unit, finalizedAt, input.question_id);
      });
      return yield* Effect.sync(() => db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get(input.question_id) as Answer);
    });
  }

  listByQuestionnaire(questionnaireId: string): Effect.Effect<Answer[], never, never> {
    const { db } = this.deps;
    return Effect.sync(() =>
      db.prepare(`
        SELECT a.*
        FROM answer a
        JOIN question q ON q.id = a.question_id
        WHERE q.questionnaire_id = ?
        ORDER BY q.position
      `).all(questionnaireId) as Answer[],
    );
  }
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/answer-generation-service.ts tests/main/services/answer-generation-service.test.ts
git commit -m "feat(answer): AnswerGenerationService.save + listByQuestionnaire"
git branch --show-current
```
Expected: 494 tests passing (490 + 4).

---

## Task 4: IPC channels + handlers + renderer API

**Files:**
- Modify: `src/main/ipc/types.ts` — add `answer:*` entries
- Modify: `src/main/ipc/context.ts` — instantiate AnswerGenerationService (lazy getter, same pattern as questionnaireService)
- Create: `src/main/ipc/handlers/answer.ts`
- Modify: `src/main/ipc/setup.ts` — register the new handler set
- Modify: `src/preload/bridge.ts` — allowlist `answer:*` channels
- Modify: `tests/preload/bridge.test.ts` — update allowlist assertion
- Create: `src/renderer/lib/api/answer.ts`
- Create: `tests/main/ipc/answer-handlers.test.ts`

Pattern is identical to T6 of Phase 2.2a (questionnaire IPC wiring). Mirror that work.

The KEY new thing here: the handler runs Effect via `Effect.runPromise`:

```ts
// src/main/ipc/handlers/answer.ts
import { Effect } from 'effect';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const idInput = z.object({ question_id: z.string().min(1) });
const saveInput = z.object({
  question_id: z.string().min(1),
  value: z.string(),
  unit: z.string().nullable(),
  finalize: z.boolean(),
});
const qidInput = z.object({ questionnaire_id: z.string().min(1) });

export function answerHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'answer:generate': async (input) => {
      const parsed = idInput.parse(input);
      // The Effect → Promise translation boundary.
      return Effect.runPromise(ctx.answerGenerationService.generate(parsed.question_id));
    },
    'answer:save': async (input) => {
      const parsed = saveInput.parse(input);
      return Effect.runPromise(ctx.answerGenerationService.save(parsed));
    },
    'answer:list-by-questionnaire': async (input) => {
      const parsed = qidInput.parse(input);
      return Effect.runPromise(ctx.answerGenerationService.listByQuestionnaire(parsed.questionnaire_id));
    },
  };
}
```

- [ ] **Step 1-7: Mirror Phase 2.2a T6 structure**
  - Write the handler tests first (3 tests, similar shape to questionnaire-handlers.test.ts)
  - Implement handler
  - Add `IpcTypeMap` entries
  - Add `answerGenerationService` lazy getter to `IpcContext` (look at `questionnaireService` getter in `src/main/ipc/context.ts` for the pattern)
  - Register in `setup.ts`
  - Allowlist in `bridge.ts` + update `bridge.test.ts` allowlist assertion
  - Create renderer client `src/renderer/lib/api/answer.ts` with `answerApi.generate / save / listByQuestionnaire`

Note: when wiring `AnswerGenerationService` into `createIpcContext`, the constructor takes `{ db, llmClient, orgService, activityDataService, config, now }`. The `orgService` and `activityDataService` should already be on the context — verify by reading `context.ts`.

- [ ] **Step 8: typecheck + tests + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/ipc/answer-handlers.test.ts tests/preload/bridge.test.ts --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
git add -A
git commit -m "feat(ipc): answer:generate/save/list-by-questionnaire channels + renderer API"
git branch --show-current
```
Expected: ~497 tests passing (494 + 3).

---

## Task 5: `AnswerReviewCard` component

**Files:**
- Create: `src/renderer/components/AnswerReviewCard.tsx`
- Create: `tests/renderer/answer-review-card.test.tsx`
- Modify: `messages/en.json` + `messages/zh-CN.json` — add ~8 keys for the review UI

- [ ] **Step 1: Add i18n keys**

`messages/en.json` + `messages/zh-CN.json` (alphabetically positioned among `questionnaires_*` keys):

```json
"answer_generate": "Generate answer" / "生成答案"
"answer_generating": "Generating…" / "生成中…"
"answer_value": "Value" / "数值"
"answer_unit": "Unit" / "单位"
"answer_source": "Source" / "来源"
"answer_save": "Save" / "保存"
"answer_save_finalize": "Save & finalize" / "保存并定稿"
"answer_finalized": "Finalized" / "已定稿"
"answer_not_generated": "Not yet generated" / "尚未生成"
"answer_inventory_empty": "No inventory data for this year — manual answer required." / "本年度无库存数据，需手动填写。"
```

- [ ] **Step 2: Component**

Create `src/renderer/components/AnswerReviewCard.tsx`. Each card represents one question + its answer (or button to generate). Layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Question text                              Cell: Sheet1!B5    │
│                                                               │
│ ┌─[ Not yet generated ]─────────────────────────────────────┐ │
│ │ [Generate answer]                                          │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                               │
│ — OR after generation: —                                      │
│                                                               │
│ Value: [_______]    Unit: [____]                              │
│ Source: <italic source_summary>                               │
│ [Save]  [Save & finalize]                  Status: Generated  │
└──────────────────────────────────────────────────────────────┘
```

Use `useMutation` for `answer:generate` and `answer:save`. Use the existing `answerApi` from T4.

Skeleton:

```tsx
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { answerApi } from '@renderer/lib/api/answer';
import * as m from '@renderer/paraglide/messages';
import type { Answer, Question } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export interface AnswerReviewCardProps {
  question: Question;
  answer: Answer | null;
  questionnaireId: string;
}

export function AnswerReviewCard({ question, answer, questionnaireId }: AnswerReviewCardProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(answer?.value ?? '');
  const [unit, setUnit] = useState(answer?.unit ?? '');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['answer:list-by-questionnaire', questionnaireId] });

  const generate = useMutation({
    mutationFn: () => answerApi.generate({ question_id: question.id }),
    onSuccess: (a) => {
      setValue(a.value);
      setUnit(a.unit ?? '');
      void invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const save = useMutation({
    mutationFn: (finalize: boolean) =>
      answerApi.save({ question_id: question.id, value, unit: unit || null, finalize }),
    onSuccess: () => void invalidate(),
  });

  // Render based on state: no answer yet → generate button; otherwise editable.
  // ... layout per spec.
}
```

- [ ] **Step 3: Renderer test**

Smoke tests: card with no answer shows Generate button; card with answer shows value + unit inputs.

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/renderer/components/AnswerReviewCard.tsx tests/renderer/answer-review-card.test.tsx messages/
git commit -m "feat(ui): AnswerReviewCard — per-question generate + edit + finalize"
git branch --show-current
```

---

## Task 6: Refactor `/questionnaires/$id` to use `AnswerReviewCard` + add finalize button

**Files:**
- Modify: `src/renderer/routes/questionnaires.$id.tsx`
- Modify: `messages/*.json` — finalize button keys
- Modify: backend — add `questionnaire:finalize` IPC that transitions status `mapping → answering`

Detail page changes from the read-only T9 version (Phase 2.2a) to interactive:

```tsx
// Replace the static question table with:
const answersQuery = useQuery({
  queryKey: ['answer:list-by-questionnaire', id],
  queryFn: () => answerApi.listByQuestionnaire({ questionnaire_id: id }),
});

// Build answer-by-question-id map.
const byQ = new Map(answersQuery.data?.map((a) => [a.question_id, a]) ?? []);

// Render cards.
{questions.map((q) => (
  <AnswerReviewCard key={q.id} question={q} answer={byQ.get(q.id) ?? null} questionnaireId={id} />
))}

// Page-level button:
<Button onClick={() => finalizeMutation.mutate()}>{m.questionnaires_finalize_button()}</Button>
```

The `questionnaire:finalize` channel: a thin IPC that runs `UPDATE questionnaire SET status='answering' WHERE id=?`. Add to `QuestionnaireService` as a sync method (NOT Effect — this isn't an Effect-bearing operation; Step 1 contains Effect to the answer service).

- [ ] **Tasks within T6:**
  1. Add `QuestionnaireService.finalizeAnswering(id)` (sync, plain SQL).
  2. Add `questionnaire:finalize` IPC channel + handler + renderer API.
  3. Wire `AnswerReviewCard` into the detail route.
  4. Add finalize button + i18n.
  5. Tests for the integration.

- [ ] **Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add -A
git commit -m "feat(ui): questionnaire detail page renders AnswerReviewCards + finalize button"
git branch --show-current
```

---

## Task 7: Sweep + verification

- [ ] **Step 1: Full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Expected: ≥499 tests passing.

- [ ] **Step 2: typecheck + format + lint**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm format
pnpm exec biome check --write 2>&1 | tail -3
pnpm lint --max-diagnostics=80 2>&1 | tail -5
```

Expected: 0 errors, only pre-existing `noNonNullAssertion` warnings.

- [ ] **Step 3: Branch sanity + final commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A
# only commit if there are sweep changes
git commit -m "chore: biome sweep for Phase 2.2b" || true
git log --oneline -15
git branch --show-current
```

---

## Closeout

Phase 2.2b lands on `main` with Effect TS Step 1 patterns proven in production:

- `AnswerGenerationService` is the first Effect-based service. The 6 methods use `Effect.gen`, `Data.TaggedError`, `Effect.tryPromise`, `Effect.sync`, `Effect.flatMap`.
- IPC handler at the Effect ↔ Promise boundary via `Effect.runPromise`.
- ~499 tests, typecheck + lint clean.

**Next: Effect Step 2** — refactor THIS service to use `Context.Tag` + `Layer.effect` for dependencies. Spec: a future doc. The refactor is internal — no behavior change, no test changes (only test setup changes).

**Then: Effect Step 3** — add `Effect.retry(Schedule.exponential(...))` on the LLM call + `Effect.forEach({ concurrency: 3 })` for "Generate all unanswered" button.

**Then: Phase 2.2c** — Excel write-back so user can export the answered .xlsx.
