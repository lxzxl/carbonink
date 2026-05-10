import type {
  CompleteOnboardingInput,
  OrganizationCreateInput,
  ReportingPeriodCreateInput,
  SiteCreateInput,
} from '@shared/types.js';
import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `org:*` IPC channels.
 *
 * Each method maps 1:1 to a channel in `IpcTypeMap`. Wrappers exist so
 * callers (components / TanStack queries) get readable names without having
 * to spell out channel strings, and so we have a single place to add
 * cross-cutting concerns later (logging, retries, etc).
 */
export const orgApi = {
  hasAny: () => invoke('org:has-any'),
  getById: (id: string) => invoke('org:get-by-id', { id }),
  create: (input: OrganizationCreateInput) => invoke('org:create', input),
  listSites: (organizationId: string) =>
    invoke('org:list-sites', { organization_id: organizationId }),
  createSite: (input: SiteCreateInput) => invoke('org:create-site', input),
  listReportingPeriods: (organizationId: string) =>
    invoke('org:list-reporting-periods', { organization_id: organizationId }),
  createReportingPeriod: (input: ReportingPeriodCreateInput) =>
    invoke('org:create-reporting-period', input),
  completeOnboarding: (input: CompleteOnboardingInput) => invoke('org:complete-onboarding', input),
};
