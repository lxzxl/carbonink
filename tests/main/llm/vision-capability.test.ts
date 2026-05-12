import {
  assertVisionCapable,
  VISION_CAPABLE_MODELS,
  VisionUnsupportedError,
} from '@main/llm/vision-capability';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it } from 'vitest';

function cfg(partial: Partial<ProviderConfig> & { provider: ProviderConfig['provider'] }) {
  // Returns a shape that satisfies `ProviderConfig`'s discriminated union for
  // each provider variant. We only assert on `.provider` + `.model` so the
  // other fields are placeholder defaults.
  switch (partial.provider) {
    case 'openai':
      return {
        provider: 'openai',
        model: partial.model ?? 'gpt-4o',
        apiKeyKeyref: 'llm.openai.apikey',
      } as ProviderConfig;
    case 'anthropic':
      return {
        provider: 'anthropic',
        model: partial.model ?? 'claude-sonnet-4-5',
        apiKeyKeyref: 'llm.anthropic.apikey',
      } as ProviderConfig;
    case 'azure':
      return {
        provider: 'azure',
        model: partial.model ?? 'gpt-4o',
        apiKeyKeyref: 'llm.azure.apikey',
        resourceName: 'r',
        apiVersion: '2024-08-01-preview',
      } as ProviderConfig;
    case 'deepseek':
      return {
        provider: 'deepseek',
        model: partial.model ?? 'deepseek-vl',
        apiKeyKeyref: 'llm.deepseek.apikey',
      } as ProviderConfig;
    case 'openai-compat':
      return {
        provider: 'openai-compat',
        model: partial.model ?? 'anything',
        apiKeyKeyref: 'llm.openai-compat.apikey',
        baseUrl: 'https://x.example.com',
        name: 'X',
      } as ProviderConfig;
  }
}

describe('VISION_CAPABLE_MODELS map', () => {
  it('contains every provider kind', () => {
    expect(VISION_CAPABLE_MODELS.openai).toContain('gpt-4o');
    expect(VISION_CAPABLE_MODELS.openai).toContain('gpt-4o-mini');
    expect(VISION_CAPABLE_MODELS.anthropic).toContain('claude-sonnet-4-5');
    expect(VISION_CAPABLE_MODELS.azure).toContain('gpt-4o');
    expect(VISION_CAPABLE_MODELS.deepseek).toContain('deepseek-vl');
    expect(VISION_CAPABLE_MODELS['openai-compat']).toBe('unknown');
  });
});

describe('assertVisionCapable', () => {
  it('passes through for whitelisted OpenAI models', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'openai', model: 'gpt-4o' }))).not.toThrow();
    expect(() =>
      assertVisionCapable(cfg({ provider: 'openai', model: 'gpt-4o-mini' })),
    ).not.toThrow();
  });
  it('passes through for whitelisted Anthropic models', () => {
    expect(() =>
      assertVisionCapable(cfg({ provider: 'anthropic', model: 'claude-sonnet-4-5' })),
    ).not.toThrow();
  });
  it('passes through for whitelisted DeepSeek vision model', () => {
    expect(() =>
      assertVisionCapable(cfg({ provider: 'deepseek', model: 'deepseek-vl' })),
    ).not.toThrow();
  });
  it('passes through for openai-compat regardless of model (unknown backend)', () => {
    expect(() =>
      assertVisionCapable(cfg({ provider: 'openai-compat', model: 'whatever' })),
    ).not.toThrow();
  });
  it('throws VisionUnsupportedError for deepseek-chat', () => {
    expect(() =>
      assertVisionCapable(cfg({ provider: 'deepseek', model: 'deepseek-chat' })),
    ).toThrow(VisionUnsupportedError);
  });
  it('throws VisionUnsupportedError for an openai model not in the list', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'openai', model: 'gpt-3.5-turbo' }))).toThrow(
      VisionUnsupportedError,
    );
  });
  it('error carries the offending model + a suggestion string', () => {
    try {
      assertVisionCapable(cfg({ provider: 'deepseek', model: 'deepseek-chat' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VisionUnsupportedError);
      const ve = err as VisionUnsupportedError;
      expect(ve.model).toBe('deepseek-chat');
      expect(ve.suggestion).toContain('deepseek-vl');
    }
  });
});
