import type {
  ActivityData,
  ActivityDataCreateInput,
  ActivityDataWithEf,
  Answer,
  ClassifyAndRunResult,
  CompleteOnboardingInput,
  Customer,
  Document,
  EfCompositePk,
  EfLookupQuery,
  EmissionFactor,
  EmissionSource,
  EmissionSourceCreateInput,
  EmissionSourceUpdateInput,
  Extraction,
  ExtractionStatus,
  MatcherResult,
  Organization,
  OrganizationCreateInput,
  ProviderConfig,
  Question,
  Questionnaire,
  RecommendQuery,
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
  'org:update-reporting-profile': (input: {
    id: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible_person_name: string | null;
    responsible_person_role: string | null;
    base_year_period_id: string | null;
  }) => void;

  // ef-library domain (read-only catalog: emission factors + unit definitions)
  'ef:list': (input: EfLookupQuery) => EmissionFactor[];
  'ef:get-by-pk': (input: EfCompositePk) => EmissionFactor | null;
  'units:list': () => UnitDefinition[];

  // ef-matcher domain (Phase 1c — LLM-assisted emission factor recommendation)
  'ef:recommend': (input: RecommendQuery) => Promise<MatcherResult>;

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
  'activity:get-by-id': (input: { id: string }) => ActivityDataWithEf | null;
  'activity:rebind-ef': (input: {
    activity_id: string;
    new_ef_pk: EfCompositePk;
    /**
     * When the new EF's input_unit is in a different unit family than the
     * current activity's unit (e.g. m³ vs. kWh — the same physical fuel
     * cannot be auto-converted without a heating-value assumption the
     * system can't safely fabricate), the renderer collects a new amount
     * in the new unit from the user and passes it here. If provided, the
     * service skips its unit-conversion path entirely and writes
     * `amount = override_amount`, `unit = new_ef.input_unit` directly.
     */
    override_amount?: number;
  }) => Promise<
    | {
        ok: true;
        updated: ActivityData;
        old_co2e_kg: number;
        new_co2e_kg: number;
        old_amount: number;
        old_unit: string;
        new_amount: number;
        new_unit: string;
      }
    | { ok: false; error: { _tag: 'NotFound' | 'EfNotFound' | 'UnitMismatch'; message: string } }
  >;

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
  'settings:get-amap-key': () => string | null;
  'settings:set-amap-key': (input: { value: string }) => void;

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
  'extraction:classify-and-run': (input: { document_id: string }) => Promise<ClassifyAndRunResult>;
  'extraction:run': (input: { document_id: string; stage_id: string }) => Promise<Extraction>;
  'extraction:list-pending': () => Extraction[];
  'extraction:list-by-document': (input: { document_id: string }) => Extraction[];
  'extraction:get-by-id': (input: { id: string }) => Extraction | null;
  'extraction:confirm': (input: { id: string }) => void;
  'extraction:discard': (input: { id: string }) => void;
  // One row per document that has at least one extraction. Used by the
  // /documents list to render a per-row status chip without N+1'ing into
  // `list-by-document`. Documents with zero extractions are omitted —
  // caller defaults to a "no extractions" chip for those.
  'extraction:list-statuses': () => Array<{
    document_id: string;
    active_status: ExtractionStatus | null;
    has_rejected: boolean;
  }>;

  // stages domain (Phase 1b — read-only extraction stage registry)
  'stages:list': () => Array<{ id: string; version: string; description: string }>;

  // questionnaire domain (Phase 2.2a — questionnaire upload + extract pipeline)
  'questionnaire:create': (input: {
    customer_name: string;
    reporting_year: number;
    due_date: string | null;
    file_bytes: Uint8Array;
    filename: string;
  }) => Promise<{ questionnaire_id: string; question_count: number; reused_count: number }>;
  'questionnaire:list': () => Array<
    Questionnaire & { customer_name: string; question_count: number }
  >;
  'questionnaire:get-by-id': (input: { id: string }) => {
    questionnaire: Questionnaire;
    customer: Customer;
    document: Document;
    questions: Question[];
  } | null;
  'questionnaire:finalize': (input: { id: string }) => void;
  'questionnaire:export-pdf': (input: {
    questionnaire_id: string;
    language: 'zh-CN' | 'en';
  }) => Promise<{ canceled: true } | { ok: true; path: string } | { ok: false; error: string }>;

  // mcp domain (Phase 2 Block 4 — Model Context Protocol server status / config)
  'mcp:get-status': () => {
    binary_path: string | null;
    binary_built: boolean;
    claude_config_path: string;
    claude_config_present: boolean;
    claude_config_references_us: boolean;
  };
  'mcp:write-claude-config': () => { ok: true } | { ok: false; error: string };

  // routing domain (Routing API — distance lookup via AMap or haversine)
  'routing:lookup': (input: {
    mode: 'driving' | 'transit' | 'air';
    origin: string;
    destination: string;
  }) => Promise<
    | { ok: true; distance_km: number; source: 'amap' | 'haversine'; cached: boolean }
    | { ok: false; error: { _tag: string; message: string } }
  >;

  // answer domain (Phase 2.2b — auto-answer pipeline)
  'answer:generate': (input: { question_id: string }) => Promise<Answer>;
  'answer:save': (input: {
    question_id: string;
    value: string;
    unit: string | null;
    finalize: boolean;
  }) => Promise<Answer>;
  'answer:unfinalize': (input: { question_id: string }) => Promise<Answer>;
  'answer:list-by-questionnaire': (input: { questionnaire_id: string }) => Promise<Answer[]>;
  'answer:generate-all-unanswered': (input: {
    questionnaire_id: string;
  }) => Promise<
    Array<
      | { ok: true; result: { value: Answer } }
      | { ok: false; result: { error: { _tag: string; message: string } } }
    >
  >;
  'answer:export-to-xlsx': (input: {
    questionnaire_id: string;
  }) => Promise<
    { canceled: true } | { canceled: false; path: string; written: number; drafts: number }
  >;

  // report domain (Phase 3 — ISO 14064-1 inventory report)
  'report:generate': (input: {
    report_id: string;
    reporting_period_id: string;
    language: 'zh-CN' | 'en';
  }) => Promise<
    | { canceled: true }
    | {
        canceled: false;
        data: import('@main/services/report-data-service').InventoryReportData;
        narrative: import('@main/llm/report-narrative').ReportNarrative;
        error?: never;
      }
    | {
        canceled: false;
        error: {
          _tag: 'NoProvider' | 'Refused' | 'RateLimit' | 'Timeout';
          message?: string | undefined;
        };
        data?: never;
        narrative?: never;
      }
  >;
  'report:cancel': (input: { report_id: string }) => void;
  'report:export-pdf': (input: {
    data: import('@main/services/report-data-service').InventoryReportData;
    narrative: import('@main/llm/report-narrative').ReportNarrative;
    language: 'zh-CN' | 'en';
  }) => Promise<{ canceled: true } | { ok: true; path: string } | { ok: false; error: string }>;
  'report:export-xlsx': (input: {
    data: import('@main/services/report-data-service').InventoryReportData;
    narrative: import('@main/llm/report-narrative').ReportNarrative;
    language: 'zh-CN' | 'en';
  }) => Promise<{ canceled: true } | { ok: true; path: string } | { ok: false; error: string }>;

  // audit domain (Phase 3 sub-project 3 — audit_event log viewer)
  'audit:list': (input: {
    event_kinds?: string[];
    since?: string;
    until?: string;
    limit?: number;
  }) => import('@shared/types.js').AuditEvent[];

  // license domain (Phase 4 sub-project A — Ed25519 JWT + state machine)
  // `license:get-state` is read-mostly (called on every UI render that
  // shows the License section / banner). `license:set-jwt` validates +
  // persists; failures come back as a discriminated `_tag` so the UI can
  // render distinct messages without parsing error strings.
  'license:get-state': () => import('@shared/types.js').LicenseStateView;
  'license:set-jwt': (input: { jwt: string }) =>
    | { ok: true }
    | {
        ok: false;
        error: { _tag: 'BadSignature' | 'BadSchema' | 'Malformed'; message: string };
      };
  'license:clear': () => void;

  // updater domain (Phase 5 — auto-update via electron-updater)
  // `updater:get-status` is a cheap read of the in-memory status slot in
  // `auto-updater.ts`; the renderer subscribes to `updater:status` (push)
  // for real-time progress and falls back to this for the initial value.
  // `updater:check` and `updater:install` are fire-and-forget — actual
  // results arrive asynchronously via the push channel.
  'updater:get-status': () => import('@main/updater/auto-updater.js').UpdateStatus;
  'updater:check': () => void;
  'updater:install': () => void;
};

/**
 * Push channels — main→renderer events fired via `webContents.send`,
 * subscribed via the preload `subscribe` API. Separate from
 * `IpcTypeMap` because these are not request/response: payload only,
 * no return value, no per-call correlation id.
 *
 * Phase 1c only registers `extraction:progress` (signals "switching
 * to vision OCR" mid-extraction). Phase 1d's streamObject will
 * extend the payload to carry partial JSON without a schema break —
 * `phase` becomes a discriminator with more values.
 */
export type IpcPushTypeMap = {
  'extraction:progress': {
    /** Which extraction this event belongs to. */
    document_id: string;
    /** Stage of the pipeline the event was emitted from. */
    phase: 'vision';
  };
  'report:progress': {
    report_id: string;
    phase: 'assembling' | 'narrative' | 'finalizing';
    sub_phase:
      | 'boundary'
      | 'reporting-boundary'
      | 'methodology'
      | 'emissions'
      | 'changes'
      | 'observations'
      | null;
  };
  // Phase 5 — auto-updater lifecycle status pushed from main to renderer.
  // Each transition (`checking`, `available`, `downloading`, …) fires one
  // event; the renderer mirrors the payload into its TanStack Query cache.
  'updater:status': import('@main/updater/auto-updater.js').UpdateStatus;
};
