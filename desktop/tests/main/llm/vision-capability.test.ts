import {
  assertVisionCapable,
  VISION_CAPABLE_MODELS,
  VisionUnsupportedError,
} from '@main/llm/vision-capability';
import type { ProviderConfigV2 } from '@shared/types';
import { describe, expect, it } from 'vitest';

function cfg(partial: { provider: string; model?: string }): ProviderConfigV2 {
  // V2 is a flat shape (provider + model + optional baseUrl). Defaults below
  // pick a reasonable model per known provider so callers can omit it.
  const defaults: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-5',
    azure: 'gpt-4o',
    deepseek: 'deepseek-vl',
    'openai-compat': 'anything',
  };
  return {
    provider: partial.provider,
    model: partial.model ?? defaults[partial.provider] ?? 'unknown',
  };
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
