# Phase 0 Task 26: Onboarding wizard smoke test (Renderer)

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 3734-3822.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 26: Onboarding wizard smoke test (Renderer)

**Files:**
- Create: `tests/renderer/onboarding.test.tsx`

**Scope（明确收紧）**：本任务**只**做 step 1 渲染 smoke test——wizard 端到端闭环（5 步全走通 + tRPC mutation 真触发）放在 Task 27 的手工 acceptance 里验。Phase 0 不承诺自动化端到端 happy-path 测试；那是 Phase 1+ 的 e2e harness 工作。

- [ ] **Step 1: 装测试依赖**

```bash
pnpm add -D @testing-library/react happy-dom
```

（不装 `@testing-library/user-event`——本 task 是 smoke test 不做交互；后续 e2e harness 真要走交互再加。）

- [ ] **Step 2: 改 vitest.config.ts 支持 jsx + happy-dom**

把 `test.environment` 改成支持每个测试文件指定环境：

```ts
test: {
  environmentMatchGlobs: [
    ['tests/renderer/**', 'happy-dom'],
    ['tests/main/**', 'node'],
    ['tests/shared/**', 'node'],
  ],
  // ... 其他不变
},
```

- [ ] **Step 3: 写 tests/renderer/onboarding.test.tsx (最简流程断言)**

```tsx
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '@renderer/routeTree.gen';
import { trpc } from '@renderer/lib/trpc';

// Mock trpc client to avoid IPC
vi.mock('@renderer/lib/trpc', async () => {
  const actual = await vi.importActual<typeof import('@renderer/lib/trpc')>('@renderer/lib/trpc');
  return {
    ...actual,
    trpcClient: {} as never,
  };
});

describe('Onboarding wizard step 1', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders company info form fields', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const history = createMemoryHistory({ initialEntries: ['/onboarding/1'] });
    const router = createRouter({ routeTree, history });
    render(
      <trpc.Provider client={{} as never} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </trpc.Provider>,
    );
    expect(await screen.findByLabelText(/中文名|Chinese name/i)).toBeTruthy();
    expect(await screen.findByLabelText(/英文名|English name/i)).toBeTruthy();
  });
});
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test tests/renderer/onboarding.test.tsx`
Expected: PASS (1 test)

如果 happy-dom + Tailwind v4 + Paraglide 出问题：进一步简化，只断言 step 1 包含一个 `<input>` 元素（最低 smoke）。如果继续失败超过 30 分钟，加 `it.skip` + 注释说明，**Phase 0 acceptance 不依赖此测试**——wizard 闭环走 Task 27 手工验。

> **本 task 是 smoke test，不是端到端测试**。承诺范围仅限"step 1 表单能渲染"。完整 happy-path 自动化在 Phase 1 起的 e2e harness 里做。

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/renderer/onboarding.test.tsx package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 26: renderer integration test for onboarding step 1"
```

---

