import type { ProviderConfig, ProviderKind } from '@shared/types.js';

/**
 * Models known to accept image inputs alongside text. Used by
 * `ExtractionService` to gate the vision fallback path — if the user's
 * currently-configured model isn't on this list, we surface a
 * `VisionUnsupportedError` toast pointing at Settings instead of
 * silently failing on the actual API call.
 *
 * Naming follows each provider's canonical model id (what the user
 * types into Settings). For `openai-compat` we don't know the backend
 * so we mark it `'unknown'` and let the API itself error if it
 * doesn't support images — better than over-restricting.
 *
 * Keep this list aligned with the suggestion copy in
 * `VisionUnsupportedError.suggestion` so the toast names something
 * the user can actually pick.
 */
export const VISION_CAPABLE_MODELS: Record<ProviderKind, ReadonlyArray<string> | 'unknown'> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  azure: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: [
    'claude-3-5-sonnet',
    'claude-sonnet-4',
    'claude-sonnet-4-5',
    'claude-3-opus',
    'claude-3-haiku',
  ],
  deepseek: ['deepseek-vl'],
  'openai-compat': 'unknown',
};

/**
 * Per-provider suggestion text appended to the user-facing error.
 * Names the most common vision-capable model on each platform so the
 * user has a concrete answer to "what should I switch to?".
 */
const SUGGESTIONS: Record<ProviderKind, string> = {
  openai: 'Switch to gpt-4o or gpt-4o-mini in Settings.',
  azure: 'Switch to a gpt-4o deployment in Settings.',
  anthropic: 'Switch to claude-sonnet-4-5 (or any claude-3.5+) in Settings.',
  deepseek: 'Switch from deepseek-chat to deepseek-vl in Settings.',
  'openai-compat': 'Configure a vision-capable model in Settings.',
};

/**
 * Thrown when an extraction needs to use the vision path but the
 * currently-selected provider+model combination isn't known to accept
 * image inputs. Whitelisted by `sanitize.ts` so the user sees the
 * full message + suggestion as an actionable toast.
 */
export class VisionUnsupportedError extends Error {
  constructor(
    public readonly provider: ProviderKind,
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
 * Validate that a `ProviderConfig` resolves to a vision-capable model.
 * Throws `VisionUnsupportedError` on mismatch. `openai-compat` is
 * deliberately permissive (we don't know the backend's capabilities;
 * the actual API call will error if the model is text-only and we
 * surface that via the existing SchemaMismatchError path).
 */
export function assertVisionCapable(config: ProviderConfig): void {
  const allowed = VISION_CAPABLE_MODELS[config.provider];
  if (allowed === 'unknown') return;
  if (allowed.includes(config.model)) return;
  throw new VisionUnsupportedError(config.provider, config.model, SUGGESTIONS[config.provider]);
}
