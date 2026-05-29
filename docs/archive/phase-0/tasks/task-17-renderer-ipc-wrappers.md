# Phase 0 Task 17: Renderer IPC wrappers + TanStack Query

> **Supersedes**: 原 task-17 (electron-trpc/renderer + tRPC v11 React client) — 详见 task-16 supersedes 注释。
>
> **Migration scope**: 删除 `src/renderer/lib/trpc.ts`，改写为薄 IPC wrapper（domain-by-domain 函数）；TanStack Query 保留，但用 `useQuery` / `useMutation` 直接调 wrapper 函数，不再用 trpc-react-query 适配层。

---

### Task 17: Renderer IPC wrappers + TanStack Query

**Files:**
- Delete: `src/renderer/lib/trpc.ts`
- Create: `src/renderer/lib/ipc.ts` —— `window.ipc.invoke` 类型化重导出
- Create: `src/renderer/lib/api/organization.ts` —— `orgApi.create` / `orgApi.completeOnboarding` 等
- Create: `src/renderer/lib/api/global.d.ts` —— 全局 `window.ipc` 声明
- Modify: `src/renderer/main.tsx` —— 删 `<trpc.Provider>`，留 `<QueryClientProvider>`
- Modify: 所有调用 `trpc.organization.*.useMutation/useQuery` 的组件（onboarding 5 步 wizard + dashboard）

**Preconditions:**
- Task 16 (main 端 typed-ipc) 已完成
- `@tanstack/react-query` + `@tanstack/react-query-devtools` 已装

- [ ] **Step 1: 写 src/renderer/lib/api/global.d.ts —— 声明 window.ipc**

```ts
import type { IpcTypeMap } from '@main/ipc/types.js';

declare global {
  interface Window {
    ipc: {
      invoke<C extends keyof IpcTypeMap>(
        channel: C,
        ...args: Parameters<IpcTypeMap[C]>
      ): Promise<ReturnType<IpcTypeMap[C]>>;
    };
  }
}

export {};
```

- [ ] **Step 2: 写 src/renderer/lib/ipc.ts —— 薄 wrapper 集中点**

```ts
import type { IpcTypeMap } from '@main/ipc/types.js';

/**
 * Type-safe wrapper around window.ipc.invoke.
 *
 * Prefer the per-domain wrappers in src/renderer/lib/api/<domain>.ts
 * which give callers nice function names (e.g. orgApi.create) and let
 * domains evolve independently. This generic invoke is the foundation.
 */
export function invoke<C extends keyof IpcTypeMap>(
  channel: C,
  ...args: Parameters<IpcTypeMap[C]>
): Promise<ReturnType<IpcTypeMap[C]>> {
  if (!window.ipc) {
    throw new Error('window.ipc not available — preload script not loaded?');
  }
  return window.ipc.invoke(channel, ...args);
}
```

- [ ] **Step 3: 写 src/renderer/lib/api/organization.ts —— domain wrapper**

```ts
import { invoke } from '../ipc.js';

export const orgApi = {
  hasAny: () => invoke('org:has-any'),
  getById: (id: string) => invoke('org:get-by-id', { id }),
  create: (input: Parameters<typeof invoke<'org:create'>>[1]) => invoke('org:create', input),
  listSites: (organizationId: string) => invoke('org:list-sites', { organization_id: organizationId }),
  createSite: (input: Parameters<typeof invoke<'org:create-site'>>[1]) =>
    invoke('org:create-site', input),
  listReportingPeriods: (organizationId: string) =>
    invoke('org:list-reporting-periods', { organization_id: organizationId }),
  createReportingPeriod: (input: Parameters<typeof invoke<'org:create-reporting-period'>>[1]) =>
    invoke('org:create-reporting-period', input),
  completeOnboarding: (input: Parameters<typeof invoke<'org:complete-onboarding'>>[1]) =>
    invoke('org:complete-onboarding', input),
};
```

- [ ] **Step 4: 改 src/renderer/main.tsx —— 移除 trpc Provider**

```tsx
import '@renderer/lib/api/global'; // side-effect: register window.ipc types
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: 删 src/renderer/lib/trpc.ts**

```bash
git rm src/renderer/lib/trpc.ts
```

- [ ] **Step 6: 改 onboarding step 组件 —— 把 trpc.useMutation 换成 TanStack useMutation + orgApi**

例如 `src/renderer/routes/onboarding/-components/StepAIProvider.tsx` 里：

```tsx
// before:
// const completeOnboarding = trpc.organization.completeOnboarding.useMutation();
// const utils = trpc.useUtils();
// await completeOnboarding.mutateAsync({ ... });
// await utils.organization.hasAny.invalidate();

// after:
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orgApi } from '@renderer/lib/api/organization';

const queryClient = useQueryClient();
const completeOnboarding = useMutation({
  mutationFn: orgApi.completeOnboarding,
});

// in finish():
await completeOnboarding.mutateAsync({ /* ... */ });
await queryClient.invalidateQueries({ queryKey: ['org:has-any'] });
```

同样的 pattern 套用 step 1-4 + dashboard route 里的 `trpc.organization.hasAny.useQuery()`：

```tsx
// before:
// const hasAny = trpc.organization.hasAny.useQuery();

// after:
import { useQuery } from '@tanstack/react-query';
import { orgApi } from '@renderer/lib/api/organization';

const hasAny = useQuery({
  queryKey: ['org:has-any'],
  queryFn: orgApi.hasAny,
});
```

**Convention**: queryKey 用 channel 名作为第一段，便于 invalidate 对齐。所有 organization domain queries 第一段都是对应 channel name。

- [ ] **Step 7: 跑 typecheck + dev 验证 wizard 走得通**

```bash
pnpm typecheck
pnpm dev
```

Expected:
- typecheck 0 error
- 窗口打开 → onboarding step 1 → 5 步全过 → "Creating organization..." → 跳到 dashboard
- 跳完后 sqlite3 验证 `organization` / `site` / `reporting_period` 各一行
- DevTools console 无 "ipc" 相关报错

- [ ] **Step 8: Commit**

```bash
git add -A src/renderer/ package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 17 (rev): replace tRPC client with typed-ipc wrappers + TanStack Query"
```

---
