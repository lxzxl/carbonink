import { runMigrations } from '@main/db/migrate';
import { ActivityDataService } from '@main/services/activity-data-service';
import { CalculationService } from '@main/services/calculation-service';
import { EfService } from '@main/services/ef-service';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { OrganizationService } from '@main/services/organization-service';
import {
  DimensionMismatchError,
  UnitConversionService,
} from '@main/services/unit-conversion-service';
import type { EmissionSource, Organization, ReportingPeriod, Site } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FIXED_NOW = '2026-05-11T00:00:00.000Z';

// Composite PK + Zod input fields for CN national grid 2024.
const CN_NATIONAL = {
  ef_factor_code: 'electricity.grid.cn.national.2024',
  ef_year: 2024,
  ef_source: 'MEE_China',
  ef_geography: 'CN',
  ef_dataset_version: '2024.q4',
} as const;

const GASOLINE = {
  ef_factor_code: 'fuel.gasoline.combustion.global.2024',
  ef_year: 2024,
  ef_source: 'IPCC_AR6',
  ef_geography: 'GLOBAL',
  ef_dataset_version: '2024.v1',
} as const;

const NATURAL_GAS = {
  ef_factor_code: 'fuel.natural_gas.combustion.global.2024',
  ef_year: 2024,
  ef_source: 'IPCC_AR6',
  ef_geography: 'GLOBAL',
  ef_dataset_version: '2024.v1',
} as const;

const STEEL = {
  ef_factor_code: 'material.steel.global.average.2024',
  ef_year: 2024,
  ef_source: 'WorldSteel',
  ef_geography: 'GLOBAL',
  ef_dataset_version: '2024.annual',
} as const;

let db: Database.Database;
let unitConv: UnitConversionService;
let efService: EfService;
let calcService: CalculationService;
let orgService: OrganizationService;
let sourceService: EmissionSourceService;
let svc: ActivityDataService;

let org: Organization;
let site: Site;
let period: ReportingPeriod;
let scope1Source: EmissionSource;
let scope2Source: EmissionSource;
let scope3Source: EmissionSource;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const ctx = { db, now: () => FIXED_NOW };

  unitConv = new UnitConversionService({ db });
  efService = new EfService({ db, now: () => FIXED_NOW });
  calcService = new CalculationService({ unitConversion: unitConv });
  orgService = new OrganizationService(ctx);
  sourceService = new EmissionSourceService(ctx);
  svc = new ActivityDataService({
    ...ctx,
    efService,
    calculationService: calcService,
    unitConversionService: unitConv,
  });

  // Org + first site + reporting period.
  org = orgService.createOrganization({
    name_en: 'Acme Co',
    country_code: 'CN',
    boundary_kind: 'operational_control',
  });
  site = orgService.createSite({
    organization_id: org.id,
    name_en: 'HQ',
    country_code: 'CN',
  });
  period = orgService.createReportingPeriod({
    organization_id: org.id,
    year: 2024,
    granularity: 'annual',
  });

  // Sources, one per scope, all on the same site.
  scope1Source = sourceService.create({
    site_id: site.id,
    name: 'Boiler',
    scope: 1,
    category: 'fuel.stationary',
  });
  scope2Source = sourceService.create({
    site_id: site.id,
    name: 'Grid meter',
    scope: 2,
    category: 'electricity.grid',
  });
  scope3Source = sourceService.create({
    site_id: site.id,
    name: 'Steel purchase',
    scope: 3,
    category: 'purchased_goods',
  });
});

afterEach(() => db.close());

describe('ActivityDataService.create — happy path', () => {
  it('1000 kWh on CN national grid → activity row with computed_co2e_kg ≈ 570.3', () => {
    const row = svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });

    expect(row.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row.site_id).toBe(site.id);
    expect(row.emission_source_id).toBe(scope2Source.id);
    expect(row.reporting_period_id).toBe(period.id);
    expect(row.amount).toBe(1000);
    expect(row.unit).toBe('kWh');
    expect(row.computed_co2e_kg).toBeCloseTo(570.3, 4);
    expect(row.computed_at).toBe(FIXED_NOW);
    expect(row.created_at).toBe(FIXED_NOW);
    expect(row.updated_at).toBe(FIXED_NOW);
    expect(row.extraction_id).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.ef_factor_code).toBe(CN_NATIONAL.ef_factor_code);
  });

  it('pinning the same EF twice yields only one pinned_emission_factor row', () => {
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-02-01',
      occurred_at_end: '2024-02-28',
      amount: 500,
      unit: 'kWh',
      ...CN_NATIONAL,
    });

    const n = db
      .prepare(
        `SELECT COUNT(*) AS c FROM pinned_emission_factor
         WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
      )
      .get(
        CN_NATIONAL.ef_factor_code,
        CN_NATIONAL.ef_year,
        CN_NATIONAL.ef_source,
        CN_NATIONAL.ef_geography,
        CN_NATIONAL.ef_dataset_version,
      ) as { c: number };
    expect(n.c).toBe(1);

    const activities = svc.listByPeriod(period.id);
    expect(activities).toHaveLength(2);
  });
});

describe('ActivityDataService.create — error paths + transaction rollback', () => {
  it('throws when emission_source_id does not exist; leaves no pinned EF behind', () => {
    expect(() =>
      svc.create({
        emission_source_id: 'does_not_exist',
        reporting_period_id: period.id,
        occurred_at_start: '2024-01-01',
        occurred_at_end: '2024-01-31',
        amount: 1000,
        unit: 'kWh',
        ...CN_NATIONAL,
      }),
    ).toThrow(/emission_source not found/);

    // Rollback assertion: pinned_emission_factor must be empty.
    const n = db.prepare('SELECT COUNT(*) AS c FROM pinned_emission_factor').get() as {
      c: number;
    };
    expect(n.c).toBe(0);
    expect(svc.listByPeriod(period.id)).toHaveLength(0);
  });

  it('throws when emission_factor does not exist; leaves no activity_data behind', () => {
    expect(() =>
      svc.create({
        emission_source_id: scope2Source.id,
        reporting_period_id: period.id,
        occurred_at_start: '2024-01-01',
        occurred_at_end: '2024-01-31',
        amount: 1000,
        unit: 'kWh',
        ef_factor_code: 'nonexistent.ef',
        ef_year: 2024,
        ef_source: 'MEE_China',
        ef_geography: 'CN',
        ef_dataset_version: '2024.q4',
      }),
    ).toThrow(/emission_factor not found/i);

    const np = db.prepare('SELECT COUNT(*) AS c FROM pinned_emission_factor').get() as {
      c: number;
    };
    expect(np.c).toBe(0);
    const na = db.prepare('SELECT COUNT(*) AS c FROM activity_data').get() as { c: number };
    expect(na.c).toBe(0);
  });

  it('throws when emission_source is_active = 0 (soft-deleted)', () => {
    sourceService.delete(scope2Source.id);
    expect(() =>
      svc.create({
        emission_source_id: scope2Source.id,
        reporting_period_id: period.id,
        occurred_at_start: '2024-01-01',
        occurred_at_end: '2024-01-31',
        amount: 1000,
        unit: 'kWh',
        ...CN_NATIONAL,
      }),
    ).toThrow(/is_active|inactive|deactivated/i);

    // Nothing pinned, nothing inserted.
    const np = db.prepare('SELECT COUNT(*) AS c FROM pinned_emission_factor').get() as {
      c: number;
    };
    expect(np.c).toBe(0);
  });

  it('cross-family unit without fuel_code → DimensionMismatchError + rollback', () => {
    // CN national grid expects kWh (energy); pass kg (mass) without fuel_code.
    expect(() =>
      svc.create({
        emission_source_id: scope2Source.id,
        reporting_period_id: period.id,
        occurred_at_start: '2024-01-01',
        occurred_at_end: '2024-01-31',
        amount: 100,
        unit: 'kg',
        ...CN_NATIONAL,
      }),
    ).toThrow(DimensionMismatchError);

    const na = db.prepare('SELECT COUNT(*) AS c FROM activity_data').get() as { c: number };
    expect(na.c).toBe(0);
    // EF lookup + pin happen before compute, so pinned row exists.
    // (Transaction-rollback semantics: even pin gets rolled back since
    // compute throws inside the same transaction. Assert that too.)
    const np = db.prepare('SELECT COUNT(*) AS c FROM pinned_emission_factor').get() as {
      c: number;
    };
    expect(np.c).toBe(0);
  });
});

describe('ActivityDataService.create — cross-family conversion via fuel_code', () => {
  it('73 kg gasoline + fuel_code=gasoline → ~225 kg CO2e', () => {
    const row = svc.create({
      emission_source_id: scope1Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 73,
      unit: 'kg',
      fuel_code: 'gasoline',
      ...GASOLINE,
    });
    // 73 / 0.745 = 97.987 L; 97.987 × 2.296 ≈ 224.98 kg
    expect(row.computed_co2e_kg).toBeCloseTo(224.98, 1);
    expect(row.amount).toBe(73);
    expect(row.unit).toBe('kg');
  });
});

describe('ActivityDataService.getById', () => {
  it('returns the row for an existing id', () => {
    const created = svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    const fetched = svc.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.computed_co2e_kg).toBeCloseTo(570.3, 4);
  });

  it('returns null for a missing id', () => {
    expect(svc.getById('does_not_exist')).toBeNull();
  });
});

describe('ActivityDataService.listByPeriod', () => {
  it('returns activities for the period ordered by occurred_at_start ASC', () => {
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-03-01',
      occurred_at_end: '2024-03-31',
      amount: 300,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 100,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-02-01',
      occurred_at_end: '2024-02-28',
      amount: 200,
      unit: 'kWh',
      ...CN_NATIONAL,
    });

    const rows = svc.listByPeriod(period.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.occurred_at_start)).toEqual([
      '2024-01-01',
      '2024-02-01',
      '2024-03-01',
    ]);
  });

  it('returns empty array for a period with no activities', () => {
    expect(svc.listByPeriod(period.id)).toEqual([]);
  });
});

describe('ActivityDataService.listBySource', () => {
  it('returns only activities for the given source', () => {
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    svc.create({
      emission_source_id: scope1Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 100,
      unit: 'm3',
      ...NATURAL_GAS,
    });

    const scope2 = svc.listBySource(scope2Source.id);
    expect(scope2).toHaveLength(1);
    expect(scope2[0]?.emission_source_id).toBe(scope2Source.id);

    const scope1 = svc.listBySource(scope1Source.id);
    expect(scope1).toHaveLength(1);
    expect(scope1[0]?.emission_source_id).toBe(scope1Source.id);
  });
});

describe('ActivityDataService.delete', () => {
  it('hard-deletes the row', () => {
    const created = svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    expect(svc.getById(created.id)).not.toBeNull();
    svc.delete(created.id);
    expect(svc.getById(created.id)).toBeNull();
  });
});

describe('ActivityDataService.totalsByPeriod', () => {
  it('returns all zeros for an empty period', () => {
    const t = svc.totalsByPeriod(period.id);
    expect(t.total_co2e_kg).toBe(0);
    expect(t.scope1_kg).toBe(0);
    expect(t.scope2_kg).toBe(0);
    expect(t.scope3_kg).toBe(0);
  });

  it('attributes a single Scope 2 activity entirely to scope2_kg', () => {
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    const t = svc.totalsByPeriod(period.id);
    expect(t.total_co2e_kg).toBeCloseTo(570.3, 4);
    expect(t.scope1_kg).toBe(0);
    expect(t.scope2_kg).toBeCloseTo(570.3, 4);
    expect(t.scope3_kg).toBe(0);
  });

  it('splits mixed Scope 1 + 2 + 3 activities into the right buckets', () => {
    // Scope 2: 1000 kWh × 0.5703 = 570.3
    svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    // Scope 1: 100 m3 natural gas × 1.879 = 187.9
    svc.create({
      emission_source_id: scope1Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 100,
      unit: 'm3',
      ...NATURAL_GAS,
    });
    // Scope 3: 50 kg steel × 1.97 = 98.5
    svc.create({
      emission_source_id: scope3Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 50,
      unit: 'kg',
      ...STEEL,
    });

    const t = svc.totalsByPeriod(period.id);
    expect(t.scope1_kg).toBeCloseTo(187.9, 4);
    expect(t.scope2_kg).toBeCloseTo(570.3, 4);
    expect(t.scope3_kg).toBeCloseTo(98.5, 4);
    expect(t.total_co2e_kg).toBeCloseTo(187.9 + 570.3 + 98.5, 4);
  });
});

describe('ActivityDataService.rebindEf', () => {
  function seedActivity() {
    // Three emission_factor rows so we can rebind between them.
    db.prepare(
      `INSERT INTO emission_factor (factor_code, year, source, geography, dataset_version,
         scope, category, input_unit, co2e_kg_per_unit, gwp_basis, name_zh, name_en,
         description_zh, description_en, ghg_protocol_path, notes, citation_url)
       VALUES
         ('diesel_L', 2024, 'MEE',  'CN', '2024.1', 1, 'fuel', 'L',  2.68, 'AR5', '柴油', 'Diesel', NULL, NULL, NULL, NULL, NULL),
         ('diesel_kg', 2025, 'IPCC', 'CN', '2025.1', 1, 'fuel', 'kg', 3.17, 'AR5', '柴油', 'Diesel', NULL, NULL, NULL, NULL, NULL),
         ('grid_kWh',  2025, 'MEE',  'CN', '2025.1', 2, 'electricity', 'kWh', 0.5703, 'AR5', '电网', 'Grid', NULL, NULL, NULL, NULL, NULL)`,
    ).run();
    // Pin diesel_L (the initial EF).
    db.prepare(
      `INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
         scope, category, input_unit, co2e_kg_per_unit, gwp_basis, name_zh, name_en,
         description_zh, description_en, ghg_protocol_path, citation_url, pinned_at, pinned_from)
       VALUES ('diesel_L', 2024, 'MEE', 'CN', '2024.1', 1, 'fuel', 'L', 2.68, 'AR5',
               '柴油', 'Diesel', NULL, NULL, NULL, NULL, '2026-01-01', 'app.sqlite')`,
    ).run();
    // Activity with 1000 L diesel, pinned to diesel_L. computed_co2e_kg = 1000 * 2.68 = 2680.
    const stmt = db.prepare(
      `INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
         occurred_at_start, occurred_at_end, amount, unit,
         ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
         computed_co2e_kg, computed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?,
               '2025-04-01', '2025-04-30', 1000, 'L',
               'diesel_L', 2024, 'MEE', 'CN', '2024.1',
               2680, '2025-05-01', '2025-05-01', '2025-05-01')`,
    );
    stmt.run('act-1', site.id, scope1Source.id, period.id);
  }

  it('rebinds when units match exactly', () => {
    seedActivity();
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: {
        factor_code: 'diesel_L',
        year: 2024,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2024.1',
      },
    });
    expect(result.ok).toBe(true);
    // Trivial rebind to same EF — co2e unchanged.
    if (result.ok) {
      expect(result.old_co2e_kg).toBe(2680);
      expect(result.new_co2e_kg).toBe(2680);
    }
    const audit = db
      .prepare(`SELECT * FROM audit_event WHERE event_kind = 'activity_rebind_ef'`)
      .all() as Array<{ payload: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toBeDefined();
    const payload = JSON.parse(audit[0]!.payload);
    expect(payload.activity_id).toBe('act-1');
    expect(payload.old_ef.factor_code).toBe('diesel_L');
    expect(payload.new_ef.factor_code).toBe('diesel_L');
  });

  it('rebinds with same-family unit conversion (L → kg) or rejects with UnitMismatch', () => {
    seedActivity();
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: {
        factor_code: 'diesel_kg',
        year: 2025,
        source: 'IPCC',
        geography: 'CN',
        dataset_version: '2025.1',
      },
    });
    // L → kg without a fuel binding is cross-family in the existing
    // unit-conversion-service (the family for L is "volume", for kg is "mass").
    // Therefore expect UnitMismatch:
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe('UnitMismatch');
    }
  });

  it('refuses cross-family rebind (no fuel binding) with UnitMismatch', () => {
    seedActivity();
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: {
        factor_code: 'grid_kWh',
        year: 2025,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2025.1',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe('UnitMismatch');
    }
    // Activity row unchanged.
    const row = db
      .prepare(`SELECT computed_co2e_kg FROM activity_data WHERE id = 'act-1'`)
      .get() as { computed_co2e_kg: number };
    expect(row.computed_co2e_kg).toBe(2680);
    // No audit_event written.
    const audit = db.prepare(`SELECT COUNT(*) AS c FROM audit_event`).get() as { c: number };
    expect(audit.c).toBe(0);
  });

  it('cross-family rebind with override_amount succeeds and bypasses conversion', () => {
    seedActivity();
    // 1000 L diesel → switch to grid_kWh at 0.5703 kg/kWh, override_amount = 250 kWh.
    // Expected new co2e = 250 * 0.5703 = 142.575 kg.
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: {
        factor_code: 'grid_kWh',
        year: 2025,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2025.1',
      },
      override_amount: 250,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.new_amount).toBe(250);
      expect(result.new_unit).toBe('kWh');
      expect(result.new_co2e_kg).toBeCloseTo(142.575, 3);
      expect(result.old_amount).toBe(1000);
      expect(result.old_unit).toBe('L');
      expect(result.old_co2e_kg).toBe(2680);
    }
    // Activity row updated.
    const row = db
      .prepare(`SELECT amount, unit, computed_co2e_kg FROM activity_data WHERE id = 'act-1'`)
      .get() as { amount: number; unit: string; computed_co2e_kg: number };
    expect(row.amount).toBe(250);
    expect(row.unit).toBe('kWh');
    expect(row.computed_co2e_kg).toBeCloseTo(142.575, 3);
    // Audit event recorded the cross-family rebind with new amount/unit.
    const audit = db
      .prepare(`SELECT payload FROM audit_event WHERE event_kind = 'activity_rebind_ef'`)
      .all() as Array<{ payload: string }>;
    expect(audit).toHaveLength(1);
    const payload = JSON.parse(audit[0]!.payload);
    expect(payload.old_unit).toBe('L');
    expect(payload.new_unit).toBe('kWh');
    expect(payload.old_amount).toBe(1000);
    expect(payload.new_amount).toBe(250);
  });

  it('returns NotFound when activity_id is unknown', () => {
    seedActivity();
    const result = svc.rebindEf({
      activity_id: 'ghost',
      new_ef_pk: {
        factor_code: 'diesel_L',
        year: 2024,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2024.1',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('NotFound');
  });

  it('returns EfNotFound when new_ef_pk has no matching emission_factor row', () => {
    seedActivity();
    const result = svc.rebindEf({
      activity_id: 'act-1',
      new_ef_pk: {
        factor_code: 'phantom',
        year: 2025,
        source: 'NONE',
        geography: 'CN',
        dataset_version: '2025.1',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe('EfNotFound');
  });
});

describe('ActivityDataService.getByIdWithEf', () => {
  function seedActivity() {
    db.prepare(
      `INSERT INTO emission_factor (factor_code, year, source, geography, dataset_version,
         scope, category, input_unit, co2e_kg_per_unit, gwp_basis, name_zh, name_en,
         description_zh, description_en, ghg_protocol_path, notes, citation_url)
       VALUES ('diesel_L', 2024, 'MEE',  'CN', '2024.1', 1, 'fuel', 'L',  2.68, 'AR5', '柴油', 'Diesel', NULL, NULL, NULL, NULL, NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
         scope, category, input_unit, co2e_kg_per_unit, gwp_basis, name_zh, name_en,
         description_zh, description_en, ghg_protocol_path, citation_url, pinned_at, pinned_from)
       VALUES ('diesel_L', 2024, 'MEE', 'CN', '2024.1', 1, 'fuel', 'L', 2.68, 'AR5',
               '柴油', 'Diesel', NULL, NULL, NULL, NULL, '2026-01-01', 'app.sqlite')`,
    ).run();
    const stmt = db.prepare(
      `INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id,
         occurred_at_start, occurred_at_end, amount, unit,
         ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
         computed_co2e_kg, computed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?,
               '2025-04-01', '2025-04-30', 1000, 'L',
               'diesel_L', 2024, 'MEE', 'CN', '2024.1',
               2680, '2025-05-01', '2025-05-01', '2025-05-01')`,
    );
    stmt.run('act-1', site.id, scope1Source.id, period.id);
  }

  it('returns the activity joined with its pinned_ef', () => {
    seedActivity();
    const row = svc.getByIdWithEf('act-1');
    expect(row).not.toBeNull();
    if (row) {
      expect(row.id).toBe('act-1');
      expect(row.pinned_ef.factor_code).toBe('diesel_L');
      expect(row.pinned_ef.year).toBe(2024);
    }
  });

  it('returns null for unknown id', () => {
    seedActivity();
    expect(svc.getByIdWithEf('ghost')).toBeNull();
  });
});
