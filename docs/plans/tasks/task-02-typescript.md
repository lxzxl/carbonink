# Phase 0 Task 2: TypeScript 基础配置

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 246-334.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 2: TypeScript 基础配置

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/vite-env.d.ts`

- [ ] **Step 1: 写根 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@main/*": ["src/main/*"],
      "@renderer/*": ["src/renderer/*"]
    }
  },
  "include": ["src", "tests"],
  "exclude": ["node_modules", "dist", "out"]
}
```

- [ ] **Step 2: 写 tsconfig.node.json（给 vite/electron-vite 配置文件用）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["electron.vite.config.ts", "vitest.config.ts", "tailwind.config.ts"]
}
```

- [ ] **Step 3: 装 TypeScript + 类型基线**

```bash
pnpm add -D typescript@5.5 @types/node
```

> `@types/node` 是 main process / tests 必需（用 `node:fs`、`Buffer`、`process` 等）。即使 renderer 不用，全局装一份不污染 renderer 类型——renderer 的 `react` 类型已经独立。

- [ ] **Step 4: 写 src/vite-env.d.ts**

```ts
/// <reference types="vite/client" />
```

> 这一行让 `import.meta.glob`、`import.meta.env` 等 Vite-injected 类型在 main + renderer 都可用。文件本身只起 type-augmentation，不会进 runtime。

- [ ] **Step 5: 验证 typecheck**

Run: `pnpm typecheck`
Expected: 通过（无源代码时无错误，但 `@types/node` + `vite/client` 已就位，后续 Task 7 用 `import.meta.glob` 时不再报 "Property 'glob' does not exist"）。

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json tsconfig.node.json src/vite-env.d.ts package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 2: TypeScript baseline (strict + path aliases + Node/Vite types)"
```

---

