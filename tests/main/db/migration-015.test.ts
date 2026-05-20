import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('migration 015 — ISO 14064-1 schema additions', () => {
  it('applies cleanly on a fresh DB and adds the expected columns', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const orgCols = db.prepare(`PRAGMA table_info(organization)`).all() as Array<{ name: string }>;
    const orgColNames = new Set(orgCols.map((c) => c.name));
    expect(orgColNames).toContain('boundary_kind');
    expect(orgColNames).toContain('responsible_person_name');
    expect(orgColNames).toContain('responsible_person_role');
    expect(orgColNames).toContain('base_year_period_id');
    expect(orgColNames).toContain('recalc_threshold_pct');

    const periodCols = db.prepare(`PRAGMA table_info(reporting_period)`).all() as Array<{
      name: string;
    }>;
    const periodColNames = new Set(periodCols.map((c) => c.name));
    expect(periodColNames).toContain('significant_changes_text');
    expect(periodColNames).toContain('recalculation_reason');

    const efCols = db.prepare(`PRAGMA table_info(emission_factor)`).all() as Array<{
      name: string;
    }>;
    const efColNames = new Set(efCols.map((c) => c.name));
    expect(efColNames).toContain('biogenic_co2_factor');

    db.close();
  });

  it('extends organization.boundary_kind CHECK to allow financial_control', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(
      `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
       VALUES ('org-1', '测试', 'CN', 'financial_control', '2026-01-01', '2026-01-01')`,
    ).run();
    const row = db.prepare(`SELECT boundary_kind FROM organization WHERE id = 'org-1'`).get() as {
      boundary_kind: string;
    };
    expect(row.boundary_kind).toBe('financial_control');
    db.close();
  });

  it('preserves existing organization rows after the boundary_kind rebuild', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(
      `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
       VALUES ('org-keep', '保留', 'CN', 'equity_share', '2026-01-01', '2026-01-01')`,
    ).run();
    runMigrations(db);
    const row = db.prepare(`SELECT * FROM organization WHERE id = 'org-keep'`).get() as {
      boundary_kind: string;
      responsible_person_name: string | null;
    };
    expect(row.boundary_kind).toBe('equity_share');
    expect(row.responsible_person_name).toBeNull();
    db.close();
  });
});
