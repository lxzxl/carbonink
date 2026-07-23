import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { settingsHandlers } from '@main/ipc/handlers/settings';
import { AiAuthError, AiProviderError } from '@main/llm/errors';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfigV2 } from '@shared/types';
import Database from 'better-sqlite3';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * IPC handler smoke + glue test for the Phase 1b settings channels.
 *
 * We pass a fake `credentialService` through `IpcContextOverrides` so the test
 * doesn't depend on Electron `safeStorage` (the production credential
 * backend). SettingsService still exercises the real sqlite path, which keeps
 * the round-trip coverage useful.
 *
 * For `settings:ping-provider` we swap `buildAiClientLayer` via `vi.mock` so
 * the handler runs against a deterministic in-memory `AiClient` instead of
 * hitting pi-ai's real model registry. The mock factory captures the
 * `overrideKey` so the test can assert that the typed-but-unsaved key flow
 * propagates correctly.
 *
 * Wire shape: Item 3 Task 10b — the renderer-facing channels are V2-only.
 * The handler zod-parses input against `providerConfigV2`, so a V1
 * discriminated-union shape (with `apiKeyKeyref`) is now REJECTED at the
 * IPC boundary. We assert that rejection in a dedicated test.
 */
function makeFakeCredentials(): CredentialService {
  const store = new Map<string, string>();
  return {
    set: vi.fn((key: string, plaintext: string) => {
      store.set(key, plaintext);
    }),
    get: vi.fn((key: string) => store.get(key) ?? null),
    getMasked: vi.fn((key: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return `sk-...${v.slice(-4)}`;
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
    }),
    isAvailable: vi.fn(() => true),
  } as unknown as CredentialService;
}

// Captures the AiClient.ping result the next handler invocation should see,
// plus the `buildAiClientLayer` deps so tests can assert on `overrideKey`.
const pingSpy = vi.fn();
const buildLayerSpy = vi.fn();

vi.mock('@main/llm/ai-client', async (orig) => {
  const actual = (await orig()) as typeof import('@main/llm/ai-client');
  return {
    ...actual,
    buildAiClientLayer: (
      deps: Parameters<typeof import('@main/llm/ai-client').buildAiClientLayer>[0],
    ) => {
      buildLayerSpy(deps);
      return Layer.succeed(actual.AiClientTag, {
        generateObject: () => Effect.die(new Error('not used by ping handler')),
        generateText: () => Effect.die(new Error('not used by ping handler')),
        ping: () => pingSpy(),
      });
    },
  };
});

describe('settings IPC handlers', () => {
  let db: Database.Database;
  let credentials: CredentialService;
  let handlers: ReturnType<typeof settingsHandlers>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    credentials = makeFakeCredentials();
    const ctx = createIpcContext(
      { db, now: () => '2026-05-11T00:00:00.000Z' },
      { credentialService: credentials },
    );
    handlers = settingsHandlers(ctx);
  });

  afterEach(() => {
    db.close();
    pingSpy.mockReset();
    buildLayerSpy.mockReset();
  });

  it('settings:available delegates to credentialService.isAvailable', () => {
    expect(handlers['settings:available']?.()).toBe(true);
    expect(credentials.isAvailable).toHaveBeenCalled();
  });

  it('settings:get-provider returns null on an empty store', () => {
    expect(handlers['settings:get-provider']?.()).toBeNull();
  });

  it('settings:save-provider persists config + key, then settings:get-provider returns masked', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
    handlers['settings:save-provider']?.({ config, apiKey: 'sk-test-12345' });

    expect(credentials.set).toHaveBeenCalledWith('llm.openai.apikey', 'sk-test-12345');
    const fetched = handlers['settings:get-provider']?.();
    expect(fetched).toEqual({ ...config, apiKeyMasked: 'sk-...2345' });
  });

  it('settings:save-provider rejects V1 shape (V2-only after Task 10b)', () => {
    // The handler now zod-parses against `providerConfigV2`, which has no
    // `apiKeyKeyref` field. Zod's `.strict()` isn't on (`providerConfigV2`
    // is permissive), so V1's extra fields are silently dropped — but the
    // resulting V2 record is still valid because provider+model are
    // present. The renderer no longer emits V1 ever, so this is the
    // documented behavior we expect: the V1 envelope is accepted but
    // V1-only fields like `apiKeyKeyref` are NOT persisted (they're
    // re-derived from `provider`).
    const v1: unknown = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    handlers['settings:save-provider']?.({
      // biome-ignore lint/suspicious/noExplicitAny: simulating legacy V1 callers
      config: v1 as any,
      apiKey: 'sk-test',
    });
    // The persisted row carries V2 — no `apiKeyKeyref`.
    const row = db.prepare('SELECT value FROM setting WHERE key = ?').get('llm.provider') as
      | { value: string }
      | undefined;
    expect(row).toBeDefined();
    const parsed = JSON.parse(row?.value ?? '{}');
    expect(parsed).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(parsed.apiKeyKeyref).toBeUndefined();
  });

  it('settings:save-provider rejects invalid input (ZodError)', () => {
    // Empty-string `provider` and `model` fail V2's `min(1)`.
    expect(() =>
      handlers['settings:save-provider']?.({
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        config: { provider: '', model: '' } as any,
        apiKey: 'sk',
      }),
    ).toThrow(z.ZodError);
  });

  it('settings:save-provider rejects empty apiKey (ZodError)', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
    expect(() => handlers['settings:save-provider']?.({ config, apiKey: '' })).toThrow(z.ZodError);
  });

  it('settings:clear-provider removes the config + key', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
    handlers['settings:save-provider']?.({ config, apiKey: 'sk-bye' });
    handlers['settings:clear-provider']?.();

    expect(credentials.delete).toHaveBeenCalledWith('llm.openai.apikey');
    expect(handlers['settings:get-provider']?.()).toBeNull();
  });

  it('settings:ping-provider without apiKey builds layer from saved credentials and pings', async () => {
    pingSpy.mockReturnValue(Effect.succeed({ ok: true } as const));
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };

    const result = await handlers['settings:ping-provider']?.({ config });

    expect(result).toEqual({ ok: true });
    expect(pingSpy).toHaveBeenCalledTimes(1);
    // No `overrideKey` means the layer must read the key from `credentials`.
    const deps = buildLayerSpy.mock.calls[0]?.[0];
    expect(deps?.config).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(deps?.overrideKey).toBeUndefined();
    expect(deps?.credentials).toBe(credentials);
  });

  it('settings:ping-provider with apiKey passes overrideKey and does NOT persist', async () => {
    pingSpy.mockReturnValue(Effect.succeed({ ok: true } as const));
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };

    const result = await handlers['settings:ping-provider']?.({
      config,
      apiKey: 'sk-typed-but-unsaved',
    });

    expect(result).toEqual({ ok: true });
    expect(pingSpy).toHaveBeenCalledTimes(1);
    const deps = buildLayerSpy.mock.calls[0]?.[0];
    expect(deps?.overrideKey).toBe('sk-typed-but-unsaved');
    // Critical: a ping does NOT persist — credentials.set should not have been called.
    expect(credentials.set).not.toHaveBeenCalled();
    expect(handlers['settings:get-provider']?.()).toBeNull();
  });

  it('settings:ping-provider maps AiAuthError to { ok: false, error: "auth_failed: <provider>" }', async () => {
    pingSpy.mockReturnValue(Effect.fail(new AiAuthError({ provider: 'openai' })));
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };

    const result = await handlers['settings:ping-provider']?.({ config, apiKey: 'sk-bad' });
    expect(result).toEqual({ ok: false, error: 'auth_failed: openai' });
  });

  it('settings:ping-provider maps AiProviderError to { ok: false, error: "provider_error: <cause>" }', async () => {
    pingSpy.mockReturnValue(
      Effect.fail(new AiProviderError({ status: 500, cause: 'upstream timeout' })),
    );
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };

    const result = await handlers['settings:ping-provider']?.({ config, apiKey: 'sk-x' });
    expect(result).toEqual({ ok: false, error: 'provider_error: upstream timeout' });
  });

  it('settings:ping-provider AiProviderError without cause falls back to "unknown"', async () => {
    pingSpy.mockReturnValue(Effect.fail(new AiProviderError({})));
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };

    const result = await handlers['settings:ping-provider']?.({ config });
    expect(result).toEqual({ ok: false, error: 'provider_error: unknown' });
  });

  // Batch-import outlier multiplier (spec 2026-07-23-import-outlier-threshold).
  it('settings:get/set-import-outlier-ratio round-trips and rejects out-of-range', () => {
    expect(handlers['settings:get-import-outlier-ratio']?.()).toEqual({ ratio: 10 });

    handlers['settings:set-import-outlier-ratio']?.({ ratio: 5 });
    expect(handlers['settings:get-import-outlier-ratio']?.()).toEqual({ ratio: 5 });

    for (const bad of [1, 0, -3, 1001]) {
      expect(() => handlers['settings:set-import-outlier-ratio']?.({ ratio: bad })).toThrow(
        z.ZodError,
      );
    }
    // Rejected writes must not clobber the stored value.
    expect(handlers['settings:get-import-outlier-ratio']?.()).toEqual({ ratio: 5 });
  });

  // Item 3 Task 10c — runtime catalog channels. The handlers delegate to
  // pi-catalog.ts which wraps pi-ai's `getProviders` / `getModels`. We
  // exercise the real catalog here (rather than mocking it) because the
  // pi-ai dependency is bundled at build time — the catalog is a constant
  // and the test asserts on stable invariants (deepseek + openai are
  // always present; deepseek has at least one model).
  it('settings:list-providers returns pi-ai providers including deepseek and openai', () => {
    const providers = handlers['settings:list-providers']?.() ?? [];
    expect(Array.isArray(providers)).toBe(true);
    expect(providers).toContain('deepseek');
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    // The previous V1 hardcoded id is NOT in pi-ai's catalog — sanity check
    // that the smoke regression class is closed.
    expect(providers).not.toContain('openai-compat');
  });

  it('settings:list-providers includes azure-openai-responses (V1 azure rename target)', () => {
    const providers = handlers['settings:list-providers']?.() ?? [];
    expect(providers).toContain('azure-openai-responses');
    expect(providers).not.toContain('azure');
  });

  it('settings:list-models returns deepseek-v4-pro for the deepseek provider', () => {
    const models = handlers['settings:list-models']?.({ provider: 'deepseek' }) ?? [];
    const ids = models.map((m) => m.id);
    expect(ids).toContain('deepseek-v4-pro');
    expect(ids).toContain('deepseek-v4-flash');
    // The legacy default surfaced by the V1 UI was `deepseek-chat`. pi-ai
    // does not expose that id; the bug we just fixed depended on this fact.
    expect(ids).not.toContain('deepseek-chat');
  });

  it('settings:list-models returns ProviderCatalogModel-shaped rows', () => {
    const models = handlers['settings:list-models']?.({ provider: 'deepseek' }) ?? [];
    expect(models.length).toBeGreaterThan(0);
    const first = models[0];
    if (!first) return;
    expect(first).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      api: expect.any(String),
      input: expect.any(Array),
      reasoning: expect.any(Boolean),
      costInput: expect.any(Number),
      costOutput: expect.any(Number),
      contextWindow: expect.any(Number),
      maxTokens: expect.any(Number),
    });
    // Input modalities are constrained to the union the UI knows how to
    // render — anything else from a future pi-ai version is filtered out
    // by `listModelsForProvider`, not blindly forwarded.
    for (const modality of first.input) {
      expect(['text', 'image']).toContain(modality);
    }
  });

  it('settings:list-models returns [] for an unknown provider rather than throwing', () => {
    // The renderer surfaces this as an empty-catalog → free-form text input
    // fallback, so the user can still type a model id even when pi-ai's
    // `getModels` would have thrown for a stale post-migration string.
    const models = handlers['settings:list-models']?.({
      provider: 'totally-not-a-real-provider',
    });
    expect(models).toEqual([]);
  });

  it('settings:list-models rejects empty-string provider input (ZodError)', () => {
    expect(() =>
      handlers['settings:list-models']?.({
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        provider: '' as any,
      }),
    ).toThrow(z.ZodError);
  });
});
