import type { AuditEventListInput } from '@main/services/audit-event-service.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const listInput = z.object({
  event_kinds: z.array(z.string().min(1)).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

/**
 * Audit-event read-only handler. The table is append-only via DB trigger;
 * producers write directly from their own services (e.g.
 * ActivityDataService.rebindEf writes `event_kind = 'activity_rebind_ef'`).
 * This handler exposes a single query path with optional filters.
 */
export function auditHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'audit:list': (input) => {
      const parsed = listInput.parse(input);
      const listParams: AuditEventListInput = {};
      if (parsed.event_kinds !== undefined) listParams.event_kinds = parsed.event_kinds;
      if (parsed.since !== undefined) listParams.since = parsed.since;
      if (parsed.until !== undefined) listParams.until = parsed.until;
      if (parsed.limit !== undefined) listParams.limit = parsed.limit;
      return ctx.auditEventService.list(listParams);
    },
  };
}
