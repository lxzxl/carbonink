import { runMigrations } from '@main/db/migrate';
import type { CredentialService } from '@main/services/credential-service';
import { SettingsService } from '@main/services/settings-service';
import type { ProviderConfig } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Fake CredentialService: an in-memory Map standing in for the keychain.
 * SettingsService only touches `set` / `get` / `getMasked` / `delete`, so the
 * remaining surface (`isAvailable`) is stubbed minimally.
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
      // Match the production maskSecret() shape for ≥8-char inputs that
      // start with "sk-": preserve the `sk-` head and the last 4 chars.
      return `sk-...${v.slice(-4)}`;
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
    }),
    isAvailable: vi.fn(() => true),
  } as unknown as CredentialService;
}

describe('SettingsService', () => {
  let db: Database.Database;
  let credentials: CredentialService;
  let service: SettingsService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    credentials = makeFakeCredentials();
    service = new SettingsService({
      db,
      now: () => '2026-05-11T00:00:00.000Z',
      credentials,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('saveProviderConfig writes config to setting and key to credentials', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    service.saveProviderConfig(config, 'sk-test-12345');

    // Credential set with the keyref derived from config
    expect(credentials.set).toHaveBeenCalledWith('llm.openai.apikey', 'sk-test-12345');

    // setting row contains the JSON-serialized config (NOT the api key)
    const row = db.prepare('SELECT key, value, updated_at FROM setting').get() as {
      key: string;
      value: string;
      updated_at: string;
    };
    expect(row.key).toBe('llm.provider');
    expect(row.updated_at).toBe('2026-05-11T00:00:00.000Z');
    const parsed = JSON.parse(row.value);
    expect(parsed).toEqual(config);
    // Defense in depth: the plaintext api key must never appear in sqlite.
    expect(row.value).not.toContain('sk-test-12345');
  });

  it('saveProviderConfig upserts on repeat save (idempotent on key)', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    service.saveProviderConfig(config, 'sk-first');
    service.saveProviderConfig({ ...config, model: 'gpt-4o' }, 'sk-second');

    const rows = db.prepare('SELECT key, value FROM setting').all() as Array<{
      key: string;
      value: string;
    }>;
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0]!.value).model).toBe('gpt-4o');
  });

  it('getProviderConfig returns null when no config has been saved', () => {
    expect(service.getProviderConfig()).toBeNull();
  });

  it('getProviderConfig returns config plus masked key when present', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    service.saveProviderConfig(config, 'sk-test-prod-987654');
    const result = service.getProviderConfig();

    expect(result).toEqual({ ...config, apiKeyMasked: 'sk-...7654' });
    expect(credentials.getMasked).toHaveBeenCalledWith('llm.openai.apikey');
  });

  it('getProviderConfig returns config with apiKeyMasked=null when the key blob is missing', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    // Insert the config row directly without going through save, simulating
    // a sqlite row that survived a credential-blob deletion (e.g. user wiped
    // <userData>/credentials/ manually).
    db.prepare(`INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'llm.provider',
      JSON.stringify(config),
      '2026-05-11T00:00:00.000Z',
    );

    const result = service.getProviderConfig();
    expect(result).toEqual({ ...config, apiKeyMasked: null });
  });

  it('getProviderConfigWithKey returns config + plaintext key when both exist', () => {
    const config: ProviderConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyKeyref: 'llm.anthropic.apikey',
    };
    service.saveProviderConfig(config, 'sk-ant-secret');

    const result = service.getProviderConfigWithKey();
    expect(result).toEqual({ config, apiKey: 'sk-ant-secret' });
  });

  it('getProviderConfigWithKey returns null when key blob is missing', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    db.prepare(`INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'llm.provider',
      JSON.stringify(config),
      '2026-05-11T00:00:00.000Z',
    );

    expect(service.getProviderConfigWithKey()).toBeNull();
  });

  it('clearProviderConfig removes both the setting row and the credential', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    service.saveProviderConfig(config, 'sk-bye');
    service.clearProviderConfig();

    expect(credentials.delete).toHaveBeenCalledWith('llm.openai.apikey');
    const row = db.prepare('SELECT key FROM setting WHERE key = ?').get('llm.provider');
    expect(row).toBeUndefined();
    expect(service.getProviderConfig()).toBeNull();
  });

  it('clearProviderConfig is a no-op (no throw) when nothing is saved', () => {
    expect(() => service.clearProviderConfig()).not.toThrow();
    expect(credentials.delete).not.toHaveBeenCalled();
  });

  it('saveProviderConfig rejects an invalid config shape (ZodError)', () => {
    expect(() =>
      service.saveProviderConfig(
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        { provider: 'unknown-provider', model: 'x', apiKeyKeyref: 'llm.openai.apikey' } as any,
        'sk-anything',
      ),
    ).toThrow(z.ZodError);
    // Defense: nothing should land in either store.
    expect(credentials.set).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) as c FROM setting').get()).toMatchObject({ c: 0 });
  });

  it('readConfig parses azure config with all required discriminated-union fields', () => {
    const config: ProviderConfig = {
      provider: 'azure',
      model: 'gpt-4o',
      apiKeyKeyref: 'llm.azure.apikey',
      resourceName: 'my-resource',
      apiVersion: '2024-08-01-preview',
    };
    service.saveProviderConfig(config, 'az-key');

    expect(service.getProviderConfig()).toEqual({
      ...config,
      apiKeyMasked: 'sk-...-key',
    });
    expect(service.getProviderConfigWithKey()).toEqual({ config, apiKey: 'az-key' });
  });
});
