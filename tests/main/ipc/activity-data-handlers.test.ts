import { runMigrations } from '@main/db/migrate';
import { createIpcContext, type IpcContext } from '@main/ipc/context';
import { activityDataHandlers } from '@main/ipc/handlers/activity-data';
import type { EmissionSource, Organization, ReportingPeriod, Site } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Smoke coverage for activity-data IPC glue. The actual pin + compute + insert
 * pipeline (single-tx semantics, CO2e math, dimension-mismatch error path) is
 * asserted in `activity-data-service.test.ts`; this file checks the IPC layer
 * Zod-parses input + returns the service result intact.
 */
describe('activity-data IPC handlers', () => {
  let db: Database.Database;
  let ctx: IpcContext;
  let handlers: ReturnType<typeof activityDataHandlers>;
  let org: Organization;
  let site: Site;
  let period: ReportingPeriod;
  let source: EmissionSource;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    ctx = createIpcContext({ db, now: () => '2026-05-11T00:00:00.000Z' });
    handlers = activityDataHandlers(ctx);

    org = ctx.organizationService.createOrganization({
      name_en: 'Acme',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    site = ctx.organizationService.createSite({
      organization_id: org.id,
      name_en: 'HQ',
      country_code: 'CN',
    });
    period = ctx.organizationService.createReportingPeriod({
      organization_id: org.id,
      year: 2024,
      granularity: 'annual',
    });
    source = ctx.emissionSourceService.create({
      site_id: site.id,
      name: 'Grid meter',
      scope: 2,
      category: 'electricity.grid',
    });
  });

  afterEach(() => db.close());

  it('activity:create computes CO2e and the row shows up under list/totals', () => {
    const created = handlers['activity:create']?.({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ef_factor_code: 'electricity.grid.cn.national.2024',
      ef_year: 2024,
      ef_source: 'MEE_China',
      ef_geography: 'CN',
      ef_dataset_version: '2024.q4',
    });
    if (!created) throw new Error('handler returned undefined');
    expect(created.id).toBeTruthy();
    expect(created.computed_co2e_kg).toBeCloseTo(570.3, 4);

    const listed = handlers['activity:list-by-period']?.({ reporting_period_id: period.id });
    expect(listed?.length).toBe(1);
    expect(listed?.[0]?.id).toBe(created.id);

    const totals = handlers['activity:totals-by-period']?.({ reporting_period_id: period.id });
    expect(totals?.total_co2e_kg).toBeCloseTo(570.3, 4);
    expect(totals?.scope2_kg).toBeCloseTo(570.3, 4);
    expect(totals?.scope1_kg).toBe(0);
  });

  it('activity:create rejects non-positive amount via ZodError', () => {
    expect(() =>
      handlers['activity:create']?.({
        emission_source_id: source.id,
        reporting_period_id: period.id,
        occurred_at_start: '2024-01-01',
        occurred_at_end: '2024-01-31',
        amount: 0,
        unit: 'kWh',
        ef_factor_code: 'electricity.grid.cn.national.2024',
        ef_year: 2024,
        ef_source: 'MEE_China',
        ef_geography: 'CN',
        ef_dataset_version: '2024.q4',
      }),
    ).toThrow(z.ZodError);
  });

  it('activity:totals-by-period returns zeros on an empty period', () => {
    const totals = handlers['activity:totals-by-period']?.({ reporting_period_id: period.id });
    expect(totals).toEqual({
      total_co2e_kg: 0,
      scope1_kg: 0,
      scope2_kg: 0,
      scope3_kg: 0,
    });
  });

  it('activity:get-by-id returns the activity joined with its pinned_ef', () => {
    const created = handlers['activity:create']?.({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ef_factor_code: 'electricity.grid.cn.national.2024',
      ef_year: 2024,
      ef_source: 'MEE_China',
      ef_geography: 'CN',
      ef_dataset_version: '2024.q4',
    });
    if (!created) throw new Error('handler returned undefined');

    const result = handlers['activity:get-by-id']?.({ id: created.id });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.id).toBe(created.id);
      expect(result.pinned_ef).toBeTruthy();
      expect(result.pinned_ef.factor_code).toBe('electricity.grid.cn.national.2024');
      expect(result.pinned_ef.year).toBe(2024);
    }
  });

  it('activity:get-by-id returns null for unknown id', () => {
    const result = handlers['activity:get-by-id']?.({ id: 'nonexistent' });
    expect(result).toBeNull();
  });

  it('activity:rebind-ef returns ok:true with old/new amounts and co2e on same-family units', () => {
    const created = handlers['activity:create']?.({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ef_factor_code: 'electricity.grid.cn.national.2024',
      ef_year: 2024,
      ef_source: 'MEE_China',
      ef_geography: 'CN',
      ef_dataset_version: '2024.q4',
    });
    if (!created) throw new Error('handler returned undefined');

    // Rebind to a different EF with the same unit.
    const result = handlers['activity:rebind-ef']?.({
      activity_id: created.id,
      new_ef_pk: {
        factor_code: 'electricity.grid.cn.national.2024',
        year: 2024,
        source: 'MEE_China',
        geography: 'CN',
        dataset_version: '2024.q4',
      },
    });
    expect(result).toBeTruthy();
    // Wait for the promise to resolve
    if (result && result instanceof Promise) {
      return result.then((resolved) => {
        expect((resolved as { ok: boolean }).ok).toBe(true);
        if ((resolved as { ok: boolean }).ok) {
          expect((resolved as { old_co2e_kg: number }).old_co2e_kg).toBeCloseTo(570.3, 4);
        }
      });
    }
  });

  it('activity:rebind-ef returns ok:false with UnitMismatch on cross-family rebind', () => {
    // Seed a diesel_L EF so the lookup succeeds.
    db.prepare(
      `INSERT INTO emission_factor (factor_code, year, source, geography, dataset_version,
         scope, category, input_unit, co2e_kg_per_unit, gwp_basis, name_zh, name_en,
         description_zh, description_en, ghg_protocol_path, notes, citation_url)
       VALUES ('diesel_L', 2024, 'MEE', 'CN', '2024.1', 1, 'fuel', 'L', 2.68, 'AR5',
               '柴油', 'Diesel', NULL, NULL, NULL, NULL, NULL)`,
    ).run();

    const created = handlers['activity:create']?.({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ef_factor_code: 'electricity.grid.cn.national.2024',
      ef_year: 2024,
      ef_source: 'MEE_China',
      ef_geography: 'CN',
      ef_dataset_version: '2024.q4',
    });
    if (!created) throw new Error('handler returned undefined');

    // Try to rebind to a fuel EF (cross-family from kWh).
    const result = handlers['activity:rebind-ef']?.({
      activity_id: created.id,
      new_ef_pk: {
        factor_code: 'diesel_L',
        year: 2024,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2024.1',
      },
    });
    expect(result).toBeTruthy();
    if (result && result instanceof Promise) {
      return result.then((resolved) => {
        expect((resolved as { ok: boolean }).ok).toBe(false);
        if (!(resolved as { ok: boolean }).ok) {
          expect((resolved as { error: { _tag: string } }).error._tag).toBe('UnitMismatch');
        }
      });
    }
  });
});
