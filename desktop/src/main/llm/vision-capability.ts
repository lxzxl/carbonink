import { getModelsCollection } from '@main/llm/models.js';
import { dynamicModelMirror, resolveModel } from '@main/llm/pi-catalog.js';
import type { ProviderConfigV2 } from '@shared/types.js';

/**
 * Gate the vision (OCR fallback) path on the selected model's catalog
 * capability — `ExtractionService` calls this before rendering PDF pages.
 *
 * Rule (Decision 6 of the pi-0.85 plan):
 * - bundled static entry with `input` including `image` → allow;
 * - bundled static entry that is text-only → throw `VisionUnsupportedError`
 *   with a concrete switch-to suggestion;
 * - capability-unknown (dynamic-fetched rows, synthetic custom ids, unknown
 *   providers) → permissive: the provider API is the source of truth.
 *   pi-ai silently ignores images on non-vision models, so without this
 *   gate a misconfigured text model would produce silent garbage — but
 *   over-restricting unknown ids would block users with known-good
 *   multimodal models we simply haven't catalogued.
 */
const SUGGESTIONS: Record<string, string> = {
  openai: 'Switch to gpt-4o or gpt-4o-mini in Settings.',
  azure: 'Switch to a gpt-4o deployment in Settings.',
  'azure-openai-responses': 'Switch to a gpt-4o deployment in Settings.',
  anthropic: 'Switch to claude-sonnet-4-5 (or any claude-3.5+) in Settings.',
  deepseek: 'Switch to a vision-capable DeepSeek model in Settings.',
};

const DEFAULT_SUGGESTION = 'Switch to a vision-capable model in Settings.';

/**
 * Thrown when an extraction needs to use the vision path but the
 * currently-selected provider+model combination isn't known to accept
 * image inputs. Whitelisted by `sanitize.ts` so the user sees the
 * full message + suggestion as an actionable toast.
 */
export class VisionUnsupportedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly model: string,
    public readonly suggestion: string,
  ) {
    super(
      `Selected model "${model}" does not support image input. ` +
        `OCR fallback needs a multimodal model. ${suggestion}`,
    );
    this.name = 'VisionUnsupportedError';
  }
}

/**
 * Validate that a `ProviderConfigV2` resolves to a vision-capable model.
 * Throws `VisionUnsupportedError` on a catalog-confirmed text-only model;
 * passes through on image-capable or capability-unknown configurations.
 */
export function assertVisionCapable(config: ProviderConfigV2): void {
  const resolved = resolveModel(config.provider, config.model);
  // Unknown provider (nothing to clone) — let the API call decide.
  if (!resolved) return;
  // Capability-unknown rows are permissive: dynamic-fetched entries (list
  // endpoints expose no modality flags) and synthetic custom ids
  // (user-typed, newer than any catalog).
  if (dynamicModelMirror.get(config.provider)?.some((m) => m.id === config.model)) return;
  const bundled = getModelsCollection().getModel(config.provider, config.model);
  if (!bundled) return;
  // Authoritative bundled entry: text-only (no `image` in `input`) is a
  // confirmed mismatch — throw with a concrete suggestion.
  if (!bundled.input.includes('image')) {
    throw new VisionUnsupportedError(
      config.provider,
      config.model,
      SUGGESTIONS[config.provider] ?? DEFAULT_SUGGESTION,
    );
  }
}
