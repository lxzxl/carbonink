# Phase 0 Task 18: TanStack Router + 基础 routes

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 2478-2670.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 18: TanStack Router + 基础 routes

**Files:**
- Create: `src/renderer/routes/__root.tsx`
- Create: `src/renderer/routes/index.tsx`
- Create: `src/renderer/router.tsx`
- Create: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: 装 TanStack Router**

```bash
pnpm add @tanstack/react-router
pnpm add -D @tanstack/router-vite-plugin
```

- [ ] **Step 2: 改 electron.vite.config.ts renderer 部分加 router plugin**

```ts
// 在 renderer.plugins 数组里前置:
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';
// ...
renderer: {
  plugins: [TanStackRouterVite(), react()],
  // ... 其余不变
},
```

- [ ] **Step 3: 写 src/renderer/components/Sidebar.tsx**

```tsx
import { Link } from '@tanstack/react-router';
import { cn } from '@renderer/lib/utils';

export function Sidebar() {
  return (
    <nav className="flex h-full w-56 flex-col border-r border-border bg-muted/30 p-4">
      <h2 className="mb-6 text-lg font-semibold">carbonbook</h2>
      <ul className="space-y-1">
        <li>
          <Link
            to="/"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              '[&.active]:bg-primary [&.active]:text-primary-foreground',
            )}
          >
            Dashboard
          </Link>
        </li>
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: 写 src/renderer/routes/__root.tsx**

```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Sidebar } from '@renderer/components/Sidebar';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: 写 src/renderer/routes/index.tsx (Dashboard 空态)**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@renderer/lib/trpc';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  const hasAny = trpc.organization.hasAny.useQuery();

  if (hasAny.isLoading) return <p className="text-muted-foreground">Loading…</p>;

  if (!hasAny.data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Welcome to carbonbook</h1>
        <p className="mt-2 text-muted-foreground">
          You haven&apos;t set up your organization yet. The onboarding wizard will guide you next.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Inventory Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        No emission data yet. Phase 1 will let you upload documents and see CO2e.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: 写 src/renderer/router.tsx**

```tsx
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 7: 改 src/renderer/main.tsx 用 RouterProvider**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { trpc, trpcClient } from '@renderer/lib/trpc';
import { router } from '@renderer/router';
import './styles/globals.css';

const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
);
```

- [ ] **Step 8: 跑 dev**

Run: `pnpm dev`
Expected: 页面分左右：左 sidebar，右 Dashboard 空态 ("Welcome to carbonbook…")。

- [ ] **Step 9: 触发 TanStack Router codegen + 验证 gen file 出现**

```bash
pnpm dev
```

让 Vite 启动一次，`TanStackRouterVite` plugin 会生成 `src/renderer/routeTree.gen.ts`。Ctrl-C 关掉 dev server。

验证：
```bash
ls -la src/renderer/routeTree.gen.ts
```
Expected: 文件存在，**包含 `__root` + `index` 两条 route**（onboarding 路由在 Task 22 才加，届时 Task 22 会更新并 commit gen file）。

- [ ] **Step 10: Commit（**含 routeTree.gen.ts**）**

```bash
git add src/renderer/router.tsx src/renderer/routes/ src/renderer/routeTree.gen.ts src/renderer/components/Sidebar.tsx src/renderer/main.tsx electron.vite.config.ts package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 18: TanStack Router + Sidebar + Dashboard empty state (gen file committed)"
```

> **关于 routeTree.gen.ts 的处理策略**：直接 commit。理由——
> - vite plugin 会在 dev/build 时自动重生（不会陈旧）
> - 但 vitest 跑测试时不一定走 vite plugin（取决于 vitest 配置），有 gen 文件可以直接 import
> - CI / 新 checkout 不用先 codegen，简化 pipeline
> - gen 文件冲突是常见的 git 噪音，但 Phase 0 routes 改动很少，可以接受
>
> 后续 phase 加 routes 时，每次 commit 同时带 gen 文件更新，CI 可加一条断言"gen 文件 up-to-date"。

---

