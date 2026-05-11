import type {
  ActivityData,
  ActivityDataCreateInput,
  CompleteOnboardingInput,
  Document,
  EfCompositePk,
  EfLookupQuery,
  EmissionFactor,
  EmissionSource,
  EmissionSourceCreateInput,
  EmissionSourceUpdateInput,
  Extraction,
  Organization,
  OrganizationCreateInput,
  ProviderConfig,
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

  // settings domain (Phase 1b — LLM provider config)
  // `settings:available` reports whether the OS-level keychain backend works.
  // `settings:get-provider` returns the config + masked key for UI display.
  // `settings:save-provider` persists config + key (split storage in SettingsService).
  // `settings:clear-provider` removes both halves.
  // `settings:ping-provider` is the "Test connection" path; optional `apiKey`
  // lets the UI verify a key the user has typed but not yet saved.
  'settings:available': () => boolean;
  'settings:get-provider': () => (ProviderConfig & { apiKeyMasked: string | null }) | null;
  'settings:save-provider': (input: { config: ProviderConfig; apiKey: string }) => void;
  'settings:clear-provider': () => void;
  'settings:ping-provider': (input: {
    config: ProviderConfig;
    apiKey?: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;

  // document domain (Phase 1b — uploaded source files)
  // `document:upload` carries raw bytes as a `Uint8Array` so Electron's
  // structured-clone path doesn't trip on Buffer (it does, but Uint8Array is
  // the lowest-common-denominator across realms). The handler converts to a
  // Buffer before handing off to DocumentService.
  'document:upload': (input: { filename: string; mimeType: string; bytes: Uint8Array }) => Document;
  'document:list': () => Document[];
  'document:get-by-id': (input: { id: string }) => Document | null;
  // `document:read-bytes` ships the raw PDF over IPC so the renderer can
  // construct a `Blob` URL for an `<iframe>` preview without granting the
  // renderer process direct filesystem access. Returning Uint8Array keeps the
  // payload structured-clone friendly (Buffer would lose its Node-specific
  // prototype on the renderer side).
  'document:read-bytes': (input: { id: string }) => Uint8Array;

  // extraction domain (Phase 1b — AI extraction pipeline)
  // `extraction:run` is async — it reads the PDF, calls the LLM, and writes
  // the row; the sanitize wrapper already awaits handlers, so this is fine.
  'extraction:run': (input: { document_id: string; stage_id: string }) => Promise<Extraction>;
  'extraction:list-pending': () => Extraction[];
  'extraction:list-by-document': (input: { document_id: string }) => Extraction[];
  'extraction:get-by-id': (input: { id: string }) => Extraction | null;
  'extraction:confirm': (input: { id: string }) => void;
  'extraction:discard': (input: { id: string }) => void;

  // stages domain (Phase 1b — read-only extraction stage registry)
  'stages:list': () => Array<{ id: string; version: string; description: string }>;
};
