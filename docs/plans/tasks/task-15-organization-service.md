# Phase 0 Task 15: organization-service (CRUD)

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1878-2219.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 15: organization-service (CRUD)

**Files:**
- Create: `src/main/services/base.ts`
- Create: `src/main/services/organization-service.ts`
- Create: `tests/main/services/organization-service.test.ts`

- [ ] **Step 1: 写 src/main/services/base.ts**

```ts
import type { Database } from 'better-sqlite3';

export interface ServiceContext {
  db: Database;
  /** Returns ISO8601 timestamp; injected for testability */
  now: () => string;
}

export function defaultNow(): string {
  return new Date().toISOString();
}
```

- [ ] **Step 2: 写失败测试 tests/main/services/organization-service.test.ts**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openAppDb, closeAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { OrganizationService } from '@main/services/organization-service';

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
    try { rmSync(dbPath); } catch { /* ignore */ }
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
      svc.createOrganization({ name_en: 'Second', country_code: 'CN', boundary_kind: 'equity_share' }),
    ).toThrow(/singleton|UNIQUE|already exists/i);
  });

  it('createReportingPeriod creates annual period with correct date range', () => {
    const org = svc.createOrganization({ name_en: 'Acme', country_code: 'CN', boundary_kind: 'operational_control' });
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
    const org = svc.createOrganization({ name_en: 'Acme', country_code: 'CN', boundary_kind: 'operational_control' });
    svc.createReportingPeriod({ organization_id: org.id, year: 2025, granularity: 'annual' });
    expect(() =>
      svc.createReportingPeriod({ organization_id: org.id, year: 2025, granularity: 'annual' }),
    ).toThrow(/UNIQUE/i);
  });

  it('listReportingPeriodsByOrganization returns periods in created order', () => {
    const org = svc.createOrganization({ name_en: 'Acme', country_code: 'CN', boundary_kind: 'operational_control' });
    svc.createReportingPeriod({ organization_id: org.id, year: 2024, granularity: 'annual' });
    svc.createReportingPeriod({ organization_id: org.id, year: 2025, granularity: 'annual' });
    const list = svc.listReportingPeriodsByOrganization(org.id);
    expect(list.length).toBe(2);
    expect(list[0]!.year).toBe(2024);
    expect(list[1]!.year).toBe(2025);
  });

  it('completeOnboarding creates org+site+period atomically', () => {
    const result = svc.completeOnboarding({
      organization: { name_zh: '中山钢铁', country_code: 'CN', boundary_kind: 'operational_control' },
      first_site: { name_zh: '主厂区', country_code: 'CN' },
      reporting_period: { year: 2025, granularity: 'annual' },
    });
    expect(result.organization.id).toBeTruthy();
    expect(result.site.organization_id).toBe(result.organization.id);
    expect(result.reporting_period.organization_id).toBe(result.organization.id);
    expect(result.reporting_period.year).toBe(2025);
  });

  it('completeOnboarding accepts empty string for one of the bilingual name fields (treats as NULL)', () => {
    // Wizard 表单默认值是 ''；optionalString preprocess 应把空串转 undefined → DB 存 NULL
    const result = svc.completeOnboarding({
      organization: { name_zh: '中山钢铁', name_en: '   ', country_code: 'CN', boundary_kind: 'operational_control' },
      first_site: { name_zh: '主厂区', name_en: '', country_code: 'CN' },
      reporting_period: { year: 2025, granularity: 'annual' },
    });
    expect(result.organization.name_zh).toBe('中山钢铁');
    expect(result.organization.name_en).toBeNull();
    expect(result.site.name_zh).toBe('主厂区');
    expect(result.site.name_en).toBeNull();
  });

  it('completeOnboarding rolls back when reporting_period is invalid (no half state)', () => {
    // 制造一个会让事务尾部失败的场景：先用同一年建一个 period，再调 completeOnboarding 用同 year
    // 但 completeOnboarding 自己先建 org，然后 site，然后 period——
    // 这里换个法子：手工 mock 让 createReportingPeriod 抛错验证 rollback
    const orgSvc = svc;
    const original = orgSvc.createReportingPeriod.bind(orgSvc);
    (orgSvc as unknown as { createReportingPeriod: (i: unknown) => unknown }).createReportingPeriod =
      () => { throw new Error('synthetic period failure'); };
    expect(() =>
      orgSvc.completeOnboarding({
        organization: { name_en: 'Rollback Co', country_code: 'CN', boundary_kind: 'operational_control' },
        first_site: { name_en: 'Site', country_code: 'CN' },
        reporting_period: { year: 2025, granularity: 'annual' },
      }),
    ).toThrow(/synthetic period failure/);
    // 还原
    (orgSvc as unknown as { createReportingPeriod: typeof original }).createReportingPeriod = original;
    // 关键断言：事务回滚 → 没有 organization 残留
    expect(orgSvc.hasAnyOrganization()).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test tests/main/services/organization-service.test.ts`
Expected: FAIL ("Cannot find module '@main/services/organization-service'")

- [ ] **Step 4: 写 src/main/services/organization-service.ts**

```ts
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
    // 应用层兜一道：spec §1 单机一个 organization
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
    const parsed = reportingPeriodCreateInput.parse(input);  // v1 schema 限定 'annual'
    const id = newId();
    const ts = this.ctx.now();
    // v1 仅 annual：UTC 全年范围
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
   *
   * 这是 wizard finish 应该调用的唯一 mutation。
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test tests/main/services/organization-service.test.ts`
Expected: 全部 PASS（含基础 org/site CRUD + singleton 拒绝 + reporting_period 创建/UNIQUE/列表 + completeOnboarding 原子写入/回滚 + 空字符串归一化为 NULL 等覆盖；不锁定具体数字以减少后续维护噪音）

- [ ] **Step 6: Commit**

```bash
git add src/main/services/ tests/main/services/
git commit -m "Phase 0/Task 15: OrganizationService (org+site+reporting_period + singleton + transactional completeOnboarding)"
```

---

