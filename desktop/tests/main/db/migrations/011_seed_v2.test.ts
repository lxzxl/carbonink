import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('migration 011 — seed v2 emission factors', () => {
  it('seeds at least 20 new EFs (total ≥32 with prior 12)', () => {
    const db = setupDb();
    const row = db.prepare(`SELECT COUNT(*) AS c FROM emission_factor`).get() as { c: number };
    expect(row.c).toBeGreaterThanOrEqual(32);
  });

  it('every seeded EF row has a non-empty citation_url and positive co2e_kg_per_unit', () => {
    const db = setupDb();
    const bad = db
      .prepare(
        `
      SELECT factor_code FROM emission_factor
      WHERE citation_url IS NULL OR citation_url = '' OR co2e_kg_per_unit <= 0
    `,
      )
      .all() as { factor_code: string }[];
    expect(bad).toEqual([]);
  });

  it('covers freight modes (road, rail, sea, air)', () => {
    const db = setupDb();
    for (const mode of ['road', 'rail', 'sea', 'air']) {
      const row = db
        .prepare(
          `
        SELECT COUNT(*) AS c FROM emission_factor
        WHERE category = ? OR category LIKE ?
      `,
        )
        .get(`freight.${mode}`, `freight.${mode}.%`) as { c: number };
      expect(row.c, `freight.${mode}`).toBeGreaterThan(0);
    }
  });

  it('covers travel modes (air, rail, taxi)', () => {
    const db = setupDb();
    for (const mode of ['air', 'rail', 'taxi']) {
      const row = db
        .prepare(
          `
        SELECT COUNT(*) AS c FROM emission_factor
        WHERE category = ? OR category LIKE ?
      `,
        )
        .get(`travel.${mode}`, `travel.${mode}.%`) as { c: number };
      expect(row.c, `travel.${mode}`).toBeGreaterThan(0);
    }
  });

  it('covers a generic-CNY purchase EF for service invoices', () => {
    const db = setupDb();
    const row = db
      .prepare(
        `
      SELECT factor_code FROM emission_factor
      WHERE input_unit = 'CNY' AND category LIKE 'purchase.%' LIMIT 1
    `,
      )
      .get();
    expect(row).toBeDefined();
  });
});
