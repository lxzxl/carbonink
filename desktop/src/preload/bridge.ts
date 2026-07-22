import type { IpcPushTypeMap, IpcTypeMap } from '@main/ipc/types.js';

export const allowedChannels: ReadonlyArray<keyof IpcTypeMap> = [
  // organization domain
  'org:has-any',
  'org:get-current',
  'org:get-by-id',
  'org:create',
  'org:list-sites',
  'org:create-site',
  'org:list-reporting-periods',
  'org:create-reporting-period',
  'org:complete-onboarding',
  'org:update-reporting-profile',
  'org:update-basic-info',
  // ef-library domain (read-only catalog)
  'ef:list',
  'ef:get-by-pk',
  'units:list',
  // user-ef-library domain (ROADMAP §8.1-④ — user-imported EF libraries)
  'ef-library:pick-file',
  'ef-library:revalidate',
  'ef-library:import',
  'ef-library:discard',
  'ef-library:list',
  'ef-library:delete',
  'ef-library:save-template',
  // ef-matcher domain (Phase 1c — LLM-assisted EF recommendation)
  'ef:recommend',
  'ef:recommend-text',
  // activity-import domain (ROADMAP §8.1-① — batch ledger import wizard)
  'activity-import:pick-file',
  'activity-import:revalidate',
  'activity-import:list-sources',
  'activity-import:resolve-source',
  'activity-import:list-groups',
  'activity-import:confirm-group',
  'activity-import:skip-group',
  'activity-import:import',
  'activity-import:discard',
  // emission-source domain
  'source:create',
  'source:get-by-id',
  'source:list-by-site',
  'source:list-by-org',
  'source:list-by-org-with-stats',
  'source:update',
  'source:delete',
  'source:list-presets',
  'source:add-from-preset',
  'source:add-from-presets',
  // activity-data domain
  'activity:create',
  'activity:list-by-period',
  'activity:totals-by-period',
  'activity:get-by-id',
  'activity:find-by-extraction',
  'activity:rebind-ef',
  // settings domain (Phase 1b — LLM provider config)
  'settings:available',
  'settings:get-provider',
  'settings:save-provider',
  'settings:clear-provider',
  'settings:ping-provider',
  'settings:get-amap-key',
  'settings:set-amap-key',
  'settings:list-providers',
  'settings:list-models',
  // document domain (Phase 1b — uploaded source files)
  'document:upload',
  'document:list',
  'document:get-by-id',
  'document:read-bytes',
  // extraction domain (Phase 1b — AI extraction pipeline)
  'extraction:classify-and-run',
  'extraction:batch-run',
  'extraction:batch-cancel',
  'extraction:batch-status',
  // workspace domain (spec 2026-07-22 — client workspaces / 账套)
  'workspace:list',
  'workspace:get-active',
  'workspace:create',
  'workspace:rename',
  'workspace:switch',
  'extraction:run',
  'extraction:list-pending',
  'extraction:list-by-document',
  'extraction:list-statuses',
  'extraction:get-by-id',
  'extraction:confirm',
  'extraction:discard',
  // stages domain (Phase 1b — read-only extraction stage registry)
  'stages:list',
  // questionnaire domain (Phase 2.2a — questionnaire upload + extract pipeline)
  'questionnaire:create',
  'questionnaire:list',
  'questionnaire:get-by-id',
  'questionnaire:finalize',
  'questionnaire:export-pdf',
  // inbound questionnaire domain (v2.0 — supplier-disclosure Cat 1 round-trip)
  'questionnaire:inbound-create-draft',
  'questionnaire:inbound-export-xlsx',
  'questionnaire:inbound-import-preview',
  'questionnaire:inbound-get-preview',
  'questionnaire:inbound-ingest',
  'questionnaire:inbound-delete',
  'supplier:list',
  'supplier:create',
  'supplier:set-email',
  // answer domain (Phase 2.2b — auto-answer pipeline)
  'answer:export-to-xlsx',
  'answer:generate',
  'answer:save',
  'answer:unfinalize',
  'answer:list-by-questionnaire',
  'answer:generate-all-unanswered',
  // routing domain (Routing API)
  'routing:lookup',
  // mcp-integration domain (Settings → Integrations sub-page)
  'mcp:detect',
  'mcp:configure',
  'mcp:remove',
  'mcp:get-server-entry',
  // Agent skill installer (v1.1 — Settings → Integrations step 1)
  'skill:detect',
  'skill:install',
  'skill:update',
  'skill:remove',
  // report domain (Phase 3 — ISO 14064-1 inventory report)
  'report:generate',
  'report:cancel',
  'report:export-pdf',
  'report:export-xlsx',
  // audit domain (Phase 3 sub-project 3 — audit_event log viewer)
  'audit:list',
  'audit:export-csv',
  'audit:list-by-record',
  // evidence + lineage domains (audit-readiness 2026-07-11)
  'evidence:add',
  'evidence:list',
  'evidence:remove',
  'lineage:get',
  // license domain (Phase 4 sub-project A — Ed25519 JWT + state machine)
  // updater domain (Phase 5 — auto-update via electron-updater)
  'updater:get-status',
  'updater:check',
  'updater:install',
  // app domain (Phase 5.1 — about info + open data directory)
  'app:get-info',
  'app:open-data-dir',
  // Phase 5.3 — log dir + auto-backup dir
  'app:open-log-dir',
  'app:open-auto-backup-dir',
  'app:get-auto-backup-enabled',
  'app:set-auto-backup-enabled',
  // Undo/Redo (post-launch)
  'undo:peek',
  'undo:do',
  // data domain (Phase 5.2 — backup/restore/reset + cache cleanup)
  'data:export-backup',
  'data:import-backup',
  'data:reset',
  'cache:get-stats',
  'cache:clear-extraction-raw',
];

/**
 * Whitelist of push channels (main→renderer events via webContents.send).
 * Subscribe-side counterpart to `allowedChannels`. Keep aligned with
 * `IpcPushTypeMap` keys in `src/main/ipc/types.ts`.
 */
export const allowedPushChannels: ReadonlyArray<keyof IpcPushTypeMap> = [
  'extraction:progress',
  'extraction:batch-progress',
  'report:progress',
  'updater:status',
  'menu:undo',
  'menu:redo',
  'app:navigate',
];

export type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Preload-side subscribe primitive. Implementations wire to
 * `ipcRenderer.on` + return a cleanup that calls `removeListener`.
 *
 * The handler signature mirrors Electron's: receives the event object
 * (which we never pass through) plus the payload. The bridge translates
 * this to a payload-only callback on the renderer side.
 */
export type SubscribeFn = (
  channel: string,
  handler: (event: unknown, payload: unknown) => void,
) => () => void;

export interface IpcBridge {
  invoke<C extends keyof IpcTypeMap & string>(
    channel: C,
    ...args: Parameters<IpcTypeMap[C]>
  ): Promise<Awaited<ReturnType<IpcTypeMap[C]>>>;
  /**
   * Subscribe to a main→renderer push channel. Returns an unsubscribe
   * function that detaches the listener.
   */
  subscribe<C extends keyof IpcPushTypeMap & string>(
    channel: C,
    callback: (payload: IpcPushTypeMap[C]) => void,
  ): () => void;
}

/**
 * Builds the bridge object exposed to the renderer. Extracted from
 * `src/preload/index.ts` so the channel-allowlist gate can be unit-tested
 * without bundling the preload script through Electron.
 */
export function createBridge(invokeFn: InvokeFn, subscribeFn: SubscribeFn): IpcBridge {
  return {
    invoke<C extends keyof IpcTypeMap & string>(
      channel: C,
      ...args: Parameters<IpcTypeMap[C]>
    ): Promise<Awaited<ReturnType<IpcTypeMap[C]>>> {
      if (!allowedChannels.includes(channel)) {
        return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
      }
      return invokeFn(channel, ...args) as Promise<Awaited<ReturnType<IpcTypeMap[C]>>>;
    },
    subscribe<C extends keyof IpcPushTypeMap & string>(
      channel: C,
      callback: (payload: IpcPushTypeMap[C]) => void,
    ): () => void {
      if (!allowedPushChannels.includes(channel)) {
        throw new Error(`IPC push channel not allowed: ${String(channel)}`);
      }
      const unsubscribe = subscribeFn(channel, (_event, payload) => {
        callback(payload as IpcPushTypeMap[C]);
      });
      return unsubscribe ?? (() => {});
    },
  };
}
