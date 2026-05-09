# Phase 0 Task 16: electron-trpc IPC + organization router

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 2220-2392.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 16: electron-trpc IPC + organization router

**Files:**
- Create: `src/main/trpc/context.ts`
- Create: `src/main/trpc/routers/organization.ts`
- Create: `src/main/trpc/router.ts`
- Create: `src/main/ipc/setup.ts`
- Create: `src/preload/index.ts` (替换之前的 stub)
- Modify: `src/main/index.ts` (启动时调 setupIpc)

- [ ] **Step 1: 装 trpc + electron-trpc**

```bash
pnpm add @trpc/server @trpc/client electron-trpc
```

- [ ] **Step 2: 写 src/main/trpc/context.ts**

```ts
import type { ServiceContext } from '@main/services/base.js';
import { OrganizationService } from '@main/services/organization-service.js';

export interface TrpcContext {
  organizationService: OrganizationService;
}

export function createTrpcContext(svc: ServiceContext): TrpcContext {
  return {
    organizationService: new OrganizationService(svc),
  };
}
```

- [ ] **Step 3: 写 src/main/trpc/routers/organization.ts**

```ts
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
```

- [ ] **Step 4: 写 src/main/trpc/router.ts**

```ts
import { initTRPC } from '@trpc/server';
import type { TrpcContext } from './context.js';
import { organizationRouter } from './routers/organization.js';

const t = initTRPC.context<TrpcContext>().create();

export const appRouter = t.router({
  organization: organizationRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: 写 src/main/ipc/setup.ts**

```ts
import { ipcMain, type BrowserWindow } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import { appRouter } from '@main/trpc/router.js';
import { createTrpcContext } from '@main/trpc/context.js';
import { defaultNow } from '@main/services/base.js';
import { getAppDb } from '@main/db/connection.js';

export function setupIpc(win: BrowserWindow): void {
  createIPCHandler({
    router: appRouter,
    windows: [win],
    createContext: async () =>
      createTrpcContext({ db: getAppDb(), now: defaultNow }),
  });
}
```

- [ ] **Step 6: 写 src/preload/index.ts**

```ts
import { exposeElectronTRPC } from 'electron-trpc/main';

process.once('loaded', () => {
  exposeElectronTRPC();
});
```

- [ ] **Step 7: 改 src/main/index.ts 启动时跑 migration + ipc**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { createMainWindow } from './window.js';
import { openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { setupIpc } from '@main/ipc/setup.js';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'app.sqlite');
  const db = openAppDb(dbPath);
  runMigrations(db);

  mainWindow = createMainWindow();
  setupIpc(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      if (mainWindow) setupIpc(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 8: 跑 dev 验证 IPC 启动不崩**

Run: `pnpm dev`
Expected: 窗口打开，Console 无 "preload error" 类报错。

- [ ] **Step 9: Commit**

```bash
git add src/main/trpc/ src/main/ipc/ src/preload/ src/main/index.ts package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 16: electron-trpc IPC + organization router (service-layer wired)"
```

---

