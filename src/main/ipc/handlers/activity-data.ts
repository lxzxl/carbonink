import { activityDataCreateInput } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const periodScopedInput = z.object({ reporting_period_id: z.string().min(1) });
const idInput = z.object({ id: z.string().min(1) });
const rebindInput = z.object({
  activity_id: z.string().min(1),
  new_ef_pk: z.object({
    factor_code: z.string().min(1),
    year: z.number().int(),
    source: z.string().min(1),
    geography: z.string().min(1),
    dataset_version: z.string().min(1),
  }),
});

/**
 * Activity-data handlers. `activity:create` triggers the keystone single-tx
 * pin+compute+insert flow inside `ActivityDataService.create`; this layer is
 * a thin pass-through that just validates the input shape.
 *
 * `activity:rebind-ef` (Phase 3 sub-project 2) swaps the pinned EF on an
 * existing activity row; the service handles the transaction and audit_event.
 * The handler never throws — typed errors come back as `{ ok: false, error }`.
 */
export function activityDataHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const svc = ctx.activityDataService;
  return {
    'activity:create': (input) => svc.create(activityDataCreateInput.parse(input)),
    'activity:list-by-period': (input) =>
      svc.listByPeriod(periodScopedInput.parse(input).reporting_period_id),
    'activity:totals-by-period': (input) =>
      svc.totalsByPeriod(periodScopedInput.parse(input).reporting_period_id),
    'activity:get-by-id': (input) => svc.getByIdWithEf(idInput.parse(input).id),
    'activity:rebind-ef': (input) => Promise.resolve(svc.rebindEf(rebindInput.parse(input))),
  };
}
