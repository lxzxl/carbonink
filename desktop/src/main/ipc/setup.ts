import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { getMainWindow } from '@main/window.js';
import { createIpcContext, type IpcContext } from './context.js';
import { activityDataHandlers } from './handlers/activity-data.js';
import { activityImportHandlers } from './handlers/activity-import.js';
import { agentSkillHandlers } from './handlers/agent-skill.js';
import { answerHandlers } from './handlers/answer.js';
import { appHandlers } from './handlers/app.js';
import { auditHandlers } from './handlers/audit.js';
import { dataHandlers } from './handlers/data.js';
import { documentHandlers } from './handlers/document.js';
import { efLibraryHandlers } from './handlers/ef-library.js';
import { efMatcherHandlers } from './handlers/ef-matcher.js';
import { emissionSourceHandlers } from './handlers/emission-source.js';
import { evidenceHandlers } from './handlers/evidence.js';
import { extractionHandlers } from './handlers/extraction.js';
import { inboundQuestionnaireHandlers } from './handlers/inbound-questionnaire.js';
import { lineageHandlers } from './handlers/lineage.js';
import { mcpHandlers } from './handlers/mcp.js';
import { organizationHandlers } from './handlers/organization.js';
import { questionnaireHandlers } from './handlers/questionnaire.js';
import { reportHandlers } from './handlers/report.js';
import { routingHandlers } from './handlers/routing.js';
import { settingsHandlers } from './handlers/settings.js';
import { supplierHandlers } from './handlers/supplier.js';
import { undoHandlers } from './handlers/undo.js';
import { updaterHandlers } from './handlers/updater.js';
import { userEfLibraryHandlers } from './handlers/user-ef-library.js';
import { workspaceHandlers } from './handlers/workspace.js';
import { createProgressEmitter } from './progress.js';
import { sanitize } from './sanitize.js';
import type { IpcTypeMap } from './types.js';

let listener: IpcListener<IpcTypeMap> | null = null;

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };
type HandlerFactory = (ctx: IpcContext) => HandlerMap;

const HANDLER_FACTORIES: ReadonlyArray<HandlerFactory> = [
  organizationHandlers,
  efLibraryHandlers,
  userEfLibraryHandlers,
  efMatcherHandlers,
  emissionSourceHandlers,
  activityDataHandlers,
  activityImportHandlers,
  settingsHandlers,
  documentHandlers,
  extractionHandlers,
  questionnaireHandlers,
  inboundQuestionnaireHandlers,
  supplierHandlers,
  answerHandlers,
  routingHandlers,
  mcpHandlers,
  agentSkillHandlers,
  reportHandlers,
  auditHandlers,
  evidenceHandlers,
  lineageHandlers,
  updaterHandlers,
  appHandlers,
  dataHandlers,
  undoHandlers,
  workspaceHandlers,
];

export function setupIpc(): void {
  if (listener) return;

  // Derive printRenderUrl from ELECTRON_RENDERER_URL or use the built renderer path
  const printRenderUrl = process.env.ELECTRON_RENDERER_URL
    ? `${process.env.ELECTRON_RENDERER_URL}/print-render`
    : 'about:blank/print-render';

  const ctx = createIpcContext(
    { db: getAppDb(), now: defaultNow },
    { progressEmitter: createProgressEmitter(getMainWindow), printRenderUrl },
  );
  const l = new IpcListener<IpcTypeMap>();

  for (const factory of HANDLER_FACTORIES) {
    for (const [channel, handler] of Object.entries(factory(ctx))) {
      // sanitize wraps every handler so raw errors (SQL fragments, file paths)
      // never cross the IPC boundary; tagged user-actionable errors pass through.
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
