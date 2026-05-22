import type {
  CompleteOnboardingInput,
  Organization,
  OrganizationCreateInput,
  ReportingPeriod,
  ReportingPeriodCreateInput,
  Site,
  SiteCreateInput,
} from '@shared/types.js';
import {
  completeOnboardingInput,
  organizationCreateInput,
  reportingPeriodCreateInput,
  siteCreateInput,
} from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';

export class OrganizationService {
  constructor(private readonly ctx: ServiceContext) {}

  createOrganization(input: OrganizationCreateInput): Organization {
    const parsed = organizationCreateInput.parse(input);
    if (this.hasAnyOrganization()) {
      throw new Error(
        'Organization already exists (singleton enforced — only one per app instance).',
      );
    }
    const id = newId();
    const ts = this.ctx.now();
    this.ctx.db
      .prepare(
        `INSERT INTO organization (id, name_zh, name_en, industry, country_code, boundary_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
    const row = this.ctx.db.prepare('SELECT COUNT(*) AS c FROM organization').get() as {
      c: number;
    };
    return row.c > 0;
  }

  /**
   * Phase 1a singleton accessor: returns the (only) organization, or null if
   * onboarding hasn't run yet. `createOrganization` enforces the singleton
   * invariant, but the row could theoretically have been seeded externally
   * — `ORDER BY id ASC LIMIT 1` deterministically picks the earliest ULID so
   * concurrent callers always see the same row.
   *
   * Used by `/sources` and `/activities` routes which need an organization_id
   * to scope their queries without forcing a per-route org picker (single-org
   * desktop app — there is no multi-tenant story in Phase 1a).
   */
  getCurrentOrganization(): Organization | null {
    const row = this.ctx.db.prepare('SELECT * FROM organization ORDER BY id ASC LIMIT 1').get() as
      | Organization
      | undefined;
    return row ?? null;
  }

  createSite(input: SiteCreateInput): Site {
    const parsed = siteCreateInput.parse(input);
    const id = newId();
    const ts = this.ctx.now();
    this.ctx.db
      .prepare(
        `INSERT INTO site (id, organization_id, name_zh, name_en, address, country_code, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
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
    this.ctx.db
      .prepare(
        `INSERT INTO reporting_period
         (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
       VALUES (?, ?, ?, 'annual', ?, ?, 1, ?)`,
      )
      .run(id, parsed.organization_id, parsed.year, starts_at, ends_at, ts);
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
      .prepare(
        'SELECT * FROM reporting_period WHERE organization_id = ? ORDER BY year ASC, created_at ASC',
      )
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

  /**
   * Update organization reporting profile (ISO 14064-1 metadata):
   * - boundary_kind (consolidation approach: equity_share / financial_control / operational_control)
   * - responsible_person_name + responsible_person_role
   * - base_year_period_id (reference year for comparisons)
   */
  updateReportingProfile(input: {
    id: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible_person_name: string | null;
    responsible_person_role: string | null;
    base_year_period_id: string | null;
  }): void {
    const now = this.ctx.now();
    this.ctx.db
      .prepare(
        `UPDATE organization
            SET boundary_kind = ?,
                responsible_person_name = ?,
                responsible_person_role = ?,
                base_year_period_id = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        input.boundary_kind,
        input.responsible_person_name,
        input.responsible_person_role,
        input.base_year_period_id,
        now,
        input.id,
      );
  }
}
