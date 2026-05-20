import { runMigrations } from '@main/db/migrate';
import { ReportDataService } from '@main/services/report-data-service';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function seedInventory(db: Database.Database) {
  // Organization with 1 site, 1 period, 3 sources across scope 1+2+3, 4 activities.
  db.prepare(
    `INSERT INTO organization (id, name_zh, name_en, industry, country_code, boundary_kind,
       responsible_person_name, responsible_person_role, recalc_threshold_pct, created_at, updated_at)
     VALUES ('org-1', '测试公司', 'Test Co', '制造业', 'CN', 'operational_control',
       '张三', '可持续发展负责人', 5.0, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO site (id, organization_id, name_zh, name_en, address, country_code, is_active, created_at, updated_at)
     VALUES ('site-1', 'org-1', '北京工厂', 'Beijing Plant', '北京市朝阳区', 'CN', 1, '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
     VALUES ('per-2025', 'org-1', 2025, 'annual', '2025-01-01', '2025-12-31', 1, '2025-01-01')`,
  ).run();
  // Need 3 emission_sources to exercise scope 1/2/3.
  db.prepare(
    `INSERT INTO emission_source (id, site_id, name, scope)
     VALUES ('src-1', 'site-1', '公司车队柴油', 1),
            ('src-2', 'site-1', '电网电力', 2),
            ('src-3', 'site-1', '外购运输', 3)`,
  ).run();
  // Pin 3 EFs (one per source). Schema: pinned_emission_factor has composite PK.
  db.prepare(
    `INSERT INTO pinned_emission_factor (
       factor_code, year, source, geography, dataset_version, scope, category,
       ghg_protocol_path, input_unit, co2e_kg_per_unit, gwp_basis,
       pinned_at, pinned_from
     ) VALUES
     ('diesel_kg', 2025, 'IPCC', 'CN', '2025.1', 1, 'fuel', 'scope1', 'kg', 3.16, 'AR5', '2025-01-01', 'app.sqlite'),
     ('grid_kwh',  2025, 'MEE',  'CN', '2025.1', 2, 'electricity', 'scope2', 'kWh', 0.5703, 'AR5', '2025-01-01', 'app.sqlite'),
     ('truck_tkm', 2025, 'IPCC', 'CN', '2025.1', 3, 'transport', 'scope3', 't*km', 0.11, 'AR5', '2025-01-01', 'app.sqlite')`,
  ).run();
  // 4 activities — note computed_co2e_kg is precomputed
  db.prepare(
    `INSERT INTO activity_data (id, site_id, emission_source_id, reporting_period_id, occurred_at_start, occurred_at_end,
       amount, unit, ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
       computed_co2e_kg, computed_at, created_at, updated_at)
     VALUES
     ('act-1', 'site-1', 'src-1', 'per-2025', '2025-03-01', '2025-03-01', 1000, 'kg',
      'diesel_kg', 2025, 'IPCC', 'CN', '2025.1', 3160, '2025-03-01', '2025-03-01', '2025-03-01'),
     ('act-2', 'site-1', 'src-2', 'per-2025', '2025-03-01', '2025-03-01', 50000, 'kWh',
      'grid_kwh', 2025, 'MEE', 'CN', '2025.1', 28515, '2025-03-01', '2025-03-01', '2025-03-01'),
     ('act-3', 'site-1', 'src-2', 'per-2025', '2025-03-01', '2025-03-01', 10000, 'kWh',
      'grid_kwh', 2025, 'MEE', 'CN', '2025.1', 5703, '2025-03-01', '2025-03-01', '2025-03-01'),
     ('act-4', 'site-1', 'src-3', 'per-2025', '2025-03-01', '2025-03-01', 200, 't*km',
      'truck_tkm', 2025, 'IPCC', 'CN', '2025.1', 22, '2025-03-01', '2025-03-01', '2025-03-01')`,
  ).run();
}

describe('ReportDataService.assembleReportData', () => {
  it('assembles full InventoryReportData with scope totals', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedInventory(db);
    const svc = new ReportDataService({ db });
    const data = svc.assembleReportData({
      reporting_period_id: 'per-2025',
      language: 'zh-CN',
    });

    expect(data.org.name_zh).toBe('测试公司');
    expect(data.org.boundary_kind).toBe('operational_control');
    expect(data.org.responsible.name).toBe('张三');
    expect(data.period.year).toBe(2025);
    expect(data.period.granularity).toBe('annual');
    expect(data.sites).toHaveLength(1);
    expect(data.sites[0]?.name_zh).toBe('北京工厂');
    expect(data.scope_totals.scope1_kg).toBe(3160);
    expect(data.scope_totals.scope2_kg).toBe(34218); // 28515 + 5703
    expect(data.scope_totals.scope3_kg).toBe(22);
    expect(data.scope_totals.total_kg).toBe(37400);
    expect(data.scope_totals.biogenic_kg).toBe(0);
    expect(data.all_sources).toHaveLength(3);
    expect(data.activities).toHaveLength(4);
    expect(data.activities[0]?.source_name).toBeTruthy();
    expect(data.activities[0]?.unit).toBeTruthy();
    db.close();
  });

  it('computes share_pct per source against total emissions', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedInventory(db);
    const svc = new ReportDataService({ db });
    const data = svc.assembleReportData({
      reporting_period_id: 'per-2025',
      language: 'zh-CN',
    });
    const grid = data.all_sources.find((s) => s.name === '电网电力');
    expect(grid).toBeDefined();
    expect(grid!.co2e_kg).toBe(34218);
    // 34218 / 37400 ≈ 91.49%
    expect(grid!.share_pct).toBeCloseTo(91.49, 1);
    db.close();
  });

  it('returns null prior_period_summary when no prior period exists', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedInventory(db);
    const svc = new ReportDataService({ db });
    const data = svc.assembleReportData({
      reporting_period_id: 'per-2025',
      language: 'zh-CN',
    });
    expect(data.prior_period_summary).toBeNull();
    expect(data.base_year_summary).toBeNull();
    db.close();
  });

  it('throws when reporting_period_id is unknown', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const svc = new ReportDataService({ db });
    expect(() =>
      svc.assembleReportData({ reporting_period_id: 'ghost', language: 'zh-CN' }),
    ).toThrow(/not found/i);
    db.close();
  });
});
