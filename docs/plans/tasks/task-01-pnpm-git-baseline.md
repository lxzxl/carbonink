# Phase 0 Task 1: 项目初始化 + pnpm + git baseline

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 117-245.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 1: 项目初始化 + pnpm + git baseline

**Files:**
- Create: `package.json`
- Create: `.editorconfig`
- Create: `.nvmrc`
- Create: `pnpm-workspace.yaml`
- Create: `biome.json`
- Modify: `.gitignore` (already exists)

- [ ] **Step 1: 初始化 package.json**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm init
```

编辑 `package.json` 写入：

```json
{
  "name": "carbonbook",
  "version": "0.0.1-phase0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write ."
  }
}
```

- [ ] **Step 2: 写 .nvmrc**

```
22
```

- [ ] **Step 3: 写 .editorconfig**

```
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4: 写 pnpm-workspace.yaml（暂留空，未来加子包用）**

```yaml
packages: []
```

- [ ] **Step 5: 装 Biome（lint/format）+ 写 biome.json**

```bash
pnpm add -D @biomejs/biome@1.9.4
```

> 显式 pin 1.9.4——`biome.json` 的 `$schema` 引用同版本，必须保持一致；major 升级时同步改 schema URL + 验证规则没破。

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useImportType": "warn",
        "useNodejsImportProtocol": "warn"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "files": {
    "ignore": ["node_modules", "dist", "out", "src/renderer/paraglide", "src/renderer/routeTree.gen.ts"]
  }
}
```

- [ ] **Step 6: 验证**

Run: `pnpm install && pnpm exec biome --version && cat package.json | head -5`
Expected: `pnpm-lock.yaml` 生成，Biome version 输出，`package.json` 头 5 行可见。

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .editorconfig .nvmrc biome.json
git commit -m "Phase 0/Task 1: pnpm + Biome + project baseline"
```

---

