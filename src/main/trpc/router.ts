import { initTRPC } from '@trpc/server';
import type { TrpcContext } from './context.js';
import { organizationRouter } from './routers/organization.js';

const t = initTRPC.context<TrpcContext>().create();

export const appRouter = t.router({
  organization: organizationRouter,
});

export type AppRouter = typeof appRouter;
