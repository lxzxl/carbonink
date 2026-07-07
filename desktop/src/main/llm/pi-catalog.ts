import { type Api, getModel, getModels, getProviders, type Model } from '@earendil-works/pi-ai';
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
 *
 * `resolveModel` is the runtime lookup used by AiClient. It adds the
 * custom-model escape hatch on top of pi-ai's `getModel`: the bundled
 * catalog is a snapshot and structurally lags live provider lists (models
 * launch on openrouter daily), so an id the catalog doesn't know is
 * synthesized from a same-provider template instead of failing.
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
/**
 * Resolve `modelId` for `provider` into a runnable pi-ai `Model`.
 *
 * - Catalog hit → pi-ai's own entry, verbatim.
 * - Catalog miss on a known provider → a **synthetic** model cloned from
 *   the provider's first catalog entry with `id`/`name` swapped for the
 *   custom id. Within one pi-ai provider every model shares the transport
 *   fields that make requests work (`api`, `baseUrl`, `provider`,
 *   `headers`, `compat`), so the clone is wire-correct; the metadata
 *   fields (`cost`, `contextWindow`, `maxTokens`, `input`) are the
 *   template's and therefore approximations. `reasoning` is forced off
 *   and `thinkingLevelMap` dropped so the request shape stays the
 *   conservative one every model accepts.
 * - Unknown provider (nothing to clone) → `undefined`; the caller keeps
 *   its existing loud `AiProviderError` path.
 *
 * This is the main-side half of the Settings UI's custom-model escape
 * hatch: the id is user-typed, and "Test connection" performs the real
 * validation against the provider.
 */
export function resolveModel(provider: string, modelId: string): Model<Api> | undefined {
  // pi-ai types both lookups over literal unions of known ids; we accept
  // free-form strings from config, so the casts mirror listModelsForProvider.
  const exact = (getModel as unknown as (p: string, m: string) => Model<Api> | undefined)(
    provider,
    modelId,
  );
  if (exact) return exact;
  try {
    const models = getModels(provider as never) as Array<Model<Api>>;
    const template = models[0];
    if (!template) return undefined;
    const { thinkingLevelMap: _dropped, ...rest } = template;
    return { ...rest, id: modelId, name: modelId, reasoning: false };
  } catch {
    return undefined;
  }
}

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
