import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAppDb, openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { OrganizationService } from '@main/services/organization-service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('OrganizationService', () => {
  let svc: OrganizationService;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cb-orgsvc-${Date.now()}-${Math.random()}.sqlite`);
    const db = openAppDb(dbPath);
    runMigrations(db);
    svc = new OrganizationService({ db, now: () => '2026-05-09T00:00:00Z' });
  });

  afterEach(() => {
    closeAppDb();
    try {
      rmSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('createOrganization persists and returns full row', () => {
    const org = svc.createOrganization({
      name_zh: '中山钢铁有限公司',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    expect(org.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(org.name_zh).toBe('中山钢铁有限公司');
    expect(org.boundary_kind).toBe('operational_control');
  });

  it('createSite links to existing organization', () => {
    const org = svc.createOrganization({
      name_en: 'Acme Co.',
      country_code: 'CN',
      boundary_kind: 'equity_share',
    });
    const site = svc.createSite({
      organization_id: org.id,
      name_zh: '主厂区',
      country_code: 'CN',
    });
    expect(site.organization_id).toBe(org.id);
    expect(site.name_zh).toBe('主厂区');
  });

  it('createSite rejects when organization_id does not exist', () => {
    expect(() =>
      svc.createSite({ organization_id: 'org_nope', name_en: 'X', country_code: 'CN' }),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('hasAnyOrganization returns false initially, true after create', () => {
    expect(svc.hasAnyOrganization()).toBe(false);
    svc.createOrganization({ name_en: 'X', country_code: 'CN', boundary_kind: 'equity_share' });
    expect(svc.hasAnyOrganization()).toBe(true);
  });

  it('createOrganization rejects a second organization (singleton enforced)', () => {
    svc.createOrganization({ name_en: 'First', country_code: 'CN', boundary_kind: 'equity_share' });
    expect(() =>
      svc.createOrganization({
        name_en: 'Second',
        country_code: 'CN',
        boundary_kind: 'equity_share',
      }),
    ).toThrow(/singleton|UNIQUE|already exists/i);
  });

  it('createReportingPeriod creates annual period with correct date range', () => {
    const org = svc.createOrganization({
      name_en: 'Acme',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    const period = svc.createReportingPeriod({
      organization_id: org.id,
      year: 2025,
      granularity: 'annual',
    });
    expect(period.year).toBe(2025);
    expect(period.granularity).toBe('annual');
    expect(period.starts_at).toBe('2025-01-01T00:00:00.000Z');
    expect(period.ends_at).toBe('2025-12-31T23:59:59.999Z');
  });

  it('createReportingPeriod is idempotent — duplicate (org, year, annual) rejected by UNIQUE', () => {
    const org = svc.createOrganization({
      name_en: 'Acme',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    svc.createReportingPeriod({ organization_id: org.id, year: 2025, granularity: 'annual' });
    expect(() =>
      svc.createReportingPeriod({ organization_id: org.id, year: 2025, granularity: 'annual' }),
    ).toThrow(/UNIQUE/i);
  });

  it('listReportingPeriodsByOrganization returns periods in created order', () => {
    const org = svc.createOrganization({
      name_en: 'Acme',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    svc.createReportingPeriod({ organization_id: org.id, year: 2024, granularity: 'annual' });
    svc.createReportingPeriod({ organization_id: org.id, year: 2025, granularity: 'annual' });
    const list = svc.listReportingPeriodsByOrganization(org.id);
    expect(list.length).toBe(2);
    expect(list[0]?.year).toBe(2024);
    expect(list[1]?.year).toBe(2025);
  });

  it('completeOnboarding creates org+site+period atomically', () => {
    const result = svc.completeOnboarding({
      organization: {
        name_zh: '中山钢铁',
        country_code: 'CN',
        boundary_kind: 'operational_control',
      },
      first_site: { name_zh: '主厂区', country_code: 'CN' },
      reporting_period: { year: 2025, granularity: 'annual' },
    });
    expect(result.organization.id).toBeTruthy();
    expect(result.site.organization_id).toBe(result.organization.id);
    expect(result.reporting_period.organization_id).toBe(result.organization.id);
    expect(result.reporting_period.year).toBe(2025);
  });

  it('completeOnboarding accepts empty string for one of the bilingual name fields (treats as NULL)', () => {
    const result = svc.completeOnboarding({
      organization: {
        name_zh: '中山钢铁',
        name_en: '   ',
        country_code: 'CN',
        boundary_kind: 'operational_control',
      },
      first_site: { name_zh: '主厂区', name_en: '', country_code: 'CN' },
      reporting_period: { year: 2025, granularity: 'annual' },
    });
    expect(result.organization.name_zh).toBe('中山钢铁');
    expect(result.organization.name_en).toBeNull();
    expect(result.site.name_zh).toBe('主厂区');
    expect(result.site.name_en).toBeNull();
  });

  it('completeOnboarding rolls back when reporting_period is invalid (no half state)', () => {
    const orgSvc = svc;
    const original = orgSvc.createReportingPeriod.bind(orgSvc);
    (
      orgSvc as unknown as { createReportingPeriod: (i: unknown) => unknown }
    ).createReportingPeriod = () => {
      throw new Error('synthetic period failure');
    };
    expect(() =>
      orgSvc.completeOnboarding({
        organization: {
          name_en: 'Rollback Co',
          country_code: 'CN',
          boundary_kind: 'operational_control',
        },
        first_site: { name_en: 'Site', country_code: 'CN' },
        reporting_period: { year: 2025, granularity: 'annual' },
      }),
    ).toThrow(/synthetic period failure/);
    (orgSvc as unknown as { createReportingPeriod: typeof original }).createReportingPeriod =
      original;
    expect(orgSvc.hasAnyOrganization()).toBe(false);
  });

  describe('OrganizationService.updateReportingProfile', () => {
    it('updates responsible person + boundary + base_year_period_id', () => {
      const org = svc.createOrganization({
        name_zh: '中山钢铁有限公司',
        country_code: 'CN',
        boundary_kind: 'operational_control',
      });
      svc.createReportingPeriod({
        organization_id: org.id,
        year: 2024,
        granularity: 'annual',
      });
      const period = svc.createReportingPeriod({
        organization_id: org.id,
        year: 2025,
        granularity: 'annual',
      });

      svc.updateReportingProfile({
        id: org.id,
        boundary_kind: 'financial_control',
        responsible_person_name: '张三',
        responsible_person_role: '可持续发展负责人',
        base_year_period_id: period.id,
      });

      const updated = svc.getOrganization(org.id);
      expect(updated?.boundary_kind).toBe('financial_control');
      expect(updated?.responsible_person_name).toBe('张三');
      expect(updated?.responsible_person_role).toBe('可持续发展负责人');
      expect(updated?.base_year_period_id).toBe(period.id);
    });
  });
});
