import { initTRPC } from '@trpc/server';
import type { TrpcContext } from '../context.js';
import {
  organizationCreateInput,
  siteCreateInput,
  reportingPeriodCreateInput,
  completeOnboardingInput,
} from '@shared/types.js';
import { z } from 'zod';

const t = initTRPC.context<TrpcContext>().create();

export const organizationRouter = t.router({
  hasAny: t.procedure.query(({ ctx }) => ctx.organizationService.hasAnyOrganization()),
  // Phase 0 wizard finish 走这一个原子 mutation
  completeOnboarding: t.procedure
    .input(completeOnboardingInput)
    .mutation(({ input, ctx }) => ctx.organizationService.completeOnboarding(input)),
  // 以下细粒度 mutation 保留作 Phase 1+ 在 Settings 里增加 site / period 用
  create: t.procedure.input(organizationCreateInput).mutation(({ input, ctx }) =>
    ctx.organizationService.createOrganization(input),
  ),
  getById: t.procedure.input(z.object({ id: z.string() })).query(({ input, ctx }) =>
    ctx.organizationService.getOrganization(input.id),
  ),
  createSite: t.procedure.input(siteCreateInput).mutation(({ input, ctx }) =>
    ctx.organizationService.createSite(input),
  ),
  listSites: t.procedure.input(z.object({ organization_id: z.string() })).query(({ input, ctx }) =>
    ctx.organizationService.listSitesByOrganization(input.organization_id),
  ),
  createReportingPeriod: t.procedure
    .input(reportingPeriodCreateInput)
    .mutation(({ input, ctx }) => ctx.organizationService.createReportingPeriod(input)),
  listReportingPeriods: t.procedure
    .input(z.object({ organization_id: z.string() }))
    .query(({ input, ctx }) =>
      ctx.organizationService.listReportingPeriodsByOrganization(input.organization_id),
    ),
});
