import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { settingsHandlers } from '@main/ipc/handlers/settings';
import { AiAuthError, AiProviderError } from '@main/llm/errors';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfig } from '@shared/types';
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
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    handlers['settings:save-provider']?.({ config, apiKey: 'sk-test-12345' });

    expect(credentials.set).toHaveBeenCalledWith('llm.openai.apikey', 'sk-test-12345');
    const fetched = handlers['settings:get-provider']?.();
    expect(fetched).toEqual({ ...config, apiKeyMasked: 'sk-...2345' });
  });

  it('settings:save-provider rejects invalid input (ZodError)', () => {
    expect(() =>
      handlers['settings:save-provider']?.({
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        config: { provider: 'not-a-real-provider', model: 'x' } as any,
        apiKey: 'sk',
      }),
    ).toThrow(z.ZodError);
  });

  it('settings:save-provider rejects empty apiKey (ZodError)', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    expect(() => handlers['settings:save-provider']?.({ config, apiKey: '' })).toThrow(z.ZodError);
  });

  it('settings:clear-provider removes the config + key', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    handlers['settings:save-provider']?.({ config, apiKey: 'sk-bye' });
    handlers['settings:clear-provider']?.();

    expect(credentials.delete).toHaveBeenCalledWith('llm.openai.apikey');
    expect(handlers['settings:get-provider']?.()).toBeNull();
  });

  it('settings:ping-provider without apiKey builds layer from saved credentials and pings', async () => {
    pingSpy.mockReturnValue(Effect.succeed({ ok: true } as const));
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };

    const result = await handlers['settings:ping-provider']?.({ config });

    expect(result).toEqual({ ok: true });
    expect(pingSpy).toHaveBeenCalledTimes(1);
    // No `overrideKey` means the layer must read the key from `credentials`.
    const deps = buildLayerSpy.mock.calls[0]?.[0];
    expect(deps?.config).toEqual(config);
    expect(deps?.overrideKey).toBeUndefined();
    expect(deps?.credentials).toBe(credentials);
  });

  it('settings:ping-provider with apiKey passes overrideKey and does NOT persist', async () => {
    pingSpy.mockReturnValue(Effect.succeed({ ok: true } as const));
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
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
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };

    const result = await handlers['settings:ping-provider']?.({ config, apiKey: 'sk-bad' });
    expect(result).toEqual({ ok: false, error: 'auth_failed: openai' });
  });

  it('settings:ping-provider maps AiProviderError to { ok: false, error: "provider_error: <cause>" }', async () => {
    pingSpy.mockReturnValue(
      Effect.fail(new AiProviderError({ status: 500, cause: 'upstream timeout' })),
    );
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };

    const result = await handlers['settings:ping-provider']?.({ config, apiKey: 'sk-x' });
    expect(result).toEqual({ ok: false, error: 'provider_error: upstream timeout' });
  });

  it('settings:ping-provider AiProviderError without cause falls back to "unknown"', async () => {
    pingSpy.mockReturnValue(Effect.fail(new AiProviderError({})));
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };

    const result = await handlers['settings:ping-provider']?.({ config });
    expect(result).toEqual({ ok: false, error: 'provider_error: unknown' });
  });
});
