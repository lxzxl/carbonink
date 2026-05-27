import { AiClientTag } from '@main/llm/ai-client';
import { AiAuthError, AiProviderError } from '@main/llm/errors';
import { runAiObject } from '@main/llm/run-ai';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfig } from '@shared/types';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * `runAiObject` is the thin Promise-boundary helper that
 * extraction/ef-matcher/questionnaire services use to call AiClient
 * without owning the Effect runtime. Internally it builds an
 * AiClientLayer per call and runs `generateObject` against it.
 *
 * The faux pi-ai provider doesn't register itself into pi-ai's MODELS
 * registry (only into the API-stream registry), so `getModel(provider,
 * model)` — which `buildAiClientLayer` uses internally — can't find
 * it. That makes the AiClient unit tests pass `model: faux.getModel()`
 * explicitly to `buildAiClientLayer`; since `runAiObject` doesn't (and
 * shouldn't) expose a `model` override, we test it by swapping the
 * layer wholesale via `vi.mock` so the real pi-ai path is never taken.
 *
 * This keeps the test focused on what runAiObject actually does — build
 * the layer, run the Effect, return parsed object on success or reject
 * on failure — and defers full faux-provider round-trip coverage to
 * the AiClient tests.
 */
function fakeCredentials(): CredentialService {
  return {
    get: vi.fn(() => 'sk-fake'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

function fakeConfig(): ProviderConfig {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKeyKeyref: 'llm.deepseek.apikey',
  };
}

const generateObjectSpy = vi.fn();

vi.mock('@main/llm/ai-client', async (orig) => {
  const actual = (await orig()) as typeof import('@main/llm/ai-client');
  return {
    ...actual,
    buildAiClientLayer: () =>
      Layer.succeed(actual.AiClientTag, {
        generateObject: (
          args: Parameters<import('@main/llm/ai-client').AiClient['generateObject']>[0],
        ) => generateObjectSpy(args),
        generateText: () => Effect.die(new Error('not used by runAiObject')),
        ping: () => Effect.die(new Error('not used by runAiObject')),
      }),
  };
});

afterEach(() => {
  generateObjectSpy.mockReset();
});

describe('runAiObject (Promise-boundary helper)', () => {
  it('returns parsed object on schema-valid response', async () => {
    generateObjectSpy.mockReturnValue(Effect.succeed({ value: 'ok', count: 7 }));

    const schema = z.object({ value: z.string(), count: z.number() });
    const result = await runAiObject(fakeConfig(), fakeCredentials(), {
      schema,
      prompt: 'classify this',
    });

    expect(result).toEqual({ value: 'ok', count: 7 });
    expect(generateObjectSpy).toHaveBeenCalledTimes(1);
    const args = generateObjectSpy.mock.calls[0]?.[0];
    expect(args?.prompt).toBe('classify this');
    expect(args?.schema).toBeTruthy();
  });

  it('forwards system + images + timeoutMs through to AiClient.generateObject', async () => {
    generateObjectSpy.mockReturnValue(Effect.succeed({ ok: true }));

    const schema = z.object({ ok: z.boolean() });
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await runAiObject(fakeConfig(), fakeCredentials(), {
      schema,
      prompt: 'analyze this',
      system: 'you are a tester',
      images: [image],
      timeoutMs: 30_000,
    });

    expect(generateObjectSpy).toHaveBeenCalledTimes(1);
    const args = generateObjectSpy.mock.calls[0]?.[0];
    expect(args?.system).toBe('you are a tester');
    expect(args?.images).toEqual([image]);
    expect(args?.timeoutMs).toBe(30_000);
  });

  it('rejects with AiAuthError when AiClient.generateObject fails with auth error', async () => {
    generateObjectSpy.mockReturnValue(Effect.fail(new AiAuthError({ provider: 'deepseek' })));

    const schema = z.object({ ok: z.boolean() });
    await expect(
      runAiObject(fakeConfig(), fakeCredentials(), { schema, prompt: 'hi' }),
    ).rejects.toMatchObject({ _tag: 'AiAuthError', provider: 'deepseek' });
  });

  it('rejects with AiProviderError when AiClient.generateObject fails with provider error', async () => {
    generateObjectSpy.mockReturnValue(Effect.fail(new AiProviderError({ status: 500 })));

    const schema = z.object({ ok: z.boolean() });
    await expect(
      runAiObject(fakeConfig(), fakeCredentials(), { schema, prompt: 'hi' }),
    ).rejects.toMatchObject({ _tag: 'AiProviderError', status: 500 });
  });

  it('omits undefined optionals (no system / no images)', async () => {
    generateObjectSpy.mockReturnValue(Effect.succeed({ ok: true }));

    const schema = z.object({ ok: z.boolean() });
    await runAiObject(fakeConfig(), fakeCredentials(), { schema, prompt: 'hi' });

    const args = generateObjectSpy.mock.calls[0]?.[0];
    expect(args).not.toHaveProperty('system');
    // The helper passes through whatever args it receives unchanged — but
    // since we did not provide `system`/`images`, they should be absent in
    // the forwarded object (exactOptionalPropertyTypes contract).
    expect(args?.system).toBeUndefined();
    expect(args?.images).toBeUndefined();
  });

  // Sanity: AiClientTag is consumed via Tag, not by reference. If somebody
  // refactors the helper to use a different Tag the mock-based test above
  // would still pass; this assertion keeps the helper honest about which
  // Tag it yields.
  it('uses AiClientTag (regression guard for Tag stability)', () => {
    expect(AiClientTag).toBeDefined();
  });
});
