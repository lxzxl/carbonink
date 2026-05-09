import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openAppDb, closeAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';

describe('schema integrity (FK enforcement smoke)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `carbonbook-schema-${Date.now()}-${Math.random()}.sqlite`);
  });

  afterEach(() => {
    closeAppDb();
    try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('rejects site row pointing to non-existent organization', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    const insertBadSite = () =>
      db.prepare(
        'INSERT INTO site (id, organization_id, country_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('site_1', 'org_does_not_exist', 'CN', '2026-01-01', '2026-01-01');
    expect(insertBadSite).toThrow(/FOREIGN KEY/i);
  });

  it('accepts site row pointing to existing organization', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    db.prepare(
      'INSERT INTO organization (id, country_code, boundary_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('org_1', 'CN', 'operational_control', '2026-01-01', '2026-01-01');
    expect(() =>
      db.prepare(
        'INSERT INTO site (id, organization_id, country_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('site_1', 'org_1', 'CN', '2026-01-01', '2026-01-01'),
    ).not.toThrow();
  });
});
