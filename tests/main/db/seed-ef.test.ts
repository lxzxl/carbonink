import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('Migration 008: seed emission factors', () => {
  it('inserts 12 EFs', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM emission_factor').get() as { n: number };
    expect(n.n).toBe(12);
  });

  it('includes all 4 China grid regional EFs + national', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const grids = db
      .prepare(
        "SELECT factor_code FROM emission_factor WHERE factor_code LIKE 'electricity.grid.cn.%' ORDER BY factor_code",
      )
      .all() as { factor_code: string }[];
    expect(grids.map((g) => g.factor_code)).toEqual([
      'electricity.grid.cn.east.2024',
      'electricity.grid.cn.national.2024',
      'electricity.grid.cn.north.2024',
      'electricity.grid.cn.south.2024',
    ]);
  });

  it('all EFs use AR6 gwp_basis', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const others = db
      .prepare("SELECT factor_code FROM emission_factor WHERE gwp_basis != 'AR6'")
      .all();
    expect(others).toEqual([]);
  });

  it('all EFs reference units that exist in unit_definition', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const orphans = db
      .prepare(
        `SELECT ef.factor_code, ef.input_unit FROM emission_factor ef
         LEFT JOIN unit_definition u ON ef.input_unit = u.unit
         WHERE u.unit IS NULL`,
      )
      .all();
    expect(orphans).toEqual([]);
  });

  it('pins exact co2e_kg_per_unit for representative rows (paste-error guard)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const cases: Array<[string, number]> = [
      ['electricity.grid.cn.national.2024', 0.5703],
      ['electricity.grid.cn.east.2024', 0.5586],
      ['fuel.gasoline.combustion.global.2024', 2.296],
      ['fuel.diesel.combustion.global.2024', 2.683],
      ['fuel.natural_gas.combustion.global.2024', 1.879],
    ];
    for (const [code, expected] of cases) {
      const row = db
        .prepare('SELECT co2e_kg_per_unit FROM emission_factor WHERE factor_code = ?')
        .get(code) as { co2e_kg_per_unit: number };
      expect(row.co2e_kg_per_unit).toBeCloseTo(expected, 4);
    }
  });
});
