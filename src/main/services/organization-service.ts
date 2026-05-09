import type { ServiceContext } from './base.js';
import { newId } from '@shared/ulid.js';
import type {
  Organization,
  OrganizationCreateInput,
  Site,
  SiteCreateInput,
  ReportingPeriod,
  ReportingPeriodCreateInput,
  CompleteOnboardingInput,
} from '@shared/types.js';
import {
  organizationCreateInput,
  siteCreateInput,
  reportingPeriodCreateInput,
  completeOnboardingInput,
} from '@shared/types.js';

export class OrganizationService {
  constructor(private readonly ctx: ServiceContext) {}

  createOrganization(input: OrganizationCreateInput): Organization {
    const parsed = organizationCreateInput.parse(input);
    if (this.hasAnyOrganization()) {
      throw new Error('Organization already exists (singleton enforced — only one per app instance).');
    }
    const id = newId();
    const ts = this.ctx.now();
    this.ctx.db.prepare(
      `INSERT INTO organization (id, name_zh, name_en, industry, country_code, boundary_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      parsed.name_zh ?? null,
      parsed.name_en ?? null,
      parsed.industry ?? null,
      parsed.country_code,
      parsed.boundary_kind,
      ts,
      ts,
    );
    return this.getOrganization(id)!;
  }

  getOrganization(id: string): Organization | null {
    const row = this.ctx.db.prepare('SELECT * FROM organization WHERE id = ?').get(id) as
      | Organization
      | undefined;
    return row ?? null;
  }

  hasAnyOrganization(): boolean {
    const row = this.ctx.db.prepare('SELECT COUNT(*) AS c FROM organization').get() as { c: number };
    return row.c > 0;
  }

  createSite(input: SiteCreateInput): Site {
    const parsed = siteCreateInput.parse(input);
    const id = newId();
    const ts = this.ctx.now();
    this.ctx.db.prepare(
      `INSERT INTO site (id, organization_id, name_zh, name_en, address, country_code, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      id,
      parsed.organization_id,
      parsed.name_zh ?? null,
      parsed.name_en ?? null,
      parsed.address ?? null,
      parsed.country_code,
      ts,
      ts,
    );
    return this.getSite(id)!;
  }

  getSite(id: string): Site | null {
    const row = this.ctx.db.prepare('SELECT * FROM site WHERE id = ?').get(id) as Site | undefined;
    return row ?? null;
  }

  listSitesByOrganization(orgId: string): Site[] {
    return this.ctx.db
      .prepare('SELECT * FROM site WHERE organization_id = ? ORDER BY created_at')
      .all(orgId) as Site[];
  }

  createReportingPeriod(input: ReportingPeriodCreateInput): ReportingPeriod {
    const parsed = reportingPeriodCreateInput.parse(input);
    const id = newId();
    const ts = this.ctx.now();
    const starts_at = `${parsed.year}-01-01T00:00:00.000Z`;
    const ends_at = `${parsed.year}-12-31T23:59:59.999Z`;
    this.ctx.db.prepare(
      `INSERT INTO reporting_period
         (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
       VALUES (?, ?, ?, 'annual', ?, ?, 1, ?)`,
    ).run(id, parsed.organization_id, parsed.year, starts_at, ends_at, ts);
    return this.getReportingPeriod(id)!;
  }

  getReportingPeriod(id: string): ReportingPeriod | null {
    const row = this.ctx.db.prepare('SELECT * FROM reporting_period WHERE id = ?').get(id) as
      | ReportingPeriod
      | undefined;
    return row ?? null;
  }

  listReportingPeriodsByOrganization(orgId: string): ReportingPeriod[] {
    return this.ctx.db
      .prepare('SELECT * FROM reporting_period WHERE organization_id = ? ORDER BY year ASC, created_at ASC')
      .all(orgId) as ReportingPeriod[];
  }

  /**
   * Phase 0 onboarding 的"原子收尾"：
   * 在单个 SQLite 事务里同时建 organization + first site + first reporting_period。
   * 任意一步失败 → 全部回滚 → singleton 不会被半初始化数据卡死。
   */
  completeOnboarding(input: CompleteOnboardingInput): {
    organization: Organization;
    site: Site;
    reporting_period: ReportingPeriod;
  } {
    const parsed = completeOnboardingInput.parse(input);
    const tx = this.ctx.db.transaction(() => {
      const organization = this.createOrganization(parsed.organization);
      const site = this.createSite({
        ...parsed.first_site,
        organization_id: organization.id,
      });
      const reporting_period = this.createReportingPeriod({
        ...parsed.reporting_period,
        organization_id: organization.id,
      });
      return { organization, site, reporting_period };
    });
    return tx();
  }
}
