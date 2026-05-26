import { z } from 'zod';
import { optionalString } from './schemas/_helpers.js';

export * from './schemas/complete-onboarding.js';
export * from './schemas/organization.js';
export * from './schemas/reporting-period.js';
export * from './schemas/site.js';

// ---------------------------------------------------------------------------
// Customer types
// ---------------------------------------------------------------------------

/** Row shape mirroring the `customer` table. See migration 005. */
export type Customer = {
  id: string;
  name: string;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Question / Questionnaire types (Phase 2.2a — questionnaire extract pipeline)
// ---------------------------------------------------------------------------

/** Row shape mirroring the `question` table. See migration 005. */
export type Question = {
  id: string;
  questionnaire_id: string;
  question_signature: string;
  signature_version: string;
  normalized_text: string;
  raw_text: string;
  parsed_intent: string | null;
  question_kind: 'numerical' | 'categorical' | 'narrative';
  expected_unit: string | null;
  position: string | null;
  required: number;
};

/** Row shape mirroring the `questionnaire` table. See migration 005. */
export type Questionnaire = {
  id: string;
  customer_id: string;
  document_id: string;
  template_kind: string | null;
  reporting_year: number;
  status: 'parsing' | 'mapping' | 'answering' | 'exported';
  due_date: string | null;
  created_at: string;
};

/** Assembled questionnaire data for PDF rendering: sheets grouped + questions sorted by cell position. */
export type QuestionnairePdfData = {
  customer: { name: string };
  questionnaire: {
    id: string;
    reporting_year: number;
    due_date: string | null;
    created_at: string;
    status: 'parsing' | 'mapping' | 'answering' | 'exported';
  };
  document: { filename: string };
  sheets: Array<{
    sheet_name: string;
    questions: Array<{
      id: string;
      position: string | null;
      raw_text: string;
      normalized_text: string;
      parsed_intent: string | null;
      question_kind: 'numerical' | 'categorical' | 'narrative';
      expected_unit: string | null;
      answer: {
        value: string;
        unit: string | null;
        finalized_at: string | null;
        source_summary: string | null;
      } | null;
    }>;
  }>;
  language: 'zh-CN' | 'en';
};

// ---------------------------------------------------------------------------
// Emission Factor types (Phase 1a — bare TS types; Zod schemas land in Task 6)
// ---------------------------------------------------------------------------

/**
 * Composite primary key shared by `emission_factor` and `pinned_emission_factor`.
 * See migration 002 (`src/main/db/migrations/002_emission_factors.sql`).
 */
export type EfCompositePk = {
  factor_code: string;
  year: number;
  source: string;
  geography: string;
  dataset_version: string;
};

/** Query shape for `EfService.list()`. All filters optional and AND-ed. */
export type EfLookupQuery = {
  category?: string; // e.g. 'electricity.grid'
  scope?: 1 | 2 | 3;
  geography?: string; // e.g. 'CN' or 'CN-East'
  year?: number;
  /** Exact match. When set, all other filters still apply. */
  factor_code?: string;
};

/** Row shape mirroring the `emission_factor` table. */
export type EmissionFactor = {
  factor_code: string;
  year: number;
  source: string;
  geography: string;
  dataset_version: string;
  scope: 1 | 2 | 3;
  category: string | null;
  ghg_protocol_path: string | null;
  input_unit: string;
  co2e_kg_per_unit: number;
  ch4_kg_per_unit: number | null;
  n2o_kg_per_unit: number | null;
  hfc_kg_per_unit: number | null;
  pfc_kg_per_unit: number | null;
  sf6_kg_per_unit: number | null;
  nf3_kg_per_unit: number | null;
  gwp_basis: 'AR5' | 'AR6';
  name_zh: string | null;
  name_en: string | null;
  description_zh: string | null;
  description_en: string | null;
  notes: string | null;
  biogenic_co2_factor: number | null;
  citation_url: string | null;
};

/**
 * Row shape for `pinned_emission_factor`. Mirrors `EmissionFactor` minus
 * `notes`, plus pin metadata. See migration 002.
 */
export type PinnedEmissionFactor = Omit<EmissionFactor, 'notes' | 'biogenic_co2_factor'> & {
  pinned_at: string;
  /**
   * Which RO snapshot the pin was copied from. In Phase 1a both source and
   * pin live in `app.sqlite`, so this is hardcoded to `'app.sqlite'`.
   * Phase 1c+ will set this to `'ef_library.sqlite'` (per spec §2).
   */
  pinned_from: string;
};

// ---------------------------------------------------------------------------
// emission_source / activity_data — Zod inputs + DB row types (Phase 1a task 6)
// ---------------------------------------------------------------------------
//
// 命名/lengths：参照 organization/site schema 的约定（255/500/100），
// JSON / 自由文本字段给得宽松一些。`scope` 用 union of literals 而不是
// `z.enum([...])`，因为它在 DB 里是 INTEGER（migration 004 CHECK 约束）。

export const emissionSourceCreateInput = z.object({
  site_id: z.string().min(1),
  name: z.string().min(1).max(200),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  category: optionalString({ max: 255 }),
  ghg_protocol_path: optionalString({ max: 500 }),
  // JSON string (e.g. serialized EfLookupQuery). Validated as JSON by the
  // DB CHECK constraint on insert; the zod schema just bounds length.
  default_ef_query: optionalString({ max: 2000 }),
  template_origin: optionalString({ max: 255 }),
});

export const emissionSourceUpdateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  category: optionalString({ max: 255 }),
  is_active: z.boolean().optional(),
});

export const activityDataCreateInput = z.object({
  emission_source_id: z.string().min(1),
  reporting_period_id: z.string().min(1),
  occurred_at_start: z.string(), // ISO 8601 date or datetime
  occurred_at_end: z.string(),
  amount: z.number().positive(),
  unit: z.string().min(1),
  ef_factor_code: z.string().min(1),
  ef_year: z.number().int(),
  ef_source: z.string().min(1),
  ef_geography: z.string().min(1),
  ef_dataset_version: z.string().min(1),
  // Optional: lets ActivityDataService do cross-family conversion
  // (e.g. m³ → kg via fuel density) when input unit and EF input_unit
  // belong to different families. See spec §3 / migration 007.
  fuel_code: optionalString({ max: 100 }),
  notes: optionalString({ max: 2000 }),
  // Soft FK to `extraction.id` — set when the activity row was confirmed
  // from a document extraction (the /documents review flow). NULL for
  // hand-typed entries on /activities. Lets /activities surface
  // "来自文档 X" + lets /documents/$id deep-link to the confirmed
  // activity once a row exists.
  extraction_id: optionalString({ max: 100 }),
});

/** Row shape mirroring the `emission_source` table. See migration 004. */
export type EmissionSource = {
  id: string;
  site_id: string;
  name: string;
  scope: 1 | 2 | 3;
  category: string | null;
  ghg_protocol_path: string | null;
  default_ef_query: string | null;
  template_origin: string | null;
  is_active: boolean;
};

/** Row shape mirroring the `activity_data` table. See migration 004. */
export type ActivityData = {
  id: string;
  site_id: string;
  emission_source_id: string;
  reporting_period_id: string;
  occurred_at_start: string;
  occurred_at_end: string;
  amount: number;
  unit: string;
  ef_factor_code: string;
  ef_year: number;
  ef_source: string;
  ef_geography: string;
  ef_dataset_version: string;
  computed_co2e_kg: number;
  computed_at: string;
  extraction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** ActivityData row joined with the currently pinned emission factor. */
export type ActivityDataWithEf = ActivityData & {
  pinned_ef: PinnedEmissionFactor;
};

/**
 * ActivityData row enriched with its source document (when present).
 * Both fields are non-null only when the activity was confirmed from
 * a `/documents/$id` review flow — hand-typed activities on /activities
 * have a NULL `extraction_id` and both joins resolve to null.
 *
 * Used by `activity:list-by-period` so the /activities list can render
 * "来自文档 X" without firing an N+1 of per-row extraction lookups.
 */
export type ActivityDataWithDocument = ActivityData & {
  source_document_id: string | null;
  source_document_filename: string | null;
};

export type EmissionSourceCreateInput = z.infer<typeof emissionSourceCreateInput>;
export type EmissionSourceUpdateInput = z.infer<typeof emissionSourceUpdateInput>;
export type ActivityDataCreateInput = z.infer<typeof activityDataCreateInput>;

/**
 * EmissionSource row augmented with usage stats computed via a LEFT JOIN
 * against `activity_data`. Surfaced on the `/sources` list cards so users
 * can see at a glance which sources are actually in use and which are
 * dead weight.
 *
 * Zero-activity sources get `activity_count = 0`, `total_co2e_kg = 0`,
 * and `last_activity_at = null`. The aggregation is across ALL reporting
 * periods (not the current one) — `/sources` is a global org view.
 */
export type EmissionSourceWithStats = EmissionSource & {
  activity_count: number;
  total_co2e_kg: number;
  /** ISO timestamp of the most recent activity_data.occurred_at_end. */
  last_activity_at: string | null;
};

/**
 * One entry in the built-in preset emission-source catalog.
 *
 * Ships as a static JSON seed at `src/main/data/preset-sources.json`,
 * generated by `desktop/scripts/climatiq-to-presets.mjs` from the
 * Climatiq public API. The main process exposes the list via
 * `source:list-presets` and `source:add-from-preset` IPC channels.
 *
 * `source`, `region`, `year` carry Climatiq provenance for the UI to
 * surface as muted metadata. They're optional on older snapshots
 * (the original hand-curated 27-entry seed didn't have them) — the
 * renderer must tolerate `undefined`.
 */
export type PresetSource = {
  id: string;
  name_zh: string;
  name_en: string;
  scope: 1 | 2 | 3;
  category: string;
  hint_unit: string;
  /** Climatiq dataset publisher (e.g. 'BEIS', 'EPA', 'IPCC'). */
  source?: string;
  /** Climatiq region code (e.g. 'CN', 'GLOBAL', 'GB', 'US', 'EU'). */
  region?: string;
  /** Climatiq factor year (the data year, not the release year). */
  year?: number;
};

// ---------------------------------------------------------------------------
// Unit definition (read-only catalog row, exposed via `units:list` IPC channel)
// ---------------------------------------------------------------------------

/**
 * Row shape mirroring the `unit_definition` table (migration 003 / 007).
 * Read-only for the UI: the renderer pulls the full catalog once at startup
 * and uses it for unit pickers / family compatibility filtering.
 */
export type UnitDefinition = {
  unit: string;
  family: string;
  multiply_of_ratio: number;
  divide_of_ratio: number;
  display_order: number;
  display_name_zh: string | null;
  display_name_en: string | null;
};

// ---------------------------------------------------------------------------
// AI provider config (Phase 1b)
// ---------------------------------------------------------------------------
//
// Discriminated union over provider kinds; each shape has its own required
// fields. `apiKeyKeyref` is a literal pointing to a `CredentialService` key
// (see `ALLOWED_PREFIXES` in `credential-service.ts`); the plaintext key
// itself never lives on this config object — it stays in OS keychain.

export const openAiProviderConfig = z.object({
  provider: z.literal('openai'),
  model: z.string().default('gpt-4o-mini'),
  apiKeyKeyref: z.literal('llm.openai.apikey'),
});

export const anthropicProviderConfig = z.object({
  provider: z.literal('anthropic'),
  model: z.string().default('claude-sonnet-4-5'),
  apiKeyKeyref: z.literal('llm.anthropic.apikey'),
});

export const azureProviderConfig = z.object({
  provider: z.literal('azure'),
  model: z.string(),
  apiKeyKeyref: z.literal('llm.azure.apikey'),
  resourceName: z.string().min(1),
  apiVersion: z.string().default('2024-08-01-preview'),
});

export const deepseekProviderConfig = z.object({
  provider: z.literal('deepseek'),
  model: z.string().default('deepseek-chat'),
  apiKeyKeyref: z.literal('llm.deepseek.apikey'),
});

export const openAiCompatProviderConfig = z.object({
  provider: z.literal('openai-compat'),
  model: z.string().min(1),
  apiKeyKeyref: z.literal('llm.openai-compat.apikey'),
  baseUrl: z.string().url(),
  name: z.string().default('Custom'),
});

export const providerConfig = z.discriminatedUnion('provider', [
  openAiProviderConfig,
  anthropicProviderConfig,
  azureProviderConfig,
  deepseekProviderConfig,
  openAiCompatProviderConfig,
]);

export type ProviderConfig = z.infer<typeof providerConfig>;
export type ProviderKind = ProviderConfig['provider'];

// ---------------------------------------------------------------------------
// Document + Extraction (Phase 1b — AI extraction pipeline)
// ---------------------------------------------------------------------------
//
// Mirrors the schema in migration 003. The Document row stores file metadata
// alongside an absolute `storage_path` so the extraction service can read the
// PDF without recomputing the content-addressed location. Extraction rows are
// uniquely keyed by (document_id, prompt_version, llm_provider, llm_model) per
// the migration's UNIQUE constraint — that tuple is the cache key.

/** Row shape mirroring the `document` table. See migration 003. */
export type Document = {
  id: string;
  sha256: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_at: string;
  uploaded_by: string | null;
  doc_type: string | null;
};

export type ExtractionStatus = 'pending' | 'parsed' | 'review_needed' | 'rejected';

/** Row shape mirroring the `extraction` table. See migration 003. */
export type Extraction = {
  id: string;
  document_id: string;
  llm_provider: string;
  llm_model: string;
  prompt_version: string;
  raw_response: string | null;
  parsed_json: string | null;
  error_json: string | null;
  status: ExtractionStatus;
  reviewed_by_user_at: string | null;
  cost_usd: number | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Answer (Phase 2.2b — auto-answer pipeline)
// ---------------------------------------------------------------------------

/** Row shape mirroring the `answer` table. See migration 005, extended by migration 014. */
export type Answer = {
  id: string;
  question_id: string;
  value: string;
  unit: string | null;
  source_kind: 'mapped_inventory' | 'manual' | 'ai_suggested' | 'reused';
  source_calculation_snapshot_id: string | null;
  source_activity_data_id: string | null;
  source_company_profile_key: string | null;
  source_narrative_bank_id: string | null;
  source_summary: string | null;
  finalized_at: string | null;
};

// ---------------------------------------------------------------------------
// ClassificationService result (Phase 1c Task 3 — auto-classify + run)
// ---------------------------------------------------------------------------

/**
 * Discriminated-union result from ClassificationService.classifyAndRun().
 * - `classified`: doc_type was determined (from cache or LLM) and extraction ran.
 * - `classify_failed`: any failure mode (doc missing, low confidence, LLM error,
 *   corrupt PDF). Renderer should prompt for manual stage selection.
 */
export type ClassifyAndRunResult =
  | { status: 'classified'; extraction: Extraction; doc_type: string }
  | { status: 'classify_failed' };

// ---------------------------------------------------------------------------
// EF Matcher types (Phase 1c Task 5)
// ---------------------------------------------------------------------------

/** Input to EfMatcherService.recommend(): identifies the extraction + source. */
export type RecommendQuery = {
  extraction_id: string;
  emission_source_id: string;
};

/** One LLM-recommended emission factor with a short Chinese reasoning note. */
export type MatcherRecommendation = {
  ef: EmissionFactor;
  reasoning_zh: string;
};

/**
 * Full result from EfMatcherService.recommend().
 * - `recommended`: 0–3 items selected by the LLM (empty on LLM failure).
 * - `ranked_full`: ≤ 20 items sorted by FTS5 bm25 relevance.
 */
export type MatcherResult = {
  recommended: MatcherRecommendation[];
  ranked_full: EmissionFactor[];
};

// ---------------------------------------------------------------------------
// Audit Event types (Phase 3 sub-project 3 — audit log viewer)
// ---------------------------------------------------------------------------

/**
 * Row shape mirroring the `audit_event` table (migration 006).
 * Append-only via DB triggers; readers parse `payload` as JSON.
 */
export type AuditEvent = {
  id: string;
  event_kind: string;
  /** JSON-text payload. Caller parses with `JSON.parse`. */
  payload: string;
  occurred_at: string;
};

/**
 * Typed shape of the `payload` for `event_kind === 'activity_rebind_ef'`.
 * Written by `ActivityDataService.rebindEf` (Phase 3 sub-project 2).
 */
export type ActivityRebindEfPayload = {
  activity_id: string;
  old_ef: EfCompositePk;
  new_ef: EfCompositePk;
  old_amount: number;
  old_unit: string;
  old_computed_co2e_kg: number;
  new_amount: number;
  new_unit: string;
  new_computed_co2e_kg: number;
};

// ---------------------------------------------------------------------------
// License types (Phase 4 sub-project A — Ed25519 JWT + state machine)
// ---------------------------------------------------------------------------

/**
 * The Ed25519-signed JWT claims carried by every CarbonInk license.
 * The cloud is the issuer; the client verifies the signature locally and
 * reads `expires_at` / `grace_until` / `revocation_check_after` to drive
 * the state machine. See design spec §10.
 *
 * `features` is open-ended (future modules like CBAM ship their own
 * license JWT with `features: ['cbam']`). The Base license carries
 * exactly `['inventory','questionnaire','iso14064']`.
 */
export type LicenseJwtClaims = {
  iss: string; // 'carbonink.xyz'
  license_id: string; // 'lic_01H...'
  user_id: string; // 'usr_01H...'
  plan: string; // 'base@2026-q2', 'trial@14d', etc.
  features: string[];
  devices_max: number;
  issued_at: number; // unix seconds
  expires_at: number; // unix seconds
  grace_until: number; // expires_at + 30 days
  support_until?: number; // expires_at + N days for hotfix updates only
  revocation_check_after: number; // unix seconds; next mandatory cloud ping
};

/**
 * One of the four states from the design spec §10. `unverified` is a
 * synthetic 5th value used only when no license has ever been activated
 * on this device — distinct from `expired` so the UI can show a
 * different welcome path (activate-license-now vs renew-now).
 */
export type LicenseState = 'unverified' | 'active' | 'grace' | 'expired' | 'revoked';

/**
 * The shape returned by `license:get-state`. `claims` is null when no
 * JWT has been activated yet (state === 'unverified'). The UI uses
 * `state` to pick a banner, and `claims` to render details (plan name,
 * days remaining, etc.).
 */
export type LicenseStateView = {
  state: LicenseState;
  claims: LicenseJwtClaims | null;
  device_id: string;
  last_verified_at: string | null;
  consecutive_offline_days: number;
  /** Human-readable explanation; surfaced in diagnostics / dev logs. */
  reason: string;
};

/**
 * Row shape for the `license_local_state` table (migration 016).
 * Internal — not exposed directly to the renderer; UI reads via
 * LicenseStateView.
 */
export type LicenseLocalStateRow = {
  id: 1;
  device_id: string;
  last_verified_at: string | null;
  consecutive_offline_days: number;
  last_known_state: LicenseState;
  last_known_state_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// MCP integration types (cross-process — used by main service, IPC layer, renderer)
// ---------------------------------------------------------------------------

export type McpClientId = 'claudeDesktop' | 'claudeCode' | 'cursor' | 'pi';

export type McpClientStatus =
  | { installed: false }
  | { installed: true; configured: false; configPath: string }
  | { installed: true; configured: true; configPath: string; entryDiffersFromCurrent: boolean }
  | { installed: true; error: 'invalid_json'; configPath: string };

export type McpDetectResult = Record<McpClientId, McpClientStatus>;

export type McpServerEntry = {
  command: string;
  args: string[];
  env: { ELECTRON_RUN_AS_NODE: '1' };
};

export type McpConfigureResult =
  | { configPath: string; backupPath: string | null; noChange?: false }
  | { configPath: string; backupPath: null; noChange: true };

export type McpRemoveResult = { configPath: string; backupPath: string | null };

// Agent skill installer types (v1.1)
export type AgentHost = 'claudeCode' | 'pi' | 'codex' | 'agentsShared';

export type SkillDetectResult =
  | { state: 'not_installed'; detectedHosts: AgentHost[] }
  | {
      state: 'installed';
      canonicalPath: string;
      hostsLinked: AgentHost[];
      needsUpdate: boolean;
      detectedHosts: AgentHost[];
    };

export type SkillInstallResult = {
  canonicalPath: string;
  hostsLinked: AgentHost[];
  backupPath: string | null;
};

export type SkillRemoveResult = {
  removed: string[];
  backupPath: string | null;
};
