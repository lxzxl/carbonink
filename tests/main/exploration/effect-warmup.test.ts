/**
 * Effect TS — Step 0 warmup exercise.
 *
 * Goal: confirm the `effect` package installs cleanly, the TS types look the
 * way the learning doc describes, and the runtime executes in this project's
 * vitest setup. This file is intentionally a self-contained tutorial — each
 * `it()` block demonstrates ONE concept from `docs/research/2026-05-15-effect-ts-adoption.md`.
 *
 * Re-reading order (matches the doc):
 *   1. Effect<A, E, R> as a typed Promise+errors+deps
 *   2. Effect.gen as the async/await analog
 *   3. Effect.tryPromise — wrap a real Promise
 *   4. Data.TaggedError + Effect.catchTag — typed error recovery
 *   5. Context.Tag + Layer — compile-time DI preview
 *
 * NOTE: This file lives in tests/exploration/. The dir is not vitest-excluded,
 * so vitest will run these as regular tests. That's the goal — failing tests
 * here would mean the Effect runtime is broken in our environment.
 *
 * NOTE: This is pedagogy, not production code. Several patterns here (e.g. the
 * inline Context.Tag declaration) would live in dedicated tags.ts / errors.ts
 * files in a real Effect service. Phase 2.2b's AnswerGenerationService will
 * show the production shape.
 */

import { Context, Data, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

// ----------------------------------------------------------------------------
// 1. Effect<A, E, R> as a value
// ----------------------------------------------------------------------------
//
// An Effect is "a description of a computation". Until you run it, nothing
// happens — it's just data. Compare with a Promise, which starts executing
// the moment you construct it.

describe('Effect.succeed + Effect.runPromise', () => {
  it('Effect.succeed("hi") produces a value when executed', async () => {
    // Build the description. Type: Effect<string, never, never>.
    const program: Effect.Effect<string, never, never> = Effect.succeed('hi');

    // Run it through the default runtime. Returns a real Promise<A>.
    const result = await Effect.runPromise(program);
    expect(result).toBe('hi');
  });

  it('Effect.fail(e) rejects when run with runPromise', async () => {
    class Boom extends Data.TaggedError('Boom')<{ reason: string }> {}

    const program = Effect.fail(new Boom({ reason: 'kaboom' }));

    await expect(Effect.runPromise(program)).rejects.toThrow();
  });
});

// ----------------------------------------------------------------------------
// 2. Effect.gen — the async/await analog (generator-based)
// ----------------------------------------------------------------------------
//
// `function* () { yield* otherEffect }` reads like `async () { await otherFn() }`.
// `yield*` extracts the success value of an Effect, OR short-circuits with
// the error type up the call stack.

describe('Effect.gen', () => {
  it('composes two effects sequentially', async () => {
    const step1 = Effect.succeed(2);
    const step2 = (x: number) => Effect.succeed(x * 21);

    const program = Effect.gen(function* () {
      const a = yield* step1;
      const b = yield* step2(a);
      return b;
    });

    expect(await Effect.runPromise(program)).toBe(42);
  });

  it('short-circuits on the first failed yield', async () => {
    class Fail extends Data.TaggedError('Fail')<{ at: string }> {}

    const program = Effect.gen(function* () {
      const a = yield* Effect.succeed(1);
      yield* Effect.fail(new Fail({ at: 'step-2' }));
      // Unreachable. The function returns immediately with the failure.
      return a + 999;
    });

    const exit = await Effect.runPromiseExit(program);
    expect(exit._tag).toBe('Failure');
  });
});

// ----------------------------------------------------------------------------
// 3. Effect.tryPromise — wrap a Promise-returning function
// ----------------------------------------------------------------------------
//
// Most existing async/await APIs live on the Promise side of the world.
// `Effect.tryPromise({ try, catch })` lifts them into Effect-land, with a
// typed error for the rejection case.

describe('Effect.tryPromise', () => {
  class FetchFailed extends Data.TaggedError('FetchFailed')<{ cause: unknown }> {}

  it('wraps a resolving Promise into Effect.succeed', async () => {
    const wrap = Effect.tryPromise({
      try: () => Promise.resolve(99),
      catch: (cause) => new FetchFailed({ cause }),
    });

    expect(await Effect.runPromise(wrap)).toBe(99);
  });

  it('wraps a rejecting Promise into a typed failure', async () => {
    const wrap = Effect.tryPromise({
      try: () => Promise.reject(new Error('network down')),
      catch: (cause) => new FetchFailed({ cause }),
    });

    const exit = await Effect.runPromiseExit(wrap);
    expect(exit._tag).toBe('Failure');
    // The error is the FetchFailed instance, not the raw Error — typed.
    if (exit._tag === 'Failure') {
      const failure = exit.cause;
      // Effect's Cause type is rich; here we just confirm it's not a Success.
      expect(failure).toBeDefined();
    }
  });
});

// ----------------------------------------------------------------------------
// 4. Data.TaggedError + Effect.catchTag — typed error recovery
// ----------------------------------------------------------------------------
//
// Errors are values, tagged by a string discriminator (`_tag`). catchTag
// matches on the tag — the compiler can prove exhaustiveness.

describe('Data.TaggedError + Effect.catchTag', () => {
  class NotFound extends Data.TaggedError('NotFound')<{ id: string }> {}
  class Timeout extends Data.TaggedError('Timeout')<{ ms: number }> {}

  const lookup = (
    id: string,
  ): Effect.Effect<string, NotFound | Timeout, never> =>
    id === 'slow'
      ? Effect.fail(new Timeout({ ms: 1000 }))
      : id === 'gone'
        ? Effect.fail(new NotFound({ id }))
        : Effect.succeed(`record:${id}`);

  it('catchTag recovers only the matching error', async () => {
    // Recover from NotFound by returning a default; let Timeout pass through.
    const safe = (id: string) =>
      lookup(id).pipe(
        Effect.catchTag('NotFound', (_e) => Effect.succeed('fallback')),
      );

    expect(await Effect.runPromise(safe('ok'))).toBe('record:ok');
    expect(await Effect.runPromise(safe('gone'))).toBe('fallback');
    // 'slow' still fails — catchTag('NotFound') doesn't touch Timeout.
    const exit = await Effect.runPromiseExit(safe('slow'));
    expect(exit._tag).toBe('Failure');
  });

  it('catchTags handles multiple tagged errors at once', async () => {
    const safe = (id: string) =>
      lookup(id).pipe(
        Effect.catchTags({
          NotFound: () => Effect.succeed('default-for-missing'),
          Timeout: (e) => Effect.succeed(`default-for-timeout-${e.ms}ms`),
        }),
      );

    expect(await Effect.runPromise(safe('gone'))).toBe('default-for-missing');
    expect(await Effect.runPromise(safe('slow'))).toBe('default-for-timeout-1000ms');
  });
});

// ----------------------------------------------------------------------------
// 5. Context.Tag + Layer — compile-time dependency injection (preview)
// ----------------------------------------------------------------------------
//
// In production code these declarations live in dedicated tags.ts / layers.ts
// files. The pattern here previews what Phase 2.2b's AnswerGenerationService
// will look like (dependency on a Clock and a LoggerService, both injected
// via tags).

describe('Context.Tag + Layer (DI preview)', () => {
  // Define a service interface as a Tag. The first type arg is the tag
  // identity; the second is the service's method shape.
  class Clock extends Context.Tag('Clock')<Clock, { now: () => number }>() {}

  // Live implementation — would normally come from `Layer.effect(...)` if it
  // needed to construct anything. Here Layer.succeed is enough.
  const ClockLive = Layer.succeed(Clock, { now: () => Date.now() });

  // Test implementation — returns a fixed timestamp so tests are deterministic.
  const ClockTest = Layer.succeed(Clock, { now: () => 1_700_000_000_000 });

  it('a program declares its dependency by yielding the Tag', async () => {
    // Program of type Effect<number, never, Clock> — the R is non-empty.
    const program = Effect.gen(function* () {
      const clock = yield* Clock;
      return clock.now();
    });

    // Providing the test layer satisfies R; the resulting Effect has R=never
    // and can be run.
    const wired = program.pipe(Effect.provide(ClockTest));
    expect(await Effect.runPromise(wired)).toBe(1_700_000_000_000);
  });

  it('swap layers freely — same program, different implementation', async () => {
    const program = Effect.gen(function* () {
      const clock = yield* Clock;
      return clock.now();
    });

    const liveResult = await Effect.runPromise(program.pipe(Effect.provide(ClockLive)));
    const testResult = await Effect.runPromise(program.pipe(Effect.provide(ClockTest)));

    expect(typeof liveResult).toBe('number');
    expect(testResult).toBe(1_700_000_000_000);
    // Live time is the actual now — and definitely past the test fixed time.
    expect(liveResult).toBeGreaterThan(testResult);
  });
});
