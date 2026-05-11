import type {
  ActivityData,
  ActivityDataCreateInput,
  CompleteOnboardingInput,
  EfCompositePk,
  EfLookupQuery,
  EmissionFactor,
  EmissionSource,
  EmissionSourceCreateInput,
  EmissionSourceUpdateInput,
  Organization,
  OrganizationCreateInput,
  ReportingPeriod,
  ReportingPeriodCreateInput,
  Site,
  SiteCreateInput,
  UnitDefinition,
} from '@shared/types.js';

/**
 * IPC channel type map. Shared by the main process (IpcListener) and the
 * renderer-side bridge (IpcEmitter), keeping channel name + input + output
 * aligned in one place.
 *
 * Naming: `<domain>:<verb>` (kebab-case domain, kebab-case verb).
 * Channels are flat (no nesting) — namespace via prefix.
 */
export type IpcTypeMap = {
  // organization domain
  'org:has-any': () => boolean;
  'org:get-current': () => Organization | null;
  'org:get-by-id': (input: { id: string }) => Organization | null;
  'org:create': (input: OrganizationCreateInput) => Organization;
  'org:list-sites': (input: { organization_id: string }) => Site[];
  'org:create-site': (input: SiteCreateInput) => Site;
  'org:list-reporting-periods': (input: { organization_id: string }) => ReportingPeriod[];
  'org:create-reporting-period': (input: ReportingPeriodCreateInput) => ReportingPeriod;
  'org:complete-onboarding': (input: CompleteOnboardingInput) => {
    organization: Organization;
    site: Site;
    reporting_period: ReportingPeriod;
  };

  // ef-library domain (read-only catalog: emission factors + unit definitions)
  'ef:list': (input: EfLookupQuery) => EmissionFactor[];
  'ef:get-by-pk': (input: EfCompositePk) => EmissionFactor | null;
  'units:list': () => UnitDefinition[];

  // emission-source domain (per-site source definitions)
  'source:create': (input: EmissionSourceCreateInput) => EmissionSource;
  'source:get-by-id': (input: { id: string }) => EmissionSource | null;
  'source:list-by-site': (input: { site_id: string }) => EmissionSource[];
  'source:list-by-org': (input: { organization_id: string }) => EmissionSource[];
  'source:update': (input: EmissionSourceUpdateInput) => EmissionSource;
  'source:delete': (input: { id: string }) => void;

  // activity-data domain (pinned EF + computed CO2e per amount entry)
  'activity:create': (input: ActivityDataCreateInput) => ActivityData;
  'activity:list-by-period': (input: { reporting_period_id: string }) => ActivityData[];
  'activity:totals-by-period': (input: { reporting_period_id: string }) => {
    total_co2e_kg: number;
    scope1_kg: number;
    scope2_kg: number;
    scope3_kg: number;
  };
};
