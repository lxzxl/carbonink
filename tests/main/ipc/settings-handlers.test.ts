import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { settingsHandlers } from '@main/ipc/handlers/settings';
import type { LLMClient } from '@main/llm/llm-client';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfig } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * IPC handler smoke + glue test for the Phase 1b settings channels.
 *
 * We pass fake `credentialService` / `llmClient` through `IpcContextOverrides`
 * so the test doesn't depend on Electron `safeStorage` (the production
 * credential backend) or hit a real LLM provider. SettingsService still
 * exercises the real sqlite path, which keeps the round-trip coverage useful.
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

function makeFakeLLMClient(): LLMClient {
  return {
    ping: vi.fn(),
    pingWithKey: vi.fn(),
    extract: vi.fn(),
  } as unknown as LLMClient;
}

describe('settings IPC handlers', () => {
  let db: Database.Database;
  let credentials: CredentialService;
  let llmClient: LLMClient;
  let handlers: ReturnType<typeof settingsHandlers>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    credentials = makeFakeCredentials();
    llmClient = makeFakeLLMClient();
    const ctx = createIpcContext(
      { db, now: () => '2026-05-11T00:00:00.000Z' },
      { credentialService: credentials, llmClient },
    );
    handlers = settingsHandlers(ctx);
  });

  afterEach(() => db.close());

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

  it('settings:ping-provider without apiKey calls llmClient.ping (uses saved key)', async () => {
    vi.mocked(llmClient.ping).mockResolvedValueOnce({ ok: true });
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };

    const result = await handlers['settings:ping-provider']?.({ config });

    expect(result).toEqual({ ok: true });
    expect(llmClient.ping).toHaveBeenCalledWith(config);
    expect(llmClient.pingWithKey).not.toHaveBeenCalled();
  });

  it('settings:ping-provider with apiKey calls llmClient.pingWithKey and does NOT persist', async () => {
    vi.mocked(llmClient.pingWithKey).mockResolvedValueOnce({ ok: true });
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
    expect(llmClient.pingWithKey).toHaveBeenCalledWith(config, 'sk-typed-but-unsaved');
    expect(llmClient.ping).not.toHaveBeenCalled();
    // Critical: a ping does NOT persist — credentials.set should not have been called.
    expect(credentials.set).not.toHaveBeenCalled();
    expect(handlers['settings:get-provider']?.()).toBeNull();
  });

  it('settings:ping-provider surfaces { ok: false, error } from LLMClient', async () => {
    vi.mocked(llmClient.pingWithKey).mockResolvedValueOnce({ ok: false, error: 'unauthorized' });
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };

    const result = await handlers['settings:ping-provider']?.({ config, apiKey: 'sk-bad' });
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
  });
});
