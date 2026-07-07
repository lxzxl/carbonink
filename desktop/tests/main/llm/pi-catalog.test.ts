import { type Api, getModel, getModels, type Model } from '@earendil-works/pi-ai';
import { AiClientTag, buildAiClientLayer } from '@main/llm/ai-client';
import { resolveModel } from '@main/llm/pi-catalog';
import type { CredentialService } from '@main/services/credential-service';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

/**
 * `resolveModel` — the custom-model escape hatch (see pi-catalog.ts).
 *
 * These tests run against pi-ai's real bundled catalog (deterministic, no
 * network): catalog hits pass through verbatim; misses on a known provider
 * synthesize a wire-correct clone; unknown providers stay a hard miss so
 * AiClient keeps its loud `AiProviderError` path.
 */
describe('resolveModel', () => {
  it('returns the catalog entry verbatim on an exact hit', () => {
    const catalog = getModels('deepseek');
    const first = catalog[0];
    if (!first) throw new Error('pi-ai catalog unexpectedly empty for deepseek');

    const resolved = resolveModel('deepseek', first.id);
    expect(resolved).toEqual(
      (getModel as unknown as (p: string, m: string) => Model<Api>)('deepseek', first.id),
    );
    expect(resolved?.id).toBe(first.id);
  });

  it('synthesizes a same-provider clone for an uncatalogued id', () => {
    // The motivating case: a model that launched on openrouter after the
    // bundled pi-ai snapshot was published.
    const customId = 'tencent/hy3:free';
    const template = getModels('openrouter')[0];
    if (!template) throw new Error('pi-ai catalog unexpectedly empty for openrouter');
    expect(getModels('openrouter').some((m) => m.id === customId)).toBe(false);

    const synthetic = resolveModel('openrouter', customId);
    expect(synthetic).toBeDefined();
    // Identity is the custom id…
    expect(synthetic?.id).toBe(customId);
    expect(synthetic?.name).toBe(customId);
    // …transport fields come from the provider template (what makes the
    // request actually work)…
    expect(synthetic?.api).toBe(template.api);
    expect(synthetic?.baseUrl).toBe(template.baseUrl);
    expect(synthetic?.provider).toBe(template.provider);
    // …and the request shape stays conservative: no reasoning params.
    expect(synthetic?.reasoning).toBe(false);
    expect(synthetic && 'thinkingLevelMap' in synthetic).toBe(false);
  });

  it('returns undefined for an unknown provider (nothing to clone)', () => {
    expect(resolveModel('not-a-provider', 'whatever')).toBeUndefined();
  });
});

/**
 * Layer-level proof that resolution reaches AiClient: with a custom id on
 * a known provider, methods fail on the *key* (AiAuthError) — i.e. the
 * model resolved; only an unknown provider still yields the
 * "no model registered" AiProviderError. No network: both paths
 * short-circuit inside callPi before any request is made.
 */
describe('buildAiClientLayer with custom model ids', () => {
  function nullCredentials(): CredentialService {
    return {
      get: vi.fn(() => null),
      set: vi.fn(),
      getMasked: vi.fn(),
      delete: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(true),
    } as unknown as CredentialService;
  }

  it('custom id on a known provider resolves (fails on missing key, not on the model)', async () => {
    const layer = buildAiClientLayer({
      config: { provider: 'openrouter', model: 'tencent/hy3:free' },
      credentials: nullCredentials(),
    });
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const ai = yield* AiClientTag;
        return yield* ai.generateText({ prompt: 'hi' });
      }).pipe(
        Effect.provide(layer),
        Effect.catchAll((e) => Effect.succeed(e._tag)),
      ),
    );
    expect(outcome).toBe('AiAuthError');
  });

  it('unknown provider still fails loudly with AiProviderError', async () => {
    // ping + a present key: ensureReady clears the auth check and trips on
    // the unresolved model immediately (ping has no retry schedule, and the
    // failure happens before any request is attempted).
    const layer = buildAiClientLayer({
      config: { provider: 'not-a-provider', model: 'whatever' },
      credentials: nullCredentials(),
      overrideKey: 'sk-fake-test-key',
    });
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const ai = yield* AiClientTag;
        return yield* ai.ping();
      }).pipe(
        Effect.provide(layer),
        Effect.catchAll((e) => Effect.succeed(e._tag)),
      ),
    );
    expect(outcome).toBe('AiProviderError');
  });
});
