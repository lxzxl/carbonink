import type { Api, Model, Models, ModelsStore, ModelsStoreEntry } from '@earendil-works/pi-ai';
import type { ProviderCatalogModel } from '@shared/types.js';
import {
  type FetchModelsArgs,
  type FetchModelsResult,
  fetchModelsForProvider,
} from './model-fetcher.js';
import { getModelsCollection } from './models.js';
import { FileModelsStore } from './models-store.js';

/**
 * Deep model-catalog module: every model-listing concern behind one interface.
 *
 * Previously the settings IPC handler orchestrated three structures by hand
 * (disk files via `FileModelsStore`, an in-memory dynamic mirror, and a
 * freshness map) — the catalog was shallow: deleting any piece moved
 * complexity rather than removing it. Now the seam sits at
 * `listProviders / listModels / refresh / resolve / isDynamic` and the disk,
 * mirror, and timestamp state live inside the implementation.
 *
 * Credentials never enter this module: `refresh` takes a caller-resolved
 * `apiKey` parameter so the OS keychain stays the single credential source.
 */

export interface ModelCatalogDeps {
  /** Resolved userData dir; dynamic rows persist under `<dir>/dynamic-models`. */
  userDataDir: string;
  /** pi-ai collection. Defaults to the process singleton; tests inject a fake. */
  collection?: Models;
  /** Live-discovery fetch. Defaults to `fetchModelsForProvider`; tests stub it. */
  fetchFn?: (collections: Models, args: FetchModelsArgs) => Promise<FetchModelsResult>;
  /** Dynamic-row persistence. Defaults to `FileModelsStore`; tests inject a fake. */
  store?: CatalogStore;
  /** Clock for `checkedAt`. Defaults to `Date.now`; tests pin it. */
  now?: () => number;
}

/**
 * Persistence seam for dynamic rows. pi-ai's `ModelsStore` plus provider
 * enumeration for boot seeding. `FileModelsStore` gains `listProviders`
 * below; fakes implement the same three-plus-one shape.
 */
export interface CatalogStore extends ModelsStore {
  listProviders(): Promise<string[]> | string[];
}

export type RefreshModelsResult =
  | { ok: true; models: ProviderCatalogModel[]; checkedAt: number }
  | { ok: false; error: string };

/** Minimal resolve surface consumed by the AiClient/AiAgent layer builders + vision gate. */
export interface ModelResolver {
  resolve(provider: string, modelId: string): Model<Api> | undefined;
  /** True when `modelId` came from a fetched row (capability-unknown → permissive). */
  isDynamic(provider: string, modelId: string): boolean;
}

export interface ModelCatalog extends ModelResolver {
  /** All pi-ai provider ids, in collection registration order. */
  listProviders(): string[];
  /**
   * Merged bundled + dynamic rows projected for IPC, plus the dynamic cache
   * freshness (`null` when never fetched). Sync — served from memory; the
   * async disk seed runs once in the background (see `seed`).
   */
  listModels(provider: string): { models: ProviderCatalogModel[]; checkedAt: number | null };
  /**
   * Live discovery end-to-end: fetch the provider's list endpoint, persist
   * to the store, update the mirror + freshness, and return the merged
   * projection. Never throws — failures surface as `{ok: false, error}`.
   */
  refresh(args: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
  }): Promise<RefreshModelsResult>;
  /**
   * Boot seed: read every persisted provider file into the mirror +
   * freshness map. Idempotent; corrupt/missing files read as a miss and a
   * missing dir means first run. Triggered lazily (fire-and-forget) by the
   * first `listModels` / `refresh` / `resolve` / `isDynamic` call; tests
   * await it directly for determinism.
   */
  seed(): Promise<void>;
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
 * Collection-parameterized model resolution. Production callers go through
 * `ModelCatalog.resolve`; the AiClient/AiAgent layer builders use this
 * directly when no catalog is injected (tests with a faux collection).
 *
 * - Bundled hit → pi-ai's own entry, verbatim.
 * - Dynamic-cache hit → the fetched entry, verbatim.
 * - Miss on a known provider → a **synthetic** model cloned from the
 *   provider's first catalog entry with `id`/`name` swapped for the custom
 *   id (the Settings custom-model escape hatch; same transport, approximate
 *   metadata, reasoning off).
 * - Unknown provider (nothing to clone) → `undefined`.
 */
export function resolveModelWith(
  models: Models,
  provider: string,
  modelId: string,
  dynamicRows: ReadonlyArray<Model<Api>> = [],
): Model<Api> | undefined {
  const exact = models.getModel(provider, modelId);
  if (exact) return exact;
  const dynamic = dynamicRows.find((m) => m.id === modelId);
  if (dynamic) return dynamic;
  const catalog = models.getModels(provider);
  const template = catalog[0];
  if (!template) return undefined;
  const { thinkingLevelMap: _dropped, ...rest } = template;
  return { ...rest, id: modelId, name: modelId, reasoning: false };
}

export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
  const collection = deps.collection ?? getModelsCollection();
  const fetchFn = deps.fetchFn ?? fetchModelsForProvider;
  const store: CatalogStore = deps.store ?? new FileModelsStore(deps.userDataDir);
  const now = deps.now ?? Date.now;

  const mirror = new Map<string, Array<Model<Api>>>();
  const checkedAt = new Map<string, number>();
  let seedPromise: Promise<void> | null = null;

  async function seed(): Promise<void> {
    if (!seedPromise) {
      seedPromise = (async () => {
        let providers: ReadonlyArray<string>;
        try {
          providers = await store.listProviders();
        } catch {
          return;
        }
        await Promise.all(
          providers.map(async (providerId) => {
            let entry: ModelsStoreEntry | undefined;
            try {
              entry = await store.read(providerId);
            } catch {
              return;
            }
            if (entry && entry.models.length > 0) {
              mirror.set(providerId, [...entry.models]);
              if (entry.checkedAt !== undefined) checkedAt.set(providerId, entry.checkedAt);
            }
          }),
        );
      })();
    }
    return seedPromise;
  }

  /** Fire-and-forget seed for the sync read path; failures fall back to bundled. */
  function ensureSeeded(): void {
    void seed().catch(() => {
      // Disk errors must never break listing — the bundled catalog alone
      // is a complete fallback.
    });
  }

  function merged(provider: string): Array<Model<Api>> {
    const bundled = collection.getModels(provider) as Array<Model<Api>>;
    const dynamic = mirror.get(provider);
    if (!dynamic || dynamic.length === 0) return [...bundled];
    const dynamicIds = new Set(dynamic.map((m) => m.id));
    return [...bundled.filter((m) => !dynamicIds.has(m.id)), ...dynamic];
  }

  return {
    listProviders(): string[] {
      return collection.getProviders().map((p) => p.id);
    },

    listModels(provider: string): { models: ProviderCatalogModel[]; checkedAt: number | null } {
      ensureSeeded();
      // `getModels(provider)` is best-effort: unknown provider ids yield an
      // empty list instead of throwing — the renderer falls back to a
      // free-form text input when the catalog comes back empty.
      return {
        models: merged(provider).map((m) => toCatalogRow(m as CatalogRow)),
        checkedAt: checkedAt.get(provider) ?? null,
      };
    },

    async refresh(args: {
      provider: string;
      apiKey: string;
      baseUrl?: string;
    }): Promise<RefreshModelsResult> {
      await seed().catch(() => {});
      const result = await fetchFn(collection, {
        provider: args.provider,
        ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
        apiKey: args.apiKey,
      });
      if (!result.ok) return { ok: false as const, error: result.error };
      const at = now();
      await store.write(args.provider, { models: result.models, checkedAt: at });
      mirror.set(args.provider, result.models);
      checkedAt.set(args.provider, at);
      return {
        ok: true as const,
        models: merged(args.provider).map((m) => toCatalogRow(m as CatalogRow)),
        checkedAt: at,
      };
    },

    resolve(provider: string, modelId: string): Model<Api> | undefined {
      ensureSeeded();
      return resolveModelWith(collection, provider, modelId, mirror.get(provider) ?? []);
    },

    isDynamic(provider: string, modelId: string): boolean {
      ensureSeeded();
      return mirror.get(provider)?.some((m) => m.id === modelId) ?? false;
    },

    seed,
  };
}
