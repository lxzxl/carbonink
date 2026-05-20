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

export class AuditEventService {
  constructor(private deps: AuditEventDeps) {}

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
