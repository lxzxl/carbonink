import { getAutoBackupDir } from '@main/services/auto-backup-service.js';
import { getLogDirPath } from '@main/services/logger-service.js';
import { app, shell } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

const autoBackupEnabledInput = z.object({ enabled: z.boolean() });

/**
 * App-level IPC handlers — version info + filesystem helpers that don't
 * fit a domain (organization, license, etc.) but are still legitimately
 * needed by the Settings page (About section + Data management).
 *
 * Most handlers read directly from `electron.app` / `electron.shell` and
 * don't need the context; the auto-backup toggle pair uses
 * `ctx.settingsService` for the underlying KV store.
 */
export function appHandlers(ctx: IpcContext): HandlerMap {
  return {
    'app:get-info': () => ({
      version: app.getVersion(),
      name: app.getName(),
      // Electron's runtime versions, not webpack-injected — these reflect
      // the actually-running binary, useful for support diagnostics.
      electron_version: process.versions.electron ?? 'unknown',
      node_version: process.versions.node,
      chrome_version: process.versions.chrome ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
      user_data_dir: app.getPath('userData'),
      // ISO timestamp of process start — proxy for "when this binary
      // session began". Not a build date (which would need a baked-in
      // constant); for support purposes "started X minutes ago" is more
      // actionable.
      started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    }),
    'app:open-data-dir': async () => {
      // `openPath` opens the directory in the OS file manager (Finder on
      // macOS, Explorer on Windows). Returns '' on success per Electron
      // docs; we surface any failure message as a typed result so the
      // renderer can toast it without throwing across IPC.
      const err = await shell.openPath(app.getPath('userData'));
      return err === '' ? { ok: true } : { ok: false, error: err };
    },
    'app:open-log-dir': async () => {
      const err = await shell.openPath(getLogDirPath());
      return err === '' ? { ok: true } : { ok: false, error: err };
    },
    'app:open-auto-backup-dir': async () => {
      const err = await shell.openPath(getAutoBackupDir());
      return err === '' ? { ok: true } : { ok: false, error: err };
    },
    'app:get-auto-backup-enabled': () => ({
      enabled: ctx.settingsService.getAutoBackupEnabled(),
    }),
    'app:set-auto-backup-enabled': (input) => {
      const parsed = autoBackupEnabledInput.parse(input);
      ctx.settingsService.setAutoBackupEnabled(parsed.enabled);
    },
  };
}
