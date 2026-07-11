import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const getInput = z.object({
  entity: z.enum(['activity_data', 'answer']),
  id: z.string().min(1),
});

/**
 * Lineage handler (audit-readiness 2026-07-11): one read-only call returning
 * the full provenance chain for the renderer's 溯源 panel. Assembly lives in
 * LineageService; this layer only validates the ref shape.
 */
export function lineageHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'lineage:get': (input) => ctx.lineageService.get(getInput.parse(input)),
  };
}
