import type {
  ActivityData,
  ActivityDataCreateInput,
  ActivityDataWithDocument,
  ActivityDataWithEf,
  EfCompositePk,
  PinnedEmissionFactor,
} from '@shared/types.js';
import { activityDataCreateInput } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';
import type { CalculationService } from './calculation-service.js';
import type { EfService } from './ef-service.js';
import type { UnitConversionService } from './unit-conversion-service.js';

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
  private readonly unitConversionService: UnitConversionService;

  constructor(
    ctx: ServiceContext & {
      efService: EfService;
      calculationService: CalculationService;
      unitConversionService: UnitConversionService;
    },
  ) {
    this.db = ctx.db;
    this.now = ctx.now;
    this.efService = ctx.efService;
    this.calculationService = ctx.calculationService;
    this.unitConversionService = ctx.unitConversionService;
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
          // extraction_id wires the activity row back to the extraction
          // it was confirmed from (set by ExtractionReview via the
          // ActivityForm's matcherHint). NULL for hand-typed entries.
          parsed.extraction_id ?? null,
          parsed.notes ?? null,
          ts,
          ts,
        );

      // 6. Audit: creation event (audit-readiness spec 2026-07-11). Payload
      // is ids + numbers only — `notes` free text stays out by design.
      this.writeAudit('activity_data.created', ts, {
        activity_id: id,
        site_id: sourceRow.site_id,
        emission_source_id: parsed.emission_source_id,
        reporting_period_id: parsed.reporting_period_id,
        amount: parsed.amount,
        unit: parsed.unit,
        ef: efPk,
        computed_co2e_kg: computed.co2e_kg,
        provenance: parsed.extraction_id ? 'extraction' : 'manual',
        extraction_id: parsed.extraction_id ?? null,
      });

      return this.getById(id)!;
    });

    return tx();
  }

  /**
   * Append one audit_event row. Payload discipline (see
   * answer-generation/audit.ts): ids, counts, EF tuples, computed numbers —
   * never free text (`notes`) or prompt content.
   */
  private writeAudit(kind: string, ts: string, payload: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)')
      .run(newId(), kind, JSON.stringify(payload), ts);
  }

  /** Lookup a single activity_data by id, or null. */
  getById(id: string): ActivityData | null {
    const row = this.db.prepare(`${AD_SELECT} WHERE id = ?`).get(id) as ActivityData | undefined;
    return row ?? null;
  }

  /**
   * All activity_data for a reporting period, oldest occurrence first.
   * Order is by `occurred_at_start` (matches dashboard / table reading
   * order); `id` is the tiebreaker so the sort is stable.
   *
   * Returns rows enriched with their source document (when present) via
   * LEFT JOINs through `extraction.document_id` → `document.filename`.
   * Both joined fields are NULL for hand-typed activities that have no
   * `extraction_id`. Done as one query (not N+1) because the /activities
   * card uses these fields to render "来自文档 X" links.
   */
  listByPeriod(periodId: string): ActivityDataWithDocument[] {
    const cols = AD_COLUMNS.map((c) => `ad.${c}`).join(', ');
    // Two provenance chains are surfaced per row:
    //   - OCR: extraction_id → extraction → document  (source_document_*)
    //   - Inbound: inbound_question_id → question → questionnaire → customer
    //     (inbound_questionnaire_id + inbound_supplier_name)
    // A row carries at most one (they're mutually exclusive in practice),
    // both LEFT-joined so hand-typed rows stay NULL on both.
    return this.db
      .prepare(
        `SELECT ${cols},
                e.document_id AS source_document_id,
                d.filename    AS source_document_filename,
                iq.questionnaire_id AS inbound_questionnaire_id,
                ic.name             AS inbound_supplier_name
           FROM activity_data ad
           LEFT JOIN extraction e   ON e.id = ad.extraction_id
           LEFT JOIN document   d   ON d.id = e.document_id
           LEFT JOIN question   iq  ON iq.id = ad.inbound_question_id
           LEFT JOIN questionnaire iqn ON iqn.id = iq.questionnaire_id
           LEFT JOIN customer   ic  ON ic.id = iqn.customer_id
          WHERE ad.reporting_period_id = ?
          ORDER BY ad.occurred_at_start ASC, ad.id ASC`,
      )
      .all(periodId) as ActivityDataWithDocument[];
  }

  /**
   * Reverse lookup: given an extraction id, return the activity row
   * that was confirmed from it (or null). Used by ExtractionReview's
   * "already confirmed" panel to deep-link to the activity instead of
   * dropping the user on a flat list.
   *
   * Returns at most one row: a single extraction can only be confirmed
   * once (UI prevents the second pass; even if it slipped through,
   * we'd want the most recent so `ORDER BY created_at DESC LIMIT 1`).
   */
  findByExtractionId(extractionId: string): ActivityData | null {
    const row = this.db
      .prepare(`${AD_SELECT} WHERE extraction_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(extractionId) as ActivityData | undefined;
    return row ?? null;
  }

  /** All activity_data for an emission source, same ordering as `listByPeriod`. */
  listBySource(sourceId: string): ActivityData[] {
    return this.db
      .prepare(`${AD_SELECT} WHERE emission_source_id = ? ORDER BY occurred_at_start ASC, id ASC`)
      .all(sourceId) as ActivityData[];
  }

  /**
   * Flexible filtered listing for the answer-generation agent loop.
   *
   * Filters are all optional and AND-ed; `organization_id` is mandatory so the
   * tool layer can't accidentally leak rows across the (theoretical) tenant
   * boundary — in Phase 1a there's only ever one org per app instance, but
   * keeping the filter explicit costs nothing and matches the rest of the
   * org-scoped service surface.
   *
   * Joins:
   *   - `emission_source es`  — needed for `scope` filter + multi-tenant gate
   *     via `es.site_id → site.organization_id` (es itself has no org_id).
   *   - `reporting_period rp` — needed for `year` filter; FK already on
   *     activity_data so the join is cheap.
   *   - `site s`              — only joined when `organization_id` filter is
   *     active (always, in v1).
   *
   * Ordering: `occurred_at_start DESC, id DESC` so the most recent activities
   * come first — matches what a question-answering agent would want to scan.
   * `limit` defaults to 50 at the tool layer; the service caps at the caller-
   * supplied value (no implicit cap here so unit tests can read all rows).
   */
  list(filters: {
    organization_id: string;
    year?: number;
    scope?: 1 | 2 | 3;
    emission_source_id?: string;
    limit?: number;
  }): Array<{
    id: string;
    source_name: string;
    scope: 1 | 2 | 3;
    period_id: string;
    occurred_at_start: string;
    occurred_at_end: string;
    amount: number;
    unit: string;
    co2e_kg: number;
  }> {
    const clauses: string[] = ['s.organization_id = ?'];
    const params: unknown[] = [filters.organization_id];

    if (filters.year !== undefined) {
      clauses.push('rp.year = ?');
      params.push(filters.year);
    }
    if (filters.scope !== undefined) {
      clauses.push('es.scope = ?');
      params.push(filters.scope);
    }
    if (filters.emission_source_id !== undefined) {
      clauses.push('ad.emission_source_id = ?');
      params.push(filters.emission_source_id);
    }

    let sql = `SELECT ad.id              AS id,
                      es.name            AS source_name,
                      es.scope           AS scope,
                      ad.reporting_period_id AS period_id,
                      ad.occurred_at_start,
                      ad.occurred_at_end,
                      ad.amount,
                      ad.unit,
                      ad.computed_co2e_kg AS co2e_kg
                 FROM activity_data ad
                 JOIN emission_source es ON es.id = ad.emission_source_id
                 JOIN site s             ON s.id = es.site_id
                 JOIN reporting_period rp ON rp.id = ad.reporting_period_id
                WHERE ${clauses.join(' AND ')}
                ORDER BY ad.occurred_at_start DESC, ad.id DESC`;

    if (filters.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params) as Array<{
      id: string;
      source_name: string;
      scope: 1 | 2 | 3;
      period_id: string;
      occurred_at_start: string;
      occurred_at_end: string;
      amount: number;
      unit: string;
      co2e_kg: number;
    }>;
  }

  /**
   * Aggregate `computed_co2e_kg` over the same filter shape as `list`. Used by
   * the agent's `sum_co2e` tool — the agent can ask "what's the scope-1 total
   * for 2024?" without scanning every row.
   *
   * `COALESCE(SUM(...), 0)` so an empty filter set returns `{total_kg: 0,
   * count: 0}` rather than `null` — keeps the tool's return contract simple.
   */
  sumCo2e(filters: {
    organization_id: string;
    year?: number;
    scope?: 1 | 2 | 3;
    emission_source_id?: string;
  }): { total_kg: number; count: number } {
    const clauses: string[] = ['s.organization_id = ?'];
    const params: unknown[] = [filters.organization_id];

    if (filters.year !== undefined) {
      clauses.push('rp.year = ?');
      params.push(filters.year);
    }
    if (filters.scope !== undefined) {
      clauses.push('es.scope = ?');
      params.push(filters.scope);
    }
    if (filters.emission_source_id !== undefined) {
      clauses.push('ad.emission_source_id = ?');
      params.push(filters.emission_source_id);
    }

    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(ad.computed_co2e_kg), 0) AS total_kg,
                COUNT(*) AS count
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
           JOIN site s             ON s.id = es.site_id
           JOIN reporting_period rp ON rp.id = ad.reporting_period_id
          WHERE ${clauses.join(' AND ')}`,
      )
      .get(...params) as { total_kg: number; count: number };
    return row;
  }

  /**
   * Hard delete with reference check.
   *
   * `answer.source_activity_data_id` (FK in migration 005/014, no ON DELETE
   * clause → SQLite default NO ACTION) is populated whenever a
   * questionnaire answer was sourced from `mapped_inventory`. Without this
   * check, the raw `DELETE` would surface as an opaque
   * `SQLITE_CONSTRAINT_FOREIGNKEY` IPC error.
   *
   * Why not `ON DELETE SET NULL`? The `answer` CHECK constraint requires
   * `source_kind = 'mapped_inventory'` to have **exactly one** source FK
   * non-null, so nulling the FK would re-violate the CHECK and the
   * DELETE would still fail — just with a different opaque error.
   *
   * Why not soft-delete (`is_active` column)? Heavier migration than the
   * problem warrants. Most users don't delete activities; those who do
   * can detach the questionnaire references first. Revisit if a real
   * UX appears for "detach + cascade".
   *
   * `calculation_snapshot_line.original_activity_data_id` (migration 004)
   * is intentionally NOT a real FK — snapshots outlive deleted activities
   * by design — so it doesn't constrain this either.
   */
  delete(id: string): void {
    const refs = this.db
      .prepare(`SELECT COUNT(*) AS c FROM answer WHERE source_activity_data_id = ?`)
      .get(id) as { c: number };
    if (refs.c > 0) {
      throw new Error(
        `activity_data ${id} is referenced by ${refs.c} questionnaire answer(s) — detach the answer's data source before deleting`,
      );
    }
    const row = this.getById(id);
    if (!row) return; // match the historical silent no-op on unknown ids

    const tx = this.db.transaction(() => {
      // Evidence links are cleaned up explicitly (their FK is NO ACTION by
      // design — see migration 018 header); backing documents stay.
      const evidence = this.db
        .prepare('DELETE FROM evidence_attachment WHERE activity_data_id = ?')
        .run(id);
      this.db.prepare('DELETE FROM activity_data WHERE id = ?').run(id);
      this.writeAudit('activity_data.deleted', this.now(), {
        activity_id: id,
        emission_source_id: row.emission_source_id,
        reporting_period_id: row.reporting_period_id,
        amount: row.amount,
        unit: row.unit,
        computed_co2e_kg: row.computed_co2e_kg,
        evidence_removed_count: evidence.changes,
      });
    });
    tx();
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

  /**
   * Rebind the pinned EF on an existing activity. Recomputes co2e_kg
   * (with same-family unit conversion if needed) and writes an audit_event
   * row capturing the change. Returns a discriminated-union result —
   * the IPC layer surfaces the error variants without throwing.
   *
   * `override_amount` is the cross-family escape hatch. When the new EF's
   * input_unit is in a different unit family than the current activity's
   * unit (e.g. m³ vs. kWh for natural gas — the conversion requires a
   * heating-value assumption that varies by gas composition and that the
   * system cannot safely fabricate), the caller (UI) collects the new
   * amount from the user and passes it here. With override_amount set,
   * we bypass the unit-conversion step entirely and write the value as-is.
   */
  rebindEf(input: { activity_id: string; new_ef_pk: EfCompositePk; override_amount?: number }):
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
    | { ok: false; error: { _tag: 'NotFound' | 'EfNotFound' | 'UnitMismatch'; message: string } } {
    // 1. Load current activity.
    const current = this.db.prepare(`${AD_SELECT} WHERE id = ?`).get(input.activity_id) as
      | ActivityData
      | undefined;
    if (!current) {
      return {
        ok: false,
        error: { _tag: 'NotFound', message: `activity_data not found: ${input.activity_id}` },
      };
    }

    // 2. Validate the new EF exists in emission_factor.
    const efRow = this.db
      .prepare(
        `SELECT input_unit, co2e_kg_per_unit FROM emission_factor
          WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
      )
      .get(
        input.new_ef_pk.factor_code,
        input.new_ef_pk.year,
        input.new_ef_pk.source,
        input.new_ef_pk.geography,
        input.new_ef_pk.dataset_version,
      ) as { input_unit: string; co2e_kg_per_unit: number } | undefined;
    if (!efRow) {
      return {
        ok: false,
        error: {
          _tag: 'EfNotFound',
          message: `emission_factor not found for PK ${JSON.stringify(input.new_ef_pk)}`,
        },
      };
    }

    // 3. Resolve the new amount.
    //   (a) override_amount provided → trust caller, skip conversion entirely.
    //   (b) units match exactly → identity.
    //   (c) same-family auto-convert via UnitConversionService.
    //   (d) cross-family without override → UnitMismatch (UI prompts user to supply override).
    let newAmount: number;
    if (input.override_amount !== undefined) {
      newAmount = input.override_amount;
    } else if (current.unit === efRow.input_unit) {
      newAmount = current.amount;
    } else {
      try {
        newAmount = this.unitConversionService.convert(
          current.amount,
          current.unit,
          efRow.input_unit,
        );
      } catch {
        return {
          ok: false,
          error: {
            _tag: 'UnitMismatch',
            message: `Cannot convert ${current.unit} → ${efRow.input_unit} without fuel binding`,
          },
        };
      }
    }

    // 4. Compute new co2e.
    const newCo2eKg = newAmount * efRow.co2e_kg_per_unit;
    const old_co2e_kg = current.computed_co2e_kg;
    const old_amount = current.amount;
    const old_unit = current.unit;
    const old_ef_pk: EfCompositePk = {
      factor_code: current.ef_factor_code,
      year: current.ef_year,
      source: current.ef_source,
      geography: current.ef_geography,
      dataset_version: current.ef_dataset_version,
    };

    // 5. Transaction: pin (idempotent via INSERT OR IGNORE inside EfService.pin)
    //    + UPDATE activity_data + INSERT audit_event.
    const now = this.now();
    this.db.transaction(() => {
      this.efService.pin(input.new_ef_pk);
      this.db
        .prepare(
          `UPDATE activity_data
              SET ef_factor_code = ?, ef_year = ?, ef_source = ?, ef_geography = ?, ef_dataset_version = ?,
                  amount = ?, unit = ?,
                  computed_co2e_kg = ?, computed_at = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(
          input.new_ef_pk.factor_code,
          input.new_ef_pk.year,
          input.new_ef_pk.source,
          input.new_ef_pk.geography,
          input.new_ef_pk.dataset_version,
          newAmount,
          efRow.input_unit,
          newCo2eKg,
          now,
          now,
          input.activity_id,
        );
      this.writeAudit('activity_rebind_ef', now, {
        activity_id: input.activity_id,
        old_ef: old_ef_pk,
        new_ef: input.new_ef_pk,
        old_amount,
        old_unit,
        old_computed_co2e_kg: old_co2e_kg,
        new_amount: newAmount,
        new_unit: efRow.input_unit,
        new_computed_co2e_kg: newCo2eKg,
      });
    })();

    const updated = this.db
      .prepare(`${AD_SELECT} WHERE id = ?`)
      .get(input.activity_id) as ActivityData;

    return {
      ok: true,
      updated,
      old_co2e_kg,
      new_co2e_kg: newCo2eKg,
      old_amount,
      old_unit,
      new_amount: newAmount,
      new_unit: efRow.input_unit,
    };
  }

  /** Read activity with the currently-pinned EF joined in. Null if not found. */
  getByIdWithEf(id: string): ActivityDataWithEf | null {
    const ad = this.db.prepare(`${AD_SELECT} WHERE id = ?`).get(id) as ActivityData | undefined;
    if (!ad) return null;
    const pinned = this.db
      .prepare(
        `SELECT * FROM pinned_emission_factor
          WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
      )
      .get(ad.ef_factor_code, ad.ef_year, ad.ef_source, ad.ef_geography, ad.ef_dataset_version) as
      | PinnedEmissionFactor
      | undefined;
    if (!pinned) return null;
    return { ...ad, pinned_ef: pinned };
  }
}
