import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAppDb, openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('audit_event append-only triggers', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cb-audit-${Date.now()}-${Math.random()}.sqlite`);
  });

  afterEach(() => {
    closeAppDb();
    try {
      rmSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('allows INSERT', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    expect(() =>
      db
        .prepare(
          'INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)',
        )
        .run('evt_1', 'license_activated', '{}', '2026-01-01T00:00:00Z'),
    ).not.toThrow();
  });

  it('rejects UPDATE', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    db.prepare(
      'INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)',
    ).run('evt_1', 'license_activated', '{}', '2026-01-01T00:00:00Z');
    expect(() =>
      db.prepare('UPDATE audit_event SET event_kind = ? WHERE id = ?').run('changed', 'evt_1'),
    ).toThrow(/append-only/);
  });

  it('rejects DELETE', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    db.prepare(
      'INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)',
    ).run('evt_1', 'license_activated', '{}', '2026-01-01T00:00:00Z');
    expect(() => db.prepare('DELETE FROM audit_event WHERE id = ?').run('evt_1')).toThrow(
      /append-only/,
    );
  });
});
