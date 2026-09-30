import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxProvider } from '@earendil-works/pi-ai';
import { getBuiltinModel, getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { AiClientTag, buildAiClientLayer } from '@main/llm/ai-client';
import { type CatalogStore, createModelCatalog, type ModelCatalog } from '@main/llm/model-catalog';
import type { FetchModelsResult } from '@main/llm/model-fetcher';
import { FileModelsStore } from '@main/llm/models-store';
import type { CredentialService } from '@main/services/credential-service';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function tmpDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'model-catalog-test-'));
  return dir;
}

function fauxCollection(provider = 'deepseek', ids = ['deepseek-v4-pro']) {
  const faux = fauxProvider({ provider, models: ids.map((id) => ({ id })) });
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

/** In-memory store seam — no disk, deterministic seed. */
function memStore(rows: Record<string, { models: never[]; checkedAt: number }>): CatalogStore {
  return {
    listProviders: () => Object.keys(rows),
    read: async (providerId: string) => {
      const entry = rows[providerId];
      return entry ? { models: entry.models, checkedAt: entry.checkedAt } : undefined;
    },
    write: async () => {},
    delete: async () => {},
  };
}

describe('ModelCatalog.listModels', () => {
  it('merges bundled + dynamic rows, dynamic winning on id conflict', async () => {
    const collection = fauxCollection();
    const template = collection.getModel('deepseek', 'deepseek-v4-pro');
    if (!template) throw new Error('no template');
    const catalog = createModelCatalog({
      userDataDir: '',
      collection,
      store: memStore({
        deepseek: { models: [{ ...template, id: 'deepseek-v4-pro' }] as never[], checkedAt: 7 },
      }),
    });
    await catalog.seed();
    const { models, checkedAt } = catalog.listModels('deepseek');
    expect(checkedAt).toBe(7);
    expect(models.map((m) => m.id)).toEqual(['deepseek-v4-pro']);
  });

  it('returns [] + null checkedAt for unknown providers', () => {
    const catalog: ModelCatalog = createModelCatalog({
      userDataDir: '',
      collection: fauxCollection(),
      store: memStore({}),
    });
    expect(catalog.listModels('not-a-provider')).toEqual({ models: [], checkedAt: null });
  });

  it('listProviders mirrors the collection', () => {
    const catalog = createModelCatalog({
      userDataDir: '',
      collection: fauxCollection(),
      store: memStore({}),
    });
    expect(catalog.listProviders()).toEqual(['deepseek']);
  });
});

describe('ModelCatalog.refresh', () => {
  it('fetches, persists, and returns the merged projection with checkedAt', async () => {
    const collection = fauxCollection();
    const template = collection.getModel('deepseek', 'deepseek-v4-pro');
    if (!template) throw new Error('no template');
    const fetched = [{ ...template, id: 'deepseek-future-1', name: 'deepseek-future-1' }];
    const written: Array<{ provider: string; checkedAt: number }> = [];
    const catalog = createModelCatalog({
      userDataDir: '',
      collection,
      fetchFn: async (): Promise<FetchModelsResult> => ({ ok: true, models: fetched }),
      store: {
        listProviders: () => [],
        read: async () => undefined,
        write: async (provider: string, entry) => {
          written.push({ provider, checkedAt: entry.checkedAt ?? 0 });
        },
        delete: async () => {},
      },
      now: () => 1234,
    });
    const result = await catalog.refresh({ provider: 'deepseek', apiKey: 'sk-test' });
    expect(result).toEqual({
      ok: true,
      models: expect.arrayContaining([expect.objectContaining({ id: 'deepseek-future-1' })]),
      checkedAt: 1234,
    });
    expect(written).toEqual([{ provider: 'deepseek', checkedAt: 1234 }]);
    // Mirror + freshness are visible to listModels / resolve / isDynamic.
    expect(catalog.listModels('deepseek').checkedAt).toBe(1234);
    expect(catalog.isDynamic('deepseek', 'deepseek-future-1')).toBe(true);
    expect(catalog.resolve('deepseek', 'deepseek-future-1')?.id).toBe('deepseek-future-1');
  });

  it('surfaces fetch failures without touching the store', async () => {
    let writes = 0;
    const catalog = createModelCatalog({
      userDataDir: '',
      collection: fauxCollection(),
      fetchFn: async (): Promise<FetchModelsResult> => ({ ok: false, error: 'auth_failed' }),
      store: {
        listProviders: () => [],
        read: async () => undefined,
        write: async () => {
          writes += 1;
        },
        delete: async () => {},
      },
    });
    await expect(catalog.refresh({ provider: 'deepseek', apiKey: 'sk-bad' })).resolves.toEqual({
      ok: false,
      error: 'auth_failed',
    });
    expect(writes).toBe(0);
    expect(catalog.listModels('deepseek').checkedAt).toBeNull();
  });
});

describe('ModelCatalog.resolve', () => {
  it('returns bundled entries verbatim and synthesizes clones for custom ids', () => {
    const catalog = createModelCatalog({
      userDataDir: '',
      collection: fauxCollection(),
      store: memStore({}),
    });
    expect(catalog.resolve('deepseek', 'deepseek-v4-pro')?.id).toBe('deepseek-v4-pro');
    expect(catalog.resolve('deepseek', 'deepseek-future-2099')?.id).toBe('deepseek-future-2099');
    expect(catalog.resolve('not-a-provider', 'whatever')).toBeUndefined();
  });

  it('returns the bundled entry verbatim on an exact hit (real catalog)', () => {
    const catalog = getBuiltinModels('deepseek');
    const first = catalog[0];
    if (!first) throw new Error('pi-ai catalog unexpectedly empty for deepseek');

    const resolved = createModelCatalog({ userDataDir: '' }).resolve('deepseek', first.id);
    expect(resolved).toEqual(getBuiltinModel('deepseek', first.id as never));
    expect(resolved?.id).toBe(first.id);
  });

  it('synthesizes a same-provider clone for an uncatalogued id (real catalog)', () => {
    // The motivating case: a model that launched on openrouter after the
    // bundled pi-ai snapshot was published.
    const customId = 'tencent/hy3:free';
    const template = getBuiltinModels('openrouter')[0];
    if (!template) throw new Error('pi-ai catalog unexpectedly empty for openrouter');
    expect(getBuiltinModels('openrouter').some((m) => m.id === customId)).toBe(false);

    const synthetic = createModelCatalog({ userDataDir: '' }).resolve('openrouter', customId);
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
    expect(
      createModelCatalog({ userDataDir: '' }).resolve('not-a-provider', 'whatever'),
    ).toBeUndefined();
  });

  it('seeds persisted rows from disk (round-trip through FileModelsStore)', async () => {
    const userDataDir = tmpDir();
    const collection = fauxCollection();
    const template = collection.getModel('deepseek', 'deepseek-v4-pro');
    if (!template) throw new Error('no template');
    const store = new FileModelsStore(userDataDir);
    await store.write('deepseek', {
      models: [{ ...template, id: 'deepseek-persisted' }],
      checkedAt: 42,
    });
    const catalog = createModelCatalog({ userDataDir, collection });
    await catalog.seed();
    expect(catalog.listModels('deepseek').checkedAt).toBe(42);
    expect(catalog.isDynamic('deepseek', 'deepseek-persisted')).toBe(true);
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
