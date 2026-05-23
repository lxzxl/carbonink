import type {
  EmissionSource,
  EmissionSourceCreateInput,
  EmissionSourceUpdateInput,
} from '@shared/types.js';
import { emissionSourceCreateInput, emissionSourceUpdateInput } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';

/**
 * SELECT列表 — 显式列出每列以便在 mapRow 里精确处理 INTEGER→boolean 的
 * `is_active` 映射。`SELECT *` 也能 work，但显式列举更稳定（migration 演进时
 * 不易踩到字段乱序之类的坑）。
 */
const ES_COLUMNS = [
  'id',
  'site_id',
  'name',
  'scope',
  'category',
  'ghg_protocol_path',
  'default_ef_query',
  'template_origin',
  'is_active',
] as const;

const ES_SELECT = `SELECT ${ES_COLUMNS.join(', ')} FROM emission_source`;

/** Raw row shape returned by better-sqlite3 (INTEGER for is_active). */
type EmissionSourceRow = Omit<EmissionSource, 'is_active'> & { is_active: number };

function mapRow(row: EmissionSourceRow | undefined): EmissionSource | null {
  if (!row) return null;
  return { ...row, is_active: row.is_active === 1 };
}

/**
 * CRUD for `emission_source`. Composite UNIQUE (id, site_id) is preserved at
 * the schema level (migration 004) so that `activity_data` can FK to
 * (emission_source_id, site_id) and enforce site consistency. Service code
 * doesn't need special handling — normal INSERT/UPDATE suffices.
 *
 * Soft-delete via `is_active = 0` because activity_data references this table
 * by FK; a hard DELETE would either fail or orphan historical activity rows.
 */
export class EmissionSourceService {
  constructor(private readonly ctx: ServiceContext) {}

  /**
   * Insert a new emission_source. Generates a ULID for `id`.
   *
   * Note: caller is expected to have validated input via Zod (e.g. IPC
   * handler). We re-parse here as defense-in-depth, matching Phase 0
   * `OrganizationService` (which parses inside the service too).
   *
   * `site_id` is not pre-validated; if it doesn't exist, the FK constraint
   * fires and better-sqlite3 throws `SQLITE_CONSTRAINT_FOREIGNKEY`. We let
   * that propagate untouched.
   */
  create(input: EmissionSourceCreateInput): EmissionSource {
    const parsed = emissionSourceCreateInput.parse(input);
    const id = newId();
    this.ctx.db
      .prepare(
        `INSERT INTO emission_source
           (id, site_id, name, scope, category, ghg_protocol_path,
            default_ef_query, template_origin, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        parsed.site_id,
        parsed.name,
        parsed.scope,
        parsed.category ?? null,
        parsed.ghg_protocol_path ?? null,
        parsed.default_ef_query ?? null,
        parsed.template_origin ?? null,
      );
    return this.getById(id)!;
  }

  /**
   * Batch-insert N emission_sources inside a single transaction. Used by
   * the catalog drawer's "add selected" action, so that flipping 30 presets
   * into the org is one atomic operation (audit log records one event;
   * any per-row validation failure rolls everything back).
   *
   * Returns the freshly-created rows in the same order as `inputs`. Throws
   * on the first invalid input (Zod) or FK violation (better-sqlite3) —
   * the transaction wrapper unwinds the partial inserts automatically.
   *
   * Empty `inputs` is a no-op that returns `[]` (callers don't have to
   * guard).
   */
  createBatch(inputs: EmissionSourceCreateInput[]): EmissionSource[] {
    if (inputs.length === 0) return [];
    const run = this.ctx.db.transaction((batch: EmissionSourceCreateInput[]): EmissionSource[] => {
      return batch.map((i) => this.create(i));
    });
    return run(inputs);
  }

  /** Lookup a single emission_source by id, or null. */
  getById(id: string): EmissionSource | null {
    const row = this.ctx.db.prepare(`${ES_SELECT} WHERE id = ?`).get(id) as
      | EmissionSourceRow
      | undefined;
    return mapRow(row);
  }

  /** All emission_sources at one site (active + soft-deleted), oldest first by id. */
  listBySite(siteId: string): EmissionSource[] {
    const rows = this.ctx.db
      .prepare(`${ES_SELECT} WHERE site_id = ? ORDER BY scope ASC, name ASC, id ASC`)
      .all(siteId) as EmissionSourceRow[];
    return rows.map((r) => mapRow(r) as EmissionSource);
  }

  /**
   * All emission_sources across every site belonging to an organization.
   * JOINs `site` to filter by `organization_id`. Returns active + soft-deleted.
   */
  listByOrganization(orgId: string): EmissionSource[] {
    const cols = ES_COLUMNS.map((c) => `es.${c}`).join(', ');
    const rows = this.ctx.db
      .prepare(
        `SELECT ${cols}
           FROM emission_source es
           JOIN site s ON es.site_id = s.id
          WHERE s.organization_id = ?
          ORDER BY es.scope ASC, es.name ASC, es.id ASC`,
      )
      .all(orgId) as EmissionSourceRow[];
    return rows.map((r) => mapRow(r) as EmissionSource);
  }

  /**
   * Patch only the fields provided in `input`. Throws if the id does not
   * exist (so callers see a clear error rather than silently no-op).
   *
   * `is_active` (if supplied) is converted boolean → 0/1 for storage.
   */
  update(input: EmissionSourceUpdateInput): EmissionSource {
    const parsed = emissionSourceUpdateInput.parse(input);
    const { id, ...patch } = parsed;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(patch.name);
    }
    if (patch.scope !== undefined) {
      sets.push('scope = ?');
      params.push(patch.scope);
    }
    if (patch.category !== undefined) {
      sets.push('category = ?');
      params.push(patch.category ?? null);
    }
    if (patch.is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(patch.is_active ? 1 : 0);
    }

    // If nothing to update, just return the current row (still must exist).
    if (sets.length === 0) {
      const existing = this.getById(id);
      if (!existing) {
        throw new Error(`emission_source not found: ${id}`);
      }
      return existing;
    }

    params.push(id);
    const result = this.ctx.db
      .prepare(`UPDATE emission_source SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);

    if (result.changes === 0) {
      throw new Error(`emission_source not found: ${id}`);
    }
    return this.getById(id)!;
  }

  /**
   * Soft delete: set `is_active = 0`. activity_data FK still resolves; the
   * row stays readable via `getById`. Idempotent (no-op if already inactive,
   * but we don't distinguish — caller treats this as fire-and-forget).
   *
   * Throws if the id does not exist.
   */
  delete(id: string): void {
    const result = this.ctx.db
      .prepare('UPDATE emission_source SET is_active = 0 WHERE id = ?')
      .run(id);
    if (result.changes === 0) {
      throw new Error(`emission_source not found: ${id}`);
    }
  }
}
