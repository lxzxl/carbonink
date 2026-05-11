import { activityDataCreateInput } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const periodScopedInput = z.object({ reporting_period_id: z.string().min(1) });

/**
 * Activity-data handlers. `activity:create` triggers the keystone single-tx
 * pin+compute+insert flow inside `ActivityDataService.create`; this layer is
 * a thin pass-through that just validates the input shape.
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
  };
}
