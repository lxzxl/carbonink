import { runMigrations } from '@main/db/migrate';
import { EfService } from '@main/services/ef-service';
import type { EfCompositePk } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let db: Database.Database;
let svc: EfService;

const FIXED_NOW = '2026-05-11T00:00:00.000Z';

const PK_CN_EAST: EfCompositePk = {
  factor_code: 'electricity.grid.cn.east.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN-East',
  dataset_version: '2024.q4',
};

const PK_CN_NATIONAL: EfCompositePk = {
  factor_code: 'electricity.grid.cn.national.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN',
  dataset_version: '2024.q4',
};

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  svc = new EfService({ db, now: () => FIXED_NOW });
});

afterEach(() => db.close());

describe('EfService.list', () => {
  it('returns 5 grid EFs for { category: electricity.grid, scope: 2 }', () => {
    const rows = svc.list({ category: 'electricity.grid', scope: 2 });
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.category).toBe('electricity.grid');
      expect(r.scope).toBe(2);
    }
  });

  it('returns 1 row for { geography: "CN-East" }', () => {
    const rows = svc.list({ geography: 'CN-East' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.factor_code).toBe('electricity.grid.cn.east.2024');
  });

  it('returns the full seeded set when called with no filters', () => {
    const rows = svc.list({});
    // Migration 008 seeds 12 EFs; migration 011 adds 20 more (32 total).
    expect(rows).toHaveLength(32);
  });

  it('AND-combines factor_code with other filters', () => {
    // factor_code matches but scope mismatches → empty.
    expect(svc.list({ factor_code: 'electricity.grid.cn.east.2024', scope: 1 })).toHaveLength(0);
    expect(svc.list({ factor_code: 'electricity.grid.cn.east.2024', scope: 2 })).toHaveLength(1);
  });

  // Bridges the source/catalog granularity gap: `emission_source.category` is
  // coarse (e.g. 'travel.air') while the EF catalog goes finer
  // (travel.air.economy.shorthaul). Prefix-match lets a coarse source category
  // pull in all matching finer-grained EFs.
  it('returns all travel.air.* EFs for { category: "travel.air" } (prefix-match)', () => {
    const rows = svc.list({ category: 'travel.air' });
    // Migration 011 seeds 3 travel.air.* variants:
    // economy.shorthaul, economy.longhaul, business.longhaul.
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.category).toMatch(/^travel\.air(\.|$)/);
    }
  });

  it('still exact-matches { category: "travel.air.economy.shorthaul" }', () => {
    const rows = svc.list({ category: 'travel.air.economy.shorthaul' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.category).toBe('travel.air.economy.shorthaul');
  });

  it('returns all travel.* EFs for { category: "travel" } (prefix-match at top level)', () => {
    const rows = svc.list({ category: 'travel' });
    // 3 air + 2 rail + 1 taxi = 6 travel.* EFs in migration 011.
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.category).toMatch(/^travel\./);
    }
  });
});

describe('EfService.get', () => {
  it('returns the row for an existing composite PK', () => {
    const row = svc.get(PK_CN_EAST);
    expect(row).not.toBeNull();
    expect(row?.factor_code).toBe(PK_CN_EAST.factor_code);
    expect(row?.co2e_kg_per_unit).toBeCloseTo(0.5586, 4);
    expect(row?.input_unit).toBe('kWh');
  });

  it('returns null for a non-existent PK', () => {
    const row = svc.get({
      factor_code: 'nonexistent',
      year: 2024,
      source: 'MEE_China',
      geography: 'CN-East',
      dataset_version: '2024.q4',
    });
    expect(row).toBeNull();
  });
});

describe('EfService.pin', () => {
  it('first pin copies row from emission_factor and stamps pinned_at + pinned_from', () => {
    const pinned = svc.pin(PK_CN_EAST);
    expect(pinned.factor_code).toBe(PK_CN_EAST.factor_code);
    expect(pinned.co2e_kg_per_unit).toBeCloseTo(0.5586, 4);
    expect(pinned.input_unit).toBe('kWh');
    expect(pinned.pinned_at).toBe(FIXED_NOW);
    expect(pinned.pinned_from).toBe('app.sqlite');

    // Persisted in pinned_emission_factor.
    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM pinned_emission_factor
         WHERE factor_code = ? AND year = ? AND source = ?
           AND geography = ? AND dataset_version = ?`,
      )
      .get(
        PK_CN_EAST.factor_code,
        PK_CN_EAST.year,
        PK_CN_EAST.source,
        PK_CN_EAST.geography,
        PK_CN_EAST.dataset_version,
      ) as { c: number };
    expect(count.c).toBe(1);
  });

  it('is idempotent: second pin returns existing row with original pinned_at', () => {
    const first = svc.pin(PK_CN_EAST);
    expect(first.pinned_at).toBe(FIXED_NOW);

    // Swap clock so a non-idempotent impl would overwrite pinned_at.
    const LATER = '2027-01-01T00:00:00.000Z';
    const svc2 = new EfService({ db, now: () => LATER });
    const second = svc2.pin(PK_CN_EAST);

    expect(second.pinned_at).toBe(FIXED_NOW); // unchanged
    expect(second.factor_code).toBe(first.factor_code);

    // Still exactly one pinned row.
    const count = db.prepare('SELECT COUNT(*) AS c FROM pinned_emission_factor').get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it('returns a row matching the source EF fields plus pin metadata', () => {
    const source = svc.get(PK_CN_NATIONAL);
    const pinned = svc.pin(PK_CN_NATIONAL);
    expect(source).not.toBeNull();
    if (!source) return;
    expect(pinned.factor_code).toBe(source.factor_code);
    expect(pinned.year).toBe(source.year);
    expect(pinned.source).toBe(source.source);
    expect(pinned.geography).toBe(source.geography);
    expect(pinned.dataset_version).toBe(source.dataset_version);
    expect(pinned.scope).toBe(source.scope);
    expect(pinned.category).toBe(source.category);
    expect(pinned.input_unit).toBe(source.input_unit);
    expect(pinned.co2e_kg_per_unit).toBe(source.co2e_kg_per_unit);
    expect(pinned.gwp_basis).toBe(source.gwp_basis);
    expect(pinned.name_zh).toBe(source.name_zh);
    expect(pinned.citation_url).toBe(source.citation_url);
    expect(pinned.pinned_at).toBe(FIXED_NOW);
    expect(pinned.pinned_from).toBe('app.sqlite');
  });

  it('throws for a non-existent composite PK', () => {
    expect(() =>
      svc.pin({
        factor_code: 'nonexistent',
        year: 2024,
        source: 'MEE_China',
        geography: 'CN-East',
        dataset_version: '2024.q4',
      }),
    ).toThrow(/emission_factor not found/);
  });

  it('uses defaultNow when no clock is injected', () => {
    const svcDefault = new EfService({ db });
    const before = new Date().toISOString();
    const pinned = svcDefault.pin(PK_CN_EAST);
    const after = new Date().toISOString();
    // ISO 8601 strings are lexicographically comparable.
    expect(pinned.pinned_at >= before).toBe(true);
    expect(pinned.pinned_at <= after).toBe(true);
  });
});
