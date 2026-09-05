import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxProvider } from '@earendil-works/pi-ai';
import { fetchModelsForProvider, toDynamicModels } from '@main/llm/model-fetcher';
import { FileModelsStore } from '@main/llm/models-store';
import { afterEach, describe, expect, it, vi } from 'vitest';

let dir = '';
afterEach(() => {
  vi.unstubAllGlobals();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function fauxCollection(provider = 'deepseek', ids = ['deepseek-v4-pro']) {
  const faux = fauxProvider({ provider, models: ids.map((id) => ({ id })) });
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => handler(url, init)),
  );
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

describe('fetchModelsForProvider', () => {
  it('fetches OpenAI-compatible /v1/models with Bearer auth', async () => {
    const seen: Array<{ url: string; auth: string }> = [];
    stubFetch((url, init) => {
      seen.push({
        url,
        auth: (init.headers as Record<string, string>).Authorization ?? '',
      });
      return jsonResponse(200, { data: [{ id: 'deepseek-new-1' }, { id: 'deepseek-new-2' }] });
    });
    const result = await fetchModelsForProvider(fauxCollection(), {
      provider: 'deepseek',
      apiKey: 'sk-test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen[0]?.url).toContain('/v1/models');
    expect(seen[0]?.auth).toBe('Bearer sk-test');
    expect(result.models.map((m) => m.id).sort()).toEqual(['deepseek-new-1', 'deepseek-new-2']);
  });

  it('maps 401 to auth_failed', async () => {
    stubFetch(() => jsonResponse(401, { error: 'bad key' }));
    const result = await fetchModelsForProvider(fauxCollection(), {
      provider: 'deepseek',
      apiKey: 'sk-bad',
    });
    expect(result).toEqual({ ok: false, error: 'auth_failed' });
  });

  it('filters non-chat rows', async () => {
    stubFetch(() =>
      jsonResponse(200, {
        data: [
          { id: 'chat-model' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'dall-e-3' },
        ],
      }),
    );
    const result = await fetchModelsForProvider(fauxCollection(), {
      provider: 'deepseek',
      apiKey: 'sk-test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual(['chat-model']);
  });

  it('uses the explicit baseUrl override', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return jsonResponse(200, { data: [{ id: 'local-model' }] });
    });
    const result = await fetchModelsForProvider(fauxCollection(), {
      provider: 'deepseek',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-test',
    });
    expect(result.ok).toBe(true);
    expect(seen[0]).toContain('http://localhost:11434/v1/models');
  });

  it('returns missing_api_key without a network call', async () => {
    const spy = vi.fn(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', spy);
    const result = await fetchModelsForProvider(fauxCollection(), {
      provider: 'deepseek',
      apiKey: '',
    });
    expect(result).toEqual({ ok: false, error: 'missing_api_key' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns unknown_provider when the collection has no template', async () => {
    const spy = vi.fn(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', spy);
    const result = await fetchModelsForProvider(fauxCollection(), {
      provider: 'not-a-provider',
      apiKey: 'sk-test',
    });
    expect(result).toEqual({ ok: false, error: 'unknown_provider' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('toDynamicModels', () => {
  it('clones transport, swaps identity, stays conservative', () => {
    const models = fauxCollection();
    const template = models.getModel('deepseek', 'deepseek-v4-pro');
    if (!template) throw new Error('no template');
    const [row] = toDynamicModels(template, ['deepseek-future-1']);
    expect(row?.id).toBe('deepseek-future-1');
    expect(row?.name).toBe('deepseek-future-1');
    expect(row?.api).toBe(template.api);
    expect(row?.provider).toBe(template.provider);
    expect(row?.baseUrl).toBe(template.baseUrl);
    expect(row?.reasoning).toBe(false);
    // Capability-unknown marker: never claim image support from a list id.
    expect(row?.input).toEqual(['text']);
  });
});

describe('FileModelsStore', () => {
  it('round-trips write → read', async () => {
    dir = mkdtempSync(join(tmpdir(), 'models-store-test-'));
    const store = new FileModelsStore(dir);
    const models = fauxCollection().getModels('deepseek');
    await store.write('deepseek', { models, checkedAt: 123 });
    const back = await store.read('deepseek');
    expect(back?.checkedAt).toBe(123);
    expect(back?.models.map((m) => m.id)).toEqual(models.map((m) => m.id));
  });

  it('reads a miss as undefined, never throws', async () => {
    dir = mkdtempSync(join(tmpdir(), 'models-store-test-'));
    const store = new FileModelsStore(dir);
    await expect(store.read('deepseek')).resolves.toBeUndefined();
  });

  it('reads corrupt files as a miss', async () => {
    dir = mkdtempSync(join(tmpdir(), 'models-store-test-'));
    const store = new FileModelsStore(dir);
    await store.write('deepseek', { models: [], checkedAt: 1 });
    // Corrupt the file behind the store's back.
    const { join: joinPath } = await import('node:path');
    writeFileSync(joinPath(dir, 'dynamic-models', 'deepseek.json'), '{not json');
    await expect(store.read('deepseek')).resolves.toBeUndefined();
  });

  it('delete is idempotent', async () => {
    dir = mkdtempSync(join(tmpdir(), 'models-store-test-'));
    const store = new FileModelsStore(dir);
    await store.delete('deepseek');
    await store.write('deepseek', { models: [], checkedAt: 1 });
    await store.delete('deepseek');
    await expect(store.read('deepseek')).resolves.toBeUndefined();
  });

  it('sanitizes hostile provider ids', async () => {
    dir = mkdtempSync(join(tmpdir(), 'models-store-test-'));
    const store = new FileModelsStore(dir);
    await store.write('../../evil', { models: [], checkedAt: 1 });
    const back = await store.read('../../evil');
    expect(back?.checkedAt).toBe(1);
  });
});
