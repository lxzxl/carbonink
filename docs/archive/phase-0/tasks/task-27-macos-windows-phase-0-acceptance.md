# Phase 0 Task 27: macOS + Windows 构建验证（最终 Phase 0 acceptance）

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 3823-3955.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 27: macOS + Windows 构建验证（最终 Phase 0 acceptance）

**Files:** (无新代码，纯构建产物验证)

> ⚠️ **顺序很关键**：先跑 typecheck/test（要 Node ABI），再 rebuild 切到 Electron ABI 跑 build/preview。反过来跑会让 vitest 在 Electron ABI binding 下失败。

- [ ] **Step 0 (clean install 重现性验证)**：

```bash
rm -rf node_modules out
pnpm install
# clean install 后 better-sqlite3 是 Node ABI binding —— vitest 可直接跑
```

Expected: `pnpm install` 不触发任何 native rebuild（无 postinstall hook）→ 装上后 binding 是 Node ABI。

- [ ] **Step 1: 跑 typecheck + 全部测试（Node ABI 阶段）**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过（vitest 用 Node ABI 的 better-sqlite3）。

- [ ] **Step 2: 跑 lint**

Run: `pnpm lint`
Expected: 通过（Biome 全绿）。

- [ ] **Step 3: 切到 Electron ABI + 跑 production build**

```bash
pnpm rebuild:native
pnpm build
```
Expected: `out/main`, `out/preload`, `out/renderer` 三个目录有产物，无 TS 错误。

> 注意：此时 better-sqlite3 binding 已切到 Electron ABI，**再跑 vitest 会报 ABI 错**——这是预期行为。需要回去 vitest 的话先跑 `pnpm rebuild:node`。

- [ ] **Step 4: 跑预览看 production 模式能启动**

Run: `pnpm preview`
Expected: app 启动；过 wizard；写 organization + site + reporting_period 到 `~/Library/Application Support/carbonbook/app.sqlite` (macOS) 或 `%APPDATA%\carbonbook\app.sqlite` (Windows)；重启后直接进 dashboard。

- [ ] **Step 5: 验证 SQLite 文件可手工读**

macOS：
Run: `sqlite3 ~/Library/Application\ Support/carbonbook/app.sqlite ".tables"`
Expected: 列出所有表（organization / site / reporting_period / emission_factor / pinned_emission_factor / emission_source / activity_data / calculation_snapshot / calculation_snapshot_line / document / extraction / customer / questionnaire / question / question_mapping / answer / company_profile / narrative_bank / audit_event / schema_migrations）

Run: `sqlite3 ~/Library/Application\ Support/carbonbook/app.sqlite "SELECT * FROM organization; SELECT * FROM site; SELECT * FROM reporting_period;"`
Expected: 一行 organization + 一行 site + 一行 reporting_period（你 wizard 填的数据，year = 你在 step 2 选的年份）

Run: `sqlite3 ~/Library/Application\ Support/carbonbook/app.sqlite "PRAGMA foreign_keys;"`
Expected: `1`

Run: `sqlite3 ~/Library/Application\ Support/carbonbook/app.sqlite "SELECT COUNT(*) FROM organization;"`
Expected: `1`（singleton 约束生效）

- [ ] **Step 6: Windows 验证**

如果有 Windows 机器：在 Windows 上 `pnpm install && pnpm exec electron-rebuild && pnpm dev` 跑一遍同 wizard 流程，验证 `%APPDATA%\carbonbook\app.sqlite` 生成 + organization + site + reporting_period 三行各一条 + `PRAGMA foreign_keys = 1`。

如果没有 Windows 机器：标 FIXME 注释，等 Phase 4 真正打 installer 时再补 Windows 验证。

- [ ] **Step 7: 写 release notes (Phase 0)**

`docs/release-notes/phase-0.md`：

```markdown
# Phase 0 — Foundation (碳本 v0.0.1-phase0)

## What works

- Electron + React + TanStack stack scaffolded.
- macOS + Windows dev/build pipeline.
- SQLite (better-sqlite3) with full v1 schema migrated:
  organization / site / reporting_period / emission_factor /
  pinned_emission_factor / emission_source / activity_data /
  calculation_snapshot[_line] / document / extraction /
  customer / questionnaire / question / question_mapping /
  answer / company_profile / narrative_bank / audit_event.
- PRAGMA foreign_keys = ON enforced; smoke-tested.
- audit_event append-only triggers in place.
- electron-trpc IPC + Service Layer pattern.
- safeStorage credential adapter (mac+win only).
- 5-step onboarding wizard → atomic `completeOnboarding` mutation
  persists organization + first site + first reporting_period.
- Paraglide JS i18n (zh-CN + en).
- Phase 0 acceptance: launch → wizard → dashboard.

## What's next

Phase 1 — AI Pipeline + 算 (inventory) flow.
```

- [ ] **Step 8: Commit + tag**

```bash
git add docs/release-notes/
git commit -m "Phase 0 complete: foundation ready for Phase 1"
git tag -a phase-0 -m "Phase 0 — Foundation"
```

---

## Phase 0 完成 Acceptance Checklist

- [ ] `pnpm dev` 在 macOS 启动 carbonbook 窗口
- [ ] 第一次启动跳到 onboarding wizard
- [ ] 5 步 wizard 全部填完，**写入 organization (1 行) + site (1 行) + reporting_period (1 行)** 到 SQLite
- [ ] 重启 app 直接进 Dashboard 不再 onboarding
- [ ] `pnpm test` 全绿（含 organization singleton 测试 + reporting_period 创建 / UNIQUE 测试）
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm build` 三个 out/ 产物齐全
- [ ] `pnpm lint` 通过（Biome）
- [ ] sqlite3 CLI 能 query 出 organization + site + reporting_period 行 + `PRAGMA foreign_keys` = 1 + `SELECT COUNT(*) FROM organization` = 1
- [ ] git 历史里 27 个 Phase 0 commit + tag `phase-0`

---

## Out of Scope (Phase 0 故意不做)

| 不做 | 何时做 |
|---|---|
| AI provider 真接入（pi-ai / LLMClient / BYOT key 验证） | Phase 1 Task 起 |
| Document upload + AI pipeline | Phase 1 |
| EF 库内容（即使 schema 已建表，0 行数据） | Phase 1 (空库够用) → Phase 1 末尾导入首批 670 条 |
| Activity data UI | Phase 1 |
| Inventory dashboard 真聚合数据（目前只是空态） | Phase 1 |
| 报告生成 / ISO 14064 / Excel 导出 | Phase 3 |
| Questionnaire 全套 | Phase 2 |
| MCP server | Phase 2 |
| License / cloud / signing | Phase 4 |

Phase 0 故意保持"骨架完整、功能空"——确认 stack 可工作，schema 落地，wizard→DB 闭环。任何业务功能都从 Phase 1 起按 spec §11 phase 推进。
