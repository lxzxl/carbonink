import type { BrowserWindow } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import { appRouter } from '@main/trpc/router.js';
import { createTrpcContext } from '@main/trpc/context.js';
import { defaultNow } from '@main/services/base.js';
import { getAppDb } from '@main/db/connection.js';

export function setupIpc(win: BrowserWindow): void {
  createIPCHandler({
    router: appRouter,
    windows: [win],
    createContext: async () =>
      createTrpcContext({ db: getAppDb(), now: defaultNow }),
  });
}
