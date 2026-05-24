import { getCacheService } from '@main/services/cache-service.js';
import { getDataBackupService } from '@main/services/data-backup-service.js';
import { dialog } from 'electron';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

/**
 * Data lifecycle IPC handlers (Phase 5.2). Glue between the renderer's
 * Data section and the main-process DataBackupService + CacheService.
 *
 * Each handler that performs file IO around the SQLite db is responsible
 * for opening the native dialog (save/open) — these can't be stubbed from
 * the renderer without compromising the security boundary. The service
 * layer does the actual file work + relaunch scheduling.
 *
 * Context is accepted-and-ignored because both services hold their own
 * singleton state. The factory signature requires it.
 */
export function dataHandlers(_ctx: IpcContext): HandlerMap {
  const backup = getDataBackupService();
  const cache = getCacheService();
  return {
    'data:export-backup': async () => {
      const today = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog({
        title: 'Export CarbonInk backup',
        defaultPath: `carbonink-backup-${today}.carbonink-backup`,
        filters: [{ name: 'CarbonInk backup', extensions: ['carbonink-backup', 'sqlite'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }
      try {
        const stats = backup.exportToFile(result.filePath);
        return { ok: true, path: result.filePath, bytes_written: stats.bytes_written };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },

    'data:import-backup': async () => {
      const result = await dialog.showOpenDialog({
        title: 'Import CarbonInk backup',
        properties: ['openFile'],
        filters: [{ name: 'CarbonInk backup', extensions: ['carbonink-backup', 'sqlite', 'db'] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const source = result.filePaths[0];
      if (!source) {
        return { canceled: true };
      }
      const restoreResult = backup.importFromFile(source);
      if (!restoreResult.ok) {
        return { ok: false, error: restoreResult.error };
      }
      // Renderer should show "restored, restarting..." toast; the
      // service's scheduleRelaunch fires app.quit() after a 250ms
      // grace period so this reply makes it back.
      return { ok: true };
    },

    'data:reset': () => {
      backup.reset();
      return { ok: true };
    },

    'cache:get-stats': () => cache.getStats(),

    'cache:clear-extraction-raw': () => cache.clearExtractionRawCache(),
  };
}
