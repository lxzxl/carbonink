import { runMigrations } from '@main/db/migrate';
import type { CredentialService } from '@main/services/credential-service';
import { SettingsService } from '@main/services/settings-service';
import type { ProviderConfigV2 } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('saveProviderConfig writes V2 config to setting and key to credentials', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
    service.saveProviderConfig(config, 'sk-test-12345');

    // Credential set with the keyref derived from config.provider
    expect(credentials.set).toHaveBeenCalledWith('llm.openai.apikey', 'sk-test-12345');

    // setting row contains the JSON-serialized V2 config (NOT the api key)
    const row = db.prepare('SELECT key, value, updated_at FROM setting').get() as {
      key: string;
      value: string;
      updated_at: string;
    };
    expect(row.key).toBe('llm.provider');
    expect(row.updated_at).toBe('2026-05-11T00:00:00.000Z');
    const parsed = JSON.parse(row.value);
    expect(parsed).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    // Defense in depth: the plaintext api key must never appear in sqlite.
    expect(row.value).not.toContain('sk-test-12345');
  });

  it('saveProviderConfig upserts on repeat save (idempotent on key)', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
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

  it('getProviderConfig returns V2 config plus masked key when present', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
    service.saveProviderConfig(config, 'sk-test-prod-987654');
    const result = service.getProviderConfig();

    expect(result).toEqual({ ...config, apiKeyMasked: 'sk-...7654' });
    expect(credentials.getMasked).toHaveBeenCalledWith('llm.openai.apikey');
  });

  it('getProviderConfig returns config with apiKeyMasked=null when the key blob is missing', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
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
    const config: ProviderConfigV2 = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };
    service.saveProviderConfig(config, 'sk-ant-secret');

    const result = service.getProviderConfigWithKey();
    expect(result).toEqual({
      config: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      apiKey: 'sk-ant-secret',
    });
  });

  it('getProviderConfigWithKey returns null when key blob is missing', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
    db.prepare(`INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'llm.provider',
      JSON.stringify(config),
      '2026-05-11T00:00:00.000Z',
    );

    expect(service.getProviderConfigWithKey()).toBeNull();
  });

  it('clearProviderConfig removes both the setting row and the credential', () => {
    const config: ProviderConfigV2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
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

  it('saveProviderConfig rejects an invalid config shape', () => {
    // V2 accepts any non-empty provider string, so the old V1-only error
    // ("unknown-provider" not in the discriminated union) no longer
    // surfaces. Use a structurally broken input (missing required `model`)
    // that fails both V1 and V2 schemas.
    expect(() =>
      service.saveProviderConfig(
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        { provider: 'openai' } as any,
        'sk-anything',
      ),
    ).toThrow();
    // Defense: nothing should land in either store.
    expect(credentials.set).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) as c FROM setting').get()).toMatchObject({ c: 0 });
  });

  it('readConfig migrates legacy azure V1 records on disk to V2 and renames provider id', () => {
    // Old installs from before Task 10a persisted V1 rows; Task 10c added a
    // provider-id rename so `azure` → pi-ai's `azure-openai-responses` on
    // read. The on-read path also writes the migrated record back to disk
    // and aliases the credential blob, so the user's saved API key carries
    // through the rename without forcing them to re-enter it.
    const v1Azure = {
      provider: 'azure',
      model: 'gpt-4o',
      apiKeyKeyref: 'llm.azure.apikey',
      resourceName: 'my-resource',
      apiVersion: '2024-08-01-preview',
    };
    db.prepare(`INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)`).run(
      'llm.provider',
      JSON.stringify(v1Azure),
      '2026-05-11T00:00:00.000Z',
    );
    credentials.set('llm.azure.apikey', 'az-key');

    expect(service.getProviderConfig()).toEqual({
      provider: 'azure-openai-responses',
      model: 'gpt-4o',
      baseUrl: 'https://my-resource.openai.azure.com',
      apiKeyMasked: 'sk-...-key',
    });
    expect(service.getProviderConfigWithKey()).toEqual({
      config: {
        provider: 'azure-openai-responses',
        model: 'gpt-4o',
        baseUrl: 'https://my-resource.openai.azure.com',
      },
      apiKey: 'az-key',
    });
    // The opportunistic write-back persisted the migrated record, so a
    // fresh read takes the V2 fast path (no further migration triggers).
    const row = db.prepare('SELECT value FROM setting WHERE key = ?').get('llm.provider') as {
      value: string;
    };
    expect(JSON.parse(row.value)).toEqual({
      provider: 'azure-openai-responses',
      model: 'gpt-4o',
      baseUrl: 'https://my-resource.openai.azure.com',
    });
    // Credential alias copies the apiKey to the new keyref but leaves the
    // old blob in place — losing the credential mid-migration would be
    // worse than a stale blob.
    expect(credentials.get('llm.azure-openai-responses.apikey')).toBe('az-key');
    expect(credentials.get('llm.azure.apikey')).toBe('az-key');
  });
});
