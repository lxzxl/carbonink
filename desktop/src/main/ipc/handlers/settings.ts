import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { AiClientTag, buildAiClientLayer } from '@main/llm/ai-client.js';
import { fetchModelsForProvider } from '@main/llm/model-fetcher.js';
import { getModelsCollection } from '@main/llm/models.js';
import { FileModelsStore } from '@main/llm/models-store.js';
import {
  dynamicModelMirror,
  listModelsForProvider,
  listProviderIds,
} from '@main/llm/pi-catalog.js';
import { getProviderGuidance } from '@main/llm/provider-guidance.js';
import {
  IMPORT_OUTLIER_RATIO_MAX,
  IMPORT_OUTLIER_RATIO_MIN,
} from '@main/services/settings-service.js';
import { apiKeyKeyrefForProvider, providerConfigV2 } from '@shared/types.js';
import { Effect } from 'effect';
import { dialog } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

/**
 * Input schemas for the write/test channels. We zod-parse at the IPC boundary
 * (defense in depth: even if `IpcTypeMap` is correct, runtime values from the
 * preload could be hostile after a renderer compromise).
 *
 * Item 3 Task 10b: V2-only. The renderer emits V2 directly now; the
 * earlier V1-or-V2 union has been retired. On-disk V1 records from old
 * installs still get migrated on read by SettingsService — that path is
 * internal to the storage layer and not exposed through these IPC
 * schemas.
 */
const saveProviderInput = z.object({
  config: providerConfigV2,
  apiKey: z.string().min(1).optional(),
});

const pingProviderInput = z.object({
  config: providerConfigV2,
  apiKey: z.string().min(1).optional(),
});

const setAmapKeyInput = z.object({
  value: z.string(),
});

const setImportOutlierRatioInput = z.object({
  ratio: z.number().min(IMPORT_OUTLIER_RATIO_MIN).max(IMPORT_OUTLIER_RATIO_MAX),
});

const listModelsInput = z.object({
  provider: z.string().min(1),
});

const fetchModelsInput = z.object({
  provider: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
});

/**
 * Boot-seed helper: read every `<provider>.json` under the dynamic-models
 * dir into the in-memory mirror + freshness map. Corrupt files read as a
 * miss (FileModelsStore contract); a missing dir means first run.
 */
async function seedDynamicMirror(userDataDir: string): Promise<void> {
  const store = new FileModelsStore(userDataDir);
  let files: string[];
  try {
    files = readdirSync(store.dir);
  } catch {
    return;
  }
  await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => {
        const providerId = f.slice(0, -'.json'.length);
        const entry = await store.read(providerId);
        if (entry && entry.models.length > 0) {
          dynamicModelMirror.set(providerId, [...entry.models]);
          if (entry.checkedAt !== undefined) dynamicCheckedAt.set(providerId, entry.checkedAt);
        }
      }),
  );
}
/**
 * Freshness of the dynamic catalog mirror, keyed by provider id. Updated by
 * `settings:fetch-models` (and seeded at boot from `FileModelsStore`;
 * entries are inserted/deleted at runtime, hence `Map`). `list-models`
 * reports it so the renderer shows a stale badge without a new channel.
 */
export const dynamicCheckedAt = new Map<string, number>();

/**
 * Phase 1b settings handlers — provider config CRUD + the "Test connection"
 * action used by the Settings drawer.
 *
 * Critical: `settings:get-provider` returns a **masked** API key (or `null`),
 * never plaintext. The plaintext path (`SettingsService.getProviderConfigWithKey`)
 * is intentionally not wired here — it stays main-only for AiClient.
 */
export function settingsHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  // Boot-seed the dynamic catalog mirror from `FileModelsStore` so fetched
  // rows survive restarts. Fire-and-forget: a missing dir/file is the
  // common first-run case and reads as a miss. Only providers with a
  // cache file populate the mirror; everything else stays bundled-only.
  void seedDynamicMirror(ctx.userDataDir).catch(() => {
    // Disk errors must never break Settings — the bundled catalog alone
    // is a complete fallback.
  });
  return {
    'settings:available': () => ctx.credentialService.isAvailable(),
    'settings:get-provider': () => ctx.settingsService.getProviderConfig(),
    'settings:get-key-status': (input) => {
      const parsed = z.object({ provider: z.string().min(1) }).parse(input);
      return {
        apiKeyMasked: ctx.credentialService.getMasked(apiKeyKeyrefForProvider(parsed.provider)),
      };
    },
    'settings:save-provider': (input) => {
      const parsed = saveProviderInput.parse(input);
      ctx.settingsService.saveProviderConfig(parsed.config, parsed.apiKey);
    },
    'settings:clear-provider': () => ctx.settingsService.clearProviderConfig(),
    'settings:ping-provider': async (input) => {
      const parsed = pingProviderInput.parse(input);
      // Build a one-shot AiClient layer for this ping. `overrideKey` is the
      // typed-but-not-saved key flow — the Settings UI passes a fresh key
      // through here without committing it to the credential store. When
      // omitted, the layer falls back to `credentials.get(apiKeyKeyref)`.
      const layer = buildAiClientLayer({
        config: parsed.config,
        credentials: ctx.credentialService,
        ...(parsed.apiKey !== undefined ? { overrideKey: parsed.apiKey } : {}),
      });
      // ping() only fails with AiAuthError | AiProviderError; map both onto
      // the `{ok: false, error}` shape the renderer toasts verbatim under a
      // localized "Connection failed" title (see AIProviderSection.tsx).
      // Error labels are short, machine-readable strings — the UI does NOT
      // currently translate them, so we keep them in English and informative
      // (provider name for auth failures, cause for provider errors).
      return Effect.runPromise(
        Effect.gen(function* () {
          const ai = yield* AiClientTag;
          yield* ai.ping();
          return { ok: true as const };
        }).pipe(
          Effect.provide(layer),
          Effect.catchTags({
            AiAuthError: (e) =>
              Effect.succeed({
                ok: false as const,
                error:
                  e.reason === 'missing_key'
                    ? `auth_failed: ${e.provider} (no key saved — enter one and retry)`
                    : `auth_failed: ${e.provider} (key rejected — check the key and retry)`,
              }),
            AiProviderError: (e) =>
              Effect.succeed({
                ok: false as const,
                error: `provider_error: ${e.cause ?? 'unknown'}`,
              }),
          }),
        ),
      );
    },
    'settings:get-amap-key': () => ctx.settingsService.getAmapKey(),
    'settings:set-amap-key': (input) => {
      const parsed = setAmapKeyInput.parse(input);
      ctx.settingsService.setAmapKey(parsed.value);
    },
    // White-label report logo. The 512KB cap keeps the data URL well under
    // the setting-table comfort zone and the print payload lightweight.
    'settings:get-report-logo': () => ctx.settingsService.getReportLogo(),
    'settings:pick-report-logo': async () => {
      const result = await dialog.showOpenDialog({
        title: 'Choose report logo',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
      });
      const path = result.filePaths[0];
      if (result.canceled || path === undefined) return { canceled: true as const };
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch {
        return { ok: false as const, error: 'ReadFailed' as const };
      }
      if (bytes.length > 512 * 1024) {
        return { ok: false as const, error: 'TooLarge' as const };
      }
      const ext = extname(path).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null;
      if (!mime) return { ok: false as const, error: 'UnsupportedType' as const };
      const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
      ctx.settingsService.setReportLogo(dataUrl);
      return { ok: true as const, data_url: dataUrl };
    },
    // Batch-import outlier multiplier (spec 2026-07-23). Range enforced
    // here so a renderer bug can't persist a rule-disabling value; the
    // service getter additionally tolerates hand-edited garbage.
    'settings:get-import-outlier-ratio': () => ({
      ratio: ctx.settingsService.getImportOutlierRatio(),
    }),
    'settings:set-import-outlier-ratio': (input) => {
      const parsed = setImportOutlierRatioInput.parse(input);
      ctx.settingsService.setImportOutlierRatio(parsed.ratio);
    },
    'settings:clear-report-logo': () => {
      ctx.settingsService.clearReportLogo();
      return { ok: true as const };
    },
    // Item 3 Task 10c — runtime catalog channels. The renderer's Settings
    // form populates its Provider + Model dropdowns from pi-ai's catalog
    // via these channels rather than hardcoded lists, so the UI never
    // drifts from pi-ai's actual catalog.
    'settings:list-providers': () => listProviderIds(),
    'settings:list-models': (input) => {
      const parsed = listModelsInput.parse(input);
      return {
        models: listModelsForProvider(parsed.provider),
        checkedAt: dynamicCheckedAt.get(parsed.provider) ?? null,
      };
    },
    // Live model discovery (pi-0.85 plan Phase C). Fetches the provider's
    // own list endpoint, persists to FileModelsStore, seeds the in-memory
    // mirror, and returns the merged catalog. The key is typed-but-not-
    // saved (`apiKey?`) or the saved keychain key — same contract as
    // `ping-provider`; never persisted by this handler.
    'settings:fetch-models': async (input) => {
      const parsed = fetchModelsInput.parse(input);
      const key =
        parsed.apiKey ?? ctx.credentialService.get(apiKeyKeyrefForProvider(parsed.provider));
      if (!key) return { ok: false as const, error: 'missing_api_key' };
      const result = await fetchModelsForProvider(getModelsCollection(), {
        provider: parsed.provider,
        ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
        apiKey: key,
      });
      if (!result.ok) return { ok: false as const, error: result.error };
      const store = new FileModelsStore(ctx.userDataDir);
      const checkedAt = Date.now();
      await store.write(parsed.provider, { models: result.models, checkedAt });
      dynamicModelMirror.set(parsed.provider, result.models);
      dynamicCheckedAt.set(parsed.provider, checkedAt);
      return {
        ok: true as const,
        models: listModelsForProvider(parsed.provider),
        checkedAt,
      };
    },
    // LLM provider guidance + deterministic cache (spec 2026-09-02).
    // Guidance merges the static table with the maintainer's runtime
    // referral overlay; clear wipes the file-backed LlmCache.
    'settings:get-provider-guidance': () => getProviderGuidance(ctx.userDataDir),
    'settings:clear-ai-cache': () => ({ cleared: ctx.llmCache.clear() }),
  };
}
