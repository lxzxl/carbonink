import type { ActivityData, ActivityDataCreateInput, EfCompositePk } from '@shared/types.js';
import { activityDataCreateInput } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';
import type { CalculationService } from './calculation-service.js';
import type { EfService } from './ef-service.js';

/**
 * Explicit column list mirrors `EmissionSourceService` style. activity_data
 * has no INTEGER-as-boolean columns today (see migration 004), so the SELECT
 * is a pure pass-through — listed explicitly so a future column addition
 * needing post-processing is obvious at the call site.
 */
const AD_COLUMNS = [
  'id',
  'site_id',
  'emission_source_id',
  'reporting_period_id',
  'occurred_at_start',
  'occurred_at_end',
  'amount',
  'unit',
  'ef_factor_code',
  'ef_year',
  'ef_source',
  'ef_geography',
  'ef_dataset_version',
  'computed_co2e_kg',
  'computed_at',
  'extraction_id',
  'notes',
  'created_at',
  'updated_at',
] as const;

const AD_SELECT = `SELECT ${AD_COLUMNS.join(', ')} FROM activity_data`;

/**
 * Phase 1a's keystone service. Composes:
 *   - EmissionSource lookup (validates source exists + is_active + harvests site_id)
 *   - EfService.pin (copies emission_factor → pinned_emission_factor)
 *   - CalculationService.compute (amount × EF → CO2e, applies UnitConversion)
 *   - activity_data row insert
 *
 * The four steps run in a single `db.transaction(...)`, so any failure rolls
 * back the pin together with the failed insert — leaving zero side effects on
 * an error path (verified by the test "throws when emission_source_id does
 * not exist; leaves no pinned EF behind"). better-sqlite3 transactions are
 * synchronous and re-entrant, so nesting inside EfService.pin's own
 * transaction is safe (inner BEGIN becomes a SAVEPOINT).
 */
export class ActivityDataService {
  private readonly db: ServiceContext['db'];
  private readonly now: () => string;
  private readonly efService: EfService;
  private readonly calculationService: CalculationService;

  constructor(
    ctx: ServiceContext & {
      efService: EfService;
      calculationService: CalculationService;
    },
  ) {
    this.db = ctx.db;
    this.now = ctx.now;
    this.efService = ctx.efService;
    this.calculationService = ctx.calculationService;
  }

  /**
   * Single-transaction pin + compute + insert. Errors thrown at any step
   * (missing source, deactivated source, missing EF, dimension mismatch) abort
   * the transaction so neither `pinned_emission_factor` nor `activity_data`
   * accumulates partial state.
   */
  create(input: ActivityDataCreateInput): ActivityData {
    const parsed = activityDataCreateInput.parse(input);

    const efPk: EfCompositePk = {
      factor_code: parsed.ef_factor_code,
      year: parsed.ef_year,
      source: parsed.ef_source,
      geography: parsed.ef_geography,
      dataset_version: parsed.ef_dataset_version,
    };

    const ts = this.now();

    const tx = this.db.transaction((): ActivityData => {
      // 1. Look up source → site_id + is_active gate.
      const sourceRow = this.db
        .prepare('SELECT id, site_id, is_active FROM emission_source WHERE id = ?')
        .get(parsed.emission_source_id) as
        | { id: string; site_id: string; is_active: number }
        | undefined;
      if (!sourceRow) {
        throw new Error(`emission_source not found: ${parsed.emission_source_id}`);
      }
      if (sourceRow.is_active !== 1) {
        throw new Error(`emission_source is inactive (is_active=0): ${parsed.emission_source_id}`);
      }

      // 2. Validate EF exists upfront. (EfService.pin also checks, but pulling
      // it forward yields a clearer error message — and matches the test
      // expectation /emission_factor not found/.)
      const efRow = this.efService.get(efPk);
      if (!efRow) {
        throw new Error(
          `emission_factor not found for PK ` +
            `${efPk.factor_code}/${efPk.year}/${efPk.source}/${efPk.geography}/${efPk.dataset_version}`,
        );
      }

      // 3. Pin EF (idempotent on composite PK).
      const pinned = this.efService.pin(efPk);

      // 4. Compute CO2e. fuelCode is optional and lives in the schema as
      // optionalString — undefined when omitted, which CalculationService
      // already handles via its `fuelCode !== undefined` branch.
      const computed = this.calculationService.compute({
        amount: parsed.amount,
        unit: parsed.unit,
        ef: pinned,
        ...(parsed.fuel_code !== undefined ? { fuelCode: parsed.fuel_code } : {}),
      });

      // 5. INSERT activity_data.
      const id = newId();
      this.db
        .prepare(
          `INSERT INTO activity_data (
            id, site_id, emission_source_id, reporting_period_id,
            occurred_at_start, occurred_at_end,
            amount, unit,
            ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
            computed_co2e_kg, computed_at,
            extraction_id, notes, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?
          )`,
        )
        .run(
          id,
          sourceRow.site_id,
          parsed.emission_source_id,
          parsed.reporting_period_id,
          parsed.occurred_at_start,
          parsed.occurred_at_end,
          parsed.amount,
          parsed.unit,
          parsed.ef_factor_code,
          parsed.ef_year,
          parsed.ef_source,
          parsed.ef_geography,
          parsed.ef_dataset_version,
          computed.co2e_kg,
          ts,
          null, // extraction_id: NULL for manual entries (Phase 1a path)
          parsed.notes ?? null,
          ts,
          ts,
        );

      return this.getById(id)!;
    });

    return tx();
  }

  /** Lookup a single activity_data by id, or null. */
  getById(id: string): ActivityData | null {
    const row = this.db.prepare(`${AD_SELECT} WHERE id = ?`).get(id) as ActivityData | undefined;
    return row ?? null;
  }

  /**
   * All activity_data for a reporting period, oldest occurrence first. Order
   * is by `occurred_at_start` (matches dashboard / table reading order); `id`
   * is the tiebreaker so the sort is stable.
   */
  listByPeriod(periodId: string): ActivityData[] {
    return this.db
      .prepare(`${AD_SELECT} WHERE reporting_period_id = ? ORDER BY occurred_at_start ASC, id ASC`)
      .all(periodId) as ActivityData[];
  }

  /** All activity_data for an emission source, same ordering as `listByPeriod`. */
  listBySource(sourceId: string): ActivityData[] {
    return this.db
      .prepare(`${AD_SELECT} WHERE emission_source_id = ? ORDER BY occurred_at_start ASC, id ASC`)
      .all(sourceId) as ActivityData[];
  }

  /**
   * Hard delete. Phase 1a: safe because `answer.source_activity_data_id`
   * (FK declared in migration 005, no ON DELETE clause) is only populated
   * in Phase 1b+. Until then, no row references activity_data and the
   * DELETE always succeeds. `calculation_snapshot_line.original_activity_data_id`
   * (migration 004) is intentionally not a real FK — snapshots are designed
   * to outlive deleted activities — so it doesn't constrain this either.
   *
   * Phase 1b TODO: once `answer` rows can reference activities, pick one:
   *   (a) switch to soft-delete (add is_active column to activity_data), or
   *   (b) change the FK to `ON DELETE SET NULL` in migration 005, or
   *   (c) explicitly cascade or block deletes in this service.
   * Whichever is chosen needs a service-layer test asserting the new semantics.
   */
  delete(id: string): void {
    this.db.prepare('DELETE FROM activity_data WHERE id = ?').run(id);
  }

  /**
   * Period-level CO2e totals split by scope. Implemented as a single SQL
   * aggregate (not JS sum) so it scales when periods carry thousands of
   * activity rows. `COALESCE(...)` guarantees zeros (not NULL) on empty
   * periods — the renderer can render the row unconditionally.
   *
   * scope is read off `emission_source` (the canonical owner), not duplicated
   * onto activity_data, so a future scope correction on a source flows through
   * to dashboards without a backfill.
   */
  totalsByPeriod(periodId: string): {
    total_co2e_kg: number;
    scope1_kg: number;
    scope2_kg: number;
    scope3_kg: number;
  } {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(ad.computed_co2e_kg), 0) AS total_co2e_kg,
           COALESCE(SUM(CASE WHEN es.scope = 1 THEN ad.computed_co2e_kg ELSE 0 END), 0) AS scope1_kg,
           COALESCE(SUM(CASE WHEN es.scope = 2 THEN ad.computed_co2e_kg ELSE 0 END), 0) AS scope2_kg,
           COALESCE(SUM(CASE WHEN es.scope = 3 THEN ad.computed_co2e_kg ELSE 0 END), 0) AS scope3_kg
         FROM activity_data ad
         JOIN emission_source es ON ad.emission_source_id = es.id
         WHERE ad.reporting_period_id = ?`,
      )
      .get(periodId) as {
      total_co2e_kg: number;
      scope1_kg: number;
      scope2_kg: number;
      scope3_kg: number;
    };
    return row;
  }
}
