import { dynamicModelMirror } from '@main/llm/pi-catalog';
import { assertVisionCapable, VisionUnsupportedError } from '@main/llm/vision-capability';
import type { ProviderConfigV2 } from '@shared/types';
import { afterEach, describe, expect, it } from 'vitest';

function cfg(provider: string, model: string): ProviderConfigV2 {
  return { provider, model };
}

afterEach(() => {
  dynamicModelMirror.clear();
});

describe('assertVisionCapable (catalog-driven)', () => {
  it('passes for a bundled image-capable model', () => {
    // deepseek-reasoner is text-only in the bundled catalog; pick a
    // provider/model the bundled catalog marks with image input. If the
    // bundled catalog ever drops all image models, this test fails loudly
    // and the gate needs re-examination — that is intentional.
    expect(() => assertVisionCapable(cfg('openai', 'gpt-4o'))).not.toThrow();
  });
  it('throws VisionUnsupportedError for a bundled text-only model', () => {
    expect(() => assertVisionCapable(cfg('deepseek', 'deepseek-v4-pro'))).toThrow(
      VisionUnsupportedError,
    );
  });
  it('error carries the offending model + a suggestion string', () => {
    try {
      assertVisionCapable(cfg('deepseek', 'deepseek-v4-pro'));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VisionUnsupportedError);
      const ve = err as VisionUnsupportedError;
      expect(ve.model).toBe('deepseek-v4-pro');
      expect(ve.suggestion.length).toBeGreaterThan(0);
    }
  });
  it('passes for unknown providers (let the API decide)', () => {
    expect(() => assertVisionCapable(cfg('not-a-provider', 'whatever'))).not.toThrow();
  });
  it('passes for synthetic custom ids (capability-unknown)', () => {
    expect(() => assertVisionCapable(cfg('deepseek', 'deepseek-chat-future-2099'))).not.toThrow();
  });
  it('passes for dynamic-mirror rows even when bundled is text-only', () => {
    // A fetched row with the same id as a bundled text-only entry wins the
    // merge and is capability-unknown → permissive.
    dynamicModelMirror.set('deepseek', [
      {
        id: 'deepseek-v4-pro',
        name: 'deepseek-v4-pro',
        api: 'openai-completions',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 64000,
        maxTokens: 8000,
      },
    ]);
    expect(() => assertVisionCapable(cfg('deepseek', 'deepseek-v4-pro'))).not.toThrow();
  });
});
