import type { AuditEvent } from '@shared/types.js';
import type Database from 'better-sqlite3';

export interface AuditEventDeps {
  db: Database.Database;
}

export interface AuditEventListInput {
  /** If absent or empty array, no event_kind filter applied. */
  event_kinds?: string[];
  /** ISO timestamp; default = no lower bound. */
  since?: string;
  /** ISO timestamp; default = no upper bound. */
  until?: string;
  /** Default 500. Hard cap at 5000. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

export interface AuditRecordRef {
  activity_data_id?: string;
  answer_id?: string;
}

/**
 * Which JSON payload path identifies a given record type, per event kind.
 * `audit_event` deliberately has no entity columns (append-only table,
 * links live in the payload — see migration 006), so per-record queries
 * are a query-time `json_extract` over this registry. Event volume is
 * single-machine small; a full scan stays well under interactive latency.
 *
 * Older kinds predate the naming convention (`activity_rebind_ef` uses
 * `activity_id`); new kinds should always carry `activity_id` /
 * `answer_id` keys so entries here stay one-per-kind.
 */
const RECORD_PATHS: Record<'activity_data_id' | 'answer_id', ReadonlyArray<[string, string]>> = {
  activity_data_id: [
    ['activity_rebind_ef', '$.activity_id'],
    ['activity_data.created', '$.activity_id'],
    ['activity_data.deleted', '$.activity_id'],
    ['evidence.attached', '$.activity_id'],
    ['evidence.removed', '$.activity_id'],
  ],
  answer_id: [
    ['evidence.attached', '$.answer_id'],
    ['evidence.removed', '$.answer_id'],
  ],
};

export class AuditEventService {
  constructor(private deps: AuditEventDeps) {}

  /**
   * Timeline for one record: every event whose payload references the given
   * activity/answer id, newest first. Passing both keys ORs the two
   * timelines together (useful when a panel shows an answer plus its
   * source activity).
   */
  listByRecord(ref: AuditRecordRef, limit = DEFAULT_LIMIT): AuditEvent[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    for (const key of ['activity_data_id', 'answer_id'] as const) {
      const id = ref[key];
      if (!id) continue;
      for (const [kind, path] of RECORD_PATHS[key]) {
        clauses.push(`(event_kind = ? AND json_extract(payload, ?) = ?)`);
        params.push(kind, path, id);
      }
    }
    if (clauses.length === 0) return [];

    params.push(Math.min(limit, MAX_LIMIT));
    return this.deps.db
      .prepare(
        `SELECT id, event_kind, payload, occurred_at
           FROM audit_event
          WHERE ${clauses.join(' OR ')}
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?`,
      )
      .all(...params) as AuditEvent[];
  }

  list(input: AuditEventListInput): AuditEvent[] {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const kinds = input.event_kinds ?? [];

    // Build dynamic WHERE clauses. Parameterized for safety.
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (kinds.length > 0) {
      const placeholders = kinds.map(() => '?').join(', ');
      clauses.push(`event_kind IN (${placeholders})`);
      params.push(...kinds);
    }
    if (input.since) {
      clauses.push('occurred_at >= ?');
      params.push(input.since);
    }
    if (input.until) {
      clauses.push('occurred_at <= ?');
      params.push(input.until);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT id, event_kind, payload, occurred_at
        FROM audit_event
        ${where}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?
    `;
    params.push(limit);

    return this.deps.db.prepare(sql).all(...params) as AuditEvent[];
  }
}
