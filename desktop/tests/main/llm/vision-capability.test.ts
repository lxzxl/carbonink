import { createModelCatalog, type ModelCatalog } from '@main/llm/model-catalog';
import { assertVisionCapable, VisionUnsupportedError } from '@main/llm/vision-capability';
import type { ProviderConfigV2 } from '@shared/types';
import { describe, expect, it } from 'vitest';

function cfg(provider: string, model: string): ProviderConfigV2 {
  return { provider, model };
}

/** Catalog with one fetched row injected via the store seam. */
function catalogWithDynamicRow(provider: string, modelId: string): ModelCatalog {
  const catalog = createModelCatalog({
    userDataDir: '',
    store: {
      listProviders: () => [provider],
      read: async () => ({ models: [{ id: modelId }] as never[], checkedAt: 1 }),
      write: async () => {},
      delete: async () => {},
    },
  });
  return catalog;
}

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
  it('passes for dynamic rows even when bundled is text-only', async () => {
    // A fetched row with the same id as a bundled text-only entry wins the
    // merge and is capability-unknown → permissive.
    const catalog = catalogWithDynamicRow('deepseek', 'deepseek-v4-pro');
    await catalog.seed();
    expect(() => assertVisionCapable(cfg('deepseek', 'deepseek-v4-pro'), catalog)).not.toThrow();
  });
});
