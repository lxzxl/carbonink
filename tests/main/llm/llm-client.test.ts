import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LLMClient, ProviderNotConfiguredError } from '@main/llm/llm-client';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfig } from '@shared/types';
import { generateObject } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
// `vi.mock` is hoisted by Vitest before any `import` runs. We replace the
// real AI SDK packages with factory stubs so the test can introspect what
// arguments LLMClient passes through, without ever opening a network socket
// or needing a real API key.

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  // Provider factory returns a callable Provider: calling it with a modelId
  // yields a LanguageModel. The test uses a tagged string sentinel so
  // assertions can match the exact model instance passed to generateObject.
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => `openai-model:${modelId}`)),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => `anthropic-model:${modelId}`)),
}));

vi.mock('@ai-sdk/azure', () => ({
  createAzure: vi.fn(() => vi.fn((modelId: string) => `azure-model:${modelId}`)),
}));

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => vi.fn((modelId: string) => `deepseek-model:${modelId}`)),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => vi.fn((modelId: string) => `compat-model:${modelId}`)),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCredentials(keyMap: Record<string, string | null>): CredentialService {
  // Only `get` is exercised by LLMClient; the rest can stay unimplemented.
  return {
    get: vi.fn((key: string) => keyMap[key] ?? null),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn(() => true),
  } as unknown as CredentialService;
}

beforeEach(() => {
  vi.mocked(generateObject).mockReset();
  vi.mocked(createOpenAI).mockClear();
  vi.mocked(createAnthropic).mockClear();
  vi.mocked(createAzure).mockClear();
  vi.mocked(createDeepSeek).mockClear();
  vi.mocked(createOpenAICompatible).mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLMClient.extract', () => {
  it('looks up the api key, builds an OpenAI model, and forwards schema/prompt to generateObject', async () => {
    const credentials = makeCredentials({ 'llm.openai.apikey': 'sk-test-openai' });
    const client = new LLMClient({ credentials });
    const schema = z.object({ value: z.number() });
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { value: 42 },
    } as never);

    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    const result = await client.extract(config, schema, 'hello');

    expect(result).toEqual({ value: 42 });
    expect(credentials.get).toHaveBeenCalledWith('llm.openai.apikey');
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test-openai' });
    expect(generateObject).toHaveBeenCalledWith({
      model: 'openai-model:gpt-4o-mini',
      schema,
      prompt: 'hello',
      // `mode: 'json'` forces JSON-mode across all providers; default
      // 'auto' silently falls back to compatibility mode for DeepSeek /
      // OpenAI-compat and logs a runtime warning.
      mode: 'json',
    });
  });

  it('throws ProviderNotConfiguredError when the credential is absent', async () => {
    const credentials = makeCredentials({ 'llm.openai.apikey': null });
    const client = new LLMClient({ credentials });
    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };

    await expect(
      client.extract(config, z.object({ ok: z.boolean() }), 'hi'),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('routes Anthropic provider through createAnthropic with the key', async () => {
    const credentials = makeCredentials({
      'llm.anthropic.apikey': 'sk-ant-test',
    });
    const client = new LLMClient({ credentials });
    const schema = z.object({ s: z.string() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { s: 'x' } } as never);

    const config: ProviderConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyKeyref: 'llm.anthropic.apikey',
    };
    await client.extract(config, schema, 'p');

    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-ant-test' });
    expect(vi.mocked(generateObject).mock.calls[0]![0]!.model).toBe(
      'anthropic-model:claude-sonnet-4-5',
    );
  });

  it('routes Azure provider with resourceName and apiVersion', async () => {
    const credentials = makeCredentials({ 'llm.azure.apikey': 'az-key' });
    const client = new LLMClient({ credentials });
    const schema = z.object({ s: z.string() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { s: 'x' } } as never);

    const config: ProviderConfig = {
      provider: 'azure',
      model: 'gpt-4o',
      apiKeyKeyref: 'llm.azure.apikey',
      resourceName: 'my-resource',
      apiVersion: '2024-08-01-preview',
    };
    await client.extract(config, schema, 'p');

    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      resourceName: 'my-resource',
      apiVersion: '2024-08-01-preview',
    });
    expect(vi.mocked(generateObject).mock.calls[0]![0]!.model).toBe('azure-model:gpt-4o');
  });

  it('routes DeepSeek provider through createDeepSeek with the key', async () => {
    const credentials = makeCredentials({ 'llm.deepseek.apikey': 'ds-key' });
    const client = new LLMClient({ credentials });
    const schema = z.object({ s: z.string() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { s: 'x' } } as never);

    const config: ProviderConfig = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyKeyref: 'llm.deepseek.apikey',
    };
    await client.extract(config, schema, 'p');

    expect(createDeepSeek).toHaveBeenCalledWith({ apiKey: 'ds-key' });
    expect(vi.mocked(generateObject).mock.calls[0]![0]!.model).toBe('deepseek-model:deepseek-chat');
  });

  it('routes OpenAI-compat provider with baseURL and name', async () => {
    const credentials = makeCredentials({
      'llm.openai-compat.apikey': 'compat-key',
    });
    const client = new LLMClient({ credentials });
    const schema = z.object({ s: z.string() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { s: 'x' } } as never);

    const config: ProviderConfig = {
      provider: 'openai-compat',
      model: 'llama-3.1-70b',
      apiKeyKeyref: 'llm.openai-compat.apikey',
      baseUrl: 'https://api.example.com/v1',
      name: 'Together',
    };
    await client.extract(config, schema, 'p');

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      apiKey: 'compat-key',
      baseURL: 'https://api.example.com/v1',
      name: 'Together',
    });
    expect(vi.mocked(generateObject).mock.calls[0]![0]!.model).toBe('compat-model:llama-3.1-70b');
  });
});

describe('LLMClient.ping', () => {
  it('returns ok=true on successful ping (generateObject resolves)', async () => {
    const credentials = makeCredentials({ 'llm.openai.apikey': 'sk-test' });
    const client = new LLMClient({ credentials });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { ok: true } } as never);

    const result = await client.ping({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    });

    expect(result).toEqual({ ok: true });
    // Verify ping uses a real zod schema (not a JSON Schema literal) so the
    // AI SDK can validate the model response. Cast to a permissive record
    // because generateObject's first-arg type is a discriminated union.
    const callArgs = vi.mocked(generateObject).mock.calls[0]![0]! as Record<string, unknown>;
    expect(callArgs.schema).toBeDefined();
    expect(callArgs.prompt).toContain('ok');
  });

  it('returns ok=false with the error message on generateObject failure', async () => {
    const credentials = makeCredentials({ 'llm.openai.apikey': 'sk-test' });
    const client = new LLMClient({ credentials });
    vi.mocked(generateObject).mockRejectedValueOnce(new Error('unauthorized'));

    const result = await client.ping({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    });

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('returns ok=false with ProviderNotConfiguredError message when key missing', async () => {
    const credentials = makeCredentials({});
    const client = new LLMClient({ credentials });

    const result = await client.ping({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyKeyref: 'llm.anthropic.apikey',
    });

    expect(result).toEqual({
      ok: false,
      error: 'No API key set for provider: anthropic',
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('returns ok=false with "unknown error" when a non-Error is thrown', async () => {
    const credentials = makeCredentials({ 'llm.openai.apikey': 'sk-test' });
    const client = new LLMClient({ credentials });
    vi.mocked(generateObject).mockRejectedValueOnce('weird string thrown');

    const result = await client.ping({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    });

    expect(result).toEqual({ ok: false, error: 'unknown error' });
  });
});

describe('LLMClient.pingWithKey', () => {
  it('uses the override key (does NOT consult credentials.get) and returns ok=true on success', async () => {
    const credentials = makeCredentials({}); // intentionally empty
    const client = new LLMClient({ credentials });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { ok: true } } as never);

    const result = await client.pingWithKey(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKeyKeyref: 'llm.openai.apikey',
      },
      'sk-unsaved-typed-in-form',
    );

    expect(result).toEqual({ ok: true });
    expect(credentials.get).not.toHaveBeenCalled();
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-unsaved-typed-in-form' });
  });

  it('returns ok=false with the error message on failure (override key still in effect)', async () => {
    const credentials = makeCredentials({});
    const client = new LLMClient({ credentials });
    vi.mocked(generateObject).mockRejectedValueOnce(new Error('bad key'));

    const result = await client.pingWithKey(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKeyKeyref: 'llm.openai.apikey',
      },
      'sk-wrong',
    );

    expect(result).toEqual({ ok: false, error: 'bad key' });
    expect(credentials.get).not.toHaveBeenCalled();
  });
});

describe('ProviderNotConfiguredError', () => {
  it('exposes the provider name and a recognizable name', () => {
    const err = new ProviderNotConfiguredError('openai');
    expect(err.provider).toBe('openai');
    expect(err.name).toBe('ProviderNotConfiguredError');
    expect(err.message).toContain('openai');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('LLMClient.extractWithImages', () => {
  it('builds a multipart user message with text + image parts and forwards mode=json', async () => {
    const credentials = makeCredentials({ 'llm.openai.apikey': 'sk-vision' });
    const client = new LLMClient({ credentials });
    const schema = z.object({ ok: z.boolean() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { ok: true } } as never);

    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    const imageA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa]);
    const imageB = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xbb]);

    const result = await client.extractWithImages(
      config,
      schema,
      { userText: 'extract fields' },
      [imageA, imageB],
    );

    expect(result).toEqual({ ok: true });
    expect(generateObject).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateObject).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.model).toBe('openai-model:gpt-4o');
    expect(call?.schema).toBe(schema);
    expect(call?.mode).toBe('json');
    // One user-role message with content = [text, image, image].
    const messages = call?.messages as Array<{ role: string; content: Array<{ type: string }> }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toHaveLength(3); // 1 text + 2 images
    expect(messages[0]!.content[0]).toEqual({ type: 'text', text: 'extract fields' });
    expect(messages[0]!.content[1]).toMatchObject({ type: 'image' });
    expect(messages[0]!.content[2]).toMatchObject({ type: 'image' });
  });

  it('includes a system message when VisionMessages.system is set', async () => {
    const credentials = makeCredentials({ 'llm.anthropic.apikey': 'sk-anthropic' });
    const client = new LLMClient({ credentials });
    const schema = z.object({ ok: z.boolean() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { ok: true } } as never);

    const config: ProviderConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyKeyref: 'llm.anthropic.apikey',
    };
    await client.extractWithImages(
      config,
      schema,
      { system: 'You are an expert OCR.', userText: 'extract' },
      [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    );

    const call = vi.mocked(generateObject).mock.calls[0]?.[0] as Record<string, unknown>;
    const messages = call?.messages as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'system', content: 'You are an expert OCR.' });
    expect(messages[1]!.role).toBe('user');
  });
});
