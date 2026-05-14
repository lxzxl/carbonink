import type {
  EfCompositePk,
  EfLookupQuery,
  EmissionFactor,
  PinnedEmissionFactor,
} from '@shared/types.js';
import { defaultNow, type ServiceContext } from './base.js';

/**
 * Phase 1a value for `pinned_emission_factor.pinned_from`. In Phase 1a both
 * the source `emission_factor` and the pinned copy live in `app.sqlite`, so
 * this is a constant. Phase 1c+ will switch the source to a read-only
 * `ef_library.sqlite` snapshot (per spec §2 architecture decision #5).
 */
const PINNED_FROM_PHASE_1A = 'app.sqlite';

const EF_COLUMNS = [
  'factor_code',
  'year',
  'source',
  'geography',
  'dataset_version',
  'scope',
  'category',
  'ghg_protocol_path',
  'input_unit',
  'co2e_kg_per_unit',
  'ch4_kg_per_unit',
  'n2o_kg_per_unit',
  'hfc_kg_per_unit',
  'pfc_kg_per_unit',
  'sf6_kg_per_unit',
  'nf3_kg_per_unit',
  'gwp_basis',
  'name_zh',
  'name_en',
  'description_zh',
  'description_en',
  'notes',
  'citation_url',
] as const;

const EF_SELECT = `SELECT ${EF_COLUMNS.join(', ')} FROM emission_factor`;

export class EfService {
  private readonly db: ServiceContext['db'];
  private readonly now: () => string;

  constructor(ctx: { db: ServiceContext['db']; now?: () => string }) {
    this.db = ctx.db;
    this.now = ctx.now ?? defaultNow;
  }

  /**
   * Lookup emission factors with optional filters. All provided filters are
   * AND-ed. Results are ordered by (factor_code, year DESC) for stable UX.
   */
  list(q: EfLookupQuery): EmissionFactor[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (q.factor_code !== undefined) {
      clauses.push('factor_code = ?');
      params.push(q.factor_code);
    }
    if (q.category !== undefined) {
      // Prefix-match: source categories are coarse (e.g. 'travel.air') while
      // catalog rows go finer ('travel.air.economy.shorthaul'). Match both
      // the exact category and any dotted descendant.
      clauses.push('(category = ? OR category LIKE ?)');
      params.push(q.category, `${q.category}.%`);
    }
    if (q.scope !== undefined) {
      clauses.push('scope = ?');
      params.push(q.scope);
    }
    if (q.geography !== undefined) {
      clauses.push('geography = ?');
      params.push(q.geography);
    }
    if (q.year !== undefined) {
      clauses.push('year = ?');
      params.push(q.year);
    }

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const sql = `${EF_SELECT}${where} ORDER BY factor_code ASC, year DESC`;
    return this.db.prepare(sql).all(...params) as EmissionFactor[];
  }

  /** Get a single emission factor by composite PK, or null. */
  get(pk: EfCompositePk): EmissionFactor | null {
    const row = this.db
      .prepare(
        `${EF_SELECT}
         WHERE factor_code = ? AND year = ? AND source = ?
           AND geography = ? AND dataset_version = ?`,
      )
      .get(pk.factor_code, pk.year, pk.source, pk.geography, pk.dataset_version) as
      | EmissionFactor
      | undefined;
    return row ?? null;
  }

  /**
   * Pin an emission factor to `pinned_emission_factor` by copying the row
   * from `emission_factor`. Idempotent on composite PK: a second call with
   * the same PK returns the existing pinned row unchanged (pinned_at
   * preserved). Throws if the source EF does not exist.
   */
  pin(pk: EfCompositePk): PinnedEmissionFactor {
    const ts = this.now();
    const tx = this.db.transaction((): PinnedEmissionFactor => {
      const existing = this.getPinned(pk);
      if (existing) return existing;

      const source = this.get(pk);
      if (!source) {
        throw new Error(
          `Cannot pin: emission_factor not found for PK ` +
            `${pk.factor_code}/${pk.year}/${pk.source}/${pk.geography}/${pk.dataset_version}`,
        );
      }

      // INSERT OR IGNORE: belt-and-suspenders alongside the existence check
      // above. If a concurrent pin won the race (extremely unlikely with
      // better-sqlite3's synchronous single-writer model, but cheap insurance),
      // the IGNORE means we just fall through to the SELECT below.
      this.db
        .prepare(
          `INSERT OR IGNORE INTO pinned_emission_factor (
            factor_code, year, source, geography, dataset_version,
            scope, category, ghg_protocol_path, input_unit,
            co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
            hfc_kg_per_unit, pfc_kg_per_unit, sf6_kg_per_unit, nf3_kg_per_unit,
            gwp_basis, name_zh, name_en, description_zh, description_en,
            citation_url, pinned_at, pinned_from
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?
          )`,
        )
        .run(
          source.factor_code,
          source.year,
          source.source,
          source.geography,
          source.dataset_version,
          source.scope,
          source.category,
          source.ghg_protocol_path,
          source.input_unit,
          source.co2e_kg_per_unit,
          source.ch4_kg_per_unit,
          source.n2o_kg_per_unit,
          source.hfc_kg_per_unit,
          source.pfc_kg_per_unit,
          source.sf6_kg_per_unit,
          source.nf3_kg_per_unit,
          source.gwp_basis,
          source.name_zh,
          source.name_en,
          source.description_zh,
          source.description_en,
          source.citation_url,
          ts,
          PINNED_FROM_PHASE_1A,
        );

      const pinned = this.getPinned(pk);
      if (!pinned) {
        // Defensive: the INSERT above must have produced a row.
        throw new Error('pin: failed to read back pinned_emission_factor after insert');
      }
      return pinned;
    });
    return tx();
  }

  private getPinned(pk: EfCompositePk): PinnedEmissionFactor | null {
    const row = this.db
      .prepare(
        `SELECT factor_code, year, source, geography, dataset_version,
                scope, category, ghg_protocol_path, input_unit,
                co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit,
                hfc_kg_per_unit, pfc_kg_per_unit, sf6_kg_per_unit, nf3_kg_per_unit,
                gwp_basis, name_zh, name_en, description_zh, description_en,
                citation_url, pinned_at, pinned_from
         FROM pinned_emission_factor
         WHERE factor_code = ? AND year = ? AND source = ?
           AND geography = ? AND dataset_version = ?`,
      )
      .get(pk.factor_code, pk.year, pk.source, pk.geography, pk.dataset_version) as
      | PinnedEmissionFactor
      | undefined;
    return row ?? null;
  }
}
