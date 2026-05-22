import { z } from 'zod';
import { organizationCreateInput } from './organization.js';
import { reportingPeriodCreateInput } from './reporting-period.js';
import { siteCreateInputBase } from './site.js';

export const completeOnboardingInput = z.object({
  organization: organizationCreateInput,
  // 注意：不要让前端传 organization_id；service 在事务里把刚建的 org.id 注入进来。
  // siteCreateInputBase 是未带 .refine 的版本，因为 Zod 4 在 refined ZodObject 上不允许 .omit()。
  // 这里 .omit() 之后再用同一条 refine 重新约束 name_zh/name_en 至少有一个。
  first_site: siteCreateInputBase
    .omit({ organization_id: true })
    .refine((v) => v.name_zh || v.name_en, {
      message: 'At least one of name_zh / name_en is required',
    }),
  reporting_period: reportingPeriodCreateInput.omit({ organization_id: true }),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingInput>;
