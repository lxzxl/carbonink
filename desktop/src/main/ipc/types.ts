import type {
  ActivityData,
  ActivityDataCreateInput,
  ActivityDataWithDocument,
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
  EmissionSourceWithStats,
  Extraction,
  ExtractionStatus,
  MatcherResult,
  McpClientId,
  McpConfigureResult,
  McpDetectResult,
  McpRemoveResult,
  McpServerEntry,
  Organization,
  OrganizationCreateInput,
  PresetSource,
  ProviderConfigV2,
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
  /**
   * Update the basic-identity fields (names, industry, country) the
   * user set during onboarding step 1. Lets users fix typos or industry
   * mis-selections without resetting the whole database.
   */
  'org:update-basic-info': (input: {
    id: string;
    name_zh: string | null;
    name_en: string | null;
    industry: string | null;
    country_code: string;
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
  /**
   * Same as `list-by-org` but joins in per-source usage stats (count of
   * activity_data rows, total CO₂e, most recent activity timestamp).
   * Used by /sources for its enriched cards; older callers (extraction
   * review, dashboard, activities dropdown) keep using the leaner
   * `list-by-org` so they don't pay for the aggregation they don't need.
   */
  'source:list-by-org-with-stats': (input: {
    organization_id: string;
  }) => EmissionSourceWithStats[];
  'source:update': (input: EmissionSourceUpdateInput) => EmissionSource;
  'source:delete': (input: { id: string }) => void;
  // Built-in catalog of typical sources (read-only seed shipped with the app;
  // see src/main/data/preset-sources.json). The renderer browses these and
  // one-click adds entries into the user's org via `add-from-preset`.
  'source:list-presets': () => PresetSource[];
  'source:add-from-preset': (input: {
    organization_id: string;
    preset_id: string;
    /** Optional override; defaults to the org's first active site. */
    site_id?: string;
  }) => EmissionSource;
  /**
   * Batch sibling of `add-from-preset` — flips many presets into the org
   * in a single transaction. The catalog drawer's "添加选中" action uses
   * this so 30 row toggles become one atomic operation (and one audit
   * event downstream).
   */
  'source:add-from-presets': (input: {
    organization_id: string;
    preset_ids: string[];
    /** Optional override; defaults to the org's first active site. */
    site_id?: string;
  }) => EmissionSource[];

  // activity-data domain (pinned EF + computed CO2e per amount entry)
  'activity:create': (input: ActivityDataCreateInput) => ActivityData;
  'activity:list-by-period': (input: { reporting_period_id: string }) => ActivityDataWithDocument[];
  /**
   * Reverse lookup from a confirmed extraction to its activity row.
   * Returns null when nothing matches (extraction not yet confirmed,
   * or activity was deleted). Used by ExtractionReview's
   * already-confirmed panel to deep-link the user to the row.
   */
  'activity:find-by-extraction': (input: { extraction_id: string }) => ActivityData | null;
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
  // `settings:get-provider` returns the V2 config + masked key for UI display.
  // `settings:save-provider` persists config + key (split storage in SettingsService).
  // `settings:clear-provider` removes both halves.
  // `settings:ping-provider` is the "Test connection" path; optional `apiKey`
  // lets the UI verify a key the user has typed but not yet saved.
  //
  // Item 3 Task 10b: all three provider channels speak V2 end-to-end. The
  // renderer emits V2 directly (AIProviderSection composes Azure's
  // resourceName into baseUrl on submit); the legacy V1 discriminated
  // union has been removed from the wire. On-disk V1 rows from older
  // installs are still silently migrated to V2 on read by SettingsService
  // — that path is internal to the read implementation, not part of the
  // IPC contract.
  'settings:available': () => boolean;
  'settings:get-provider': () => (ProviderConfigV2 & { apiKeyMasked: string | null }) | null;
  'settings:save-provider': (input: { config: ProviderConfigV2; apiKey: string }) => void;
  'settings:clear-provider': () => void;
  'settings:ping-provider': (input: {
    config: ProviderConfigV2;
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

  // mcp-integration domain (Settings → Integrations sub-page)
  'mcp:detect': () => Promise<McpDetectResult>;
  'mcp:configure': (input: {
    clientId: McpClientId;
  }) => Promise<
    | { ok: true; result: McpConfigureResult }
    | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
  >;
  'mcp:remove': (input: {
    clientId: McpClientId;
  }) => Promise<
    | { ok: true; result: McpRemoveResult }
    | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
  >;
  'mcp:get-server-entry': () => McpServerEntry;

  // Agent skill installer (Step 1 of Settings → Integrations)
  'skill:detect': () => Promise<import('@shared/types.js').SkillDetectResult>;
  'skill:install': () => Promise<
    | { ok: true; result: import('@shared/types.js').SkillInstallResult }
    | { ok: false; error: 'io_error'; message?: string }
  >;
  'skill:update': () => Promise<
    | { ok: true; result: import('@shared/types.js').SkillInstallResult }
    | { ok: false; error: 'io_error'; message?: string }
  >;
  'skill:remove': () => Promise<
    | { ok: true; result: import('@shared/types.js').SkillRemoveResult }
    | { ok: false; error: 'io_error'; message?: string }
  >;

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
  /**
   * Export the filtered audit events to a CSV. The filter shape mirrors
   * `audit:list` so the renderer can reuse the same form state. Returns
   * 3-arm discriminated union — `{ canceled }` when the save dialog is
   * dismissed, `{ ok, path, rows_written }` on success, `{ ok:false,
   * error }` on IO failure.
   */
  'audit:export-csv': (input: {
    event_kinds?: string[];
    since?: string;
    until?: string;
    limit?: number;
  }) => Promise<
    | { canceled: true }
    | { ok: true; path: string; rows_written: number }
    | { ok: false; error: string }
  >;

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
  // Exchange a humanized key (cik-XXXXX-XXXXX-XXXXX-XXXXX) for a license
  // JWT by calling /api/v1/activate, then persist the JWT via setJwt.
  // The desktop-friendly entry point — users never need to see the raw
  // JWT, just paste the key from their activation email.
  'license:activate-with-key': (input: { license_key: string }) => Promise<
    | { ok: true }
    | {
        ok: false;
        error: {
          _tag:
            | 'Network'
            | 'KeyNotFound'
            | 'RateLimited'
            | 'DeviceCapReached'
            | 'BadSignature'
            | 'Malformed'
            | 'Server';
          message: string;
          status?: number;
        };
      }
  >;
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

  // app domain (Phase 5.1 — settings about + data-management helpers)
  //
  // `app:get-info` returns the running binary's version + runtime
  // versions (Electron / Node / Chromium) + user data dir + a session
  // start timestamp. Used by the About section and surfaces in support
  // diagnostics.
  //
  // `app:open-data-dir` opens the app's userData directory in the OS
  // file manager. Discriminated result so the renderer can toast a
  // user-friendly message when the path doesn't exist or the OS
  // refuses access (rare but possible on locked-down systems).
  'app:get-info': () => {
    version: string;
    name: string;
    electron_version: string;
    node_version: string;
    chrome_version: string;
    platform: NodeJS.Platform;
    arch: string;
    user_data_dir: string;
    started_at: string;
  };
  'app:open-data-dir': () => Promise<{ ok: true } | { ok: false; error: string }>;
  'app:open-log-dir': () => Promise<{ ok: true } | { ok: false; error: string }>;
  'app:open-auto-backup-dir': () => Promise<{ ok: true } | { ok: false; error: string }>;
  // Auto-backup toggle. The runner itself lives in main and decides
  // per-launch whether a backup is due; this pair just reads / writes
  // the `auto_backup.enabled` setting row (defaults to true when absent).
  'app:get-auto-backup-enabled': () => { enabled: boolean };
  'app:set-auto-backup-enabled': (input: { enabled: boolean }) => void;

  // data domain (Phase 5.2 — backup / restore / reset / cache cleanup)
  //
  // Export + Import open native dialogs in the main process — paths
  // aren't passed from the renderer to preserve the security boundary
  // (renderer can't trick the main process into copying arbitrary
  // files). Result is a 3-arm discriminated union: { canceled } when
  // the user dismissed the dialog, { ok:true, path, bytes_written }
  // on success, { ok:false, error } on validation/IO failure.
  //
  // `data:reset` synchronously closes the db + deletes the file +
  // schedules an app.relaunch. Returns immediately; the renderer
  // should show a "restarting..." state and let the relaunch happen.
  //
  // `cache:*` channels are size-aware: `get-stats` is cheap; the
  // clear operations run VACUUM and may take a moment on large dbs.
  'data:export-backup': () => Promise<
    | { canceled: true }
    | { ok: true; path: string; bytes_written: number }
    | { ok: false; error: string }
  >;
  'data:import-backup': () => Promise<
    { canceled: true } | { ok: true } | { ok: false; error: string }
  >;
  'data:reset': () => { ok: true };
  'cache:get-stats': () => {
    extraction_raw_bytes: number;
    extraction_raw_count: number;
    db_file_bytes: number;
  };
  'cache:clear-extraction-raw': () => { rows_cleared: number; bytes_freed: number };

  // Undo/Redo (post-launch — see docs/specs/2026-05-25-undo-redo-design.md)
  //
  // peek is a cheap read of the in-memory stack tops; it powers the
  // menu's enabled/disabled state and the renderer's "can undo / can
  // redo" tracking. `do` executes the closure on the named side and is
  // in the license-gate read-only block set — inverse ops are themselves
  // writes, so an expired license blocks them too.
  'undo:peek': () => { undo_kind: string | null; redo_kind: string | null };
  'undo:do': (input: { direction: 'undo' | 'redo' }) => { kind: string };
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
  // Post-launch (undo/redo) — fired by the Edit-menu accelerators; the
  // renderer's `useUndo` hook subscribes and calls `undo:do`. Empty
  // payload because the direction is encoded in the channel name; an
  // object keeps the IpcPushTypeMap shape consistent with the others.
  'menu:undo': Record<string, never>;
  'menu:redo': Record<string, never>;
};
