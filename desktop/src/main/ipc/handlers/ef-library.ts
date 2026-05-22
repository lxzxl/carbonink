import type { EfLookupQuery } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

/**
 * Lookup-query schema for `ef:list`. Mirrors `EfLookupQuery` in
 * `src/shared/types.ts`. All fields optional and AND-ed at the service layer.
 * `scope` is the INTEGER 1/2/3 literal union (matches schema migration 002).
 */
const efLookupQuery = z.object({
  factor_code: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  geography: z.string().min(1).optional(),
  year: z.number().int().optional(),
});

/**
 * Drop keys whose value is `undefined`. Required because our tsconfig has
 * `exactOptionalPropertyTypes: true`: Zod's `.optional()` produces `T | undefined`
 * in the inferred output type, but `EfLookupQuery` (and the service signature)
 * uses bare `?:` properties — meaning the key is either absent OR a concrete
 * value, never literally `undefined`. Stripping the undefined entries reconciles
 * the two without weakening the upstream type.
 */
function stripUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}

/**
 * Composite PK schema for `ef:get-by-pk`. Mirrors `EfCompositePk` — same five
 * columns that key `emission_factor` and `pinned_emission_factor` (migration
 * 002). All fields required: an EF row is uniquely identified by all five.
 */
const efCompositePk = z.object({
  factor_code: z.string().min(1),
  year: z.number().int(),
  source: z.string().min(1),
  geography: z.string().min(1),
  dataset_version: z.string().min(1),
});

/**
 * Read-only catalog handlers for emission factors + unit definitions.
 *
 * Each handler:
 *   1. Zod-parses input (defense in depth — IPC is a trust boundary).
 *   2. Delegates to the appropriate service.
 *   3. Returns plain JSON-serializable rows (Electron structured-clone
 *      handles primitives + Date natively).
 */
export function efLibraryHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'ef:list': (input) =>
      ctx.efService.list(stripUndefined(efLookupQuery.parse(input)) satisfies EfLookupQuery),
    'ef:get-by-pk': (input) => ctx.efService.get(efCompositePk.parse(input)),
    'units:list': () => ctx.unitConversionService.listAll(),
  };
}
