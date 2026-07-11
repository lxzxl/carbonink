import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Migration 018 — evidence_attachment table (audit-readiness spec
 * 2026-07-11). Shape assertions + the exactly-one-target CHECK + FK
 * enforcement. FK tests toggle the pragma explicitly so the CHECK can be
 * exercised in isolation with synthetic ids.
 */
describe('migration 018_evidence_attachment', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => db.close());

  it('creates the table with the expected columns', () => {
    const cols = (
      db.prepare(`PRAGMA table_info(evidence_attachment)`).all() as Array<{
        name: string;
        notnull: number;
      }>
    ).map((c) => c.name);
    expect(cols).toEqual([
      'id',
      'activity_data_id',
      'answer_id',
      'document_id',
      'note',
      'created_at',
    ]);
  });

  it('creates the three lookup indexes', () => {
    const names = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'evidence_attachment'`,
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'idx_evidence_activity',
        'idx_evidence_answer',
        'idx_evidence_document',
      ]),
    );
  });

  it('CHECK rejects a row with zero targets', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_attachment (id, activity_data_id, answer_id, document_id, note, created_at)
           VALUES ('ev-1', NULL, NULL, 'doc-1', NULL, '2026-07-11T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('CHECK rejects a row with both targets', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_attachment (id, activity_data_id, answer_id, document_id, note, created_at)
           VALUES ('ev-1', 'act-1', 'ans-1', 'doc-1', NULL, '2026-07-11T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('accepts exactly one target (FKs off → synthetic ids allowed)', () => {
    db.pragma('foreign_keys = OFF');
    db.prepare(
      `INSERT INTO evidence_attachment (id, activity_data_id, answer_id, document_id, note, created_at)
       VALUES ('ev-1', 'act-1', NULL, 'doc-1', 'meter photo', '2026-07-11T00:00:00Z')`,
    ).run();
    const row = db.prepare(`SELECT * FROM evidence_attachment WHERE id = 'ev-1'`).get() as {
      activity_data_id: string;
      answer_id: string | null;
    };
    expect(row.activity_data_id).toBe('act-1');
    expect(row.answer_id).toBeNull();
  });

  it('enforces the document FK when foreign_keys is on', () => {
    db.pragma('foreign_keys = ON');
    expect(() =>
      db
        .prepare(
          `INSERT INTO evidence_attachment (id, activity_data_id, answer_id, document_id, note, created_at)
           VALUES ('ev-1', 'act-1', NULL, 'missing-doc', NULL, '2026-07-11T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
