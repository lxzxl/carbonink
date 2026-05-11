export * from './schemas/complete-onboarding.js';
export * from './schemas/organization.js';
export * from './schemas/reporting-period.js';
export * from './schemas/site.js';

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
