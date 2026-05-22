import { runMigrations } from '@main/db/migrate';
import { AuditEventService } from '@main/services/audit-event-service';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function seedAuditRows(db: Database.Database) {
  // 3 rows: 2 activity_rebind_ef, 1 fake other_kind, varying timestamps.
  db.prepare(
    `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES
     ('aud-1', 'activity_rebind_ef',
       '{"activity_id":"act-1","old_ef":{"factor_code":"a"},"new_ef":{"factor_code":"b"}}',
       '2026-05-18T10:00:00Z'),
     ('aud-2', 'other_kind',
       '{"foo":"bar"}',
       '2026-05-19T11:00:00Z'),
     ('aud-3', 'activity_rebind_ef',
       '{"activity_id":"act-2","old_ef":{"factor_code":"c"},"new_ef":{"factor_code":"d"}}',
       '2026-05-20T12:00:00Z')`,
  ).run();
}

describe('AuditEventService.list', () => {
  it('returns rows in reverse chronological order with no filters', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({});
    expect(rows.map((r) => r.id)).toEqual(['aud-3', 'aud-2', 'aud-1']);
  });

  it('filters by event_kinds', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({ event_kinds: ['activity_rebind_ef'] });
    expect(rows.map((r) => r.id)).toEqual(['aud-3', 'aud-1']);
  });

  it('filters by since + until date range', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({
      since: '2026-05-19T00:00:00Z',
      until: '2026-05-19T23:59:59Z',
    });
    expect(rows.map((r) => r.id)).toEqual(['aud-2']);
  });

  it('caps results at limit', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({ limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(['aud-3', 'aud-2']);
  });
});
