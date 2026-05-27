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
    const v2 = {
      provider: 'openai-compat',
      model: 'qwen3-coder',
      baseUrl: 'https://api.example.com',
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

  it('migrates v1 azure shape with derived baseUrl', () => {
    const v1 = {
      provider: 'azure',
      model: 'gpt-4o',
      apiKeyKeyref: 'llm.azure.apikey',
      resourceName: 'my-azure-resource',
      apiVersion: '2024-08-01-preview',
    };
    expect(migrateProviderConfig(v1)).toEqual({
      provider: 'azure',
      model: 'gpt-4o',
      baseUrl: 'https://my-azure-resource.openai.azure.com',
    });
  });

  it('migrates v1 openai-compat shape preserving baseUrl', () => {
    const v1 = {
      provider: 'openai-compat',
      model: 'qwen3-coder',
      apiKeyKeyref: 'llm.openai-compat.apikey',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      name: 'Qwen',
    };
    expect(migrateProviderConfig(v1)).toEqual({
      provider: 'openai-compat',
      model: 'qwen3-coder',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  });

  it('returns null for v1 azure missing resourceName', () => {
    const corrupted = { provider: 'azure', model: 'gpt-4o', apiVersion: '2024-08-01' };
    expect(migrateProviderConfig(corrupted)).toBe(null);
  });

  it('returns null for v1 openai-compat missing baseUrl', () => {
    const corrupted = {
      provider: 'openai-compat',
      model: 'q',
      apiKeyKeyref: 'llm.openai-compat.apikey',
    };
    expect(migrateProviderConfig(corrupted)).toBe(null);
  });

  it('accepts unknown provider strings as valid v2 (no whitelist)', () => {
    // v2 has no provider whitelist — pi-ai is the source of truth for what
    // providers exist (32+ and growing). Any object with `provider` + `model`
    // parses as v2. This is intentional: keeps migrateProviderConfig free of
    // a hand-maintained provider list.
    const unknown = { provider: 'fake-llm-co', model: 'gpt-9000' };
    expect(migrateProviderConfig(unknown)).toEqual({
      provider: 'fake-llm-co',
      model: 'gpt-9000',
    });
  });
});
