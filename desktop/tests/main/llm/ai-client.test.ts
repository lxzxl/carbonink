import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxText,
  registerFauxProvider,
} from '@earendil-works/pi-ai';
import { AiClientTag, buildAiClientLayer } from '@main/llm/ai-client';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfig } from '@shared/types';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
// Tests
// ---------------------------------------------------------------------------

describe('AiClient.ping', () => {
  it('Layer + Tag wiring works (ping returns ok against faux pi-ai response)', async () => {
    // Arrange: register a faux pi-ai provider + script one assistant reply.
    faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])]);

    const model = faux.getModel();
    const config: ProviderConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    const layer = buildAiClientLayer({
      config,
      credentials: fakeCredentials(),
      model, // test-only injection so we don't touch pi-ai's MODELS registry
    });

    // Act
    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.ping();
    });
    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    // Assert: ping succeeded, and the faux provider really was hit.
    expect(r).toEqual({ ok: true });
    expect(faux.state.callCount).toBe(1);
  });

  it('rejects with AiAuthError when credentials are missing', async () => {
    // No faux response queued — the implementation must short-circuit on the
    // missing key *before* touching pi-ai. (If it didn't, we'd see the
    // "No more faux responses queued" error from pi-ai and the test would
    // fail with the wrong tag.)
    faux = registerFauxProvider();

    const config: ProviderConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    const layer = buildAiClientLayer({
      config,
      credentials: fakeCredentials(null),
      model: faux.getModel(),
    });

    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.ping();
    });

    // catchTag lets us assert the failure shape without throwing — Effect's
    // typed-error story means the runtime *can't* slip a different tag here.
    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(layer),
        Effect.catchTag('AiAuthError', (e) =>
          Effect.succeed({ caught: true, provider: e.provider }),
        ),
      ),
    );
    expect(result).toEqual({ caught: true, provider: 'deepseek' });

    // The implementation must never have called pi-ai.
    expect(faux.state.callCount).toBe(0);
  });

  it('honours overrideKey (the Settings UI test-connection path)', async () => {
    // The pre-save "Test connection" button in Settings supplies a key the
    // user has typed but not yet committed. The credential store should be
    // bypassed entirely.
    faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])]);

    const credentials = fakeCredentials(null); // store would say "no key"
    const config: ProviderConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    const layer = buildAiClientLayer({
      config,
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
    // Credentials store was never consulted because overrideKey took priority.
    expect(credentials.get).not.toHaveBeenCalled();
  });

  it('maps pi-ai errors to AiProviderError', async () => {
    // No responses queued → faux returns an error message. Ping should
    // surface that as AiProviderError (not Auth — we have a key).
    faux = registerFauxProvider();
    // (deliberately not calling setResponses)

    const config: ProviderConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    const layer = buildAiClientLayer({
      config,
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

describe('AiClient generateObject / generateText (Task 1 stubs)', () => {
  // Task 2 wires these up. Task 1 leaves them as Effect.die so a misuse during
  // intermediate task migrations is loud (not a silent zero-arg call).
  it('generateObject is intentionally unimplemented (Task 2)', async () => {
    faux = registerFauxProvider();
    const config: ProviderConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    const layer = buildAiClientLayer({
      config,
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });
    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      // The shape we want — schema, prompt — only matters in Task 2.
      // Just verify the Effect dies with a recognizable defect.
      // biome-ignore lint/suspicious/noExplicitAny: schema arg is stubbed
      return yield* ai.generateObject({ schema: {} as any, prompt: 'x' });
    });
    await expect(Effect.runPromise(program.pipe(Effect.provide(layer)))).rejects.toThrow(
      /not yet implemented \(Task 2\)/,
    );
  });

  it('generateText is intentionally unimplemented (Task 2)', async () => {
    faux = registerFauxProvider();
    const config: ProviderConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    const layer = buildAiClientLayer({
      config,
      credentials: fakeCredentials(),
      model: faux.getModel(),
    });
    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.generateText({ prompt: 'x' });
    });
    await expect(Effect.runPromise(program.pipe(Effect.provide(layer)))).rejects.toThrow(
      /not yet implemented \(Task 2\)/,
    );
  });
});
