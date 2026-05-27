import { migrateProviderConfig } from '@main/services/settings-service';
import { describe, expect, it } from 'vitest';

describe('migrateProviderConfig', () => {
  it('returns null for non-object input', () => {
    expect(migrateProviderConfig(null)).toBe(null);
    expect(migrateProviderConfig(undefined)).toBe(null);
    expect(migrateProviderConfig('string')).toBe(null);
    expect(migrateProviderConfig(42)).toBe(null);
  });

  it('returns null for object missing provider/model', () => {
    expect(migrateProviderConfig({})).toBe(null);
    expect(migrateProviderConfig({ provider: 'openai' })).toBe(null);
    expect(migrateProviderConfig({ model: 'gpt-4o' })).toBe(null);
  });

  it('passes already-v2 shape through unchanged', () => {
    const v2 = { provider: 'deepseek', model: 'deepseek-chat' };
    expect(migrateProviderConfig(v2)).toEqual(v2);
  });

  it('passes v2 with baseUrl through', () => {
    // The provider rename step in `migrateProviderConfig` (Task 10c) only
    // rewrites `azure` / `openai-compat`. Any other provider id with an
    // optional baseUrl override passes through verbatim — pi-ai treats
    // baseUrl as a per-config override on top of its catalog baseUrl, so
    // it stays on the record as-is for self-hosted-gateway users.
    const v2 = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://my-corp-gateway.example.com/v1',
    };
    expect(migrateProviderConfig(v2)).toEqual(v2);
  });

  it('migrates v1 openai shape', () => {
    const v1 = { provider: 'openai', model: 'gpt-4o-mini', apiKeyKeyref: 'llm.openai.apikey' };
    expect(migrateProviderConfig(v1)).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('migrates v1 anthropic shape', () => {
    const v1 = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyKeyref: 'llm.anthropic.apikey',
    };
    expect(migrateProviderConfig(v1)).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
  });

  it('migrates v1 deepseek shape', () => {
    const v1 = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    expect(migrateProviderConfig(v1)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
  });

  it('migrates v1 azure shape and renames provider to azure-openai-responses', () => {
    // pi-ai renamed `azure` → `azure-openai-responses` between V1 and Task 10c.
    // The migration must rewrite both `provider` and derive the baseUrl from
    // `resourceName` in one step, so users with V1 azure configs don't see a
    // "re-select your provider" warning on first launch post-upgrade.
    const v1 = {
      provider: 'azure',
      model: 'gpt-4o',
      apiKeyKeyref: 'llm.azure.apikey',
      resourceName: 'my-azure-resource',
      apiVersion: '2024-08-01-preview',
    };
    expect(migrateProviderConfig(v1)).toEqual({
      provider: 'azure-openai-responses',
      model: 'gpt-4o',
      baseUrl: 'https://my-azure-resource.openai.azure.com',
    });
  });

  it('returns null for v1 openai-compat (pi-ai has no equivalent provider)', () => {
    // V1's `openai-compat` was a catch-all for any OpenAI-API-compatible
    // gateway. pi-ai treats each downstream provider (qwen, kimi-coding,
    // deepseek, …) as a first-class entry, so there's no provider id to
    // rename to. We force re-onboarding instead of silently mismapping.
    const v1 = {
      provider: 'openai-compat',
      model: 'qwen3-coder',
      apiKeyKeyref: 'llm.openai-compat.apikey',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      name: 'Qwen',
    };
    expect(migrateProviderConfig(v1)).toBe(null);
  });

  it('returns null for v1 azure missing resourceName', () => {
    const corrupted = { provider: 'azure', model: 'gpt-4o', apiVersion: '2024-08-01' };
    expect(migrateProviderConfig(corrupted)).toBe(null);
  });

  it('renames a v2 azure record to azure-openai-responses (covers pre-10c V2 writes)', () => {
    // Some installs migrated through a pre-Task-10c desktop build that
    // wrote V1 → V2 azure verbatim (provider stayed `'azure'`). On read,
    // we still need to upgrade the provider id so the renderer's catalog
    // lookup finds a match. This is the V2-only path through the rename
    // step in `migrateProviderConfig`.
    const v2Azure = {
      provider: 'azure',
      model: 'gpt-4o',
      baseUrl: 'https://my-azure-resource.openai.azure.com',
    };
    expect(migrateProviderConfig(v2Azure)).toEqual({
      provider: 'azure-openai-responses',
      model: 'gpt-4o',
      baseUrl: 'https://my-azure-resource.openai.azure.com',
    });
  });

  it('returns null for a v2 openai-compat record', () => {
    // V1 path returns null above; the V2 path also has to drop these. A
    // pre-10c install that already migrated V1 openai-compat into V2 would
    // re-read here on launch and need to land in the same re-onboard state.
    const v2 = {
      provider: 'openai-compat',
      model: 'qwen3-coder',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    };
    expect(migrateProviderConfig(v2)).toBe(null);
  });

  it('accepts unknown provider strings as valid v2 (no whitelist)', () => {
    // v2 has no provider whitelist — pi-ai is the source of truth for what
    // providers exist (32+ and growing). Any object with `provider` + `model`
    // parses as v2. This is intentional: keeps migrateProviderConfig free of
    // a hand-maintained provider list. The renderer surfaces the warning
    // for ids that aren't in pi-ai's `getProviders()` snapshot.
    const unknown = { provider: 'fake-llm-co', model: 'gpt-9000' };
    expect(migrateProviderConfig(unknown)).toEqual({
      provider: 'fake-llm-co',
      model: 'gpt-9000',
    });
  });
});
