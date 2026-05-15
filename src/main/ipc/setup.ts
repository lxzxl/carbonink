import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { getMainWindow } from '@main/window.js';
import { createIpcContext, type IpcContext } from './context.js';
import { activityDataHandlers } from './handlers/activity-data.js';
import { documentHandlers } from './handlers/document.js';
import { efLibraryHandlers } from './handlers/ef-library.js';
import { efMatcherHandlers } from './handlers/ef-matcher.js';
import { emissionSourceHandlers } from './handlers/emission-source.js';
import { extractionHandlers } from './handlers/extraction.js';
import { organizationHandlers } from './handlers/organization.js';
import { questionnaireHandlers } from './handlers/questionnaire.js';
import { settingsHandlers } from './handlers/settings.js';
import { createProgressEmitter } from './progress.js';
import { sanitize } from './sanitize.js';
import type { IpcTypeMap } from './types.js';

let listener: IpcListener<IpcTypeMap> | null = null;

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };
type HandlerFactory = (ctx: IpcContext) => HandlerMap;

const HANDLER_FACTORIES: ReadonlyArray<HandlerFactory> = [
  organizationHandlers,
  efLibraryHandlers,
  efMatcherHandlers,
  emissionSourceHandlers,
  activityDataHandlers,
  settingsHandlers,
  documentHandlers,
  extractionHandlers,
  questionnaireHandlers,
];

export function setupIpc(): void {
  if (listener) return;

  const ctx = createIpcContext(
    { db: getAppDb(), now: defaultNow },
    { progressEmitter: createProgressEmitter(getMainWindow) },
  );
  const l = new IpcListener<IpcTypeMap>();

  for (const factory of HANDLER_FACTORIES) {
    for (const [channel, handler] of Object.entries(factory(ctx))) {
      const wrapped = sanitize(channel, handler as (...a: unknown[]) => unknown);
      // biome-ignore lint/suspicious/noExplicitAny: heterogeneous handler dispatch
      (l.handle as (c: string, h: (...a: any[]) => unknown) => void)(
        channel,
        (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => wrapped(...args),
      );
    }
  }

  listener = l;
}

export function cleanupIpc(): void {
  if (!listener) return;
  listener.dispose();
  listener = null;
}
