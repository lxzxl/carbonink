import { requestWorkspaceSwitch } from '@main/workspace-switch.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

const idInput = z.object({ id: z.string().min(1) });
const createInput = z.object({ name: z.string().max(200) });
const renameInput = z.object({ id: z.string().min(1), name: z.string().max(200) });

/**
 * Client workspace IPC (spec 2026-07-22). Registry CRUD goes through the
 * context's WorkspaceService; `workspace:switch` delegates to the
 * boot-configured orchestrator because it tears down this very listener.
 */
export function workspaceHandlers(ctx: IpcContext): HandlerMap {
  return {
    'workspace:list': () => ctx.workspaceService.list(),
    'workspace:get-active': () => ctx.workspaceService.activeWorkspace(),
    'workspace:create': (input) => ctx.workspaceService.create(createInput.parse(input).name),
    'workspace:rename': (input) => {
      const parsed = renameInput.parse(input);
      return { ok: ctx.workspaceService.rename(parsed.id, parsed.name) };
    },
    'workspace:switch': (input) => requestWorkspaceSwitch(idInput.parse(input).id),
    'workspace:delete': (input) => ctx.workspaceService.remove(idInput.parse(input).id),
  };
}
