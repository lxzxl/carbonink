# Phase 0 Task 5: Vitest 测试基础设施

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 673-772.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 5: Vitest 测试基础设施

**Files:**
- Create: `vitest.config.ts`
- Create: `src/shared/ulid.ts`
- Create: `tests/shared/ulid.test.ts`

- [ ] **Step 1: 装 Vitest + ULID**

```bash
pnpm add ulid
pnpm add -D vitest @vitest/ui
```

- [ ] **Step 2: 写 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer'),
    },
  },
});
```

- [ ] **Step 3: 写失败测试 tests/shared/ulid.test.ts**

```ts
import { describe, expect, it } from 'vitest';
import { newId } from '@shared/ulid';

describe('newId', () => {
  it('returns 26-char ULID strings', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('returns monotonic ids when called rapidly', () => {
    const a = newId();
    const b = newId();
    expect(b > a).toBe(true);
  });

  it('returns unique ids in a tight loop', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(1000);
  });
});
```

- [ ] **Step 4: 跑测试确认它失败**

Run: `pnpm test tests/shared/ulid.test.ts`
Expected: FAIL with "Cannot find module '@shared/ulid'"

- [ ] **Step 5: 写实现 src/shared/ulid.ts**

```ts
import { monotonicFactory } from 'ulid';

const monotonicUlid = monotonicFactory();

/**
 * Returns a 26-character ULID. Monotonic within a single process.
 * Used as primary key for all rows in app.sqlite (per spec §3 原则 5).
 */
export function newId(): string {
  return monotonicUlid();
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test tests/shared/ulid.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/shared/ulid.ts tests/shared/ulid.test.ts package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 5: Vitest + ULID utility"
```

---

