import type { ActivityImportGroup, ActivityImportRowIssue } from '@shared/types.js';
import type { ActivityImportValidRow } from './mapping.js';

/**
 * Outlier rule constants (spec 2026-07-21-batch-activity-import): a row is
 * flagged when its amount is more than RATIO× away from the group median in
 * either direction, and only in groups with enough rows for a median to
 * mean anything. Warnings only — never blocks the import.
 */
export const OUTLIER_RATIO = 10;
export const OUTLIER_MIN_GROUP_SIZE = 5;

/** A valid row whose source_name has been resolved to an emission_source. */
export type ResolvedImportRow = ActivityImportValidRow & {
  source_id: string;
};

/**
 * Description normalization for the group key only — the stored activity row
 * keeps the user's raw text. Conservative on purpose: lowercase + collapsed
 * whitespace. Anything smarter (synonyms, punctuation stripping) risks
 * merging rows a human would keep apart, and a too-fine split only costs an
 * extra confirm click.
 */
export function normalizeDescription(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Stable opaque key for (normalized description, unit, source). */
export function groupKeyOf(description: string, unit: string, sourceId: string): string {
  return JSON.stringify([normalizeDescription(description), unit.toLowerCase(), sourceId]);
}

/**
 * Fold resolved rows into confirm-units. Group identity is
 * (normalized description, unit, source); the representative description
 * shown to the user is the first-seen raw text. Insertion order of first
 * occurrence is preserved so the wizard lists groups in file order.
 */
export function buildGroups(
  rows: readonly ResolvedImportRow[],
  sourceNameOf: (sourceId: string) => string,
): ActivityImportGroup[] {
  const groups = new Map<string, ActivityImportGroup>();
  for (const row of rows) {
    const key = groupKeyOf(row.description, row.unit, row.source_id);
    const existing = groups.get(key);
    if (existing) {
      existing.row_count += 1;
      existing.amount_total += row.amount;
    } else {
      groups.set(key, {
        key,
        description: row.description,
        unit: row.unit,
        source_id: row.source_id,
        source_name: sourceNameOf(row.source_id),
        row_count: 1,
        amount_total: row.amount,
        status: 'pending',
        ef: null,
        fuel_code: null,
      });
    }
  }
  return [...groups.values()];
}

function medianOf(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Flag rows whose amount is >OUTLIER_RATIO× away from their group's median
 * (both directions — a dropped zero is as suspicious as an extra one).
 * Groups below OUTLIER_MIN_GROUP_SIZE rows are skipped entirely.
 */
export function detectAmountOutliers(rows: readonly ResolvedImportRow[]): ActivityImportRowIssue[] {
  const byGroup = new Map<string, ResolvedImportRow[]>();
  for (const row of rows) {
    const key = groupKeyOf(row.description, row.unit, row.source_id);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(row);
    else byGroup.set(key, [row]);
  }

  const issues: ActivityImportRowIssue[] = [];
  for (const bucket of byGroup.values()) {
    if (bucket.length < OUTLIER_MIN_GROUP_SIZE) continue;
    const median = medianOf(bucket.map((r) => r.amount).sort((a, b) => a - b));
    if (median <= 0) continue;
    for (const row of bucket) {
      if (row.amount > median * OUTLIER_RATIO || row.amount < median / OUTLIER_RATIO) {
        issues.push({
          row: row.row,
          code: 'amount_outlier',
          detail: `${row.amount} vs ${median}`,
        });
      }
    }
  }
  issues.sort((a, b) => a.row - b.row);
  return issues;
}
