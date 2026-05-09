# Carbonbook Phase 0 Plan Review Feedback

Review target: `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md`

Spec source: `docs/specs/2026-05-08-carbonbook-design.md`

Review date: 2026-05-09

## Verdict

上一轮 7 个问题大部分已经被吸收：`reporting_period` 写入、migration raw import、organization singleton、Biome 安装、migration 编号、routeTree 提交策略、renderer test scope 都有修正。

但当前 plan 还不建议直接执行。剩余问题主要集中在 Electron native dependency、onboarding 原子性、routeTree 生成文件实际提交点、以及 typecheck/build 可复现性。

## Findings

### P1 — `better-sqlite3` 没有 Electron native rebuild 步骤，`pnpm dev/preview` 可能启动即崩

Plan 在 Task 6 直接安装 `better-sqlite3`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:762`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:765`，随后主进程启动时直接 import/open DB：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2151`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2159`。但 `better-sqlite3` 是 native module，Electron runtime ABI 和本机 Node ABI 可能不一致；没有 rebuild/install-app-deps 步骤时，Phase 0 的 `pnpm dev` / `pnpm preview` 验收可能在 main process 加载 native binding 时失败。

建议修改：

- 在 Task 6 或 Task 3 后增加 `@electron/rebuild`。
- 增加脚本，例如 `rebuild:native`: `electron-rebuild -f -w better-sqlite3`。
- 在安装 Electron + better-sqlite3 后、第一次 `pnpm dev` 前明确运行 native rebuild。
- Task 27 acceptance 加一条：clean install 后跑 rebuild，再跑 `pnpm dev` 和 `pnpm preview`。

### P1 — onboarding finish 不是事务，失败会留下半初始化数据库并被 singleton 卡死

Task 25 finish 现在是 3 个 renderer-side mutation 串行调用：先 `createOrganization`，再 `createSite`，再 `createReportingPeriod`，见 `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3431`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3432`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3433`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3444`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3451`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3459`。同时 organization 已经有 DB singleton：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1040`，service 也会拒绝第二次创建：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1912`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1913`。

如果 `createOrganization` 成功后 `createSite` 或 `createReportingPeriod` 失败，数据库会只剩 organization。之后 `hasAnyOrganization()` 仍为 true，app 会跳过 onboarding；用户也无法重试创建组织。这会直接破坏 spec Phase 0 的 `organization/site/reporting_period` 闭环。

建议修改：

- 新增 service 方法 `completeOnboarding(input)`，在一个 SQLite transaction 里创建 organization + first site + annual reporting_period。
- tRPC 暴露单个 `organization.completeOnboarding` mutation。
- Step 5 finish 只调用这个 mutation；成功后再写 localStorage 的 `ai_provider_kind`。
- 增加测试：模拟 reporting_period duplicate / invalid 时，transaction rollback 后 `organization` 和 `site` 都不应残留。

### P1 — `routeTree.gen.ts` 策略仍有断点：Task 22 创建 onboarding route 却没有提交生成文件

Task 18 现在要求 commit `routeTree.gen.ts`，这是对的：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2455`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2458`。但 Task 18 当时只创建了 `__root.tsx` 和 `index.tsx`，却在验证里要求 `routeTree.gen.ts` 包含 `onboarding/$step`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2357`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2453`。真正创建 onboarding route 是 Task 22，而 Task 22 的 commit 没有包含 `src/renderer/routeTree.gen.ts`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3086`。

结果是执行过程中本地工作区可能有更新后的 generated file，但 tag / clean checkout 里没有，Task 26 对 `/onboarding/1` 的 routeTree import 也会依赖这个文件。

建议修改：

- Task 18 的 Expected 改成只包含 `__root` + `index`。
- Task 22 在 `pnpm dev` 后验证 `routeTree.gen.ts` 已加入 `/onboarding/$step`。
- Task 22 的 `git add` 加上 `src/renderer/routeTree.gen.ts`。

### P1 — `import.meta.glob` / Node 全局类型没有纳入 typecheck 基线

Task 7 使用 `import.meta.glob`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:947`。当前 tsconfig 没有 `vite/client` 类型或 `vite-env.d.ts`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:272`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:279`。同时 tests 和 service 里大量使用 `node:*`、`Buffer`、`NodeJS.Platform`，但 plan 没有直接安装 `@types/node`；例如 `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:772`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:773`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1782`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1783`。

这会让 `pnpm typecheck` 在后续任务中不稳定，常见错误是 `Property 'glob' does not exist on type 'ImportMeta'` 或找不到 Node globals。

建议修改：

- Task 2 增加 `pnpm add -D @types/node`。
- 增加 `src/vite-env.d.ts`，内容为 `/// <reference types="vite/client" />`。
- 或在 `tsconfig.json` 加 `"types": ["node", "vite/client"]`，但要确认不会污染 renderer/browser 类型边界。

### P2 — Paraglide config 使用远程 `@latest` 模块，build 不可复现且可能依赖外网

Task 19 的 inlang settings 使用 CDN 且带 `@latest`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2495`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2496`。这会让 build 结果受外部网络和最新版本变化影响，和桌面 app 的可复现构建目标不一致。

建议修改：

- 使用本地安装并固定版本的 message-format plugin。
- 或至少把 URL 从 `@latest` 改成固定版本，并在 Task 27 clean build 中覆盖离线/无外网场景。

### P2 — `reportingPeriodCreateInput` 允许 quarterly/monthly，但 service 明确只支持 annual

Schema 允许 `annual | quarterly | monthly`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1710`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1715`，但 service 对非 annual 直接 throw：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1988`。这会让 tRPC 类型看起来接受 quarterly/monthly，运行时却拒绝。

建议修改：

- Phase 0 若只支持年度，create input 就用 `z.literal('annual')`。
- 保留 DB check 支持 quarterly/monthly 没问题，但 API contract 不要提前承诺。
- 或实现 quarterly/monthly 的 date range 计算并加测试。

### P2 — lint/format 验收仍有失败风险

Task 1 浮动安装 `@biomejs/biome`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:191`，但 config `$schema` 写死 1.9.4：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:198`。这会让 Biome major 版本升级时产生配置兼容风险。另一个具体 lint 点是 Task 26 的 test import 了 `userEvent` 但没有使用：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3562`，最终 checklist 又要求 `pnpm lint` 通过。

建议修改：

- pin `@biomejs/biome` 到与 schema 一致的版本，或按安装版本生成对应 schema/config。
- 删除未使用的 `userEvent` import，除非测试真正使用它走交互。

### P3 — 文案和验收描述还有少量旧口径

核心代码已创建 `reporting_period`，但部分描述仍只写 organization + site。例如 Task 25 dev 验收仍写“自动建组织 + site 写入 SQLite”：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3516`，commit message 也是 `org+site persisted`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3524`；Windows 验证也只写 organization/site：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3653`；release notes 写 `persists organization + first site`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3678`。Task 15 现在有 8 个测试，但 Expected 仍是 `PASS (4 tests)`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1805`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2016`。

建议修改为统一口径：organization + first site + reporting_period，并把 Task 15 expected count 改成 8 tests。

