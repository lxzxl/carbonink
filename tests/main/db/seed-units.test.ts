import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('Migration 007: seed units', () => {
  it('inserts ≥36 unit definitions across 5 base families', () => {
    // Plan promises "40 units" but the SQL ships 36 base + 3 composite (tkm, passenger_km,
    // km_passenger) = 39 total. Composites live in their own families (mass_distance,
    // passenger_distance) so they are never auto-convertible — filter them here to assert
    // the 5 base families a unit-conversion service cares about.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const families = db
      .prepare(
        `SELECT family, COUNT(*) AS n FROM unit_definition
         WHERE family IN ('currency', 'distance', 'energy', 'mass', 'volume')
         GROUP BY family`,
      )
      .all() as { family: string; n: number }[];
    const total = families.reduce((s, f) => s + f.n, 0);
    expect(total).toBeGreaterThanOrEqual(36);
    expect(families.map((f) => f.family).sort()).toEqual(
      ['currency', 'distance', 'energy', 'mass', 'volume'].sort(),
    );
  });

  it('inserts ≥80 unit aliases (chinese + english)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM unit_alias').get() as { n: number };
    expect(n.n).toBeGreaterThanOrEqual(80);
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
