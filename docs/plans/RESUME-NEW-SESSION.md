# 新 session 继续 Phase 0 实施 — 启动指南

**日期**: 2026-05-09
**当前进度**: Tasks 1-7 完成（共 27），全部 reviewed + committed
**下一个**: Task 8 — Migration 001 (organization, site, reporting_period + singleton)

---

## 当前状态（已验证）

```
$ git log --oneline | head -10
9f7a7ef Remove plan + spec feedback files (review trail complete)
7166d0d Phase 0/Task 7: SQL migration runner (sequential, idempotent)
5c9fda8 Phase 0/Task 6: better-sqlite3 connection with mandatory FK enforcement
4fd2425 Phase 0/Task 5: Vitest + ULID utility
921a16b Phase 0/Task 4: Tailwind v4 + shadcn/ui Button baseline
302eaf7 Phase 0/Task 3: electron-vite scaffold (main+preload+renderer hello)
281f546 Phase 0/Task 2: TypeScript baseline (strict + path aliases + Node/Vite types)
8a6dd93 Phase 0/Task 1: pnpm + Biome + project baseline
d2b1415 Address Phase 0 plan feedback round 4 (1 finding)
8b50711 Address Phase 0 plan feedback round 3 (4 findings)
```

```
$ pnpm test
Test Files  3 passed (3)
     Tests  8 passed (8)

$ pnpm typecheck
(no output, exit 0)
```

`/tmp/carbonbook-dev.log` 历史 dev session 输出（已清理，可忽略）。

工作树干净（git status 空）。better-sqlite3 binding 当前是 **Node ABI**（vitest 友好）；如果跑 `pnpm dev` 会触发 `predev` 自动 electron-rebuild 切到 Electron ABI。

---

## 已完成 Tasks 概要

| # | 标题 | Commit |
|---|---|---|
| 1 | pnpm + Biome + project baseline | `8a6dd93` |
| 2 | TypeScript baseline (strict + path aliases + Node/Vite types) | `281f546` |
| 3 | electron-vite scaffold (main + preload + renderer hello) | `302eaf7` |
| 4 | Tailwind v4 + shadcn/ui Button baseline | `921a16b` |
| 5 | Vitest + ULID utility | `4fd2425` |
| 6 | better-sqlite3 + electron-rebuild + PRAGMA fk=ON | `5c9fda8` |
| 7 | SQL migration runner (`import.meta.glob`, idempotent) | `7166d0d` |

每个 task 都过了：implementer (TDD) → spec compliance reviewer → code quality reviewer。所有 review 都 ✅，无 Critical/Important 遗留 issue（仅个别 Minor 观察记录在 task 报告里）。

---

## 待办 Tasks (8-27)

| 范围 | 内容 | 预估复杂度 |
|---|---|---|
| 8-13 | 6 个 SQL migration（001 core / 002 EF / 003 extraction / 004 inventory / 005 questionnaire / 006 audit） | 每个低-中（DDL 主要） |
| 14 | zod schemas + types + `optionalString` helper | 低-中 |
| 15 | OrganizationService（CRUD + 单事务 `completeOnboarding`） | 中（多 test） |
| 16 | electron-trpc IPC + organization router | 中 |
| 17 | Renderer trpc client + TanStack Query | 低-中 |
| 18 | TanStack Router + Sidebar + Dashboard 空态 | 中 |
| 19 | Paraglide JS i18n（zh-CN + en） | 中 |
| 20 | safeStorage CredentialStore（mac+win） | 低-中 |
| 21 | TanStack Form 安装 | 低 |
| 22 | Wizard step 1（公司信息） | 中 |
| 23 | Wizard step 2/3（年度 + 边界） | 中 |
| 24 | Wizard step 4（首 site） | 低 |
| 25 | Wizard step 5 + atomic completeOnboarding finish | 中-高（连贯到 service） |
| 26 | Onboarding renderer smoke test | 低 |
| 27 | Acceptance（clean install + build + sqlite verify + tag `phase-0`） | 中 |

---

## 在新 session 启动方法

> ⚠️ **Plan 文件超过 Claude Code 25K token 单次读上限**（57K tokens）。**不要整读** `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md`。Plan 已按 task 拆成 27 个独立文件，详见下文。

新 Claude Code session，直接发这一段（或类似内容）：

> 继续执行 carbonbook v1 Phase 0 实施。
>
> 当前进度：
> - Repo: `/Users/lxz/ws/personal/carbonbook` 在 `main` 分支
> - 已完成 Tasks 1-7（commit `8a6dd93` → `7166d0d`），全部 reviewed
> - 详见本文档（`docs/plans/RESUME-NEW-SESSION.md`）
> - **Plan 已按 task 拆分**：`docs/plans/tasks/task-NN-*.md`（每个 task 一个文件，全部 < 25K tokens）
> - Task 索引：`docs/plans/TASK-INDEX.md`
> - **不要整读** `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md`（57K tokens 超 Read 上限）
> - Spec: `docs/specs/2026-05-08-carbonbook-design.md`（如需查 §3 schema 等可针对性 grep / Read 局部）
>
> 用 `superpowers:subagent-driven-development` 从 **Task 8（Migration 001）** 开始派 subagent。每个 task：
> 1. 读对应 `docs/plans/tasks/task-NN-*.md` 文件
> 2. 派 implementer subagent（把 task 全文 paste 进 prompt）
> 3. 派 spec reviewer
> 4. 派 code quality reviewer
> 5. 完成后下一 task
>
> 全部 27 task 完成后跑最终 code review + `superpowers:finishing-a-development-branch`。
>
> 不需要做 spec/plan review（已 4 轮各自完成）。

新 session 会：
1. 读本文 + `docs/plans/TASK-INDEX.md`
2. 设置 TodoWrite 列出剩余 tasks 8-27
3. 对每个 task：先 Read 该 task 的拆分文件，再派 subagent

### Task 文件清单

每个 task 一个 markdown，开头有"原始行号区间"注解，独立可读。

```
docs/plans/tasks/
├── task-01-pnpm-git-baseline.md                ← 已完成
├── task-02-typescript.md                       ← 已完成
├── task-03-electron-vite-electron.md           ← 已完成
├── task-04-tailwind-v4-shadcnui.md             ← 已完成
├── task-05-vitest.md                            ← 已完成
├── task-06-better-sqlite3-connection-...md     ← 已完成
├── task-07-migration-runner.md                 ← 已完成
├── task-08-migration-001_coresql-...md         ← 下一个
├── task-09-migration-002-emission_factor-...md
├── task-10-migration-003-document-extraction.md
├── task-11-migration-004-emission_source-...md
├── task-12-migration-005-questionnaire.md
├── task-13-migration-006-audit_event-triggers.md
├── task-14-zod-schemas-shared-types.md
├── task-15-organization-service.md             ← 最大 (~7K tokens)
├── task-16-electron-trpc-ipc-organization-router.md
├── task-17-renderer-trpc-client-tanstack-query.md
├── task-18-tanstack-router-routes.md
├── task-19-paraglide-js-i18n.md
├── task-20-safestorage-macos-windows-abort.md
├── task-21-tanstack-form.md
├── task-22-onboarding-wizard-route-step-1.md
├── task-23-wizard-step-2-step-3.md
├── task-24-wizard-step-4.md
├── task-25-wizard-step-5-ai-provider.md
├── task-26-onboarding-wizard-smoke-test.md
└── task-27-macos-windows-phase-0-acceptance.md
```

---

## 已知技术细节（新 session 应继承）

### better-sqlite3 ABI 模式

- 默认安装 → Node ABI binding（vitest 可用）
- `pnpm dev` / `pnpm build` 前自动 `electron-rebuild` 切到 Electron ABI（predev/prebuild hook）
- 想从 Electron ABI 切回 Node ABI 跑 vitest：`pnpm rebuild:node`

### pnpm 10 注意

- 用 `-w` 标志做 root 安装（workspace 已存在）
- `pnpm.onlyBuiltDependencies` 已包含 `["better-sqlite3", "electron", "esbuild"]`；下次 native dep（如 lightningcss）需要再加

### TanStack Router 注意（Task 18+）

- `routeTree.gen.ts` 由 vite plugin 自动生成
- 必须 commit gen file（避免新 checkout 缺）
- 加 routes 的 task（22+）每次都要带 gen 更新一起 commit

### Tailwind v4 注意

- 配置主要在 CSS（`@theme`），不是 `tailwind.config.ts`
- 用 `@tailwindcss/postcss` 不是 v3 的 `tailwindcss` PostCSS plugin
- `lightningcss` 没拉进来（标准 PostCSS path）

### 已知 lint 债务

- 新 task 有 `organizeImports` 警告（spec 样本写法跟 Biome 顺序偏好不一致）
- 不是 blocker（`pnpm test` 不跑 lint）
- Task 27 acceptance 跑 `pnpm lint` 时会暴露——届时一次性 `biome check --write .` 收拾即可

### 文件 ABI 状态

- 当前 better-sqlite3 在 `node_modules` 是 Node ABI binding
- 不要在新 session 没必要时跑 `pnpm rebuild:native`，会让 vitest 失败

---

## Phase 0 deliverable（最终验收目标）

> "启动空 app，过 wizard，建组织 + 1 个 site + 1 个 reporting_period（单事务原子写入），看到空 inventory dashboard。"

平台：macOS + Windows（Linux 不发行，per spec §1）。

完成后打 git tag `phase-0`。
