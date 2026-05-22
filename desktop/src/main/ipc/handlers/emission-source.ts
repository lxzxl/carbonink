import { emissionSourceCreateInput, emissionSourceUpdateInput } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const idInput = z.object({ id: z.string().min(1) });
const siteScopedInput = z.object({ site_id: z.string().min(1) });
const orgScopedInput = z.object({ organization_id: z.string().min(1) });

/**
 * Emission-source CRUD handlers. Delegates to `EmissionSourceService` —
 * site_id FK violations and "not found" errors propagate from the service
 * layer (sanitize() in setup.ts maps them to opaque correlation IDs).
 */
export function emissionSourceHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const svc = ctx.emissionSourceService;
  return {
    'source:create': (input) => svc.create(emissionSourceCreateInput.parse(input)),
    'source:get-by-id': (input) => svc.getById(idInput.parse(input).id),
    'source:list-by-site': (input) => svc.listBySite(siteScopedInput.parse(input).site_id),
    'source:list-by-org': (input) =>
      svc.listByOrganization(orgScopedInput.parse(input).organization_id),
    'source:update': (input) => svc.update(emissionSourceUpdateInput.parse(input)),
    'source:delete': (input) => {
      svc.delete(idInput.parse(input).id);
    },
  };
}
