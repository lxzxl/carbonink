import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function efRowCount(db: Database.Database, table: 'emission_factor' | 'ef_fts'): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return row.c;
}

function insertTestEf(db: Database.Database, factor_code: string, name_zh: string) {
  db.prepare(`
    INSERT INTO emission_factor (
      factor_code, year, source, geography, dataset_version,
      scope, category, input_unit, co2e_kg_per_unit, gwp_basis,
      name_zh, name_en, description_zh, description_en, citation_url
    ) VALUES (?, 2024, 'TEST', 'GLOBAL', '2024.q1',
              1, 'test.cat', 'kg', 1.0, 'AR6',
              ?, '', '', '', 'http://example.com')
  `).run(factor_code, name_zh);
}

describe('migration 010 — ef_fts virtual table', () => {
  it('creates ef_fts and backfills from emission_factor', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    expect(efRowCount(db, 'ef_fts')).toBe(efRowCount(db, 'emission_factor'));
  });

  it('INSERT trigger keeps ef_fts in sync', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const before = efRowCount(db, 'ef_fts');
    insertTestEf(db, 'test.trigger.insert', '柴油测试');
    expect(efRowCount(db, 'ef_fts')).toBe(before + 1);
    const hit = db.prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`).get('柴油测试') as
      | { factor_code: string }
      | undefined;
    expect(hit?.factor_code).toBe('test.trigger.insert');
  });

  it('UPDATE trigger keeps ef_fts in sync', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    insertTestEf(db, 'test.trigger.update', '原始名称');
    db.prepare(`UPDATE emission_factor SET name_zh = ? WHERE factor_code = ?`).run(
      '更新后名称',
      'test.trigger.update',
    );
    const oldHit = db
      .prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`)
      .get('原始名称');
    const newHit = db
      .prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`)
      .get('更新后名称') as { factor_code: string } | undefined;
    expect(oldHit).toBeUndefined();
    expect(newHit?.factor_code).toBe('test.trigger.update');
  });

  it('DELETE trigger keeps ef_fts in sync', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    insertTestEf(db, 'test.trigger.delete', '将被删除');
    db.prepare(`DELETE FROM emission_factor WHERE factor_code = ?`).run('test.trigger.delete');
    const hit = db.prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`).get('将被删除');
    expect(hit).toBeUndefined();
  });

  it('supports FTS5 bm25() ranking function', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    // Insert test factors
    insertTestEf(db, 'test.bm25.a', '电网');
    insertTestEf(db, 'test.bm25.b', '测试');
    // Query using bm25() to verify the function works
    const rows = db
      .prepare(
        `SELECT factor_code, bm25(ef_fts) AS rank FROM ef_fts
         WHERE factor_code LIKE 'test.bm25.%'
         ORDER BY rank ASC`,
      )
      .all() as { factor_code: string; rank: number }[];
    expect(rows.length).toBe(2);
    // Both should have valid ranks (0 or negative)
    expect(typeof rows[0]?.rank).toBe('number');
    expect(typeof rows[1]?.rank).toBe('number');
  });
});
