# Effect TS Adoption — Learning Notes for carbonbook

**Date:** 2026-05-15
**Status:** Active adoption plan. Phase 2.2b's `AnswerGenerationService` will be the first production code written in Effect TS.
**Goal:** Learn Effect TS hands-on by writing 1-2 new services in it, while the rest of the codebase stays in the existing async/await style. Build interview-grade understanding of the library.

This document is the single learning artifact — keep it open while writing the first Effect TS service, revisit before interviews. Examples are based on real carbonbook code so the patterns are concrete.

## TL;DR — what Effect TS is

Effect TS is a TypeScript port of [ZIO](https://zio.dev/) (Scala). The central idea: **describe what your program does as a typed value** (`Effect<A, E, R>`), then run it through an interpreter. You stop using `Promise` + `try/catch` + dependency-injection-via-constructors and instead get one unified primitive that carries:

- `A` — success type (what it produces)
- `E` — error type (the named ways it can fail — typed errors are part of the signature)
- `R` — requirements / dependencies (a phantom type listing the services it needs from context)

Mental model: `Effect<A, E, R>` is `() => Promise<A>` + typed errors + typed dependency injection + cancellation + retry/schedule + resource safety, all built into the type.

## Why bother? (the elevator pitch)

| Concern | Promise / async-await | Effect TS |
|---|---|---|
| Error handling | `throw` is invisible in types; downstream callers don't know what can fail | Errors are in the type; the compiler forces you to handle each named error |
| Composition | `await`-chains; partial-failure recovery requires `try/catch` per step | `Effect.gen` reads like async/await; recovery via `Effect.catchTag`, retry via `Schedule` |
| Dependency injection | Constructor params, factory functions, manual wiring | `Context.Tag` + `Layer` declarative graphs |
| Cancellation | `AbortSignal` plumbed manually | First-class via fibers, no extra plumbing |
| Resource safety | try/finally everywhere | `Effect.acquireUseRelease`, `Scope` |
| Concurrency | `Promise.all` / `Promise.allSettled` + manual limits | `Effect.forEach(..., { concurrency: N })`, `Stream`, interruption-aware |

The cost is real:
- **Learning curve** is steep (1-2 weeks to feel comfortable; months to feel deep).
- **Bundle size** adds ~50-100 KB gzipped to the main process.
- **Codebase split** — Effect-style services look very different from non-Effect ones; the boundary needs discipline.
- **Type errors** can be cryptic at first.

## The carbonbook adoption rule (the "boundary")

Effect is contained inside individual **services**. The IPC handler layer translates Effect → Promise at the wire boundary:

```
                Renderer (React, TanStack Query)
                         │
                         ▼   Promise via window.api.invoke
                ┌────────────────────┐
                │ IPC handlers (zod) │   ← translation boundary
                │ Effect.runPromise  │
                └────────┬───────────┘
                         │
                         ▼   Effect<A, E, R>
                ┌────────────────────┐
                │  Effect Service    │   ← internal: pure Effect
                │  (Phase 2.2b)      │
                └────────────────────┘
```

Inside the service: pure Effect. Layer-built dependencies, typed errors, `Effect.gen`, retry, concurrency. Outside the service: existing async/await codebase unchanged. The handler does one `Effect.runPromise(program.pipe(Effect.provide(layer)))`.

**Why a boundary:** preserves the 449 tests already on `main` + lets us undo the experiment by rewriting one service back to async/await if Effect feels wrong, without touching anything else.

## Core concepts — explained with carbonbook examples

### 1. `Effect<A, E, R>` — the foundational type

The "I do something that either produces an A, or fails with one of the errors in E, given the services in R" type.

```ts
import { Effect, Data } from 'effect';

class LLMTimeoutError extends Data.TaggedError('LLMTimeout')<{ ms: number }> {}
class LLMSchemaError extends Data.TaggedError('LLMSchema')<{ raw: string }> {}

// A function that produces a doc_type string OR null, with two possible
// typed errors, requiring no services from context (R = never).
declare const classify: (
  text: string,
) => Effect.Effect<string | null, LLMTimeoutError | LLMSchemaError, never>;
```

Compare with carbonbook's existing `LLMClient.classifyDocument`:

```ts
// Current — async/await
async classifyDocument(
  config: ProviderConfig,
  parsedText: string,
  images: Buffer[],
): Promise<{ doc_type: string | null; confidence: number }> {
  // throws SchemaMismatchError, ProviderNotConfiguredError, network errors...
  // — but the signature doesn't say so; callers learn by reading the body
}
```

The Effect signature would name the errors:

```ts
classifyDocument(
  config: ProviderConfig,
  parsedText: string,
  images: Buffer[],
): Effect.Effect<
  { doc_type: string | null; confidence: number },
  ProviderNotConfigured | SchemaMismatch | NetworkError,
  never
>
```

**Interview-grade takeaway:** Promise has `Promise<A>` — the failure type is missing. Effect has `Effect<A, E, R>` — failure is on the type. This is the same shift as `Result<T, E>` in Rust or `Either` in Haskell, but plus tracked dependencies (R).

### 2. `Effect.gen` — the async-await analog

```ts
// Current ClassificationService.classifyAndRun (paraphrased):
async classifyAndRun(documentId: string): Promise<ClassifyAndRunResult> {
  const doc = this.docService.getById(documentId);
  if (!doc) return { status: 'classify_failed' };
  if (doc.doc_type) {
    const ext = await this.extractionService.run({ document_id: documentId, stage_id: doc.doc_type });
    return { status: 'classified', extraction: ext, doc_type: doc.doc_type };
  }
  try {
    const result = await this.llmClient.classifyDocument(this.config, doc.text, []);
    if (!result.doc_type || result.confidence < 0.7) return { status: 'classify_failed' };
    this.docService.updateDocType(documentId, result.doc_type);
    const ext = await this.extractionService.run({ document_id: documentId, stage_id: result.doc_type });
    return { status: 'classified', extraction: ext, doc_type: result.doc_type };
  } catch {
    return { status: 'classify_failed' };
  }
}
```

In Effect, the same orchestration reads like:

```ts
const classifyAndRun = (documentId: string) =>
  Effect.gen(function* () {
    const docs = yield* DocumentService;
    const ext  = yield* ExtractionService;
    const llm  = yield* LLMService;

    const doc = yield* docs.getById(documentId);
    if (!doc) return { status: 'classify_failed' as const };

    if (doc.doc_type) {
      const extraction = yield* ext.run({ document_id: documentId, stage_id: doc.doc_type });
      return { status: 'classified' as const, extraction, doc_type: doc.doc_type };
    }

    const result = yield* llm.classifyDocument(doc.text, []).pipe(
      Effect.catchAll(() => Effect.succeed({ doc_type: null, confidence: 0 })),
    );
    if (!result.doc_type || result.confidence < 0.7) return { status: 'classify_failed' as const };

    yield* docs.updateDocType(documentId, result.doc_type);
    const extraction = yield* ext.run({ document_id: documentId, stage_id: result.doc_type });
    return { status: 'classified' as const, extraction, doc_type: result.doc_type };
  });
```

**Key observations:**

- `Effect.gen(function*() {})` is the generator-based syntax — `yield*` is the rough analog of `await`.
- The function never returns a `Promise`. It returns an `Effect` value that's not "running" yet.
- `Effect.catchAll` catches errors (compare with try/catch) — but typed.
- Dependencies (`DocumentService`, `ExtractionService`, `LLMService`) come from context via `yield* TagName`, not constructor params. The R parameter in the type signature will list these.

### 3. Typed errors — `Data.TaggedError`

Instead of `throw new Error('...')`, you define each error class with a tag and a payload. The tag is what `Effect.catchTag('TagName', handler)` matches.

```ts
import { Data } from 'effect';

class DocumentNotFound extends Data.TaggedError('DocumentNotFound')<{ id: string }> {}
class ProviderNotConfigured extends Data.TaggedError('ProviderNotConfigured')<{ provider: string }> {}
class LLMSchemaMismatch extends Data.TaggedError('LLMSchemaMismatch')<{ raw: string }> {}
```

Usage in service:

```ts
Effect.gen(function* () {
  const doc = yield* docs.getById(id);
  if (!doc) return yield* Effect.fail(new DocumentNotFound({ id }));
  // ...
});
```

Recovery:

```ts
program.pipe(
  Effect.catchTag('DocumentNotFound', (e) =>
    Effect.succeed({ status: 'classify_failed' as const }),
  ),
  Effect.catchTag('LLMSchemaMismatch', (e) =>
    // could log, retry with simpler prompt, etc.
    Effect.succeed({ status: 'classify_failed' as const }),
  ),
);
```

**Interview-grade takeaway:** unlike `instanceof` checks in JavaScript (which break across module realms, get tripped up by transpilation, etc.), `Data.TaggedError` uses a string discriminator (`_tag`). It's robust and supports exhaustive pattern matching via `Effect.catchTags({...})`.

### 4. Dependency injection — `Context.Tag` and `Layer`

Instead of constructor params, services declare what they need via `Context.Tag` and Effect's runtime provides them via `Layer`.

```ts
import { Context, Layer, Effect } from 'effect';

// Define the "service interface" as a Context.Tag.
class LLMService extends Context.Tag('LLMService')<
  LLMService,
  {
    classifyDocument: (text: string) => Effect.Effect<{ doc_type: string | null }, LLMError>;
  }
>() {}

// One implementation, expressed as a Layer.
const LLMServiceLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* ConfigService; // depend on ConfigService Tag
    return {
      classifyDocument: (text) =>
        Effect.tryPromise({
          try: () => /* call AI SDK */,
          catch: (err) => new LLMError({ cause: err }),
        }),
    };
  }),
);

// And a test layer for unit tests.
const LLMServiceTest = Layer.succeed(LLMService, {
  classifyDocument: () => Effect.succeed({ doc_type: 'fuel_receipt.v1' }),
});
```

Usage:

```ts
const program = Effect.gen(function* () {
  const llm = yield* LLMService; // type narrowing — TS knows the methods
  return yield* llm.classifyDocument('柴油 45L');
});

// In the IPC handler:
const result = await Effect.runPromise(
  program.pipe(Effect.provide(LLMServiceLive)),
);
```

**Interview-grade takeaway:** `Context.Tag` is like an abstract type / interface; `Layer` is like a binding / module. The compiler tracks which services your program depends on via the R parameter of `Effect<A, E, R>`. Running an Effect without satisfying all R dependencies is a type error.

This is **compile-time DI** — the rough TS analog of Rust's trait objects + Bevy ECS resources, or Spring's `@Autowired` but without the magic.

### 5. Retry + Schedule — for flaky LLM calls

```ts
import { Effect, Schedule } from 'effect';

const classifyWithRetry = classify(text).pipe(
  // Retry up to 3 times on any LLMTimeout, with exponential backoff.
  Effect.retry({
    schedule: Schedule.exponential('200 millis').pipe(Schedule.compose(Schedule.recurs(3))),
    while: (err) => err._tag === 'LLMTimeout',
  }),
);
```

In current carbonbook code, retry would be a manual `for` loop with `await sleep(backoff)`. Effect's `Schedule` is a composable algebra — you can multiply / pick / cap schedules.

### 6. Concurrency — `Effect.forEach` with `concurrency`

For Phase 2.2b's answer generation across N questions:

```ts
// Generate answers for every question in a questionnaire, max 3 at a time.
const generateAll = (questions: Question[]) =>
  Effect.forEach(questions, (q) => generateAnswer(q), {
    concurrency: 3,
    // If one fails, cancel the rest in-flight (interruption is free).
    discard: false,
  });
```

Compare with `Promise.all` (no limit, no cancellation) or manual `p-limit` (works but no interruption coupling).

## What we will ACTUALLY do in Phase 2.2b

Phase 2.2b builds `AnswerGenerationService.generate(questionId)` — the orchestrator that takes a question, queries inventory data, calls the LLM, and writes back an answer row. This service will be **fully Effect**:

1. **Typed errors**: `QuestionNotFound`, `InventoryEmpty`, `LLMSchemaMismatch`, `LLMTimeout`.
2. **Layered services**: `QuestionRepo`, `InventoryRepo`, `LLMService`, `ConfigService` as `Context.Tag`s; Live + Test layers.
3. **`Effect.gen`** for the orchestration body.
4. **`Effect.retry`** on the LLM call (LLM 5xx / rate-limit).
5. **`Effect.forEach`** with `{ concurrency: 3 }` for batch answer generation (answering a whole questionnaire).
6. **`Effect.runPromise(program.pipe(Effect.provide(layer)))`** at the IPC handler boundary.

The classification service, questionnaire service, etc. remain in their current async/await style — that's the boundary discipline.

## Files we'll add

- `src/main/effect/runtime.ts` — the shared `ManagedRuntime` that the IPC handlers use to call into Effect services. Avoids constructing a layer per-call.
- `src/main/effect/errors.ts` — central place for `Data.TaggedError` definitions used across Effect services.
- `src/main/effect/tags.ts` — central `Context.Tag` declarations for Effect services.
- `src/main/services/answer-generation-service.ts` — Phase 2.2b. The first Effect service.

## Pedagogical sequence — how to read this doc

Don't try to absorb everything in one pass. Walk through the codebase as you learn:

1. **Effect first**: read sections 1-2 (Effect type + gen). Understand `Effect<A, E, R>` as "a typed Promise + dependencies".
2. **Errors**: section 3. Read `src/main/llm/llm-client.ts`'s `SchemaMismatchError`; imagine it as a `Data.TaggedError`.
3. **DI**: section 4. Read `src/main/ipc/context.ts` — the lazy-getter pattern is informal DI. Effect's `Context.Tag` + `Layer` is the formalized version.
4. **Retry**: section 5. Read `LLMClient.extract`'s try/catch — that's where retry should live; `Schedule` is the proper abstraction.
5. **Concurrency**: section 6. Phase 2.2b answer generation = `forEach(concurrency: 3)`.
6. After Phase 2.2b ships: re-read this doc. The patterns will click harder because you'll have written them.

## Interview prep — questions you should be able to answer cold

After Phase 2.2b ships, you should be able to:

1. **"What is Effect TS?"** — A TS port of ZIO. Models programs as `Effect<A, E, R>` values describing what they do, including success type, error type, and dependencies. Run them through an interpreter.
2. **"Why typed errors?"** — Because `Promise<A>` hides failure modes from callers. With typed errors as part of the type, the compiler forces handling, and you can `catchTag` specific failures without `instanceof` fragility.
3. **"What's `Context.Tag` / `Layer`?"** — `Tag` is a service interface declared at type-level (`R` parameter). `Layer` is the binding / implementation. The runtime composes layers to build the service graph. Compile-time DI.
4. **"How does Effect's concurrency differ from `Promise.all`?"** — Effect uses fibers (lightweight green threads). Cancellation is automatic and propagates; `Promise` has no native cancellation. You can bound concurrency, race fibers, supervise child fibers, all without bolting on libraries.
5. **"When would you NOT use Effect TS?"** — Tiny projects (overhead doesn't pay off). Teams without time to absorb the learning curve. Code that lives at the edge (IPC handlers, UI event handlers) — pragmatic to translate to Promise at the boundary rather than push Effect everywhere.
6. **"What's the cost?"** — Bundle size ~50-100 KB. Learning curve 1-2 weeks. Cryptic compiler errors early on. Style mismatch with non-Effect code in the same repo.
7. **"What's a `Schedule`?"** — A composable description of "when to repeat" — used by `Effect.retry` and `Effect.repeat`. You can build complex schedules by composing primitives: `exponential`, `recurs`, `jittered`, `whileInput`. Like RxJS's backoff operators but algebraic.
8. **"Effect vs `neverthrow` / `fp-ts`?"** — `neverthrow` only adds `Result<T, E>` — much simpler, fewer features. `fp-ts` is the older functional ecosystem; less ergonomic, less batteries-included than Effect. Effect is the "modern, opinionated" choice in 2026.

## Resources

- Official docs: https://effect.website/
- Effect Discord (the community is responsive)
- Lucas Barake's Effect series on YouTube — great onboarding tutorials
- Ecosystem packages: `@effect/schema` (zod-equivalent), `@effect/platform-node` (file system, HTTP), `@effect/sql` (DB)

For carbonbook specifically, watch out for:
- We use better-sqlite3 (sync). Wrap sync calls in `Effect.sync(...)`, fallible sync in `Effect.try({...})`.
- We use AI SDK 6 (Promise-based). Wrap in `Effect.tryPromise({ try, catch })`.
- We use Electron IPC. The handler is the natural Effect-runPromise boundary.

## Out of scope for this initial adoption

- Effect Streams (`Stream`) — not needed for Phase 2.2b. Useful later if we process large datasets row-by-row.
- `@effect/schema` — we already use zod everywhere; not changing schema lib for v1 even though `@effect/schema` integrates cleaner with Effect errors.
- Effect's actor system / `RequestResolver` — overkill for our scale.
- React + Effect (RxJS-like Streams driving components) — UI stays in TanStack Query.
