import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAppDb, openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('runMigrations', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `carbonink-mig-${Date.now()}-${Math.random()}.sqlite`);
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
});
