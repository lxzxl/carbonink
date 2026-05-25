import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

const doInput = z.object({
  direction: z.enum(['undo', 'redo']),
});

/**
 * Undo/Redo IPC handlers — thin pass-through to `ctx.undoManager`. The
 * heavy lifting (closure storage, stack discipline, depth cap) lives
 * in the manager class so it can be unit-tested without an IPC harness.
 *
 * `undo:do` is in the license-gate read-only block set
 * (`license-gate.ts`) so expired/revoked licenses can't sneak writes
 * back in through the inverse path.
 */
export function undoHandlers(ctx: IpcContext): HandlerMap {
  return {
    'undo:peek': () => ctx.undoManager.peek(),
    'undo:do': (input) => {
      const { direction } = doInput.parse(input);
      const kind = direction === 'undo' ? ctx.undoManager.runUndo() : ctx.undoManager.runRedo();
      return { kind };
    },
  };
}
