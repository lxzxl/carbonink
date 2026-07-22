import { z } from 'zod';
import { optionalString } from './schemas/_helpers.js';

export * from './schemas/complete-onboarding.js';
export * from './schemas/organization.js';
export * from './schemas/reporting-period.js';
export * from './schemas/site.js';

// ---------------------------------------------------------------------------
// Inbound questionnaire primitives (migration 017 — Cat 1 supplier disclosure)
// ---------------------------------------------------------------------------

/**
 * Whether a questionnaire flows from us to a customer ("outbound", v1) or
 * from us to a supplier and back ("inbound", v2.0 — Scope 3 Cat 1 disclosure).
 * Mutually exclusive at the IPC/UI level: outbound runs the answer-generation
 * agent; inbound runs the supplier-disclosure ingest pipeline.
 */
export type Direction = 'outbound' | 'inbound';

/**
 * Inbound disclosure tier:
 *  - Tier 1 = supplier-specific per-unit product carbon footprint (kgCO2e/kg).
 *  - Tier 2 = supplier's allocated company-level emissions (kgCO2e attributable
 *    to our purchase, by mass / economic / physical allocation).
 * Metadata questions (legal name, period, inventory status) have `tier = null`.
 */
export type Tier = 1 | 2;

/** v2.0 ships exactly one template; the type stays a union for future Cat 4/5/etc. */
export type InboundTemplateKind = 'cat1_supplier_disclosure';

/**
 * Counterparty role on the shared `customer` table. v2.0 introduces
 * 'supplier' alongside the original 'customer' so inbound disclosures
 * can reuse the table without a rename.
 */
export type CounterpartyRole = 'customer' | 'supplier';

// ---------------------------------------------------------------------------
// Customer types
// ---------------------------------------------------------------------------

/** Row shape mirroring the `customer` table. See migration 005 + 017 + 020. */
export type Customer = {
  id: string;
  name: string;
  notes: string | null;
  role: CounterpartyRole;
  /** Contact email (migration 020). NULL until captured. */
  email: string | null;
};

/**
 * A `customer`-table row materialized with role='supplier'. Same physical row
 * shape as {@link Customer}; nominal type so the supplier endpoints can return
 * a narrower view that the renderer can statically branch on.
 */
export type Supplier = {
  id: string;
  name: string;
  notes: string | null;
  role: 'supplier';
  /** Contact email (migration 020). Reminder mailto target; NULL until captured. */
  email: string | null;
};

// ---------------------------------------------------------------------------
// Question / Questionnaire types (Phase 2.2a — questionnaire extract pipeline)
// ---------------------------------------------------------------------------

/** Row shape mirroring the `question` table. See migration 005 + 017. */
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
  /**
   * Non-null only for questions belonging to an inbound disclosure template.
   * Outbound questions extracted from a customer's xlsx always carry null.
   */
  tier: Tier | null;
};

/** Row shape mirroring the `questionnaire` table. See migration 005 + 017. */
export type Questionnaire = {
  id: string;
  customer_id: string;
  /** Nullable since migration 017 — inbound drafts have no source document. */
  document_id: string | null;
  template_kind: string | null;
  reporting_year: number;
  status:
    | 'parsing'
    | 'mapping'
    | 'answering'
    | 'exported'
    | 'draft'
    | 'sent'
    | 'received'
    | 'ingested';
  direction: Direction;
  due_date: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Inbound questionnaire template + review-pipeline view types
// ---------------------------------------------------------------------------

/**
 * A single question inside a built-in inbound template. `position` is a
 * stable identifier across template versions (e.g. 'tier1.1'); `cell_ref`
 * is the xlsx address (e.g. 'tier2!B5') where the supplier will type their
 * answer. The renderer materializes one of these per checked question into
 * the `question` table when the user creates a draft.
 */
export type InboundTemplateQuestion = {
  position: string;
  tier: Tier | null;
  kind: 'numerical' | 'categorical' | 'narrative';
  raw_zh: string;
  raw_en: string;
  expected_unit: string | null;
  cell_ref: string;
};

/**
 * Built-in inbound template. v2.0 ships `'cat1_supplier_disclosure'`; future
 * Cat 4 / Cat 5 templates plug into the same shape.
 */
export type InboundTemplate = {
  template_kind: InboundTemplateKind;
  version: string;
  scope: 1 | 2 | 3;
  category: string;
  ghg_protocol_path: string;
  questions: readonly InboundTemplateQuestion[];
};

/**
 * One per-question entry in the review-and-confirm preview after we parse
 * a supplier-filled xlsx. `parsed_value` is normalized to JS types:
 *  - numerical: number | null (null when blank or unparseable)
 *  - categorical / narrative: string | null
 * `proposed_activity` is non-null only on Tier 1/2 numerical answers that
 * would land as an `activity_data` row on ingest.
 */
export type ImportPreviewAnswer = {
  question_id: string;
  position: string;
  tier: Tier | null;
  raw_value: string;
  parsed_value: number | string | null;
  is_blank: boolean;
  /**
   * Free-form note the supplier typed in the xlsx "备注 / Notes" column (C)
   * alongside the answer. Empty string when none. Carried through review +
   * ingest so caveats like "estimate" / "预估" aren't silently dropped.
   */
  note: string;
  proposed_activity: {
    amount: number;
    unit: string;
    co2e_kg: number;
  } | null;
};

/** Soft validation issue surfaced in the review UI (does not abort import). */
export type ImportPreviewWarning = {
  /** null = workbook-level (sentinel sheet mismatches, period mismatch, etc). */
  question_id: string | null;
  kind: 'period_mismatch' | 'unit_unrecognized' | 'numerical_unparseable' | 'blank_template';
  detail: string;
};

/**
 * Side-by-side review payload the renderer feeds into the
 * `/questionnaires/$id/ingest` page. `ingestion_plan` summarizes what the
 * subsequent `inbound-ingest` IPC will produce when the user clicks confirm.
 */
export type ImportPreview = {
  questionnaire_id: string;
  supplier_name: string;
  warnings: ImportPreviewWarning[];
  answers: ImportPreviewAnswer[];
  ingestion_plan: {
    /** Auto-selected tier (GHG Protocol preference: Tier 1 over Tier 2). */
    tier_selected: Tier | null;
    /**
     * Tiers the supplier's data actually supports. When this has >1 entry
     * the review UI lets the user pick which to ingest (overriding the
     * `tier_selected` default). Order is the preference order (1 before 2).
     */
    available_tiers: Tier[];
    emission_source_name: string;
    activity_row_count: number;
    total_co2e_kg: number;
  };
};

/** Return shape of `questionnaire:inbound-ingest`. */
export type IngestResult = {
  activity_data_ids: string[];
  emission_source_id: string;
  ingested_at: string;
};

/** Assembled questionnaire data for PDF rendering: sheets grouped + questions sorted by cell position. */
export type QuestionnairePdfData = {
  customer: { name: string };
  questionnaire: {
    id: string;
    reporting_year: number;
    due_date: string | null;
    created_at: string;
    status: Questionnaire['status'];
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
// User-imported EF libraries (2026-07-11 — ROADMAP §8.1-④)
// ---------------------------------------------------------------------------

/**
 * Source-namespace prefix for user-imported emission factors. Every imported
 * row gets `source = USER_EF_SOURCE_PREFIX + library name`, which cannot
 * collide with the built-in sources (DEFRA, IPCC_AR6, MEE_China, ...). The
 * renderer uses the same prefix to badge user-library rows in pickers.
 */
export const USER_EF_SOURCE_PREFIX = 'user:';

/** Row shape mirroring the `user_ef_library` registry table (migration 019). */
export type UserEfLibrary = {
  id: string;
  name: string;
  /** `'user:' || name` — the `emission_factor.source` namespace of this library. */
  source: string;
  /** Library version string; written into every row's `dataset_version`. */
  version: string;
  source_filename: string | null;
  /** Original uploaded file in the content-addressed document store. */
  document_id: string | null;
  factor_count: number;
  imported_at: string;
  created_at: string;
};

/**
 * Target fields of the EF-import column mapping. Everything on
 * `emission_factor` except the derived identity columns (`source` comes from
 * the library name, `dataset_version` from the library version) and
 * `ghg_protocol_path` (internal taxonomy, not meaningful in user files).
 */
export type EfImportField =
  | 'factor_code'
  | 'name_zh'
  | 'name_en'
  | 'scope'
  | 'category'
  | 'year'
  | 'geography'
  | 'input_unit'
  | 'co2e_kg_per_unit'
  | 'ch4_kg_per_unit'
  | 'n2o_kg_per_unit'
  | 'hfc_kg_per_unit'
  | 'pfc_kg_per_unit'
  | 'sf6_kg_per_unit'
  | 'nf3_kg_per_unit'
  | 'biogenic_co2_factor'
  | 'gwp_basis'
  | 'description_zh'
  | 'description_en'
  | 'notes'
  | 'citation_url';

/**
 * Column mapping for an EF import: target field → 0-based column index in the
 * parsed header row. Absent key = field not mapped.
 */
export type EfImportMapping = Partial<Record<EfImportField, number>>;

/**
 * All mappable fields in canonical (template/display) order. Shared so the
 * renderer's mapping editor and the main-process validator agree on the
 * universe of fields.
 */
export const EF_IMPORT_FIELDS: readonly EfImportField[] = [
  'factor_code',
  'name_zh',
  'name_en',
  'scope',
  'category',
  'year',
  'geography',
  'input_unit',
  'co2e_kg_per_unit',
  'ch4_kg_per_unit',
  'n2o_kg_per_unit',
  'hfc_kg_per_unit',
  'pfc_kg_per_unit',
  'sf6_kg_per_unit',
  'nf3_kg_per_unit',
  'biogenic_co2_factor',
  'gwp_basis',
  'description_zh',
  'description_en',
  'notes',
  'citation_url',
];

/** Fields the import cannot proceed without a mapped column for. */
export const EF_IMPORT_REQUIRED_FIELDS: readonly EfImportField[] = [
  'scope',
  'year',
  'input_unit',
  'co2e_kg_per_unit',
];

/**
 * Locale-neutral issue codes for per-row import problems. The renderer maps
 * each code to a paraglide message (`ef_import_issue_<code>`), keeping
 * zh-CN/en parity structural instead of shipping main-process prose over IPC.
 * `detail` carries the short interpolation payload (the offending value or
 * the user's own column header) where one exists.
 */
export type EfImportIssueCode =
  | 'name_missing'
  | 'scope_missing'
  | 'scope_invalid'
  | 'year_missing'
  | 'year_invalid'
  | 'unit_missing'
  | 'co2e_missing'
  | 'value_invalid'
  | 'gwp_invalid'
  | 'duplicate_key'
  | 'category_empty'
  | 'unit_unknown';

/** File-level parse failure codes (same renderer-side mapping approach). */
export type EfImportFileErrorCode =
  | 'file_empty'
  | 'file_too_large'
  | 'too_many_rows'
  | 'xlsx_invalid'
  | 'unsupported_file_type'
  | 'file_read_failed';

/** Wire shape for a file-level import failure (`ef-library:pick-file`). */
export type EfImportFileError = {
  _tag: 'EfImportParseFailed';
  code: EfImportFileErrorCode;
  detail?: string;
};

/** One per-row problem, keyed by the 1-based row number in the user's file. */
export type EfImportRowIssue = { row: number; code: EfImportIssueCode; detail?: string };

/**
 * A normalized import row as it will land in `emission_factor`, minus the
 * two identity columns derived from the library (source, dataset_version).
 */
export type EfImportSampleRow = Omit<EmissionFactor, 'source' | 'dataset_version'>;

/**
 * Validation summary for a staged EF import. `errors` / `warnings` are capped
 * (the full counts stay in `error_count` / `warning_count`) so a pathological
 * 50k-row file can't flood the IPC payload.
 */
export type EfImportValidation = {
  total_rows: number;
  valid_count: number;
  error_count: number;
  warning_count: number;
  errors: EfImportRowIssue[];
  warnings: EfImportRowIssue[];
  /** First few normalized valid rows, for the preview pane. */
  sample: EfImportSampleRow[];
};

/** Result of `ef-library:pick-file` when a file was chosen and parsed. */
export type EfImportPreview = {
  /** Opaque handle to the staged parse; consumed by revalidate/import. */
  token: string;
  filename: string;
  headers: string[];
  total_rows: number;
  /** Auto-detected mapping (header aliases, zh + en). */
  mapping: EfImportMapping;
  /** Validation under the auto-detected mapping. */
  validation: EfImportValidation;
};

export type EfLibraryImportErrorTag =
  | 'TokenExpired'
  | 'NameExists'
  | 'InvalidName'
  | 'NothingToImport';

export type EfLibraryImportResult =
  | {
      ok: true;
      library: UserEfLibrary;
      imported_count: number;
      skipped_count: number;
      replaced: boolean;
    }
  | { ok: false; error: { _tag: EfLibraryImportErrorTag } };

// ---------------------------------------------------------------------------
// Batch activity-data import (spec 2026-07-21-batch-activity-import)
// ---------------------------------------------------------------------------

/**
 * Target fields of the activity-import column mapping: what a consultant's
 * activity-data ledger can carry. The reporting period is a wizard-level
 * choice (one import = one period), never a column.
 */
export type ActivityImportField =
  | 'source_name'
  | 'description'
  | 'amount'
  | 'unit'
  | 'occurred_at_start'
  | 'occurred_at_end'
  | 'notes';

/** Column mapping: target field → 0-based column index. Absent = unmapped. */
export type ActivityImportMapping = Partial<Record<ActivityImportField, number>>;

/** All mappable fields in canonical (display) order. */
export const ACTIVITY_IMPORT_FIELDS: readonly ActivityImportField[] = [
  'source_name',
  'description',
  'amount',
  'unit',
  'occurred_at_start',
  'occurred_at_end',
  'notes',
];

/** Fields the import cannot proceed without a mapped column for. */
export const ACTIVITY_IMPORT_REQUIRED_FIELDS: readonly ActivityImportField[] = [
  'source_name',
  'description',
  'amount',
  'unit',
];

/**
 * Locale-neutral issue codes (renderer maps each to a paraglide message
 * `activity_import_issue_<code>` — same structural i18n approach as the EF
 * import). The first six are errors (row skipped at import); the rest are
 * warnings and never block. `unit_dimension_mismatch` is special: it is
 * raised at the group-confirm step, where an EF whose unit family differs
 * from the group's without a fuel binding cannot produce a number at all,
 * so that confirm is refused rather than warned.
 */
export type ActivityImportIssueCode =
  | 'source_name_missing'
  | 'description_missing'
  | 'amount_missing'
  | 'amount_invalid'
  | 'unit_missing'
  | 'date_invalid'
  | 'date_range_invalid'
  | 'period_mismatch'
  | 'duplicate_in_file'
  | 'duplicate_in_db'
  | 'unit_dimension_mismatch'
  | 'amount_outlier';

/** One per-row problem, keyed by the 1-based row number in the user's file. */
export type ActivityImportRowIssue = {
  row: number;
  code: ActivityImportIssueCode;
  detail?: string;
};

/**
 * A normalized valid row. Dates are ISO `YYYY-MM-DD`; null means the column
 * was absent/empty and the row inherits the reporting period's bounds.
 */
export type ActivityImportRow = {
  row: number;
  source_name: string;
  description: string;
  amount: number;
  unit: string;
  occurred_at_start: string | null;
  occurred_at_end: string | null;
  notes: string | null;
};

/** Validation summary (issue lists capped, full counts preserved). */
export type ActivityImportValidation = {
  total_rows: number;
  valid_count: number;
  error_count: number;
  warning_count: number;
  errors: ActivityImportRowIssue[];
  warnings: ActivityImportRowIssue[];
  /** First few normalized valid rows, for the preview pane. */
  sample: ActivityImportRow[];
};

/**
 * Result of `activity-import:pick-file`. File-level parse failures reuse
 * `EfImportFileError` — both wizards share the same parser.
 */
export type ActivityImportPreview = {
  /** Opaque handle to the staged parse; consumed by the later steps. */
  token: string;
  filename: string;
  headers: string[];
  total_rows: number;
  mapping: ActivityImportMapping;
  validation: ActivityImportValidation;
};

/** Per distinct source_name value: match state against existing sources. */
export type ActivityImportSourceStatus = {
  name: string;
  row_count: number;
  /** Auto-match against existing emission_source names (normalized exact). */
  matched_source_id: string | null;
  /** User-confirmed target (prefilled from the auto-match). */
  resolved_source_id: string | null;
};

/** The user's EF pick for a group — the 5 identity columns that get pinned. */
export type ActivityImportEfChoice = {
  factor_code: string;
  year: number;
  source: string;
  geography: string;
  dataset_version: string;
};

export type ActivityImportGroupStatus = 'pending' | 'confirmed' | 'skipped';

/**
 * A confirm-unit of the wizard: rows sharing (normalized description, unit,
 * resolved source). One human EF decision per group, applied to every row —
 * the group is how "every number is human-confirmed" survives 5k-row files.
 */
export type ActivityImportGroup = {
  key: string;
  description: string;
  unit: string;
  source_id: string;
  source_name: string;
  row_count: number;
  amount_total: number;
  status: ActivityImportGroupStatus;
  ef: ActivityImportEfChoice | null;
  fuel_code: string | null;
};

export type ActivityImportConfirmResult =
  | { ok: true }
  | {
      ok: false;
      error: 'TokenExpired' | 'GroupNotFound' | 'EfNotFound' | 'DimensionMismatch';
    };

/** Rows excluded from the final import, bucketed by why. */
export type ActivityImportSkippedSummary = {
  validation_errors: number;
  unresolved_sources: number;
  skipped_groups: number;
};

export type ActivityImportErrorTag =
  | 'TokenExpired'
  | 'PeriodMissing'
  | 'UnconfirmedGroups'
  | 'NothingToImport';

export type ActivityImportResult =
  | {
      ok: true;
      imported_count: number;
      skipped: ActivityImportSkippedSummary;
      /** Post-import warnings: outliers, db duplicates, period mismatches. */
      warnings: ActivityImportRowIssue[];
      warning_count: number;
      /** Content-addressed archive of the imported ledger file. */
      document_id: string;
    }
  | { ok: false; error: { _tag: ActivityImportErrorTag } };

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

/** Row shape mirroring the `activity_data` table. See migration 004 + 017. */
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
  /**
   * Set when the activity row was materialized from a supplier-disclosure
   * answer. References the inbound `question.id`; null for OCR-derived
   * and hand-typed rows. See migration 017.
   */
  inbound_question_id: string | null;
  /** Which inbound tier supplied the value (1 = PCF, 2 = allocated). */
  inbound_tier: Tier | null;
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
  /** When the row was ingested from an inbound supplier disclosure, the
   * questionnaire id (for deep-linking back) + supplier name. NULL otherwise. */
  inbound_questionnaire_id: string | null;
  inbound_supplier_name: string | null;
  /** 1 when the row came from a batch ledger import (evidence link onto a
   * doc_type='activity_import' document); SQLite EXISTS yields 0/1. */
  from_ledger_import: 0 | 1;
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
// AI provider config — pi-ai-shaped, flat schema (Item 3 Task 11)
// ---------------------------------------------------------------------------
//
// Single flat shape: provider name + model name + optional baseUrl. The
// keychain key for the API key is derived deterministically from `provider`
// via {@link apiKeyKeyrefForProvider} rather than carried as a field — pi-ai
// supports 32+ providers and minting a literal per provider would balloon
// the type without buying validation strength.
//
// The plaintext API key itself never lives on this config object: it stays
// in the OS keychain, behind `CredentialService`. SettingsService strips
// any V1-shape `apiKeyKeyref`/`resourceName`/`apiVersion`/`name` fields a
// stale renderer might still send (see `migrateProviderConfig` for the
// on-disk legacy-data path).
//
// The `V2` suffix is a transition marker held over from Tasks 3-10b; the
// rename to canonical `providerConfig`/`ProviderConfig` is deferred (the
// rename touches >20 files and is cosmetic — see Task 11 plan).
export const providerConfigV2 = z.object({
  /** pi-ai provider id — free-form string. Common: deepseek / anthropic / openai / kimi-coding / qwen / zhipu / azure / ... */
  provider: z.string().min(1),
  /** Model id within the provider. */
  model: z.string().min(1),
  /** Override base URL — required for openai-compat-style providers + self-hosted. */
  baseUrl: z.string().url().optional(),
});
export type ProviderConfigV2 = z.infer<typeof providerConfigV2>;

/** Derive the keychain key for a provider's API key. Stable across providers. */
export function apiKeyKeyrefForProvider(provider: string): string {
  return `llm.${provider}.apikey`;
}

// ---------------------------------------------------------------------------
// Provider catalog (Item 3 Task 10c — runtime catalog from pi-ai)
// ---------------------------------------------------------------------------
//
// The renderer no longer hardcodes provider/model lists. The main process
// reads pi-ai's catalog at runtime via `getProviders()` / `getModels()` and
// returns a JSON-friendly slice over IPC. Only a subset of pi-ai's `Model`
// fields are forwarded — `compat`, `headers`, `thinkingLevelMap`, and the
// `cacheRead`/`cacheWrite` cost fields are diagnostic for the runtime and
// add no UI value.
//
// `api` is forwarded for the renderer's diagnostic surface but is not
// user-shown. `input` covers the modalities the model accepts ('text',
// 'image' — pi-ai may add 'audio' later; we keep the type narrow until that
// happens to surface a TS error when it does).

/**
 * JSON-serializable slice of pi-ai's `Model<TApi>` shape, ferried over IPC
 * to drive the renderer's Provider + Model pickers. Costs are USD per 1M
 * tokens (matching pi-ai's `model.cost.{input,output}` semantics); both
 * are 0 for free models.
 */
export interface ProviderCatalogModel {
  id: string;
  name: string;
  /** pi-ai's API protocol slug — surfaced for power-user diagnostics. */
  api: string;
  /** Modalities the model accepts on input. Most are single-element ['text']. */
  input: ('text' | 'image')[];
  /** True if the model has a "thinking" / reasoning mode. */
  reasoning: boolean;
  /** USD per 1M input tokens. */
  costInput: number;
  /** USD per 1M output tokens. */
  costOutput: number;
  contextWindow: number;
  maxTokens: number;
}

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
// Batch extraction queue (spec 2026-07-22-batch-extraction-queue)
// ---------------------------------------------------------------------------

/** One document the batch could not bring to review_needed. */
export type BatchExtractionFailure = {
  document_id: string;
  filename: string;
  /** classify_failed = the service's soft failure; error = thrown. */
  reason: 'classify_failed' | 'error';
  detail?: string;
};

/**
 * Live progress of the (single) in-flight batch. Pushed on
 * `extraction:batch-progress` after every completed document and readable
 * via `extraction:batch-status` for hydration on mount. `running: false`
 * marks the terminal event of a batch (finished or canceled).
 */
export type BatchExtractionProgress = {
  total: number;
  /** Completed (ok + failed). Cancel skips the rest: done can end < total. */
  done: number;
  ok_count: number;
  failed_count: number;
  running: boolean;
  canceled: boolean;
  /** Documents currently being classified/extracted (≤ concurrency). */
  current_document_ids: string[];
  /** Capped list — the full count stays in failed_count. */
  failed: BatchExtractionFailure[];
};

export type BatchExtractionStartResult =
  | { ok: true; total: number }
  | { ok: false; error: { _tag: 'BatchAlreadyRunning' | 'NothingToRun' } };

// ---------------------------------------------------------------------------
// Client workspaces / 账套 (spec 2026-07-22-client-workspaces)
// ---------------------------------------------------------------------------

/**
 * One client workspace = one standalone SQLite file under userData. `file`
 * is always a bare basename (never a path) — the registry can't be steered
 * outside the userData directory.
 */
export type Workspace = {
  id: string;
  name: string;
  file: string;
  created_at: string;
};

/** Shape of `<userData>/workspaces.json` — lives outside every workspace DB. */
export type WorkspaceRegistry = {
  version: 1;
  workspaces: Workspace[];
  active_id: string;
};

// ---------------------------------------------------------------------------
// EF Matcher types (Phase 1c Task 5)
// ---------------------------------------------------------------------------

/** Input to EfMatcherService.recommend(): identifies the extraction + source. */
export type RecommendQuery = {
  extraction_id: string;
  emission_source_id: string;
};

/**
 * Input to EfMatcherService.recommendForText(): free text instead of an
 * extraction — the batch-import path, where the hint is a ledger group's
 * description + unit rather than a parsed document.
 */
export type TextRecommendQuery = {
  hint_text: string;
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
// Evidence attachments + lineage (audit-readiness — migration 018,
// spec docs/specs/2026-07-11-audit-evidence-lineage.md)
// ---------------------------------------------------------------------------

/**
 * Row shape mirroring the `evidence_attachment` table (migration 018).
 * Exactly one of `activity_data_id` / `answer_id` is non-null (DB CHECK).
 */
export type EvidenceAttachment = {
  id: string;
  activity_data_id: string | null;
  answer_id: string | null;
  document_id: string;
  note: string | null;
  created_at: string;
};

/** Attachment row joined with its backing `document` for display. */
export type EvidenceAttachmentWithDocument = EvidenceAttachment & {
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
};

/** Identifies the record an attachment hangs off. Exactly one key. */
export type EvidenceTargetRef = { activity_data_id: string } | { answer_id: string };

/**
 * The origin node of an activity row's lineage chain. Three provenance
 * states: OCR extraction (links back to the uploaded document), inbound
 * supplier disclosure (links back to the questionnaire), or hand-typed.
 */
export type LineageSourceNode =
  | { kind: 'document'; document_id: string; filename: string; extraction_id: string }
  | {
      kind: 'inbound';
      questionnaire_id: string;
      supplier_name: string | null;
      question_id: string;
      tier: Tier | null;
    }
  | { kind: 'manual' };

/** A downstream questionnaire answer sourced from this activity row. */
export type LineageAnswerRef = {
  answer_id: string;
  question_id: string;
  questionnaire_id: string;
  question_text: string;
  value: string;
  finalized_at: string | null;
};

/** A frozen calculation-snapshot line derived from this activity row. */
export type LineageSnapshotRef = {
  snapshot_id: string;
  frozen_at: string;
  revision: number;
};

/** End-to-end lineage for one activity_data row. */
export type ActivityLineage = {
  entity: 'activity_data';
  activity: ActivityData;
  source: LineageSourceNode;
  /** Null only if the pinned EF row is missing (should not happen — FK). */
  pinned_ef: PinnedEmissionFactor | null;
  emission_source_name: string;
  answers: LineageAnswerRef[];
  snapshots: LineageSnapshotRef[];
  evidence: EvidenceAttachmentWithDocument[];
};

/** End-to-end lineage for one questionnaire answer. */
export type AnswerLineage = {
  entity: 'answer';
  answer: Answer;
  question_text: string;
  questionnaire: {
    id: string;
    direction: 'outbound' | 'inbound';
    reporting_year: number;
    customer_name: string | null;
  };
  /** One level of upstream chain when source_kind = 'mapped_inventory'
   * points at an activity row; null for other source kinds. */
  source_activity: ActivityLineage | null;
  evidence: EvidenceAttachmentWithDocument[];
};

export type LineageResult = ActivityLineage | AnswerLineage;

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
