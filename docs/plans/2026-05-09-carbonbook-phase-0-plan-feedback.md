# Carbonbook Phase 0 Plan Review Feedback

Review target: `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md`

Spec source: `docs/specs/2026-05-08-carbonbook-design.md`

Review date: 2026-05-09

## Verdict

上一轮 feedback 里的主问题基本已修：native rebuild、`completeOnboarding` 原子 mutation、`routeTree.gen.ts` 提交点、Node/Vite 类型、Biome pin、annual-only reporting period，以及 `organization + site + reporting_period` 验收口径都已补上。

当前还剩 2 个会影响执行/验收的问题，另有 2 个文档级小问题。

## Findings

### P1 — wizard 会把空字符串传给 optional schema，正常“只填中文名/只填英文名”路径会失败

`organizationCreateInput` 和 `siteCreateInput` 把 `name_zh` / `name_en` 定义成 `z.string().min(1).optional()`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1719`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1720`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1721`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1747`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1749`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1750`。但 wizard 表单默认值是空字符串，并原样保存：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3117`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3118`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3119`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3124`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3125`，site step 同样如此：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3466`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3467`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3468`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3472`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3473`。最后 StepAIProvider 又把这些值原样传给 `completeOnboarding`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3602`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3604`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3605`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3610`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3611`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3612`。

结果：用户只填中文名时，英文名字段仍是 `''`，它不是 `undefined`，所以会触发 `.min(1)` 失败。site 名称同理。这个会让 Phase 0 wizard happy path 在很常见输入下无法完成。

建议修改：

- 增加一个 `blankToUndefined` / `cleanTextFields` helper，在保存 draft 或提交 `completeOnboarding` 前把 `''` / whitespace-only 转成 `undefined`。
- 或在 zod schema 里用 preprocess，把空字符串规范化成 `undefined` 后再校验。
- 补测试：`completeOnboarding` 接收 `{ name_zh: '中山钢铁', name_en: '' }` 和 `{ first_site.name_zh: '主厂区', first_site.name_en: '' }` 时应成功，落库为空的另一语言名应为 `NULL`。

### P1 — Task 27 acceptance 顺序和 native ABI 说明互相冲突

Task 6 已说明 `pnpm dev` / `pnpm build` 会通过 `predev` / `prebuild` 把 `better-sqlite3` 切到 Electron ABI，之后再跑 vitest 需要先 `pnpm rebuild:node`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:818`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:819`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:820`。Task 27 Step 0 也明确写了 build 后再跑 vitest 会报 ABI 错：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3788`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3789`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3795`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3796`。

但 Task 27 Step 1 先跑 `pnpm build`，Step 2 紧接着跑 `pnpm typecheck && pnpm test` 并期望通过：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3798`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3800`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3803`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3805`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3806`。按前面的 ABI 说明，这里 `pnpm test` 很可能失败。

建议修改 Task 27 顺序，二选一：

- 推荐：把测试固定放在 build 前：`pnpm install` → `pnpm typecheck` → `pnpm test` → `pnpm rebuild:native` → `pnpm build` → `pnpm preview`。
- 如果必须 build 后再跑测试，则 Step 2 改成 `pnpm rebuild:node && pnpm typecheck && pnpm test`，然后 preview 前再 `pnpm rebuild:native`。

### P2 — Task 6 文件说明写了 postinstall hook，但实际计划明确不使用 postinstall

Task 6 Files 写 `Modify: package.json (加 rebuild script + postinstall hook)`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:778`。但实际脚本只有 `predev` / `prebuild` / `rebuild:*`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:791`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:798`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:800`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:808`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:809`，Task 27 还明确说无 postinstall hook：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:3793`。

建议把 Files 说明改成 `加 rebuild scripts + predev/prebuild hooks`，避免执行者误加 postinstall。

### P3 — Task 15 期望测试数仍少算

Task 15 现在有 `completeOnboarding creates org+site+period atomically` 和 rollback 两个测试：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1969`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1981`。全文件总数是 10 个 `it(...)`，但 Expected 写 `PASS (9 tests)`：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2160`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:2161`。

建议改成 `PASS (10 tests)`，或移除精确测试数，只写 `PASS`，减少后续维护成本。

