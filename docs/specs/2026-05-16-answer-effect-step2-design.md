# AnswerGenerationService — Effect Step 2: Context.Tag + Layer Refactor

**Date:** 2026-05-16
**Phase:** 2.2b-followup (Effect Step 2)
**Status:** Approved by user 2026-05-16; ready for plan.
**Predecessor:** `2026-05-15-questionnaire-auto-answer-design.md` (Step 1 — Effect.gen + Data.TaggedError, shipped on `main` through commit `94a7f3d`).
**Successor:** Step 3 — `Effect.retry(Schedule.exponential)` on the LLM call + `Effect.forEach({ concurrency: 3 })` for "Generate all unanswered" button. Separate spec.

## Why

Step 1 proved the `Effect.gen + Data.TaggedError + Effect.tryPromise` triad works in production. It used **constructor-injected deps** as a half-measure — the service has a `deps: { db, llmClient, orgService, activityDataService, config, now? }` field, and `Effect.gen` reads `this.deps.x` via locals captured before the generator.

That works, but it doesn't yet teach the third type parameter of `Effect<A, E, R>` — the **environment**. `R` is currently `never` everywhere, because deps live outside Effect's reach. Step 2 lifts each dep into a `Context.Tag` so the service's `R` becomes explicit:

```ts
// Before (Step 1):
generate(questionId: string): Effect.Effect<Answer, GenErr, never>

// After (Step 2):
generate(questionId: string, config: ProviderConfig):
  Effect.Effect<Answer, GenErr, DbTag | LLMClientTag | OrgServiceTag | ActivityDataServiceTag | NowTag>
```

The IPC boundary (`Effect.runPromise`) now requires a `Layer` that satisfies every Tag in `R` before it will compile. **The type system enforces dep wiring.** That's the interview-grade payoff: "Effect's environment makes 'what do I need' a first-class type, not a runtime convention."

## Scope

**In scope:**
- Convert `AnswerGenerationService` from a class with constructor DI to **module-level functions** (`generate`, `save`, `listByQuestionnaire`).
- Introduce 5 `Context.Tag` classes (`DbTag`, `LLMClientTag`, `OrgServiceTag`, `ActivityDataServiceTag`, `NowTag`).
- A `buildAnswerLayer(deps)` helper that composes `Layer.succeed` calls into a single `Layer` ready to provide.
- Rewire `IpcContext` to build the Layer once at IPC bootstrap and reuse across handlers.
- Update all 9 existing service tests to use `Effect.provide(Layer.mergeAll(...))` instead of constructor DI.

**Out of scope:**
- Adding retries / concurrency (that's Step 3).
- Tagging `ProviderConfig` — it's data, passes as a function parameter. (Reason below.)
- Making `LLMClient.generateAnswer` itself an Effect-returning method. It stays Promise-based; `Effect.tryPromise` is still our boundary.
- Migrating other services (`QuestionnaireService`, `ActivityDataService`, etc.) to Tags. Effect lives inside `AnswerGenerationService` and the answer IPC handlers only.
- Any behavior change. 502 tests must still pass at the end.

## Design

### File layout

```
src/main/services/answer-generation/
  ├── tags.ts                     -- 5 Context.Tag classes + buildAnswerLayer helper
  ├── errors.ts                   -- the 8 Data.TaggedError classes + GenErr/SaveErr types
  └── index.ts                    -- generate, save, listByQuestionnaire + private helpers
```

The current single file `src/main/services/answer-generation-service.ts` (≈260 LOC) is split into three files to keep each focused. The renderer and IPC layers continue to import from a single barrel — `import { generate, save, listByQuestionnaire } from '@main/services/answer-generation'`.

**Why split now?** The class file currently mixes (a) typed errors (50 LOC), (b) the service body (90 LOC), (c) private helper Effects (70 LOC). Step 2 adds Tags (40 LOC) + the layer helper (20 LOC). Without a split, the single file pushes 300+ LOC with three distinct concerns. With the split, each file is ≤150 LOC.

### Tags

All five use the class-based `Context.Tag` pattern (Effect 3.x idiomatic):

```ts
// src/main/services/answer-generation/tags.ts
import { Context, Layer } from 'effect';
import type { Database } from 'better-sqlite3';
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

**Tag identifier convention:** `'answer/Db'` namespaced — when more services adopt Tags later (Steps 4+), the namespace prevents collisions if two services both want a `Db` tag with different shapes.

**Why `NowTag` instead of Effect's built-in `Clock`?** Effect's `Clock.currentTimeMillis` returns millis, not ISO strings. Our DB rows store ISO timestamps. A bespoke `NowTag` keeps the call site simple (`const now = yield* NowTag; const ts = now();`) versus `const ts = new Date(yield* Clock.currentTimeMillis).toISOString()`. We can revisit if Clock proves useful elsewhere.

**`Layer.succeed` vs `Layer.effect`:**
- `Layer.succeed(Tag, value)` — for already-constructed values. Our case: all four deps exist at IPC bootstrap time.
- `Layer.effect(Tag, Effect<Service>)` — for layers whose construction itself needs effects (a DB pool that opens async, an HTTP client that authenticates). Not needed in Step 2; noted here for when it does matter (e.g. if `LLMClient` ever needs an async warmup, the layer becomes `Layer.effect(LLMClientTag, Effect.promise(...))`).

### Module-level service functions

```ts
// src/main/services/answer-generation/index.ts
import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { ProviderNotConfiguredError, SchemaMismatchError } from '@main/llm/llm-client';
import type { Answer, ProviderConfig } from '@shared/types';
import {
  AnswerNotFound, InventoryEmpty, LLMCallFailed, LLMSchemaMismatch,
  ProviderNotConfigured, QuestionAlreadyAnswered, QuestionnaireNotFound,
  QuestionNotFound, type GenErr, type SaveErr, type SaveInput,
} from './errors';
import {
  ActivityDataServiceTag, AnswerR, DbTag, LLMClientTag, NowTag, OrgServiceTag,
} from './tags';

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
      try: () => llmClient.generateAnswer(config, {
        raw_text: question.raw_text,
        expected_unit: question.expected_unit,
        question_kind: question.question_kind,
      }, inventory),
      catch: (cause): GenErr =>
        cause instanceof ProviderNotConfiguredError ? new ProviderNotConfigured()
        : cause instanceof SchemaMismatchError ? new LLMSchemaMismatch({ raw: cause.rawText ?? '' })
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
      db.prepare(`UPDATE answer SET value = ?, unit = ?, source_kind = 'manual', finalized_at = ? WHERE question_id = ?`)
        .run(input.value, input.unit, finalizedAt, input.question_id);
    });
    return yield* Effect.sync(
      () => db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get(input.question_id) as Answer,
    );
  });
}

export function listByQuestionnaire(questionnaireId: string): Effect.Effect<Answer[], never, DbTag> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    return db.prepare(`
      SELECT a.* FROM answer a
      JOIN question q ON q.id = a.question_id
      WHERE q.questionnaire_id = ?
      ORDER BY q.position
    `).all(questionnaireId) as Answer[];
  });
}

// Helpers below: readQuestion / readAnswerByQuestion / readQuestionnaire /
// loadInventoryContext / insertAnswer — unchanged from Step 1; they take
// db / services as plain parameters (no Tags), because they're called from
// inside Effect.gen blocks that already have the deps in scope.
```

**Why helpers stay parameter-based:** The helpers are private and called only from inside Tagged Effect.gen blocks. Threading Tags through them adds noise without benefit. The pattern is: **public entry points read Tags; private helpers take values**. This is the idiomatic Effect approach — `R` is for service-level deps, not internal plumbing.

**Note on `save`'s `R`:** It only needs `DbTag | NowTag`, not the full `AnswerR`. TypeScript will infer the narrower set. When the IPC handler provides `buildAnswerLayer(deps)` (which satisfies all 5 Tags), TypeScript is happy because `Layer<AnswerR>` is a supertype of `Layer<DbTag | NowTag>`. **Lesson:** Effect's `R` is contravariant — a function asking for fewer Tags is satisfied by a Layer providing more.

### IPC boundary

```ts
// src/main/ipc/context.ts (the lazy getter is replaced)
import { buildAnswerLayer } from '@main/services/answer-generation/tags';

// inside createIpcContext:
const answerLayer = buildAnswerLayer({
  db,
  llmClient,
  orgService: organizationService,
  activityDataService,
});

return {
  // ...
  answerLayer,
  // ...
};
```

```ts
// src/main/ipc/handlers/answer.ts
import { Effect } from 'effect';
import * as answerSvc from '@main/services/answer-generation';

export function answerHandlers(ctx: IpcContext): { ... } {
  return {
    'answer:generate': async (input) => {
      const parsed = idInput.parse(input);
      return Effect.runPromise(
        answerSvc.generate(parsed.question_id, ctx.providerConfig).pipe(Effect.provide(ctx.answerLayer))
      );
    },
    'answer:save': async (input) => {
      const parsed = saveInput.parse(input);
      return Effect.runPromise(
        answerSvc.save(parsed).pipe(Effect.provide(ctx.answerLayer))
      );
    },
    'answer:list-by-questionnaire': async (input) => {
      const parsed = qidInput.parse(input);
      return Effect.runPromise(
        answerSvc.listByQuestionnaire(parsed.questionnaire_id).pipe(Effect.provide(ctx.answerLayer))
      );
    },
  };
}
```

**Key shift from Step 1:** the handler no longer reads `ctx.answerGenerationService.generate(...)`. Instead, it imports the function directly and provides the Layer at the call site. The IpcContext just carries the pre-built Layer + the `ProviderConfig` value.

### Tests

```ts
// tests/main/services/answer-generation-service.test.ts (now tests/main/services/answer-generation/...)
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import {
  ActivityDataServiceTag, DbTag, LLMClientTag, NowTag, OrgServiceTag,
} from '@main/services/answer-generation/tags';
import * as answerSvc from '@main/services/answer-generation';

function setupLayer(opts: {...}) {
  const db = new Database(':memory:');
  runMigrations(db);
  // ... seed rows ...
  const orgService = { getCurrentOrganization: vi.fn()..., listReportingPeriodsByOrganization: vi.fn()... };
  const activityDataService = { listByPeriod: vi.fn()..., totalsByPeriod: vi.fn()... };
  const llmClient = { generateAnswer: vi.fn()... };

  const testLayer = Layer.mergeAll(
    Layer.succeed(DbTag, db),
    Layer.succeed(LLMClientTag, llmClient as never),
    Layer.succeed(OrgServiceTag, orgService as never),
    Layer.succeed(ActivityDataServiceTag, activityDataService as never),
    Layer.succeed(NowTag, () => '2026-05-15T12:00:00Z'),
  );

  return { db, testLayer, llmClient, FAKE_CONFIG };
}

it('happy path', async () => {
  const { testLayer, llmClient, FAKE_CONFIG } = setupLayer({ ... });
  const result = await Effect.runPromise(
    answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer))
  );
  expect(result.value).toBe('14820');
});
```

**Test diff scale:** ~80 lines changed across 9 tests. Mostly mechanical — replace `svc.generate('q-1')` with `answerSvc.generate('q-1', FAKE_CONFIG).pipe(Effect.provide(testLayer))`. The assertion bodies are unchanged.

## Decision points (and rationale)

| Decision | Choice | Why |
|---|---|---|
| Service shape | Module functions, class deleted | User picked module style; matches idiomatic Effect 3.x docs |
| Number of Tags | 5 (4 deps + Now) | Each external dependency becomes a Tag; clock matters for tests |
| `ProviderConfig` | Plain function parameter | It's data, not a service; per-call data shouldn't sneak into `R` |
| Layer composition | One pre-built layer at IPC boot | Avoids rebuilding per request; idiomatic for long-lived deps |
| `Layer.succeed` vs `Layer.effect` | Only `succeed` | All deps exist at boot; no async warmup |
| Built-in `Clock` | Skip; use bespoke `NowTag` | Clock returns millis; we want ISO strings; conversion ceremony not worth it |
| File split | Three files (tags / errors / index) | Keeps each focused at ≤150 LOC |
| Helpers (`readQuestion` etc.) | Stay parameter-based | Private; called inside Effect.gen with deps in scope; threading Tags adds noise |
| Test setup | Layer.mergeAll factory | Mirrors prod Layer composition; teaches the pattern |

## Risk + rollback

**Risk:** Three tasks, each touches files the IPC layer or tests depend on. Mid-T2 the test suite will be red until tests are updated. Mitigation: T1 introduces only new files (no test breakage). T2 is "convert service + tests together" — atomic commit. T3 rewires IPC and verifies all 502 tests green.

**Rollback:** If Step 2 misbehaves in any way, revert is `git revert <T1>..<T3>`. The Step 1 service shape returns. No DB migration, no data-shape change — pure code restructure.

**Forward compatibility:** When Step 3 lands `retry` and `forEach({ concurrency })`, those operators compose cleanly with the Tagged service — `generate(qid, config).pipe(Effect.retry(...), Effect.provide(answerLayer))`. The Tag refactor makes Step 3 trivial.

## Closeout criteria

- All 502 tests still pass (no regression).
- `pnpm typecheck` clean.
- `answer-generation-service.ts` deleted; replaced by `answer-generation/{tags,errors,index}.ts`.
- IPC handlers import `* as answerSvc` and provide `ctx.answerLayer`.
- One commit per task: T1 Tags+Layer helper · T2 service-rewrite+tests · T3 IPC rewire+sweep.
- Effect's `R` type parameter appears in production signatures for the first time.
