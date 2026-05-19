# 同客户问卷答案复用 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让用户给同客户上传第二份问卷时，自动从上次"已定稿"的答案里按 question_signature 预填。

**Architecture:** Migration 014 给 `answer.source_kind` 加 `'reused'`。QuestionnaireService.create 插入 question 后做 JOIN 查询（customer_id + signature → 旧 answer），命中则插入 `source_kind='reused', finalized_at=NULL` 的预填行。AnswerReviewCard 加蓝色"沿用上次"chip。返回值新增 `reused_count` 让 toast 报数。

**Tech Stack:** SQLite migration、Effect 3、React。无新依赖。

**Spec:** `docs/specs/2026-05-19-question-mapping-reuse-design.md`

**Baseline:** 534 vitest（`6461aa5`）。目标：~537。

---

## Task 1 — Migration 014 + answer 表 CHECK 扩展

**Files:**
- Create: `src/main/db/migrations/014_answer_source_kind_reused.sql`
- 可能: 现有 migration 检测脚本 — 不需要、`migrate.ts` 走 glob 自动拾起

- [ ] **Step 0**:
  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git branch --show-current
  git log --oneline -3
  pnpm rebuild better-sqlite3 2>&1 | tail -2
  ```

- [ ] **Step 1**: 读 migration 005 的 answer 表完整定义

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  grep -A30 "CREATE TABLE answer" src/main/db/migrations/005_questionnaire.sql
  ```

  记下：所有列、CHECK 约束、FK、`json_valid` 约束等。新表要 1:1 复制、只改 `source_kind` 的 CHECK。

- [ ] **Step 2**: 写 migration 014

  Content（按 spec 模板，complete schema 取自 005）：

  ```sql
  -- 014_answer_source_kind_reused.sql
  -- Extend answer.source_kind enum to include 'reused' for answers
  -- auto-prefilled from a prior questionnaire of the same customer.
  -- SQLite can't ALTER CHECK; rebuild via temp table.

  PRAGMA foreign_keys = OFF;
  BEGIN;

  CREATE TABLE answer_new (
    -- COPY 005 verbatim, ONLY source_kind CHECK changes:
    id              TEXT PRIMARY KEY,
    question_id     TEXT NOT NULL UNIQUE REFERENCES question(id),
    value           TEXT NOT NULL,
    unit            TEXT,
    source_kind     TEXT NOT NULL CHECK(source_kind IN ('ai_suggested', 'manual', 'reused')),
    source_summary  TEXT CHECK(source_summary IS NULL OR json_valid(source_summary)),
    -- ... 其余列从 005 原样抄，包括 FK / CHECK / 生成列 ...
    finalized_at    TEXT
  );

  INSERT INTO answer_new SELECT * FROM answer;
  DROP TABLE answer;
  ALTER TABLE answer_new RENAME TO answer;

  -- 重建 indexes（005 里有什么就抄什么）
  -- 重建 triggers（005 里有什么就抄什么）

  COMMIT;
  PRAGMA foreign_keys = ON;
  ```

  **Critical**：抄完所有列后**对一遍** —— 缺一列、漏一个 FK 就糟。一种安全做法是先把 005 里的 answer 表完整定义读进剪贴板，把 CHECK 那行改一下。

- [ ] **Step 3**: 跑 migration 测试（如有）+ 全套

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm typecheck 2>&1 | tail -3
  pnpm vitest run --pool=threads 2>&1 | tail -5
  ```

  期望：534 仍全绿（migration 14 应用、但无新功能调用 'reused'）。

  如果挂：常见原因是 answer 表里有 trigger 或 generated 列、新表没抄上 → migration 中 INSERT 报 schema mismatch。再去 005 把所有 trigger 抄过来。

- [ ] **Step 4**: 提交

  ```bash
  git add src/main/db/migrations/014_answer_source_kind_reused.sql
  git commit -m "feat(db): migration 014 — answer.source_kind adds 'reused' for cross-questionnaire prefill"
  ```

---

## Task 2 — QuestionnaireService.create 复用查询 + 返回 reused_count

**Files:**
- Modify: `src/main/services/questionnaire-service.ts` — 加复用查询步骤；返回值加 `reused_count`
- Modify: `src/main/ipc/types.ts` — `'questionnaire:create'` 返回类型加 `reused_count: number`
- Modify: `tests/main/services/questionnaire-service.test.ts` — 加 3 个测试

- [ ] **Step 1**: 加复用逻辑

  在 `create()` 事务内、所有 question 行 INSERT 完之后，加：

  ```ts
  const findPrev = this.deps.db.prepare(`
    SELECT a.value, a.unit, a.source_summary
      FROM answer a
      JOIN question pq ON pq.id = a.question_id
      JOIN questionnaire pqn ON pqn.id = pq.questionnaire_id
     WHERE pqn.customer_id = ?
       AND pq.question_signature = ?
       AND pqn.id != ?
       AND a.finalized_at IS NOT NULL
     ORDER BY pqn.created_at DESC
     LIMIT 1
  `);

  const insertReused = this.deps.db.prepare(`
    INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
    VALUES (?, ?, ?, ?, 'reused', ?, NULL)
  `);

  let reusedCount = 0;
  for (const { id: qid, signature } of insertedQuestionsList) {
    const prev = findPrev.get(customer.id, signature, questionnaireId) as
      | { value: string; unit: string | null; source_summary: string | null }
      | undefined;
    if (!prev) continue;
    insertReused.run(randomUUID(), qid, prev.value, prev.unit, prev.source_summary);
    reusedCount++;
  }
  ```

  把 `reusedCount` 加入返回值：

  ```ts
  return { questionnaire_id: questionnaireId, question_count: ..., reused_count: reusedCount };
  ```

  **Note**：当前 `create()` 的批量 question INSERT 循环里要收集 `{id, signature}`，否则后面没法用。Likely 已经在循环里有 `insertQ.run(...)` — 把循环改成收集列表。

- [ ] **Step 2**: 改 IPC 返回类型

  ```ts
  // src/main/ipc/types.ts
  'questionnaire:create': (input: {...}) => Promise<{
    questionnaire_id: string;
    question_count: number;
    reused_count: number;  // 新增
  }>;
  ```

  + renderer api 类型应该自动通过 IpcTypeMap 推出来。

- [ ] **Step 3**: 服务层测试 — 3 个新测试

  在 `tests/main/services/questionnaire-service.test.ts` 加：

  ```ts
  describe('QuestionnaireService.create — reuse from prior questionnaires', () => {
    it('reuses finalized answers from same customer prior questionnaire', async () => {
      // 1. 创建 customer A
      // 2. 创建第一份 questionnaire（含一道题 sig='X'）
      // 3. 插入对应 answer，source_kind='manual'，finalized_at='2026-01-01...'
      // 4. mock LLM 让 extractQuestions 返回同样 signature 的题（normalized_text 一致）
      // 5. 上传第二份 questionnaire（同 customer A）
      // 6. 断言：新 questionnaire 的题对应 answer 存在、source_kind='reused'、value 与旧的相同、finalized_at=null
      // 7. 断言：返回的 reused_count === 1
    });

    it('does not reuse drafts (finalized_at IS NULL)', async () => {
      // 同上、但第一份答案没定稿（finalized_at=null）
      // 第二份 reused_count === 0、新 question 没对应 answer 行
    });

    it('does not reuse across different customers', async () => {
      // 客户 A 有定稿答案
      // 第二份给客户 B、同 signature → 不复用
      // reused_count === 0
    });
  });
  ```

- [ ] **Step 4**: typecheck + 测试

  ```bash
  pnpm typecheck 2>&1 | tail -5
  pnpm vitest run tests/main/services/questionnaire-service.test.ts --pool=threads 2>&1 | tail -10
  ```

  期望：clean、所有测试通过（含 3 个新）。

  全套：
  ```bash
  pnpm vitest run --pool=threads 2>&1 | tail -5
  ```

  期望：~537 passing。

- [ ] **Step 5**: 提交

  ```bash
  git add -A
  git commit -m "feat(questionnaire): auto-prefill answers from same customer's prior finalized questionnaires"
  ```

---

## Task 3 — AnswerReviewCard + toast 视觉反馈

**Files:**
- Modify: `src/renderer/components/AnswerReviewCard.tsx` — 加蓝色 "沿用上次" chip
- Modify: `src/renderer/routes/questionnaires_.new.tsx` — toast 文案带复用计数
- Modify: `messages/zh-CN.json` + `messages/en.json` — 2 个新 i18n key

- [ ] **Step 1**: i18n keys

  `messages/zh-CN.json`：
  ```json
  "answer_source_reused": "沿用上次问卷答案",
  "questionnaires_wizard_success_with_reused": "已解析 {count} 题（自动沿用 {reused} 题）",
  ```

  `messages/en.json`：
  ```json
  "answer_source_reused": "Reused from previous questionnaire",
  "questionnaires_wizard_success_with_reused": "Parsed {count} questions ({reused} reused)",
  ```

  然后：
  ```bash
  npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide 2>&1 | tail -3
  ```

- [ ] **Step 2**: AnswerReviewCard chip

  在 main render（`!answer` 分支之后的 return）的 header 里，在 `finalized_at` chip 旁边加：

  ```tsx
  {!answer.finalized_at && answer.source_kind === 'reused' && (
    <span className="ml-auto rounded border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300">
      {m.answer_source_reused()}
    </span>
  )}
  ```

  注：finalized_at chip 已经用了 `ml-auto`。两个 chip 互斥（finalized 后 source_kind 会翻成 'manual'，所以同时只显示一个）— 用嵌套 `else if` 或者两个独立 conditional 都行。

- [ ] **Step 3**: toast 文案

  在 `questionnaires_.new.tsx` 的 mutation onSuccess：

  ```tsx
  onSuccess: (r) => {
    void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
    const msg =
      r.reused_count > 0
        ? m.questionnaires_wizard_success_with_reused({
            count: r.question_count,
            reused: r.reused_count,
          })
        : m.questionnaires_wizard_success({ count: r.question_count });
    toast.success(msg);
    void navigate({ to: '/questionnaires/$id', params: { id: r.questionnaire_id } });
  },
  ```

- [ ] **Step 4**: typecheck + 渲染测试

  ```bash
  pnpm typecheck 2>&1 | tail -5
  pnpm vitest run tests/renderer/ --pool=threads 2>&1 | tail -5
  ```

  期望：clean、所有渲染测试通过。

- [ ] **Step 5**: 提交

  ```bash
  git add -A
  git commit -m "feat(ui): blue 'reused' chip on AnswerReviewCard + toast count for reused answers"
  ```

---

## Task 4 — Sweep + 全套

- [ ] **Step 1**: 全套测试

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm vitest run --pool=threads 2>&1 | tail -5
  ```

  期望：~537 全绿。

- [ ] **Step 2**: typecheck + biome

  ```bash
  pnpm typecheck
  pnpm format 2>&1 | tail -3
  pnpm exec biome check --write 2>&1 | tail -3
  ```

- [ ] **Step 3**: 最后提交

  ```bash
  git add -A
  git commit -m "chore: biome sweep for question_signature reuse" || true
  git log --oneline -8
  ```

---

## Closeout

落地后能力：

- 给客户 A 上传第 N 份问卷，N≥2 → 题目签名命中上次定稿答案 → 自动预填、卡片有"沿用上次"蓝 chip、toast 报数
- 同客户的草稿 / 不同客户 / 第一份 → 行为完全不变（向后兼容）
- migration 14 给 source_kind 加 'reused'，不冲突任何旧数据
- 用户编辑 reused 答案点 "保存并定稿" → source_kind 翻为 'manual'（save 里硬编码）→ chip 消失、变成 finalized chip

**手工验证（用户做）**：
1. `node scripts/seed-test-data.mjs` 保证 2025 inventory 在
2. 上传 `samples/test-questionnaire-2025.xlsx` 给客户 X，全部定稿 → 导出
3. 用同样的 .xlsx 再上传一份给同客户 X（年度可以一致也可以改 2026）
4. 详情页：所有题应该都有蓝 chip + 上次的 value 已经预填
5. toast：`已解析 N 题（自动沿用 N 题）`
6. 改一题值、点 "保存并定稿" → chip 变成 finalized

**下一步**：MCP server v1。
