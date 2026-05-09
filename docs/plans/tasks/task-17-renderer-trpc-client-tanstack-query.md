# Phase 0 Task 17: Renderer trpc client + TanStack Query

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 2393-2477.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 17: Renderer trpc client + TanStack Query

**Files:**
- Create: `src/renderer/lib/trpc.ts`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: 装 TanStack Query**

```bash
pnpm add @tanstack/react-query
pnpm add -D @tanstack/react-query-devtools
```

- [ ] **Step 2: 写 src/renderer/lib/trpc.ts**

```ts
import { createTRPCReact } from '@trpc/react-query';
import { createTRPCClient } from '@trpc/client';
import { ipcLink } from 'electron-trpc/renderer';
import type { AppRouter } from '@main/trpc/router';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = createTRPCClient<AppRouter>({
  links: [ipcLink()],
});
```

```bash
pnpm add @trpc/react-query
```

- [ ] **Step 3: 改 src/renderer/main.tsx 提供 QueryClient + tRPC provider**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClient } from '@renderer/lib/trpc';
import { Button } from '@renderer/components/ui/button';
import './styles/globals.css';

const queryClient = new QueryClient();

function App() {
  const hasAny = trpc.organization.hasAny.useQuery();
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">carbonbook</h1>
      <p className="mt-2 text-muted-foreground">
        Organizations exist: {hasAny.isLoading ? 'checking...' : String(hasAny.data ?? false)}
      </p>
      <Button className="mt-4" onClick={() => hasAny.refetch()}>Refresh</Button>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
);
```

- [ ] **Step 4: 跑 dev 验证 tRPC 端到端**

Run: `pnpm dev`
Expected: 页面显示 "Organizations exist: false"，点 Refresh 不报错。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/ src/renderer/main.tsx package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 17: TanStack Query + tRPC client (renderer ↔ main wired)"
```

---

