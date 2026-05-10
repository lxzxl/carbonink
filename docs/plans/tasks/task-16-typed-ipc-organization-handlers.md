# Phase 0 Task 16: typed-ipc IPC + organization handlers

> **Supersedes**: 原 task-16 (electron-trpc + tRPC v11) — electron-trpc 已无活跃维护、tRPC v11 + electron-trpc 静默挂死。Spec §2 架构决定 #2 已改为 `@electron-toolkit/typed-ipc` + Zod。
>
> **Migration scope**: 删除 `src/main/trpc/` + `src/preload/index.ts` 内的 electron-trpc bootstrap，改写为 `ipcMain.handle` 风格，每个 handler 入口 Zod parse。

---

### Task 16: typed-ipc IPC + organization handlers

**Files:**
- Delete: `src/main/trpc/` (整个目录)
- Create: `src/main/ipc/types.ts` —— 共享 `IpcTypeMap` 类型表
- Create: `src/main/ipc/context.ts` —— `IpcContext`（service holder）
- Create: `src/main/ipc/handlers/organization.ts` —— 8 个 organization handler
- Create: `src/main/ipc/setup.ts` —— 注册 + cleanup
- Modify: `src/preload/index.ts` —— `contextBridge.exposeInMainWorld('ipc', { invoke })`，白名单 channel
- Modify: `src/main/index.ts` —— 启动时 `setupIpc()`，关闭时 cleanup

**Preconditions:**
- Service layer (`OrganizationService`) 已实现，测试不动（task 15 完成）
- `@shared/types.ts` zod schemas 不动（task 14 完成）

- [ ] **Step 1: 卸载 tRPC + electron-trpc + superjson**

```bash
pnpm remove @trpc/client @trpc/server @trpc/react-query electron-trpc superjson
```

- [ ] **Step 2: 装 typed-ipc**

```bash
pnpm add @electron-toolkit/typed-ipc
```

- [ ] **Step 3: 删除 trpc 目录**

```bash
git rm -r src/main/trpc/
```

- [ ] **Step 4: 写 src/main/ipc/types.ts —— 共享 channel 类型表**

```ts
import type {
  CompleteOnboardingInput,
  Organization,
  OrganizationCreateInput,
  ReportingPeriod,
  ReportingPeriodCreateInput,
  Site,
  SiteCreateInput,
} from '@shared/types.js';

/**
 * IPC channel type map. 同时被 main (IpcListener) 和 renderer (IpcEmitter) 引用，
 * 保证 channel 名 + 输入 + 输出三方对齐。
 *
 * Naming: `<domain>:<verb>` (kebab-case domain, snake or camel verb).
 * Channels are flat (no nesting) — namespace via prefix.
 */
export type IpcTypeMap = {
  // organization domain
  'org:has-any': () => boolean;
  'org:get-by-id': (input: { id: string }) => Organization | null;
  'org:create': (input: OrganizationCreateInput) => Organization;
  'org:list-sites': (input: { organization_id: string }) => Site[];
  'org:create-site': (input: SiteCreateInput) => Site;
  'org:list-reporting-periods': (input: { organization_id: string }) => ReportingPeriod[];
  'org:create-reporting-period': (input: ReportingPeriodCreateInput) => ReportingPeriod;
  'org:complete-onboarding': (input: CompleteOnboardingInput) => {
    organization: Organization;
    site: Site;
    reporting_period: ReportingPeriod;
  };
};
```

- [ ] **Step 5: 写 src/main/ipc/context.ts**

```ts
import type { ServiceContext } from '@main/services/base.js';
import { OrganizationService } from '@main/services/organization-service.js';

export interface IpcContext {
  organizationService: OrganizationService;
}

export function createIpcContext(svc: ServiceContext): IpcContext {
  return {
    organizationService: new OrganizationService(svc),
  };
}
```

- [ ] **Step 6: 写 src/main/ipc/handlers/organization.ts**

```ts
import {
  completeOnboardingInput,
  organizationCreateInput,
  reportingPeriodCreateInput,
  siteCreateInput,
} from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const orgIdInput = z.object({ id: z.string() });
const orgScopedInput = z.object({ organization_id: z.string() });

/**
 * Returns a map of channel-name → handler. Each handler:
 *   1. Zod-parse input (Defense-in-depth: types alone aren't enough — IPC is a
 *      trust boundary because preload could be exploited.)
 *   2. Delegate to service layer.
 *   3. Return plain JSON-serializable values (Electron structured-clone handles
 *      Date/Map/Set/BigInt natively — no transformer needed).
 */
export function organizationHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const svc = ctx.organizationService;
  return {
    'org:has-any': () => svc.hasAnyOrganization(),
    'org:get-by-id': (input) => svc.getOrganization(orgIdInput.parse(input).id),
    'org:create': (input) => svc.createOrganization(organizationCreateInput.parse(input)),
    'org:list-sites': (input) =>
      svc.listSitesByOrganization(orgScopedInput.parse(input).organization_id),
    'org:create-site': (input) => svc.createSite(siteCreateInput.parse(input)),
    'org:list-reporting-periods': (input) =>
      svc.listReportingPeriodsByOrganization(orgScopedInput.parse(input).organization_id),
    'org:create-reporting-period': (input) =>
      svc.createReportingPeriod(reportingPeriodCreateInput.parse(input)),
    'org:complete-onboarding': (input) =>
      svc.completeOnboarding(completeOnboardingInput.parse(input)),
  };
}
```

- [ ] **Step 7: 写 src/main/ipc/setup.ts**

```ts
import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { createIpcContext } from './context.js';
import { organizationHandlers } from './handlers/organization.js';
import type { IpcTypeMap } from './types.js';

let listener: IpcListener<IpcTypeMap> | null = null;

/**
 * Registers all IPC handlers. Idempotent — safe to call once at app startup.
 * `cleanupIpc()` disposes via the IpcListener's built-in dispose() (which
 * internally calls ipcMain.removeHandler for each handle()'d channel + off
 * for each on()'d channel).
 */
export function setupIpc(): void {
  if (listener) return;

  const ctx = createIpcContext({ db: getAppDb(), now: defaultNow });
  const l = new IpcListener<IpcTypeMap>();

  for (const [channel, handler] of Object.entries(organizationHandlers(ctx))) {
    l.handle(channel as keyof IpcTypeMap, async (_event, ...args) => {
      // typed-ipc's handler signature is (event, ...args). Ignore event in
      // Phase 0 — sender-id-based authorization waits for MCP (§9).
      return (handler as (...a: unknown[]) => unknown)(...args);
    });
  }

  listener = l;
}

export function cleanupIpc(): void {
  if (!listener) return;
  listener.dispose();
  listener = null;
}
```

- [ ] **Step 8: 改 src/preload/index.ts —— contextBridge 白名单 invoke**

```ts
import { IpcEmitter } from '@electron-toolkit/typed-ipc/renderer';
import type { IpcTypeMap } from '@main/ipc/types.js';
import { contextBridge } from 'electron';

const emitter = new IpcEmitter<IpcTypeMap>();

// Whitelist all known channels — typed-ipc gives us the types but doesn't
// enforce a runtime channel allowlist; we add one here for defense-in-depth.
const allowedChannels: ReadonlyArray<keyof IpcTypeMap> = [
  'org:has-any',
  'org:get-by-id',
  'org:create',
  'org:list-sites',
  'org:create-site',
  'org:list-reporting-periods',
  'org:create-reporting-period',
  'org:complete-onboarding',
];

contextBridge.exposeInMainWorld('ipc', {
  invoke: <C extends keyof IpcTypeMap>(channel: C, ...args: Parameters<IpcTypeMap[C]>) => {
    if (!allowedChannels.includes(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
    }
    return emitter.invoke(channel, ...args);
  },
});

export type IpcBridge = {
  invoke: <C extends keyof IpcTypeMap>(
    channel: C,
    ...args: Parameters<IpcTypeMap[C]>
  ) => Promise<ReturnType<IpcTypeMap[C]>>;
};
```

- [ ] **Step 9: 改 src/main/index.ts —— 不再传 BrowserWindow 给 setupIpc**

```ts
import { join } from 'node:path';
import { openAppDb } from '@main/db/connection.js';
import { runMigrations } from '@main/db/migrate.js';
import { cleanupIpc, setupIpc } from '@main/ipc/setup.js';
import { BrowserWindow, app } from 'electron';
import { createMainWindow } from './window.js';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'app.sqlite');
  const db = openAppDb(dbPath);
  runMigrations(db);

  setupIpc();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupIpc();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 10: 跑 dev 验证 IPC 启动不崩**

Run: `pnpm dev`
Expected: 窗口打开，Console 无 "preload error" 或 "Cannot find module" 类报错。

- [ ] **Step 11: Commit**

```bash
git add -A src/main/ src/preload/ package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 16 (rev): replace tRPC IPC with @electron-toolkit/typed-ipc + Zod"
```

---
