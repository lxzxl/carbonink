import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('Migration 007: seed units', () => {
  it('inserts 39 unit definitions across 5 base families (+ 2 composite families)', () => {
    // SQL ships 36 base (energy/volume/mass/distance/currency) + 3 composite
    // (tkm, passenger_km, km_passenger) = 39 total. Composites live in their own families
    // (mass_distance, passenger_distance) so they are never auto-convertible — assert the
    // base-family set separately. Exact total pinned so accidental row drops fail CI loudly.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const totalRow = db.prepare('SELECT COUNT(*) AS n FROM unit_definition').get() as { n: number };
    expect(totalRow.n).toBe(39);
    const families = db
      .prepare(
        `SELECT DISTINCT family FROM unit_definition
         WHERE family IN ('currency', 'distance', 'energy', 'mass', 'volume')`,
      )
      .all() as { family: string }[];
    expect(families.map((f) => f.family).sort()).toEqual(
      ['currency', 'distance', 'energy', 'mass', 'volume'].sort(),
    );
  });

  it('inserts 79 unit aliases (chinese + english)', () => {
    // 81 seeded - 2 removed (万度, 斤) = 79. Exact count so accidental drops fail CI.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM unit_alias').get() as { n: number };
    expect(n.n).toBe(79);
  });

  it('inserts 5 fuel_property rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM fuel_property').get() as { n: number };
    expect(n.n).toBe(5);
  });

  it('all aliases reference existing units', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const orphans = db
      .prepare(
        `SELECT a.alias FROM unit_alias a
         LEFT JOIN unit_definition u ON a.canonical_unit = u.unit
         WHERE u.unit IS NULL`,
      )
      .all();
    expect(orphans).toEqual([]);
  });
});
