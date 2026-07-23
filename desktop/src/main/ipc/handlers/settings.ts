import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { AiClientTag, buildAiClientLayer } from '@main/llm/ai-client.js';
import { listModelsForProvider, listProviderIds } from '@main/llm/pi-catalog.js';
import {
  IMPORT_OUTLIER_RATIO_MAX,
  IMPORT_OUTLIER_RATIO_MIN,
} from '@main/services/settings-service.js';
import { providerConfigV2 } from '@shared/types.js';
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
  apiKey: z.string().min(1),
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

/**
 * Phase 1b settings handlers — provider config CRUD + the "Test connection"
 * action used by the Settings drawer.
 *
 * Critical: `settings:get-provider` returns a **masked** API key (or `null`),
 * never plaintext. The plaintext path (`SettingsService.getProviderConfigWithKey`)
 * is intentionally not wired here — it stays main-only for AiClient.
 *
 * `settings:ping-provider` accepts an optional `apiKey` so the UI can verify
 * a key the user has just typed but not yet saved. The key is passed
 * in-memory to AiClient via the `overrideKey` build dep and is never
 * persisted by this handler — `settings:save-provider` is the only
 * persistence path.
 */
export function settingsHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'settings:available': () => ctx.credentialService.isAvailable(),
    'settings:get-provider': () => ctx.settingsService.getProviderConfig(),
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
                error: `auth_failed: ${e.provider}`,
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
    // form populates its Provider + Model dropdowns from pi-ai's `getProviders`
    // / `getModels` via these channels rather than hardcoded lists, so the
    // UI never drifts from pi-ai's actual catalog.
    'settings:list-providers': () => listProviderIds(),
    'settings:list-models': (input) => {
      const parsed = listModelsInput.parse(input);
      return listModelsForProvider(parsed.provider);
    },
  };
}
