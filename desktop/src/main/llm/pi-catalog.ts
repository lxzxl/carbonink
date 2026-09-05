import type { Api, Model, Models } from '@earendil-works/pi-ai';
import type { ProviderCatalogModel } from '@shared/types.js';
import { getModelsCollection } from './models.js';

/**
 * Read pi-ai's runtime catalog via the shared `Models` collection
 * (see `./models.ts`). The wrappers exist so handlers + tests have a single
 * import surface for the catalog (and so the JSON-friendly
 * `ProviderCatalogModel` projection lives in one place — UI code never
 * touches pi-ai's `Model<TApi>` shape directly).
 *
 * `listModelsForProvider` merges two sources, in order:
 * 1. bundled static catalog (sync, from the collection),
 * 2. cached dynamic rows fetched from the provider's own list endpoint
 *    (via `dynamicModelMirror`, dedupe by id with dynamic winning).
 * Unknown provider ids yield `[]` rather than throwing — the renderer falls
 * back to a free-form text input when the catalog comes back empty, so the
 * user is never stuck.
 *
 * `resolveModel` is the runtime lookup used by AiClient. On top of the
 * collection's `getModel` it adds two fallbacks: the dynamic cache, then
 * the synthetic custom-id clone (the Settings escape hatch for models
 * newer than any catalog).
 */

/** All pi-ai provider ids, in collection registration order. */
export function listProviderIds(): string[] {
  return getModelsCollection()
    .getProviders()
    .map((p) => p.id);
}

/**
 * In-memory mirror of the dynamic catalog cache, keyed by provider id.
 * Populated by the `settings:fetch-models` handler after a successful
 * fetch (and seeded at boot from fresh-enough `FileModelsStore` files).
 * A `Map` (not a `Record`) because entries are inserted/deleted at runtime
 * per provider. Keeps the sync `listModelsForProvider` path free of disk
 * I/O; the async disk reads stay in the handler path.
 */
export const dynamicModelMirror = new Map<string, Array<Model<Api>>>();

/**
 * Merge bundled + dynamic rows for `provider`, dynamic winning on id
 * conflict. Exported for tests; `listModelsForProvider` is the IPC-facing
 * projection over it.
 */
export function mergedModelsForProvider(provider: string): Array<Model<Api>> {
  const bundled = getModelsCollection().getModels(provider) as Array<Model<Api>>;
  const dynamic = dynamicModelMirror.get(provider);
  if (!dynamic || dynamic.length === 0) return [...bundled];
  const dynamicIds = new Set(dynamic.map((m) => m.id));
  return [...bundled.filter((m) => !dynamicIds.has(m.id)), ...dynamic];
}

/**
 * Resolve `modelId` for `provider` into a runnable pi-ai `Model`.
 *
 * - Bundled hit → pi-ai's own entry, verbatim.
 * - Dynamic-cache hit → the fetched entry, verbatim.
 * - Miss on a known provider → a **synthetic** model cloned from the
 *   provider's first catalog entry with `id`/`name` swapped for the custom
 *   id. Within one pi-ai provider every model shares the transport fields
 *   that make requests work (`api`, `baseUrl`, `provider`, `headers`,
 *   `compat`), so the clone is wire-correct; the metadata fields (`cost`,
 *   `contextWindow`, `maxTokens`, `input`) are the template's and therefore
 *   approximations. `reasoning` is forced off and `thinkingLevelMap`
 *   dropped so the request shape stays the conservative one every model
 *   accepts.
 * - Unknown provider (nothing to clone) → `undefined`; the caller keeps
 *   its existing loud `AiProviderError` path.
 *
 * This is the main-side half of the Settings UI's custom-model escape
 * hatch: the id is user-typed, and "Test connection" performs the real
 * validation against the provider.
 */
export function resolveModel(provider: string, modelId: string): Model<Api> | undefined {
  return resolveModelWith(getModelsCollection(), provider, modelId);
}

/**
 * Collection-parameterized variant of {@link resolveModel}. Production
 * callers use `resolveModel` (shared singleton); the layer builders route
 * through this with the injected test collection.
 */
export function resolveModelWith(
  models: Models,
  provider: string,
  modelId: string,
): Model<Api> | undefined {
  const exact = models.getModel(provider, modelId);
  if (exact) return exact;
  const dynamic = dynamicModelMirror.get(provider)?.find((m) => m.id === modelId);
  if (dynamic) return dynamic;
  const catalog = models.getModels(provider);
  const template = catalog[0];
  if (!template) return undefined;
  const { thinkingLevelMap: _dropped, ...rest } = template;
  return { ...rest, id: modelId, name: modelId, reasoning: false };
}

type CatalogRow = {
  id: string;
  name: string;
  api: string;
  input: ReadonlyArray<string>;
  reasoning: boolean;
  cost: { input: number; output: number };
  contextWindow: number;
  maxTokens: number;
};

function toCatalogRow(m: CatalogRow): ProviderCatalogModel {
  return {
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
  };
}

/**
 * Models published by `provider` in pi-ai's catalog, projected into the
 * IPC-friendly `ProviderCatalogModel` shape. Returns `[]` for unknown
 * providers.
 */
export function listModelsForProvider(provider: string): ProviderCatalogModel[] {
  // The collection's `getModels(provider)` is best-effort: unknown provider
  // ids yield an empty list instead of throwing, which is exactly the
  // contract the renderer relies on.
  return mergedModelsForProvider(provider).map((m) => toCatalogRow(m as CatalogRow));
}
