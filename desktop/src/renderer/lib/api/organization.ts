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
 * Each method maps 1:1 to a channel in `IpcTypeMap`. We pass snake_case
 * payloads through unchanged — Zod schemas, DB columns, and the broader
 * Seneca convention all use snake_case at the IPC boundary, so introducing
 * a camelCase facade here would be inconsistent. Wrappers exist so callers
 * (components / TanStack queries) get readable names without spelling out
 * channel strings, and so we have a single place to add cross-cutting
 * concerns later (logging, retries, etc).
 */
export const orgApi = {
  hasAny: () => invoke('org:has-any'),
  getCurrent: () => invoke('org:get-current'),
  getById: (input: { id: string }) => invoke('org:get-by-id', input),
  create: (input: OrganizationCreateInput) => invoke('org:create', input),
  listSites: (input: { organization_id: string }) => invoke('org:list-sites', input),
  createSite: (input: SiteCreateInput) => invoke('org:create-site', input),
  listReportingPeriods: (input: { organization_id: string }) =>
    invoke('org:list-reporting-periods', input),
  createReportingPeriod: (input: ReportingPeriodCreateInput) =>
    invoke('org:create-reporting-period', input),
  completeOnboarding: (input: CompleteOnboardingInput) => invoke('org:complete-onboarding', input),
  updateReportingProfile: (input: {
    id: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible_person_name: string | null;
    responsible_person_role: string | null;
    base_year_period_id: string | null;
  }) => invoke('org:update-reporting-profile', input),
  updateBasicInfo: (input: {
    id: string;
    name_zh: string | null;
    name_en: string | null;
    industry: string | null;
    country_code: string;
  }) => invoke('org:update-basic-info', input),
};
