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
