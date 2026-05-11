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
});
