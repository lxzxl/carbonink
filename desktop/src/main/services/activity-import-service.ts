import type {
  ActivityImportConfigureResult,
  ActivityImportConfirmResult,
  ActivityImportDecideItemResult,
  ActivityImportDecideResult,
  ActivityImportEfChoice,
  ActivityImportGroup,
  ActivityImportGroupDecision,
  ActivityImportMapping,
  ActivityImportPreview,
  ActivityImportResult,
  ActivityImportRowIssue,
  ActivityImportSourceStatus,
  ActivityImportValidation,
  EmissionSource,
} from '@shared/types.js';
import { ACTIVITY_IMPORT_REQUIRED_FIELDS } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ActivityDataService } from './activity-data-service.js';
import {
  buildGroups,
  detectAmountOutliers,
  groupKeyOf,
  normalizeDescription,
  type ResolvedImportRow,
} from './activity-import/grouping.js';
import {
  type ActivityImportValidRow,
  autoDetectActivityMapping,
  validateActivityRows,
} from './activity-import/mapping.js';
import type { ServiceContext } from './base.js';
import type { DocumentService } from './document-service.js';
import { type EfImportGrid, parseEfImportFile } from './ef-import/parser.js';
import type { EfService } from './ef-service.js';
import type { UnitConversionService } from './unit-conversion-service.js';
import { DimensionMismatchError, UnknownUnitError } from './unit-conversion-service.js';

/** Issues of any kind that ride the final IPC result (full count preserved). */
const MAX_RESULT_ISSUES = 200;

/** Sliding session expiry — each access refreshes the deadline. */
const SESSION_TTL_MS = 30 * 60 * 1000;

interface EmissionSourceLookup {
  listByOrganization(orgId: string): EmissionSource[];
  getById(id: string): EmissionSource | null;
}

/** Narrow settings surface — only the outlier multiplier is consumed. */
interface SettingsLookup {
  getImportOutlierRatio(): number;
}

type PendingImport = {
  token: string;
  filename: string;
  bytes: Buffer;
  grid: EfImportGrid;
  mapping: ActivityImportMapping;
  organizationId: string | null;
  period: { id: string; start: string; end: string } | null;
  validation: ActivityImportValidation;
  validRows: ActivityImportValidRow[];
  /** Keyed by normalized source_name. Built by configure, edited by resolveSource. */
  sources: Map<string, ActivityImportSourceStatus> | null;
  /** Keyed by group key. Built lazily after sources settle. */
  groups: Map<string, ActivityImportGroup> | null;
  /** Sliding expiry, refreshed on every access. */
  expiresAt: number;
};

function mimeForFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.csv')
    ? 'text/csv'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

/** Period bounds normalized to date-only so they compare with row dates. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Batch activity-data import (spec 2026-07-21-batch-activity-import,
 * ROADMAP §8.1-①). Four-step staged flow, one session per token:
 *
 *   stageImport → configure(mapping, period, org) → resolveSource* → decide → import
 *
 * `configure` collapses the old revalidate+listSources round-trip into one
 * call; `decide` collapses per-group confirm/skip into one batch. Sessions
 * live in a token-keyed map (30-minute sliding expiry) so concurrent
 * wizards no longer overwrite each other.
 *
 * The audit posture is inherited rather than re-invented: every row goes
 * through `ActivityDataService.create` (pin + compute + insert + per-row
 * audit event, nested transactions become savepoints), the original ledger
 * file is archived content-addressed (`doc_type = 'activity_import'`), and
 * each created row gets an `evidence_attachment` back to that file — so the
 * lineage drawer answers "where did this number come from" with the ledger
 * itself. EF choices are made by a human per group; nothing auto-binds.
 */
export class ActivityImportService {
  private readonly db: ServiceContext['db'];
  private readonly now: () => string;
  private readonly documentService: DocumentService;
  private readonly activityDataService: ActivityDataService;
  private readonly efService: EfService;
  private readonly unitConversionService: UnitConversionService;
  private readonly emissionSourceService: EmissionSourceLookup;
  private readonly settingsService: SettingsLookup;
  private readonly sessions = new Map<string, PendingImport>();
  private readonly clock: () => number;

  constructor(
    ctx: ServiceContext & {
      documentService: DocumentService;
      activityDataService: ActivityDataService;
      efService: EfService;
      unitConversionService: UnitConversionService;
      emissionSourceService: EmissionSourceLookup;
      /** Per-workspace outlier multiplier (spec 2026-07-23). */
      settingsService: SettingsLookup;
      /** Session clock override (tests pin expiry). Defaults to Date.now. */
      clock?: () => number;
    },
  ) {
    this.db = ctx.db;
    this.now = ctx.now;
    this.documentService = ctx.documentService;
    this.activityDataService = ctx.activityDataService;
    this.efService = ctx.efService;
    this.unitConversionService = ctx.unitConversionService;
    this.emissionSourceService = ctx.emissionSourceService;
    this.settingsService = ctx.settingsService;
    this.clock = ctx.clock ?? Date.now;
  }

  /**
   * Parse an uploaded ledger and stage it. Throws `EfImportParseError`
   * (shared parser, code-carrying) on structural problems. Validation here
   * runs without period bounds — the period is chosen in the next wizard
   * step and `configure` re-runs with them.
   */
  async stageImport(bytes: Buffer, filename: string): Promise<ActivityImportPreview> {
    const grid = await parseEfImportFile(bytes, filename);
    const token = newId();
    const mapping = autoDetectActivityMapping(grid.headers);
    const { validation, validRows } = validateActivityRows(grid.rows, mapping);
    this.sessions.set(token, {
      token,
      filename,
      bytes,
      grid,
      mapping,
      organizationId: null,
      period: null,
      validation,
      validRows,
      sources: null,
      groups: null,
      expiresAt: this.clock() + SESSION_TTL_MS,
    });
    return {
      token,
      filename,
      headers: grid.headers,
      total_rows: grid.rows.length,
      mapping,
      validation,
    };
  }

  /**
   * Configure the staged import: re-validate under an edited mapping +
   * chosen reporting period, then auto-match sources — one round-trip.
   * Resets downstream state (source resolutions, groups) because both
   * derive from the valid-row set.
   */
  configure(
    token: string,
    mapping: ActivityImportMapping,
    periodId: string,
    organizationId: string,
  ): ActivityImportConfigureResult {
    const pending = this.requirePending(token);
    if (!pending) return { ok: false, error: 'TokenExpired' };

    const periodRow = this.db
      .prepare('SELECT id, starts_at, ends_at FROM reporting_period WHERE id = ?')
      .get(periodId) as { id: string; starts_at: string; ends_at: string } | undefined;

    const period = periodRow
      ? { id: periodRow.id, start: dateOnly(periodRow.starts_at), end: dateOnly(periodRow.ends_at) }
      : null;

    const { validation, validRows } = validateActivityRows(
      pending.grid.rows,
      mapping,
      period ? { period: { start: period.start, end: period.end } } : {},
    );
    pending.mapping = mapping;
    pending.organizationId = organizationId;
    pending.period = period;
    pending.validation = validation;
    pending.validRows = validRows;
    pending.sources = null;
    pending.groups = null;
    const sources = this.buildSources(pending, organizationId);
    return { ok: true, validation, sources };
  }

  /**
   * Re-validate under an edited mapping + chosen reporting period.
   * Preserved for the mapping-step live preview while the user is still
   * editing (no org context yet); `configure` is the step-commit path.
   */
  revalidate(
    token: string,
    mapping: ActivityImportMapping,
    periodId: string,
  ): ActivityImportValidation | null {
    const pending = this.requirePending(token);
    if (!pending) return null;

    const periodRow = this.db
      .prepare('SELECT id, starts_at, ends_at FROM reporting_period WHERE id = ?')
      .get(periodId) as { id: string; starts_at: string; ends_at: string } | undefined;

    const period = periodRow
      ? { id: periodRow.id, start: dateOnly(periodRow.starts_at), end: dateOnly(periodRow.ends_at) }
      : null;

    const { validation, validRows } = validateActivityRows(
      pending.grid.rows,
      mapping,
      period ? { period: { start: period.start, end: period.end } } : {},
    );
    pending.mapping = mapping;
    pending.period = period;
    pending.validation = validation;
    pending.validRows = validRows;
    pending.sources = null;
    pending.groups = null;
    return validation;
  }

  /**
   * Distinct source_name values (file order) with their auto-match against
   * the organization's existing sources (normalized exact name match).
   * Idempotent: once built, returns the cached statuses so user resolutions
   * survive re-reads. Kept for the sources-step refresh path; the
   * step-commit path is `configure`, which returns the same list.
   */
  listSources(token: string, organizationId: string): ActivityImportSourceStatus[] | null {
    const pending = this.requirePending(token);
    if (!pending) return null;
    if (pending.sources) return [...pending.sources.values()];
    return this.buildSources(pending, organizationId);
  }

  private buildSources(
    pending: PendingImport,
    organizationId: string,
  ): ActivityImportSourceStatus[] {
    const byNormalizedName = new Map<string, string>();
    for (const source of this.emissionSourceService.listByOrganization(organizationId)) {
      if (!source.is_active) continue;
      const key = normalizeDescription(source.name);
      if (!byNormalizedName.has(key)) byNormalizedName.set(key, source.id);
    }

    const sources = new Map<string, ActivityImportSourceStatus>();
    for (const row of pending.validRows) {
      const key = normalizeDescription(row.source_name);
      const existing = sources.get(key);
      if (existing) {
        existing.row_count += 1;
        continue;
      }
      const matched = byNormalizedName.get(key) ?? null;
      sources.set(key, {
        name: row.source_name,
        row_count: 1,
        matched_source_id: matched,
        resolved_source_id: matched,
      });
    }
    pending.sources = sources;
    return [...sources.values()];
  }

  /**
   * Point one distinct source_name at an emission_source (existing or just
   * created by the renderer via the normal source APIs), or null to
   * unresolve. Invalidates built groups — they derive from resolutions.
   */
  resolveSource(token: string, name: string, sourceId: string | null): boolean {
    const pending = this.requirePending(token);
    if (!pending?.sources) return false;
    const status = pending.sources.get(normalizeDescription(name));
    if (!status) return false;
    if (sourceId !== null) {
      const source = this.emissionSourceService.getById(sourceId);
      if (!source?.is_active) return false;
    }
    status.resolved_source_id = sourceId;
    pending.groups = null;
    return true;
  }

  /**
   * Confirm-units over rows whose source is resolved. Built lazily and
   * cached; `resolveSource` invalidates. Group statuses (confirmed/skipped)
   * live in the cache, so the wizard must settle sources before groups —
   * which is exactly its step order.
   */
  listGroups(token: string): ActivityImportGroup[] | null {
    const pending = this.requirePending(token);
    if (!pending?.sources) return null;
    if (pending.groups) return [...pending.groups.values()];
    return this.buildGroups(pending);
  }

  private buildGroups(pending: PendingImport): ActivityImportGroup[] {
    const resolved = this.resolvedRows(pending);
    const nameOf = new Map<string, string>();
    for (const status of pending.sources?.values() ?? []) {
      if (status.resolved_source_id) {
        const source = this.emissionSourceService.getById(status.resolved_source_id);
        nameOf.set(status.resolved_source_id, source?.name ?? status.name);
      }
    }
    const groups = buildGroups(resolved, (id) => nameOf.get(id) ?? id);
    pending.groups = new Map(groups.map((g) => [g.key, g]));
    return groups;
  }

  private applyDecision(
    pending: PendingImport,
    d: ActivityImportGroupDecision,
  ): ActivityImportDecideItemResult {
    const group = pending.groups?.get(d.group_key);
    if (!group) return { group_key: d.group_key, ok: false, error: 'GroupNotFound' };
    if (d.action === 'skip') {
      group.status = 'skipped';
      group.ef = null;
      group.fuel_code = null;
      return { group_key: d.group_key, ok: true };
    }
    if (!d.ef) return { group_key: d.group_key, ok: false, error: 'EfNotFound' };
    const efRow = this.efService.get(d.ef);
    if (!efRow) return { group_key: d.group_key, ok: false, error: 'EfNotFound' };
    const inputUnit = efRow.input_unit ?? '';
    if (inputUnit !== '' && group.unit !== inputUnit) {
      try {
        if (d.fuel_code) {
          this.unitConversionService.convertWithFuel(1, group.unit, inputUnit, d.fuel_code);
        } else {
          this.unitConversionService.convert(1, group.unit, inputUnit);
        }
      } catch {
        return { group_key: d.group_key, ok: false, error: 'DimensionMismatch' };
      }
    }
    group.status = 'confirmed';
    group.ef = d.ef;
    group.fuel_code = d.fuel_code ?? null;
    return { group_key: d.group_key, ok: true };
  }

  /**
   * Batch EF decisions for every group: one call applies all confirms +
   * skips, running the same per-group checks as the per-group path
   * (EfNotFound / DimensionMismatch / GroupNotFound per item). Not atomic:
   * valid items apply even when siblings fail — the renderer shows per-row
   * errors and lets the user fix + re-decide.
   */
  decide(token: string, decisions: ActivityImportGroupDecision[]): ActivityImportDecideResult {
    const pending = this.requirePending(token);
    if (!pending) return { ok: false, error: 'TokenExpired' };
    if (!pending.groups && pending.sources) this.buildGroups(pending);
    const results: ActivityImportDecideItemResult[] = decisions.map((d) =>
      this.applyDecision(pending, d),
    );
    return { ok: true, results };
  }

  /**
   * Human EF decision for one group. Refuses (`DimensionMismatch`) when the
   * group's unit cannot reach the EF's input_unit — same family, direct
   * conversion, or fuel-bound cross-family are the three passable roads; a
   * refused confirm would otherwise blow up row-by-row at import time.
   * Preserved for single-group patch-ups; the step-commit path is `decide`.
   */
  confirmGroup(
    token: string,
    groupKey: string,
    ef: ActivityImportEfChoice,
    fuelCode: string | null,
  ): ActivityImportConfirmResult {
    const pending = this.requirePending(token);
    const group = pending?.groups?.get(groupKey);
    if (!pending || !group) {
      return { ok: false, error: pending ? 'GroupNotFound' : 'TokenExpired' };
    }

    const efRow = this.efService.get(ef);
    if (!efRow) return { ok: false, error: 'EfNotFound' };

    const inputUnit = efRow.input_unit ?? '';
    if (inputUnit !== '' && group.unit !== inputUnit) {
      try {
        if (fuelCode) {
          this.unitConversionService.convertWithFuel(1, group.unit, inputUnit, fuelCode);
        } else {
          this.unitConversionService.convert(1, group.unit, inputUnit);
        }
      } catch {
        return { ok: false, error: 'DimensionMismatch' };
      }
    }

    group.status = 'confirmed';
    group.ef = ef;
    group.fuel_code = fuelCode;
    return { ok: true };
  }

  /** Exclude a group (and its rows) from the import. Reversible via confirmGroup. */
  skipGroup(token: string, groupKey: string): boolean {
    const group = this.requirePending(token)?.groups?.get(groupKey);
    if (!group) return false;
    group.status = 'skipped';
    group.ef = null;
    group.fuel_code = null;
    return true;
  }

  /**
   * Commit: archive the ledger file, create every row of every confirmed
   * group through ActivityDataService.create, hang an evidence link per row,
   * and write one `activity_data.bulk_imported` summary event — all in one
   * transaction. Per-row create failures (should be rare — confirm-time
   * checks front-run them) skip that row without aborting the batch.
   */
  import(token: string): ActivityImportResult {
    const pending = this.requirePending(token);
    if (!pending) return { ok: false, error: { _tag: 'TokenExpired' } };
    if (!pending.period) return { ok: false, error: { _tag: 'PeriodMissing' } };
    for (const field of ACTIVITY_IMPORT_REQUIRED_FIELDS) {
      if (pending.mapping[field] === undefined) {
        return { ok: false, error: { _tag: 'NothingToImport' } };
      }
    }
    if (!pending.sources || !pending.groups) {
      return { ok: false, error: { _tag: 'NothingToImport' } };
    }
    const groups = pending.groups;
    if ([...groups.values()].some((g) => g.status === 'pending')) {
      return { ok: false, error: { _tag: 'UnconfirmedGroups' } };
    }

    const period = pending.period;
    const resolved = this.resolvedRows(pending);
    const importable = resolved.filter(
      (row) =>
        groups.get(groupKeyOf(row.description, row.unit, row.source_id))?.status === 'confirmed',
    );
    if (importable.length === 0) {
      return { ok: false, error: { _tag: 'NothingToImport' } };
    }

    const unresolvedCount = pending.validRows.length - resolved.length;
    const skippedGroupCount = resolved.length - importable.length;

    const warnings: ActivityImportRowIssue[] = [];
    let warningCount = 0;
    const pushWarning = (issue: ActivityImportRowIssue): void => {
      warningCount += 1;
      if (warnings.length < MAX_RESULT_ISSUES) warnings.push(issue);
    };
    // Carry the preview-stage warnings (period mismatch, in-file duplicates)
    // into the final report so the result page is self-contained.
    for (const issue of pending.validation.warnings) pushWarning(issue);

    const dupStmt = this.db.prepare(
      `SELECT 1 FROM activity_data
        WHERE emission_source_id = ? AND reporting_period_id = ?
          AND occurred_at_start = ? AND occurred_at_end = ? AND amount = ?
        LIMIT 1`,
    );

    const ts = this.now();
    let createFailures = 0;

    const tx = this.db.transaction((): { importedCount: number; documentId: string } => {
      const doc = this.documentService.uploadFile(
        {
          filename: pending.filename,
          mimeType: mimeForFilename(pending.filename),
          bytes: pending.bytes,
        },
        { purpose: 'activity_import' },
      );

      const evidenceStmt = this.db.prepare(
        `INSERT INTO evidence_attachment
           (id, activity_data_id, answer_id, document_id, note, created_at)
         VALUES (?, ?, NULL, ?, NULL, ?)`,
      );

      let importedCount = 0;
      for (const row of importable) {
        const group = groups.get(groupKeyOf(row.description, row.unit, row.source_id));
        const ef = group?.ef;
        if (!group || !ef) continue; // unreachable: importable is confirmed-only

        const start = row.occurred_at_start ?? period.start;
        const end = row.occurred_at_end ?? period.end;

        if (dupStmt.get(row.source_id, period.id, start, end, row.amount)) {
          pushWarning({ row: row.row, code: 'duplicate_in_db' });
        }

        try {
          const created = this.activityDataService.create({
            emission_source_id: row.source_id,
            reporting_period_id: period.id,
            occurred_at_start: start,
            occurred_at_end: end,
            amount: row.amount,
            unit: row.unit,
            ef_factor_code: ef.factor_code,
            ef_year: ef.year,
            ef_source: ef.source,
            ef_geography: ef.geography,
            ef_dataset_version: ef.dataset_version,
            ...(group.fuel_code !== null ? { fuel_code: group.fuel_code } : {}),
            ...(row.notes !== null ? { notes: row.notes } : {}),
          });
          evidenceStmt.run(newId(), created.id, doc.id, ts);
          importedCount += 1;
        } catch (err) {
          createFailures += 1;
          const code =
            err instanceof DimensionMismatchError || err instanceof UnknownUnitError
              ? 'unit_dimension_mismatch'
              : 'create_failed';
          pushWarning({
            row: row.row,
            code,
            ...(err instanceof Error ? { detail: err.message.slice(0, 120) } : {}),
          });
        }
      }

      if (importedCount === 0) {
        // Roll back the archive too — an import that created nothing
        // should leave nothing behind.
        throw new Error('activity-import: no row survived create');
      }

      for (const issue of detectAmountOutliers(
        importable,
        this.settingsService.getImportOutlierRatio(),
      )) {
        pushWarning(issue);
      }

      this.writeAudit('activity_data.bulk_imported', ts, {
        document_id: doc.id,
        sha256: doc.sha256,
        reporting_period_id: period.id,
        total_rows: pending.validation.total_rows,
        imported_count: importedCount,
        validation_error_count: pending.validation.error_count,
        unresolved_source_rows: unresolvedCount,
        skipped_group_rows: skippedGroupCount,
        create_failure_count: createFailures,
        source_count: pending.sources?.size ?? 0,
        group_count: groups.size,
        warning_count: warningCount,
      });

      return { importedCount, documentId: doc.id };
    });

    let committed: { importedCount: number; documentId: string };
    try {
      committed = tx();
    } catch {
      return { ok: false, error: { _tag: 'NothingToImport' } };
    }

    this.sessions.delete(token);
    return {
      ok: true,
      imported_count: committed.importedCount,
      skipped: {
        validation_errors: pending.validation.error_count + createFailures,
        unresolved_sources: unresolvedCount,
        skipped_groups: skippedGroupCount,
      },
      warnings,
      warning_count: warningCount,
      document_id: committed.documentId,
    };
  }

  /** Drop the staged import (drawer closed without importing). */
  discardPending(token: string): void {
    this.sessions.delete(token);
  }

  private requirePending(token: string): PendingImport | null {
    const pending = this.sessions.get(token);
    if (!pending) return null;
    if (pending.expiresAt <= this.clock()) {
      this.sessions.delete(token);
      return null;
    }
    pending.expiresAt = this.clock() + SESSION_TTL_MS;
    return pending;
  }

  private resolvedRows(pending: PendingImport): ResolvedImportRow[] {
    const sources = pending.sources;
    if (!sources) return [];
    const rows: ResolvedImportRow[] = [];
    for (const row of pending.validRows) {
      const status = sources.get(normalizeDescription(row.source_name));
      if (status?.resolved_source_id) {
        rows.push({ ...row, source_id: status.resolved_source_id });
      }
    }
    return rows;
  }

  private writeAudit(kind: string, ts: string, payload: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)')
      .run(newId(), kind, JSON.stringify(payload), ts);
  }
}
