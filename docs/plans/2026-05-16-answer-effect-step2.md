# Effect Step 2: Context.Tag + Layer Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `AnswerGenerationService` from a class with constructor DI into module-level functions whose dependencies are declared as `Context.Tag`s and provided via a `Layer` at the IPC boundary.

**Architecture:** Three new files under `src/main/services/answer-generation/`: `tags.ts` (5 Context.Tag classes + `buildAnswerLayer` helper), `errors.ts` (8 Data.TaggedError classes + GenErr/SaveErr/SaveInput types), `index.ts` (the 3 module-level functions + private helpers). The old `answer-generation-service.ts` is deleted. IPC handlers import `* as answerSvc` and call `.pipe(Effect.provide(ctx.answerLayer))`.

**Tech Stack:** Effect 3.21.2 — `Context.Tag` class pattern, `Layer.succeed`, `Layer.mergeAll`, `Effect.provide`. No new dependencies.

**Spec:** `docs/specs/2026-05-16-answer-effect-step2-design.md`

**Baseline:** 502 tests passing on `main` (after Phase 2.2b commit `94a7f3d`). Target after Step 2: still 502 (no behavior change; only refactor).

---

## Task 1: Create `tags.ts` with 5 Context.Tag classes + `buildAnswerLayer` helper

**Files:**
- Create: `src/main/services/answer-generation/tags.ts`

This task adds NEW code only — no existing file changes, no test breakage. The tags compile and are exported, but nothing imports them yet.

- [ ] **Step 1: Write the file**

```ts
// src/main/services/answer-generation/tags.ts
import type { Database } from 'better-sqlite3';
import { Context, Layer } from 'effect';
import type { LLMClient } from '@main/llm/llm-client';
import type { ActivityDataService } from '@main/services/activity-data-service';
import type { OrganizationService } from '@main/services/organization-service';

export class DbTag extends Context.Tag('answer/Db')<DbTag, Database>() {}
export class LLMClientTag extends Context.Tag('answer/LLMClient')<LLMClientTag, LLMClient>() {}
export class OrgServiceTag extends Context.Tag('answer/OrgService')<OrgServiceTag, OrganizationService>() {}
export class ActivityDataServiceTag extends Context.Tag('answer/ActivityDataService')<ActivityDataServiceTag, ActivityDataService>() {}
export class NowTag extends Context.Tag('answer/Now')<NowTag, () => string>() {}

export type AnswerR = DbTag | LLMClientTag | OrgServiceTag | ActivityDataServiceTag | NowTag;

export interface AnswerDeps {
  db: Database;
  llmClient: LLMClient;
  orgService: OrganizationService;
  activityDataService: ActivityDataService;
  now?: () => string;
}

export function buildAnswerLayer(deps: AnswerDeps): Layer.Layer<AnswerR> {
  return Layer.mergeAll(
    Layer.succeed(DbTag, deps.db),
    Layer.succeed(LLMClientTag, deps.llmClient),
    Layer.succeed(OrgServiceTag, deps.orgService),
    Layer.succeed(ActivityDataServiceTag, deps.activityDataService),
    Layer.succeed(NowTag, deps.now ?? (() => new Date().toISOString())),
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/services/answer-generation/tags.ts
git commit -m "feat(answer): add Context.Tag classes + buildAnswerLayer helper for Effect Step 2"
git branch --show-current
```

---

## Task 2: Convert service to module functions + migrate all tests

**Files:**
- Create: `src/main/services/answer-generation/errors.ts`
- Create: `src/main/services/answer-generation/index.ts`
- Delete: `src/main/services/answer-generation-service.ts`
- Modify: `tests/main/services/answer-generation-service.test.ts` — rewrite all 9 tests to use `Effect.provide(Layer.mergeAll(...))`

This is the centerpiece task. The service body becomes module-level functions whose `Effect.gen` reads `yield* DbTag`, `yield* LLMClientTag`, etc. The class disappears. The 9 tests update from constructor DI to Layer composition.

- [ ] **Step 1: Create `errors.ts`**

```ts
// src/main/services/answer-generation/errors.ts
import { Data } from 'effect';

export class QuestionNotFound extends Data.TaggedError('QuestionNotFound')<{ id: string }> {}
export class QuestionAlreadyAnswered extends Data.TaggedError('QuestionAlreadyAnswered')<{ id: string }> {}
export class QuestionnaireNotFound extends Data.TaggedError('QuestionnaireNotFound')<{ id: string }> {}
export class InventoryEmpty extends Data.TaggedError('InventoryEmpty')<{ year: number }> {}
export class LLMSchemaMismatch extends Data.TaggedError('LLMSchemaMismatch')<{ raw: string }> {}
export class LLMCallFailed extends Data.TaggedError('LLMCallFailed')<{ cause: unknown }> {}
export class ProviderNotConfigured extends Data.TaggedError('ProviderNotConfigured')<{}> {}
export class AnswerNotFound extends Data.TaggedError('AnswerNotFound')<{ question_id: string }> {}

export type GenErr =
  | QuestionNotFound
  | QuestionAlreadyAnswered
  | QuestionnaireNotFound
  | InventoryEmpty
  | LLMSchemaMismatch
  | LLMCallFailed
  | ProviderNotConfigured;

export type SaveErr = AnswerNotFound;

export interface SaveInput {
  question_id: string;
  value: string;
  unit: string | null;
  finalize: boolean;
}
```

- [ ] **Step 2: Create `index.ts`**

Read the current `src/main/services/answer-generation-service.ts` to preserve the exact body logic (including the `JSON.stringify(source_summary)` for the json_valid CHECK constraint).

```ts
// src/main/services/answer-generation/index.ts
import type { Database } from 'better-sqlite3';
import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { ProviderNotConfiguredError, SchemaMismatchError } from '@main/llm/llm-client';
import type { ActivityDataService } from '@main/services/activity-data-service';
import type { OrganizationService } from '@main/services/organization-service';
import type { Answer, ProviderConfig, Question, Questionnaire } from '@shared/types';
import {
  AnswerNotFound,
  type GenErr,
  InventoryEmpty,
  LLMCallFailed,
  LLMSchemaMismatch,
  ProviderNotConfigured,
  QuestionAlreadyAnswered,
  QuestionNotFound,
  QuestionnaireNotFound,
  type SaveErr,
  type SaveInput,
} from './errors';
import {
  ActivityDataServiceTag,
  type AnswerR,
  DbTag,
  LLMClientTag,
  NowTag,
  OrgServiceTag,
} from './tags';

export * from './errors';
export * from './tags';

export function generate(
  questionId: string,
  config: ProviderConfig,
): Effect.Effect<Answer, GenErr, AnswerR> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const llmClient = yield* LLMClientTag;
    const orgService = yield* OrgServiceTag;
    const activityDataService = yield* ActivityDataServiceTag;
    const now = yield* NowTag;

    const question = yield* readQuestion(db, questionId);
    const existing = yield* readAnswerByQuestion(db, questionId);
    if (existing) return yield* Effect.fail(new QuestionAlreadyAnswered({ id: questionId }));

    const questionnaire = yield* readQuestionnaire(db, question.questionnaire_id);
    const inventory = loadInventoryContext(orgService, activityDataService, questionnaire.reporting_year);
    if (inventory.activity_count === 0) {
      return yield* Effect.fail(new InventoryEmpty({ year: questionnaire.reporting_year }));
    }

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
    });

    return yield* insertAnswer(db, {
      id: randomUUID(),
      question_id: questionId,
      value: llmResult.value,
      unit: llmResult.unit,
      source_summary: llmResult.source_summary,
      created_at: now(),
    });
  });
}

export function save(input: SaveInput): Effect.Effect<Answer, SaveErr, DbTag | NowTag> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const nowFn = yield* NowTag;
    const existing = yield* readAnswerByQuestion(db, input.question_id);
    if (!existing) return yield* Effect.fail(new AnswerNotFound({ question_id: input.question_id }));
    const finalizedAt = input.finalize ? nowFn() : existing.finalized_at;
    yield* Effect.sync(() => {
      db.prepare(
        `UPDATE answer SET value = ?, unit = ?, source_kind = 'manual', finalized_at = ? WHERE question_id = ?`,
      ).run(input.value, input.unit, finalizedAt, input.question_id);
    });
    return yield* Effect.sync(
      () =>
        db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get(input.question_id) as Answer,
    );
  });
}

export function listByQuestionnaire(
  questionnaireId: string,
): Effect.Effect<Answer[], never, DbTag> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    return db
      .prepare(`
        SELECT a.* FROM answer a
        JOIN question q ON q.id = a.question_id
        WHERE q.questionnaire_id = ?
        ORDER BY q.position
      `)
      .all(questionnaireId) as Answer[];
  });
}

// Helpers — copied verbatim from Step 1. They take values, not Tags, because
// they're called from inside Effect.gen blocks that already yielded the Tags.

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
      (db.prepare('SELECT * FROM answer WHERE question_id = ?').get(qid) as Answer | undefined) ??
      null,
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
): {
  year: number;
  activity_count: number;
  activities_summary: string;
  totals: {
    total_co2e_kg: number;
    scope1_kg?: number;
    scope2_kg?: number;
    scope3_kg?: number;
  } | null;
} {
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
    `).run(input.id, input.question_id, input.value, input.unit, JSON.stringify(input.source_summary));
    return db.prepare(`SELECT * FROM answer WHERE id = ?`).get(input.id) as Answer;
  });
}
```

**Notes:**
- `loadInventoryContext` is now plain sync (not `Effect.sync`). It was wrapped before to keep the `yield*` flow uniform; with helpers taking values it can be plain.
- The `JSON.stringify(source_summary)` is preserved verbatim — that's the json_valid CHECK constraint workaround from Step 1.
- `export *` re-exports from `./errors` and `./tags` so callers can `import { generate, DbTag, GenErr } from '@main/services/answer-generation'` without knowing the file split.

- [ ] **Step 3: Delete the old service file**

```bash
cd /Users/lxz/ws/personal/carbonbook
rm src/main/services/answer-generation-service.ts
```

- [ ] **Step 4: Migrate the test file**

Replace the entire contents of `tests/main/services/answer-generation-service.test.ts` with:

```ts
import { runMigrations } from '@main/db/migrate';
import * as answerSvc from '@main/services/answer-generation';
import {
  ActivityDataServiceTag,
  DbTag,
  LLMClientTag,
  NowTag,
  OrgServiceTag,
} from '@main/services/answer-generation/tags';
import type { Answer } from '@shared/types';
import Database from 'better-sqlite3';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'fake',
} as never;

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

  if (opts?.seedQuestionnaire) {
    db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-1', ?, NULL)`).run(
      opts.seedQuestionnaire.customer_name,
    );
    db.prepare(
      `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at) VALUES ('doc-1', 'aa', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, '/tmp/q.xlsx', '2026-05-15T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at) VALUES (?, 'cu-1', 'doc-1', ?, 'mapping', NULL, '2026-05-15T00:00:00Z')`,
    ).run(opts.seedQuestionnaire.id, opts.seedQuestionnaire.reporting_year);
  }
  if (opts?.seedQuestion) {
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES (?, ?, 'sig', 'v1', 'q', ?, NULL, 'numerical', 'kWh', 'Sheet1!B5', 0)`,
    ).run(opts.seedQuestion.id, opts.seedQuestion.questionnaire_id, opts.seedQuestion.raw_text);
  }
  if (opts?.seedAnswer) {
    const a = opts.seedAnswer;
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES (?, ?, ?, NULL, 'ai_suggested', NULL, NULL)`,
    ).run(a.id, a.question_id, a.value);
  }

  const orgService = {
    getCurrentOrganization: vi.fn().mockReturnValue({
      id: 'org-1',
      name_zh: 'Test',
      name_en: null,
      industry: null,
      country_code: 'CN',
      boundary_kind: 'operational_control',
      created_at: '2026-05-15T00:00:00Z',
      updated_at: '2026-05-15T00:00:00Z',
    }),
    listReportingPeriodsByOrganization: vi.fn().mockReturnValue(
      opts?.seedQuestionnaire
        ? [
            {
              id: 'rp-1',
              organization_id: 'org-1',
              year: opts.seedQuestionnaire.reporting_year,
              granularity: 'annual',
              starts_at: '',
              ends_at: '',
              is_active: 1,
              created_at: '',
              updated_at: '',
            },
          ]
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
      : vi
          .fn()
          .mockResolvedValue(
            opts?.llmAnswer ?? { value: '14820', unit: 'kWh', source_summary: 'sum of activities' },
          ),
  };

  const testLayer = Layer.mergeAll(
    Layer.succeed(DbTag, db),
    Layer.succeed(LLMClientTag, llmClient as never),
    Layer.succeed(OrgServiceTag, orgService as never),
    Layer.succeed(ActivityDataServiceTag, activityDataService as never),
    Layer.succeed(NowTag, () => '2026-05-15T12:00:00Z'),
  );

  return { db, testLayer, llmClient };
}

describe('answer-generation.generate (Effect Step 2)', () => {
  it('happy path: returns answer row + inserts to DB', async () => {
    const { testLayer, db, llmClient } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'Acme' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: '2026 total kWh?' },
      activitiesForYear: 12,
      totalsForYear: { total_co2e_kg: 8456.7 },
      llmAnswer: { value: '14820', unit: 'kWh', source_summary: 'sum of activities' },
    });
    const result = await Effect.runPromise(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('14820');
    expect(result.source_kind).toBe('ai_suggested');
    expect(llmClient.generateAnswer).toHaveBeenCalledTimes(1);
    const row = db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get('q-1');
    expect(row).toBeTruthy();
  });

  it('QuestionNotFound when id does not exist', async () => {
    const { testLayer } = setup({});
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('not-real', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('QuestionNotFound');
  });

  it('QuestionAlreadyAnswered when answer row already exists', async () => {
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: 'existing' },
      activitiesForYear: 1,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('QuestionAlreadyAnswered');
  });

  it('InventoryEmpty when no activities for the year', async () => {
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 0,
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('InventoryEmpty');
  });

  it('LLMCallFailed when LLM rejects', async () => {
    const { testLayer } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      activitiesForYear: 1,
      llmThrows: new Error('network down'),
    });
    const exit = await Effect.runPromiseExit(
      answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('LLMCallFailed');
  });
});

describe('answer-generation.save', () => {
  it('updates value/unit + flips source_kind to manual on user edit', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: '14820' },
    });
    const result = await Effect.runPromise(
      answerSvc
        .save({ question_id: 'q-1', value: '15000', unit: 'kWh', finalize: false })
        .pipe(Effect.provide(testLayer)),
    );
    expect(result.value).toBe('15000');
    expect(result.source_kind).toBe('manual');
    const row = db
      .prepare(`SELECT * FROM answer WHERE question_id = ?`)
      .get('q-1') as { value: string; source_kind: string; finalized_at: string | null };
    expect(row.value).toBe('15000');
    expect(row.finalized_at).toBeNull();
  });

  it('sets finalized_at when finalize=true', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
      seedQuestion: { id: 'q-1', questionnaire_id: 'qn-1', raw_text: 'Q' },
      seedAnswer: { id: 'a-1', question_id: 'q-1', value: '14820' },
    });
    await Effect.runPromise(
      answerSvc
        .save({ question_id: 'q-1', value: '15000', unit: 'kWh', finalize: true })
        .pipe(Effect.provide(testLayer)),
    );
    const row = db
      .prepare(`SELECT finalized_at FROM answer WHERE question_id = ?`)
      .get('q-1') as { finalized_at: string };
    expect(row.finalized_at).toBe('2026-05-15T12:00:00Z');
  });

  it('AnswerNotFound for unknown question_id', async () => {
    const { testLayer } = setup({});
    const exit = await Effect.runPromiseExit(
      answerSvc
        .save({ question_id: 'not-real', value: 'v', unit: null, finalize: false })
        .pipe(Effect.provide(testLayer)),
    );
    expect(failureTag(exit)).toBe('AnswerNotFound');
  });
});

describe('answer-generation.listByQuestionnaire', () => {
  it('returns answers for the questionnaire ordered by question position', async () => {
    const { testLayer, db } = setup({
      seedQuestionnaire: { id: 'qn-1', reporting_year: 2026, customer_name: 'A' },
    });
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-1', 'qn-1', 's1', 'v1', 'q1', 'q1', NULL, 'numerical', NULL, 'Sheet1!B2', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required) VALUES ('q-2', 'qn-1', 's2', 'v1', 'q2', 'q2', NULL, 'numerical', NULL, 'Sheet1!B5', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-1', 'q-1', 'v1', NULL, 'ai_suggested', NULL, NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at) VALUES ('a-2', 'q-2', 'v2', NULL, 'ai_suggested', NULL, NULL)`,
    ).run();
    const result = await Effect.runPromise(
      answerSvc.listByQuestionnaire('qn-1').pipe(Effect.provide(testLayer)),
    );
    expect(result.length).toBe(2);
    expect(result[0]?.question_id).toBe('q-1');
    expect(result[1]?.question_id).toBe('q-2');
  });
});
```

- [ ] **Step 5: Verify the service test file alone**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -20
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean, 9/9 service tests pass.

If typecheck balks at the `Effect.provide(testLayer)` shape, the issue is likely:
- `testLayer` not typed as `Layer.Layer<AnswerR>` — explicit annotation may help.
- An import path wrong — double-check `@main/services/answer-generation` resolves.

Other tests in the suite (IPC handler tests, renderer tests) will FAIL at this point because they still expect the old `AnswerGenerationService` class. That's expected — T3 fixes them.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/services/answer-generation/ tests/main/services/answer-generation-service.test.ts
git rm src/main/services/answer-generation-service.ts
git commit -m "refactor(answer): convert service to module functions + Tag-based deps (Step 2)"
git branch --show-current
```

Note: the full suite is RED at this commit (IPC and context still reference the deleted class). T3 makes it green again.

---

## Task 3: Rewire IPC + IpcContext + verify all 502 tests green

**Files:**
- Modify: `src/main/ipc/context.ts` — drop the `answerGenerationService` getter; add `answerLayer` + `providerConfig` fields
- Modify: `src/main/ipc/handlers/answer.ts` — import `* as answerSvc`, call `.pipe(Effect.provide(ctx.answerLayer))`
- Modify: `tests/main/ipc/answer-handlers.test.ts` — stub the module functions instead of class methods

This task makes everything green again.

- [ ] **Step 1: Read current `src/main/ipc/context.ts`**

Look for the `answerGenerationService` lazy getter that was added in Phase 2.2b T4. Note:
- How `db`, `llmClient`, `organizationService`, `activityDataService`, and `config` are sourced.
- How `getSettings().getProviderConfigWithKey()` is called (we'll preserve that wiring).
- The shape of `IpcContext` interface (where to add new fields).

- [ ] **Step 2: Replace the getter with a Layer**

Inside `createIpcContext`, AFTER the deps are resolved (db, llmClient, organizationService, activityDataService, config), add:

```ts
import { buildAnswerLayer } from '@main/services/answer-generation';

// inside createIpcContext, near the other service constructions:
const answerLayer = buildAnswerLayer({
  db,
  llmClient,
  orgService: organizationService,
  activityDataService,
});
```

Add to the returned context object:
- `answerLayer` (new)
- `providerConfig: config` (rename `config` exposure if not already named this, to disambiguate from any other config)

Drop the `answerGenerationService` lazy getter entirely.

Update the `IpcContext` type:
- Remove `answerGenerationService` field.
- Add `answerLayer: Layer.Layer<AnswerR>` field.
- Add `providerConfig: ProviderConfig` field.

- [ ] **Step 3: Rewrite the IPC handler**

```ts
// src/main/ipc/handlers/answer.ts
import { Effect } from 'effect';
import { z } from 'zod';
import * as answerSvc from '@main/services/answer-generation';
import type { IpcContext } from '../context';
import type { IpcTypeMap } from '../types';

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
      return Effect.runPromise(
        answerSvc
          .generate(parsed.question_id, ctx.providerConfig)
          .pipe(Effect.provide(ctx.answerLayer)),
      );
    },
    'answer:save': async (input) => {
      const parsed = saveInput.parse(input);
      return Effect.runPromise(
        answerSvc.save(parsed).pipe(Effect.provide(ctx.answerLayer)),
      );
    },
    'answer:list-by-questionnaire': async (input) => {
      const parsed = qidInput.parse(input);
      return Effect.runPromise(
        answerSvc
          .listByQuestionnaire(parsed.questionnaire_id)
          .pipe(Effect.provide(ctx.answerLayer)),
      );
    },
  };
}
```

- [ ] **Step 4: Update IPC handler tests**

Open `tests/main/ipc/answer-handlers.test.ts`. The Step 1 / Phase 2.2b version stubbed `ctx.answerGenerationService.generate` as `vi.fn().mockReturnValue(Effect.succeed(...))`. Now we need to stub the module function and the answerLayer.

Two valid approaches:
- **Approach A — mock the module:** `vi.mock('@main/services/answer-generation', () => ({ generate: vi.fn(), save: vi.fn(), listByQuestionnaire: vi.fn() }))` then `vi.mocked(answerSvc.generate).mockReturnValue(Effect.succeed(<answer>))`. Provide a trivial empty `answerLayer: Layer.empty` and `providerConfig` on the test ctx.
- **Approach B — real module, fake layer:** keep the real functions, build a `testLayer` with stubbed deps, and pass that as `ctx.answerLayer`. Effectively integration-tests through the function body.

Pick Approach A — it preserves the unit-test character of the handler tests (asserting the handler does its job, not the service body). The service body has its own tests.

Skeleton:

```ts
import * as answerSvc from '@main/services/answer-generation';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerHandlers } from '@main/ipc/handlers/answer';

vi.mock('@main/services/answer-generation', async () => {
  const actual = await vi.importActual<typeof import('@main/services/answer-generation')>(
    '@main/services/answer-generation',
  );
  return {
    ...actual,
    generate: vi.fn(),
    save: vi.fn(),
    listByQuestionnaire: vi.fn(),
  };
});

const FAKE_ANSWER = { id: 'a-1', question_id: 'q-1', value: '14820', unit: 'kWh', source_kind: 'ai_suggested' as const, source_calculation_snapshot_id: null, source_activity_data_id: null, source_company_profile_key: null, source_narrative_bank_id: null, source_summary: null, finalized_at: null };

function makeCtx() {
  return {
    answerLayer: Layer.empty,
    providerConfig: { provider: 'openai', model: 'x', apiKeyKeyref: 'k' },
  } as never;
}

describe('answer IPC handlers', () => {
  afterEach(() => vi.clearAllMocks());

  it('answer:generate returns the generated answer', async () => {
    vi.mocked(answerSvc.generate).mockReturnValue(Effect.succeed(FAKE_ANSWER) as never);
    const handlers = answerHandlers(makeCtx());
    const result = await handlers['answer:generate']!({ question_id: 'q-1' });
    expect(result).toEqual(FAKE_ANSWER);
    expect(answerSvc.generate).toHaveBeenCalledTimes(1);
  });

  it('answer:save returns the saved answer', async () => {
    vi.mocked(answerSvc.save).mockReturnValue(Effect.succeed(FAKE_ANSWER) as never);
    const handlers = answerHandlers(makeCtx());
    const result = await handlers['answer:save']!({
      question_id: 'q-1', value: '15000', unit: 'kWh', finalize: false,
    });
    expect(result).toEqual(FAKE_ANSWER);
  });

  it('answer:list-by-questionnaire returns the list', async () => {
    vi.mocked(answerSvc.listByQuestionnaire).mockReturnValue(Effect.succeed([FAKE_ANSWER]) as never);
    const handlers = answerHandlers(makeCtx());
    const result = await handlers['answer:list-by-questionnaire']!({ questionnaire_id: 'qn-1' });
    expect(result).toEqual([FAKE_ANSWER]);
  });
});
```

If the existing test file already followed a pattern (override slot for the service on `IpcContext`, etc.), adapt the mock above to match. The key change is mocking module functions instead of service methods.

- [ ] **Step 5: Run full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -15
pnpm vitest run --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean, 502 tests passing.

If failures:
- IPC context test failures — likely the `answerGenerationService` removal broke a context test that asserted the field exists. Update the assertion to expect `answerLayer` / `providerConfig` instead.
- Handler tests failing on `Layer.empty` — if `answerSvc.generate` mock isn't being respected, the `vi.mock` may need to come BEFORE the import of `answerHandlers`. Vitest hoists `vi.mock`, but verify.
- ABI flip recovery: `rm /Users/lxz/ws/personal/carbonbook/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && pnpm rebuild better-sqlite3`. Env, not regression.

- [ ] **Step 6: Sweep**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -3
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```

- [ ] **Step 7: Final commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "refactor(ipc): wire AnswerGenerationService via Layer.provide at IPC boundary"
git log --oneline -8
git branch --show-current
```

Expected: clean, 502 tests passing, branch `main`.

---

## Closeout

After T3 lands:

- `src/main/services/answer-generation/` contains 3 focused files (tags, errors, index).
- `answer-generation-service.ts` is deleted.
- IPC handlers provide a Layer at the call site.
- All 502 tests pass with no behavior change.
- The `Effect<A, E, R>` third parameter is real in production code for the first time.

**Three interview-grade insights from this refactor:**
1. **`R` is the environment.** It encodes "what services this Effect needs to run" at the type level. Effect refuses to `runPromise` until every Tag has a Layer.
2. **Layers are values.** `buildAnswerLayer({...})` returns a `Layer<AnswerR>` — first-class, composable. Mock = swap the Layer; prod = pass real deps.
3. **`Layer.succeed` vs `Layer.effect`.** Succeed is for already-constructed values; effect is for layers whose construction itself runs effects (async warmup, env probes). We only need `succeed` here.

**Next: Step 3** — `Effect.retry(Schedule.exponential(...))` on the LLM call + `Effect.forEach({ concurrency: 3 })` for "Generate all unanswered" button. Separate spec, separate plan.
