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

function seedRecordTimelineRows(db: Database.Database) {
  // A full per-record timeline for act-1 across three kinds, one event on a
  // different activity (act-2), one answer-side event, and one unrelated kind.
  db.prepare(
    `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES
     ('rec-1', 'activity_data.created',
       '{"activity_id":"act-1","amount":1000,"provenance":"manual"}',
       '2026-07-01T10:00:00Z'),
     ('rec-2', 'activity_rebind_ef',
       '{"activity_id":"act-1","old_ef":{"factor_code":"a"},"new_ef":{"factor_code":"b"}}',
       '2026-07-02T10:00:00Z'),
     ('rec-3', 'evidence.attached',
       '{"attachment_id":"ev-1","activity_id":"act-1","document_id":"doc-1","sha256":"abc"}',
       '2026-07-03T10:00:00Z'),
     ('rec-4', 'activity_data.created',
       '{"activity_id":"act-2","amount":5,"provenance":"manual"}',
       '2026-07-04T10:00:00Z'),
     ('rec-5', 'evidence.attached',
       '{"attachment_id":"ev-2","answer_id":"ans-9","document_id":"doc-2","sha256":"def"}',
       '2026-07-05T10:00:00Z'),
     ('rec-6', 'other_kind',
       '{"activity_id":"act-1"}',
       '2026-07-06T10:00:00Z')`,
  ).run();
}

describe('AuditEventService.listByRecord', () => {
  it('returns only the events referencing the given activity id, newest first', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedRecordTimelineRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.listByRecord({ activity_data_id: 'act-1' });
    // rec-6 is excluded: 'other_kind' is not in the kind→path registry, so a
    // stray activity_id key in an unrelated payload cannot pollute timelines.
    expect(rows.map((r) => r.id)).toEqual(['rec-3', 'rec-2', 'rec-1']);
  });

  it('returns answer-side events for an answer id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedRecordTimelineRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.listByRecord({ answer_id: 'ans-9' });
    expect(rows.map((r) => r.id)).toEqual(['rec-5']);
  });

  it('ORs both keys when given together', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedRecordTimelineRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.listByRecord({ activity_data_id: 'act-1', answer_id: 'ans-9' });
    expect(rows.map((r) => r.id)).toEqual(['rec-5', 'rec-3', 'rec-2', 'rec-1']);
  });

  it('returns [] for an empty ref and respects limit', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedRecordTimelineRows(db);
    const svc = new AuditEventService({ db });
    expect(svc.listByRecord({})).toEqual([]);
    expect(svc.listByRecord({ activity_data_id: 'act-1' }, 1).map((r) => r.id)).toEqual(['rec-3']);
  });
});
