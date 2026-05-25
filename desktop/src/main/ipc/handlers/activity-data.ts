import type { ActivityData, ActivityDataCreateInput } from '@shared/types.js';
import { activityDataCreateInput } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';
import { withUndo } from '../undo-wrapper.js';

const periodScopedInput = z.object({ reporting_period_id: z.string().min(1) });
const idInput = z.object({ id: z.string().min(1) });
const extractionScopedInput = z.object({ extraction_id: z.string().min(1) });
const rebindInput = z.object({
  activity_id: z.string().min(1),
  new_ef_pk: z.object({
    factor_code: z.string().min(1),
    year: z.number().int(),
    source: z.string().min(1),
    geography: z.string().min(1),
    dataset_version: z.string().min(1),
  }),
  // Cross-family escape hatch: user supplies the new amount in the new
  // EF's unit. Must be > 0 — zero/negative amounts are rejected before
  // we even hit the service.
  override_amount: z.number().positive().optional(),
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
    // Wrapped with `withUndo` so successful creates push an inverse
    // (delete-by-id) on the manager. Redo re-INSERTs the captured row
    // verbatim — same id, same computed_co2e_kg, same created_at — so
    // the audit log shows a coherent create-undo-redo pair.
    //
    // The pinned_emission_factor row created by the first call stays
    // put across the cycle (pinned EFs are designed to outlive the
    // activity that triggered them).
    'activity:create': withUndo<ActivityDataCreateInput, ActivityData, true>(
      ctx.undoManager,
      'activity:create',
      'create activity',
      () => true, // no pre-state needed — non-null sentinel just records the entry
      (_captured, result) => ({
        undo: () => {
          // Best-effort: if a downstream answer started referencing this
          // activity between create and undo, the FK guard in the
          // service surfaces a friendly error which the renderer toasts.
          svc.delete(result.id);
        },
        redo: () => {
          ctx.db
            .prepare(
              `INSERT INTO activity_data (
                id, site_id, emission_source_id, reporting_period_id,
                occurred_at_start, occurred_at_end, amount, unit,
                ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
                computed_co2e_kg, computed_at, extraction_id, notes, created_at, updated_at
              ) VALUES (
                @id, @site_id, @emission_source_id, @reporting_period_id,
                @occurred_at_start, @occurred_at_end, @amount, @unit,
                @ef_factor_code, @ef_year, @ef_source, @ef_geography, @ef_dataset_version,
                @computed_co2e_kg, @computed_at, @extraction_id, @notes, @created_at, @updated_at
              )`,
            )
            .run(result);
        },
      }),
      (input) => svc.create(activityDataCreateInput.parse(input)),
    ),
    'activity:list-by-period': (input) =>
      svc.listByPeriod(periodScopedInput.parse(input).reporting_period_id),
    'activity:totals-by-period': (input) =>
      svc.totalsByPeriod(periodScopedInput.parse(input).reporting_period_id),
    'activity:get-by-id': (input) => svc.getByIdWithEf(idInput.parse(input).id),
    'activity:find-by-extraction': (input) =>
      svc.findByExtractionId(extractionScopedInput.parse(input).extraction_id),
    'activity:rebind-ef': (input) => {
      // exactOptionalPropertyTypes is strict: zod's output type allows
      // `override_amount: undefined`, but the service signature uses the
      // narrower `override_amount?: number` (no explicit undefined). Strip
      // the key when it isn't a number so the spread cleanly omits it.
      const parsed = rebindInput.parse(input);
      const { override_amount, ...rest } = parsed;
      return Promise.resolve(
        svc.rebindEf({
          ...rest,
          ...(override_amount !== undefined ? { override_amount } : {}),
        }),
      );
    },
  };
}
