import {
  completeOnboardingInput,
  organizationCreateInput,
  reportingPeriodCreateInput,
  siteCreateInput,
} from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const orgIdInput = z.object({ id: z.string() });
const orgScopedInput = z.object({ organization_id: z.string() });

/**
 * Returns a map of channel-name → handler. Each handler:
 *   1. Zod-parses input (defense in depth: types alone aren't enough — IPC is
 *      a trust boundary because the preload could be exploited).
 *   2. Delegates to the service layer.
 *   3. Returns plain JSON-serializable values (Electron structured-clone
 *      handles Date/Map/Set/BigInt natively — no transformer needed).
 */
export function organizationHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const svc = ctx.organizationService;
  return {
    'org:has-any': () => svc.hasAnyOrganization(),
    'org:get-current': () => svc.getCurrentOrganization(),
    'org:get-by-id': (input) => svc.getOrganization(orgIdInput.parse(input).id),
    'org:create': (input) => svc.createOrganization(organizationCreateInput.parse(input)),
    'org:list-sites': (input) =>
      svc.listSitesByOrganization(orgScopedInput.parse(input).organization_id),
    'org:create-site': (input) => svc.createSite(siteCreateInput.parse(input)),
    'org:list-reporting-periods': (input) =>
      svc.listReportingPeriodsByOrganization(orgScopedInput.parse(input).organization_id),
    'org:create-reporting-period': (input) =>
      svc.createReportingPeriod(reportingPeriodCreateInput.parse(input)),
    'org:complete-onboarding': (input) =>
      svc.completeOnboarding(completeOnboardingInput.parse(input)),
    'org:update-reporting-profile': (input) => {
      const parsed = z
        .object({
          id: z.string(),
          boundary_kind: z.enum(['equity_share', 'financial_control', 'operational_control']),
          responsible_person_name: z.string().nullable(),
          responsible_person_role: z.string().nullable(),
          base_year_period_id: z.string().nullable(),
        })
        .parse(input);
      svc.updateReportingProfile(parsed);
    },
    'org:update-basic-info': (input) => {
      const parsed = z
        .object({
          id: z.string(),
          name_zh: z.string().min(1).max(255).nullable(),
          name_en: z.string().min(1).max(255).nullable(),
          industry: z.string().max(100).nullable(),
          country_code: z.string().min(2).max(3),
        })
        // Server-side mirror of the `organizationCreateInput.refine` rule
        // — at least one name. The service throws on the same condition,
        // but catching it at the IPC parse layer surfaces a clean
        // ZodError to the renderer instead of a bare Error string.
        .refine((v) => v.name_zh || v.name_en, {
          message: 'At least one of name_zh / name_en is required',
        })
        .parse(input);
      svc.updateBasicInfo(parsed);
    },
  };
}
