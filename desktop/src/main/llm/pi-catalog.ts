import { getModels, getProviders } from '@earendil-works/pi-ai';
import type { ProviderCatalogModel } from '@shared/types.js';

/**
 * Read pi-ai's runtime catalog. The wrappers exist so handlers + tests
 * have a single import surface for the catalog (and so the JSON-friendly
 * `ProviderCatalogModel` projection lives in one place — UI code never
 * touches pi-ai's `Model<TApi>` shape directly).
 *
 * `listModelsForProvider` swallows errors from `getModels` (unknown provider
 * id, post-migration legacy strings) and returns `[]` rather than throwing —
 * the renderer falls back to a free-form text input when the catalog comes
 * back empty, so the user is never stuck.
 */

/** All pi-ai provider ids, in declaration order from `getProviders()`. */
export function listProviderIds(): string[] {
  return getProviders() as string[];
}

/**
 * Models published by `provider` in pi-ai's catalog, projected into the
 * IPC-friendly `ProviderCatalogModel` shape. Returns `[]` for unknown
 * providers (pi-ai's typed `getModels` throws on a bad id; we coerce that
 * into an empty list).
 */
export function listModelsForProvider(provider: string): ProviderCatalogModel[] {
  try {
    // pi-ai's `getModels` is generic over a literal-union of known providers;
    // we accept any string from the IPC boundary, so the cast is unavoidable.
    const models = getModels(provider as never) as Array<{
      id: string;
      name: string;
      api: string;
      input: ReadonlyArray<string>;
      reasoning: boolean;
      cost: { input: number; output: number };
      contextWindow: number;
      maxTokens: number;
    }>;
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api,
      // Filter to the modalities we model in the UI. Any future pi-ai
      // modality (e.g. 'audio') falls off the picker until we widen this.
      input: m.input.filter((x): x is 'text' | 'image' => x === 'text' || x === 'image'),
      reasoning: m.reasoning,
      costInput: m.cost.input,
      costOutput: m.cost.output,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }));
  } catch {
    return [];
  }
}
