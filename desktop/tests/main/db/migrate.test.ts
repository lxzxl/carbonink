import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAppDb, openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('runMigrations', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `carbonbook-mig-${Date.now()}-${Math.random()}.sqlite`);
  });

  afterEach(() => {
    closeAppDb();
    try {
      rmSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('creates schema_migrations and records applied versions', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ version: 0, name: '000_meta' });
  });

  it('is idempotent — running twice does not re-apply', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    const beforeCount = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as {
      c: number;
    };
    runMigrations(db);
    const afterCount = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as {
      c: number;
    };
    expect(afterCount.c).toBe(beforeCount.c);
  });

  it('migration 016 creates license_local_state with the singleton seed row', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    const row = db.prepare('SELECT * FROM license_local_state WHERE id = 1').get() as
      | {
          id: number;
          device_id: string;
          consecutive_offline_days: number;
          last_known_state: string;
        }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.id).toBe(1);
    // Sentinel — LicenseService replaces with a real ULID on first read.
    expect(row?.device_id).toBe('pending-first-launch');
    expect(row?.consecutive_offline_days).toBe(0);
    expect(row?.last_known_state).toBe('unverified');
    // CHECK constraint on PK = 1: a second insert with id=2 must fail.
    expect(() =>
      db
        .prepare(
          `INSERT INTO license_local_state (id, device_id, created_at, updated_at)
           VALUES (2, 'x', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
  });
});
