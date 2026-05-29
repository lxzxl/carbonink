# Phase 0 Task 14: zod schemas (organization + site + reporting_period) + 共享类型

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1698-1877.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 14: zod schemas (organization + site + reporting_period) + 共享类型

**Files:**
- Create: `src/shared/schemas/_helpers.ts`
- Create: `src/shared/schemas/organization.ts`
- Create: `src/shared/schemas/site.ts`
- Create: `src/shared/schemas/reporting-period.ts`
- Create: `src/shared/schemas/complete-onboarding.ts`
- Create: `src/shared/types.ts`

- [ ] **Step 1: 装 zod**

```bash
pnpm add zod
```

- [ ] **Step 2: 写 src/shared/schemas/_helpers.ts（共享 helper：空字符串归一化）**

```ts
import { z } from 'zod';

/**
 * Optional string field that:
 *   1. Treats '', '   ', null as undefined (用户没填等同于不填)
 *   2. Then applies length constraints if a real value remains
 *
 * 解决 wizard 表单的常见 pitfall：text input 默认值是 ''，原样传给
 * z.string().min(1).optional() 会报"too small"——因为 `''` 不是 `undefined`。
 *
 * 显式返回类型故意省略：Zod 4 移除了 ZodType 的 ZodTypeDef 泛型，
 * 让 z.preprocess(...) 直接推断更稳，跨 Zod 3/4 都可用。
 */
export function optionalString(opts: { max: number }) {
  return z.preprocess(
    (val) => {
      if (val === null || val === undefined) return undefined;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return val;
    },
    z.string().min(1).max(opts.max).optional(),
  );
}
```

- [ ] **Step 3: 写 src/shared/schemas/organization.ts**

```ts
import { z } from 'zod';
import { optionalString } from './_helpers.js';

export const organizationKindEnum = z.enum(['equity_share', 'operational_control']);

export const organizationCreateInput = z.object({
  name_zh: optionalString({ max: 255 }),
  name_en: optionalString({ max: 255 }),
  industry: optionalString({ max: 100 }),
  country_code: z.string().min(2).max(3),
  boundary_kind: organizationKindEnum,
}).refine((v) => v.name_zh || v.name_en, { message: 'At least one of name_zh / name_en is required' });

export const organization = z.object({
  id: z.string(),
  name_zh: z.string().nullable(),
  name_en: z.string().nullable(),
  industry: z.string().nullable(),
  country_code: z.string(),
  boundary_kind: organizationKindEnum,
  created_at: z.string(),
  updated_at: z.string(),
});

export type Organization = z.infer<typeof organization>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateInput>;
```

- [ ] **Step 4: 写 src/shared/schemas/site.ts**

```ts
import { z } from 'zod';
import { optionalString } from './_helpers.js';

export const siteCreateInput = z.object({
  organization_id: z.string(),
  name_zh: optionalString({ max: 255 }),
  name_en: optionalString({ max: 255 }),
  address: optionalString({ max: 500 }),
  country_code: z.string().min(2).max(3),
}).refine((v) => v.name_zh || v.name_en, { message: 'At least one of name_zh / name_en is required' });

export const site = z.object({
  id: z.string(),
  organization_id: z.string(),
  name_zh: z.string().nullable(),
  name_en: z.string().nullable(),
  address: z.string().nullable(),
  country_code: z.string(),
  is_active: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Site = z.infer<typeof site>;
export type SiteCreateInput = z.infer<typeof siteCreateInput>;
```

- [ ] **Step 5: 写 src/shared/schemas/reporting-period.ts**

```ts
import { z } from 'zod';

// DB CHECK 允许 annual / quarterly / monthly，但 v1 service / API 只暴露 annual。
// quarterly / monthly 等 Phase 1+ 实现 date range 计算时再开放。
export const granularityDbEnum = z.enum(['annual', 'quarterly', 'monthly']);
export const granularityV1Enum = z.literal('annual');

export const reportingPeriodCreateInput = z.object({
  organization_id: z.string(),
  year: z.number().int().min(2020).max(2030),
  granularity: granularityV1Enum,   // v1 仅 'annual'，避免 API contract 比 service 实现宽
});

export const reportingPeriod = z.object({
  id: z.string(),
  organization_id: z.string(),
  year: z.number().int(),
  granularity: granularityDbEnum,    // 读出来时仍可能是 quarterly/monthly（DB CHECK 允许；只是 v1 不会写入）
  starts_at: z.string(),
  ends_at: z.string(),
  is_active: z.number(),
  created_at: z.string(),
});

export type ReportingPeriod = z.infer<typeof reportingPeriod>;
export type ReportingPeriodCreateInput = z.infer<typeof reportingPeriodCreateInput>;
```

- [ ] **Step 6: 写 src/shared/schemas/complete-onboarding.ts**

```ts
import { z } from 'zod';
import { organizationCreateInput } from './organization.js';
import { siteCreateInput } from './site.js';
import { reportingPeriodCreateInput } from './reporting-period.js';

export const completeOnboardingInput = z.object({
  organization: organizationCreateInput,
  // 注意：不要让前端传 organization_id；service 在事务里把刚建的 org.id 注入进来
  first_site: siteCreateInput.omit({ organization_id: true }),
  reporting_period: reportingPeriodCreateInput.omit({ organization_id: true }),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingInput>;
```

- [ ] **Step 7: 写 src/shared/types.ts (re-export 集中)**

```ts
export * from './schemas/organization.js';
export * from './schemas/site.js';
export * from './schemas/reporting-period.js';
export * from './schemas/complete-onboarding.js';
```

- [ ] **Step 8: 跑 typecheck**

Run: `pnpm typecheck`
Expected: 通过，无类型错误

- [ ] **Step 9: Commit**

```bash
git add src/shared/ package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 14: zod schemas + types (organization/site/reporting_period/complete_onboarding) with optionalString preprocess"
```

---

