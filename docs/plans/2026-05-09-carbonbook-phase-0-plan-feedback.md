# Carbonbook Phase 0 Plan Review Feedback

Review target: `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md`

Spec source: `docs/specs/2026-05-08-carbonbook-design.md`

Review date: 2026-05-09

## Verdict

当前 plan 方向基本正确，但还不建议直接执行。下面几个问题会导致 Phase 0 与 spec 验收不一致，或在 electron-vite dev/build 环境里出现运行时失败。

## Findings

### P1 — Onboarding finish 没有写入 `reporting_period`

Spec Phase 0 明确要求 wizard 走完 5 步后写入 `organization/site/reporting_period` 表：`docs/specs/2026-05-08-carbonbook-design.md:1830`。

Plan 当前 Task 25 的 finish flow 只创建 `organization` 和 `site`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3230`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3234`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3250`。验收描述也只要求写 organization + site：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3308`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3424`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3433`。

建议修改：

- 在 Task 14 增加 `reporting_period` shared schema/type。
- 在 Task 15 增加 `createReportingPeriod` / `getReportingPeriod` / `listReportingPeriodsByOrganization`，并补 service tests。
- 在 Task 16 增加对应 tRPC procedure。
- 在 Task 25 finish 时用 step 2 选择的 year 创建 annual `reporting_period`。
- 更新 Task 26/27/acceptance，明确 SQLite 中应有 1 行 organization、1 行 site、1 行 reporting_period。

### P1 — migration loader 在 electron-vite dev/build 下可能找不到 SQL 文件

Plan 的 migration loader 使用运行时文件系统路径读取 migration SQL：`MIGRATIONS_DIR = join(__dirname, 'migrations')`，见 `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:898`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:899`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:908`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:917`。但 SQL 文件位于 `src/main/db/migrations`，electron-vite 默认不会保证它们出现在 `out/main/db/migrations`。Task 13 又会在 app startup 直接调用 `runMigrations(db)`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1973`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1981`。

风险是测试环境可能通过，但 Electron dev/build 启动时报 `No migrations found` 或路径不存在。

建议二选一：

- 优先：用 Vite raw import/glob 把 SQL 编进 main bundle，例如 `import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true })`，再按 filename 排序执行。
- 或者：在 electron-vite config 中显式复制 `src/main/db/migrations/*.sql` 到 main 输出目录，并在 plan 里补 dev/build 验证。

### P1 — “单机一个 organization” 没有被约束

Spec 和 plan 自身都写了单机单 organization：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:982`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:987`。但 `organization` 表没有 singleton constraint：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:989`，`OrganizationService.createOrganization` 也会无条件插入新行：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1770`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1782`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1786`。

建议修改：

- 在 service 层用 transaction 先检查 `COUNT(*)`，已有 organization 时拒绝创建。
- 补测试：第二次 `createOrganization` 应失败。
- 如果希望 DB 层也硬约束，可以加 `singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1) UNIQUE`。

### P2 — TanStack Router 生成文件处理不完整

Task 18 引入 `routeTree.gen`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2219`，Task 26 测试也依赖它：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3357`。但 Task 18 的提交命令没有把生成文件纳入：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2266`。

建议明确采用一种策略：

- commit `src/renderer/routeTree.gen.ts`，并在 Task 18 git add 中包含它。
- 或在 typecheck/test 前显式运行 router codegen，确保 CI/新 checkout 不缺文件。

### P2 — renderer onboarding test 的目标和实际覆盖不一致

Task 26 描述要求“把 wizard 流程跑通 + 断言 tRPC mutation 被调用”：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3326`。但示例测试实际只覆盖 step 1 render：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3369`，失败降级说明也允许只断言 step 1 input 存在：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3396`。

建议：

- 若 Phase 0 需要自动化保证 wizard 闭环，则补完整 happy path：step 1 → step 5，断言 `organization.create`、`organization.createSite`、`reportingPeriod.create` 被调用。
- 若只想保留 smoke test，则把 Task 26 标题和验收改成 smoke test，并把真正的 wizard DB 闭环放到手工 acceptance。

### P2 — `package.json` lint 脚本引用 Biome，但 plan 没有安装 Biome

Plan 的 package scripts 包含 `biome check .` 和 `biome format --write .`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:152`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:153`，但依赖安装任务里没有 `@biomejs/biome`。

建议：

- 在 Task 1/2 的 devDependencies 中加入 `@biomejs/biome`，并添加基础 `biome.json`。
- 或移除 lint/format 脚本，避免 Phase 0 验收运行 `pnpm lint` 时失败。

### P3 — migration 编号在文件树和后续任务中不一致

文件树写的是 `003_inventory.sql`、`004_extraction.sql`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:53`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:54`。后续任务实际是 `003_extraction.sql`、`004_inventory.sql`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1178`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1237`。

这不是设计阻塞，但会让执行者或 reviewer 误判迁移依赖顺序。

建议统一文件树和任务顺序。当前任务顺序更合理，因为 `activity_data` FK 依赖 extraction 表先存在，所以建议把文件树改成：

- `003_extraction.sql`
- `004_inventory.sql`

