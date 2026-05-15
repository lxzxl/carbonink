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
  citation_url: string | null;
};

/**
 * Row shape for `pinned_emission_factor`. Mirrors `EmissionFactor` minus
 * `notes`, plus pin metadata. See migration 002.
 */
export type PinnedEmissionFactor = Omit<EmissionFactor, 'notes'> & {
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

export type EmissionSourceCreateInput = z.infer<typeof emissionSourceCreateInput>;
export type EmissionSourceUpdateInput = z.infer<typeof emissionSourceUpdateInput>;
export type ActivityDataCreateInput = z.infer<typeof activityDataCreateInput>;

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
