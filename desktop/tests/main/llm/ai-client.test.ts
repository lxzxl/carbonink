import type { StreamOptions } from '@earendil-works/pi-ai';
import {
  type FauxProviderRegistration,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
} from '@earendil-works/pi-ai';
import { AiClientTag, buildAiClientLayer } from '@main/llm/ai-client';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfigV2 } from '@shared/types';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
//
// `CredentialService.get(key)` is synchronous and returns `string | null`.
// Tests build a stub that matches that real shape (a vi.fn-mocked async one
// would silently pass through main-process boundaries but blow up here).

function fakeCredentials(apiKey: string | null = 'sk-fake-test-key'): CredentialService {
  return {
    get: vi.fn((_key: string) => apiKey),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

function fakeConfig(): ProviderConfigV2 {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
  };
}

/**
 * Build a faux response factory that simulates a given HTTP status via the
 * pi-ai `onResponse` hook. The faux provider's default 200 fires first; this
 * factory re-invokes `onResponse` with the desired status afterwards so our
 * impl's last-write-wins captures the override. Pair with `stopReason: 'error'`
 * so the implementation maps via `mapPiToAiErr`.
 */
function fauxErrorWithStatus(status: number, errorMessage: string): FauxResponseFactory {
  return async (_ctx, opts: StreamOptions | undefined, _state, model) => {
    await opts?.onResponse?.({ status, headers: {} }, model);
    return fauxAssistantMessage([fauxText('error')], {
      stopReason: 'error',
      errorMessage,
    });
  };
}

// ---------------------------------------------------------------------------
// Faux pi-ai provider — short-circuits the HTTP layer for unit tests
// ---------------------------------------------------------------------------
//
// pi-ai ships `registerFauxProvider()` for this purpose. It returns a model
// handle whose `api` field points at an in-memory scripted provider; calling
// `complete(model, ...)` answers from a queue of `AssistantMessage`s instead
// of hitting the network.
//
// The faux provider does NOT populate pi-ai's global `getModel(provider, id)`
// registry — that registry is built once at module load from the generated
// `MODELS` constant. So tests pass `model` directly into `buildAiClientLayer`,
// bypassing the registry lookup. Production callers still get the
// `getModel(provider, model)` happy path; the `model` override is the seam
// where the spike-recommended Tag/Layer wiring meets a deterministic
// in-memory provider.

let faux: FauxProviderRegistration | undefined;

afterEach(() => {
  faux?.unregister();
  faux = undefined;
});

// ---------------------------------------------------------------------------
// AiClient.ping
// ---------------------------------------------------------------------------

describe('AiClient.ping', () => {
  it('Layer + Tag wiring works (ping returns ok against faux pi-ai response)', async () => {
    // Arrange: register a faux pi-ai provider + script one assistant reply.
    faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.ping();
    });
    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(r).toEqual({ ok: true });
    expect(faux.state.callCount).toBe(1);
  });

  it('rejects with AiAuthError when credentials are missing', async () => {
    faux = registerFauxProvider();

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(null),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.ping();
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiAuthError', (e) =>
          Effect.succeed({ caught: true, provider: e.provider }),
        ),
      ),
    );
    expect(result).toEqual({ caught: true, provider: 'deepseek' });
    expect(faux.state.callCount).toBe(0);
  });

  it('honours overrideKey (the Settings UI test-connection path)', async () => {
    faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])]);

    const credentials = fakeCredentials(null);
    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials,
      overrideKey: 'sk-typed-but-not-saved',
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.ping();
    });
    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(r).toEqual({ ok: true });
    expect(credentials.get).not.toHaveBeenCalled();
  });

  it('maps pi-ai errors to AiProviderError', async () => {
    faux = registerFauxProvider();
    // No responses queued → faux's default error path fires.

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.ping();
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiProviderError', () => Effect.succeed({ caught: true })),
      ),
    );
    expect(result).toEqual({ caught: true });
  });
});

// ---------------------------------------------------------------------------
// AiClient.generateObject
// ---------------------------------------------------------------------------

describe('AiClient.generateObject', () => {
  it('returns the parsed object from a schema-valid tool-call response', async () => {
    const schema = z.object({
      scope: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      category: z.string(),
    });

    faux = registerFauxProvider();
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('submit_response', { scope: 2, category: 'electricity' })],
        { stopReason: 'toolUse' },
      ),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify this' });
    });
    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(r).toEqual({ scope: 2, category: 'electricity' });
    expect(faux.state.callCount).toBe(1);
  });

  it('fails AiSchemaMismatch when the tool input does not satisfy the schema', async () => {
    const schema = z.object({
      scope: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      category: z.string(),
    });

    faux = registerFauxProvider();
    faux.setResponses([
      // scope=99 is outside the literal union → safeParse should fail.
      fauxAssistantMessage(
        [fauxToolCall('submit_response', { scope: 99, category: 'electricity' })],
        { stopReason: 'toolUse' },
      ),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify this' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiSchemaMismatch', (e) =>
          Effect.succeed({ caught: true, raw: e.raw } as const),
        ),
      ),
    );
    if (!('caught' in result)) throw new Error('expected caught result');
    expect(result.caught).toBe(true);
    expect(result.raw).toContain('"scope":99');
    // Schema mismatch must not retry — exactly one call.
    expect(faux.state.callCount).toBe(1);
  });

  it('fails AiNoData when the response has no tool_use block', async () => {
    const schema = z.object({ scope: z.number() });

    faux = registerFauxProvider();
    faux.setResponses([
      // Plain text response, no tool call.
      fauxAssistantMessage([fauxText('I cannot answer that')]),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify this' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiNoData', () => Effect.succeed({ caught: true })),
      ),
    );
    expect(result).toEqual({ caught: true });
  });

  it('401 response → AiAuthError, no retry', async () => {
    const schema = z.object({ scope: z.number() });

    faux = registerFauxProvider();
    faux.setResponses([fauxErrorWithStatus(401, 'Unauthorized: invalid API key')]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify this' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiAuthError', (e) =>
          Effect.succeed({ caught: true, provider: e.provider }),
        ),
      ),
    );
    expect(result).toEqual({ caught: true, provider: 'deepseek' });
    expect(faux.state.callCount).toBe(1);
  });

  it('429 response → AiRateLimited, retries (call count > 1)', async () => {
    const schema = z.object({ scope: z.number() });

    // Queue 3 rate-limit responses so the retry exhausts (max 2 retries = 3 calls).
    faux = registerFauxProvider();
    faux.setResponses([
      fauxErrorWithStatus(429, 'rate limit exceeded'),
      fauxErrorWithStatus(429, 'rate limit exceeded'),
      fauxErrorWithStatus(429, 'rate limit exceeded'),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiRateLimited', () => Effect.succeed({ caught: true })),
      ),
    );
    expect(result).toEqual({ caught: true });
    expect(faux.state.callCount).toBe(3); // initial + 2 retries
  });

  it('429 followed by success → returns the late success', async () => {
    const schema = z.object({ scope: z.number() });

    faux = registerFauxProvider();
    faux.setResponses([
      fauxErrorWithStatus(429, 'rate limit'),
      fauxAssistantMessage([fauxToolCall('submit_response', { scope: 1 })], {
        stopReason: 'toolUse',
      }),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify' });
    });
    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(r).toEqual({ scope: 1 });
    expect(faux.state.callCount).toBe(2);
  });

  it('500 response → AiProviderError, retries', async () => {
    const schema = z.object({ scope: z.number() });

    faux = registerFauxProvider();
    faux.setResponses([
      fauxErrorWithStatus(500, 'server error'),
      fauxErrorWithStatus(500, 'server error'),
      fauxErrorWithStatus(500, 'server error'),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiProviderError', (e) =>
          Effect.succeed({ caught: true, status: e.status } as const),
        ),
      ),
    );
    expect(result).toEqual({ caught: true, status: 500 });
    expect(faux.state.callCount).toBe(3);
  });

  it('timeout exceeded → AiTimeout, no retry', async () => {
    const schema = z.object({ scope: z.number() });

    faux = registerFauxProvider();
    // Factory that sleeps longer than the timeoutMs. Respects the AbortSignal
    // the impl wires in so the test exits promptly when the timeout fires.
    faux.setResponses([
      async (_ctx, opts) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000);
          opts?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        });
        return fauxAssistantMessage([fauxToolCall('submit_response', { scope: 1 })], {
          stopReason: 'toolUse',
        });
      },
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify', timeoutMs: 80 });
    });

    const start = Date.now();
    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiTimeout', (e) =>
          Effect.succeed({ caught: true, timeoutMs: e.timeoutMs }),
        ),
      ),
    );
    const elapsed = Date.now() - start;

    expect(result).toEqual({ caught: true, timeoutMs: 80 });
    expect(faux.state.callCount).toBe(1);
    // The 5_000ms factory must not have been awaited to completion.
    expect(elapsed).toBeLessThan(2000);
  });

  it('schema mismatch does not retry', async () => {
    const schema = z.object({ scope: z.literal(1) });

    faux = registerFauxProvider();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_response', { scope: 99 })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('submit_response', { scope: 99 })], {
        stopReason: 'toolUse',
      }),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateObject({ schema, prompt: 'classify' });
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiSchemaMismatch', () => Effect.succeed(null)),
      ),
    );
    // Exactly one call — no retry on schema mismatch.
    expect(faux.state.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AiClient.generateText
// ---------------------------------------------------------------------------

describe('AiClient.generateText', () => {
  it('returns the concatenated text from the response', async () => {
    faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('hello world')])]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateText({ prompt: 'say hello' });
    });
    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(r).toBe('hello world');
  });

  it('401 → AiAuthError', async () => {
    faux = registerFauxProvider();
    faux.setResponses([fauxErrorWithStatus(401, 'unauthorized')]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateText({ prompt: 'hi' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiAuthError', () => Effect.succeed({ caught: true })),
      ),
    );
    expect(result).toEqual({ caught: true });
    expect(faux.state.callCount).toBe(1);
  });

  it('500 → AiProviderError (retried)', async () => {
    faux = registerFauxProvider();
    faux.setResponses([
      fauxErrorWithStatus(500, 'internal'),
      fauxErrorWithStatus(500, 'internal'),
      fauxErrorWithStatus(500, 'internal'),
    ]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateText({ prompt: 'hi' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiProviderError', (e) =>
          Effect.succeed({ caught: true, status: e.status } as const),
        ),
      ),
    );
    expect(result).toEqual({ caught: true, status: 500 });
    expect(faux.state.callCount).toBe(3);
  });

  it('empty content → AiNoData', async () => {
    faux = registerFauxProvider();
    // Empty content array — no text to return.
    faux.setResponses([fauxAssistantMessage([])]);

    const layer = buildAiClientLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateText({ prompt: 'hi' });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiNoData', () => Effect.succeed({ caught: true })),
      ),
    );
    expect(result).toEqual({ caught: true });
  });
});
