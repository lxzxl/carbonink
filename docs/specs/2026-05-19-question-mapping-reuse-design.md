# 同客户问卷答案复用（question_signature 复用）

**Date:** 2026-05-19
**Phase:** Phase 2 Block 2（部分）
**Status:** Approved by user 2026-05-19; ready for plan.
**Predecessor:** 三路径答案生成器（`6461aa5`）
**Successor:** MCP server v1（用户排在 #3）

## Why

`question.question_signature` 列（SHA256 of normalized_text）从 Phase 2.2a 开始就在写入，但**没有任何代码读它**。原 Phase 2 spec 把"同 customer 同 signature 自动复用上次答案"列为 Block 2 的核心交付物 — 让用户给同一家客户填第二份问卷时不用重头答一遍。落地这块就把这个功能接通。

实际用户场景：

1. 给客户 A 上传 2025 年 CDP 问卷 → 答完 → 定稿 → 导出
2. 客户 A 一年后又给来个 2026 年问卷（80% 题目和 2025 一样）
3. 上传第二份后，相同题目自动预填上次的答案；用户只改有变化的题

## Scope

**In scope:**
- Migration 014：扩 `answer.source_kind` CHECK 枚举，加 `'reused'` 值
- `QuestionnaireService.create`：插入 question 行后，对每道题查同 customer 同 signature 的"最近一个已定稿答案"；命中则插入预填 answer 行（`source_kind='reused'`、`finalized_at=NULL`）
- `AnswerReviewCard`：`source_kind='reused'` 渲染一个"沿用上次问卷答案"的蓝色 chip
- 服务层 + 端到端测试覆盖：同客户第二份问卷 → answer 预填行存在

**Out of scope:**
- 跨**不同**客户的复用（按行业 / 题目相似度）— 那是 narrative_bank / company_profile 的事，这次只走 customer FK 精确匹配
- AI mapping 建议 UI（左右分屏）— 那是当签名不命中时让 LLM 推荐"相似题"的功能，工作量大、留给后续子项目
- 跨问卷答案的 EDIT 追溯链 — 不在 answer 表加 `reused_from_answer_id` FK 列；要恢复 lineage 就 JOIN signature + customer 重新算
- 旧问卷回填 — 这个子项目落地之前上传的问卷不会被回追预填；用户重传即可

## Design

### 1. Migration 014：扩 source_kind

当前 migration 005 里 `answer.source_kind` 的 CHECK 枚举（用 grep 找）大概是：
```sql
source_kind TEXT NOT NULL CHECK(source_kind IN ('ai_suggested', 'manual'))
```

要加 `'reused'`。SQLite 不能 `ALTER TABLE ... ADD CONSTRAINT`，得：

```sql
-- 014_answer_source_kind_reused.sql
-- 扩 source_kind 枚举：加入 'reused'（来自同客户上一份问卷的复用答案）

PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE answer_new (
  -- 完整 schema 复制自 005，仅 source_kind CHECK 改了
  ...
  source_kind TEXT NOT NULL CHECK(source_kind IN ('ai_suggested', 'manual', 'reused')),
  ...
);
INSERT INTO answer_new SELECT * FROM answer;
DROP TABLE answer;
ALTER TABLE answer_new RENAME TO answer;
-- 重建 indexes + triggers

COMMIT;
PRAGMA foreign_keys = ON;
```

migration 文件里把 answer 原始定义完整复制一份，只改 CHECK；其余 FK、索引、生成列原样保留。

### 2. QuestionnaireService.create — 复用查询

当前 `create()` 在事务里：
1. INSERT customer
2. INSERT document
3. INSERT questionnaire
4. INSERT question 行（批量）

加第 5 步：

```ts
// Step 5: 同 customer 同 signature 的已定稿历史答案复用
const findPrev = this.deps.db.prepare(`
  SELECT a.value, a.unit, a.source_summary, a.source_kind
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

const insertReusedAnswer = this.deps.db.prepare(`
  INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
  VALUES (?, ?, ?, ?, 'reused', ?, NULL)
`);

let reused = 0;
for (const q of insertedQuestions) {
  const prev = findPrev.get(customer.id, q.question_signature, questionnaireId);
  if (!prev) continue;
  insertReusedAnswer.run(
    randomUUID(),
    q.id,
    prev.value,
    prev.unit,
    prev.source_summary,
    // finalized_at stays NULL — user must reconfirm
  );
  reused++;
}
```

`reused` 计数返回给前端在 toast 里显示（"解析 13 题，自动沿用 8 题"）。

### 3. AnswerReviewCard — `reused` 渲染

新增 i18n 键：
- `answer_source_reused` — `"沿用上次问卷答案"` / `"Reused from previous questionnaire"`

卡片渲染逻辑：当 `answer.source_kind === 'reused'` 时，在 header 右侧加 chip（蓝色，区别于 finalized 的灰色）。其余渲染照旧 — value/unit 都是可编辑的（finalized_at=NULL 意味着这是 draft）。

```tsx
{answer.source_kind === 'reused' && !answer.finalized_at && (
  <span className="ml-auto rounded border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300">
    {m.answer_source_reused()}
  </span>
)}
```

注：finalized 的 chip 和 reused 的 chip 互斥 — 用户点 `保存并定稿` 后 source_kind 会自动翻到 `'manual'`（save() 写的就是 'manual'），reused chip 自然就不再出现。

### 4. 端到端测试

服务层测试新增（`tests/main/services/questionnaire-service.test.ts`）：

```ts
it('reuses finalized answers from same customer prior questionnaire', async () => {
  // 1. 上传第一份问卷给客户 A，答题，定稿
  // 2. 上传第二份（题目部分重叠）给同客户 A
  // 3. 断言：重叠题的 answer 行 source_kind='reused' value=旧值
});

it('does not reuse drafts', async () => {
  // 上次答了但没定稿 → 第二份不预填
});

it('does not reuse across different customers', async () => {
  // 客户 A 的题在客户 B 的问卷里 — 不复用
});
```

3 个新单测。

### 5. Toast 反馈

`questionnaires_.new.tsx` 的 onSuccess toast 加上复用计数：

```tsx
toast.success(m.questionnaires_wizard_success({ count: r.question_count }));
// →
toast.success(
  r.reused_count > 0
    ? m.questionnaires_wizard_success_with_reused({ count: r.question_count, reused: r.reused_count })
    : m.questionnaires_wizard_success({ count: r.question_count }),
);
```

`questionnaires_wizard_success_with_reused`: `"已解析 {count} 题（自动沿用 {reused} 题）"`

`QuestionnaireService.create` 返回值多一个字段：

```ts
{ questionnaire_id: string; question_count: number; reused_count: number }
```

## Decision points

| 决策 | 选 | 理由 |
|---|---|---|
| 是否新建 `question_mapping` 表 | 不建 | 现有 `question.question_signature` + JOIN 已够；YAGNI |
| 复用粒度 | 同 customer_id 精确匹配 | 跨客户复用是 narrative_bank/company_profile 的范畴 |
| 草稿要不要复用 | 不复用，只复用 `finalized_at IS NOT NULL` | 草稿质量参差不齐、避免传播错答 |
| 候选多个怎么选 | 最近 `created_at DESC LIMIT 1` | 简单可解释 |
| `source_kind` 新值 | 加 `'reused'` | 提供清晰 provenance |
| 复用后 `finalized_at` | NULL | 强制用户复审 — 不同年度同题答案可能要更新 |
| 写答案 lineage（`reused_from_*`） | 不写 | 通过 signature + customer JOIN 可重算；YAGNI |
| 是否覆盖现有 answer | 不覆盖 | `INSERT OR IGNORE` 等价语义，但实际上 question 行刚新建、不会有 answer 冲突 |

## Risk + rollback

**Risk 1**：用户改了 `customer.name`（同一行 UPDATE）后又上传问卷，但 customer_id 不变 → 还能复用。✓ 安全。

**Risk 2**：用户**重命名**了客户（实际上 carbonbook 用 `customers.name` 做事实主键？）— 看一下 `customerService.createOrGetByName`。如果 "客户A" → "客户 A 上海分公司" 创建了新行，那两个 customer_id 不同、复用断了。可接受的局限，文档说一下。

**Risk 3**：normalized_text 微变 → signature 完全不同 → 命中失败。当前 normalize 逻辑（trim + lowercase？）由 LLM extractQuestions 控制。如果上下两个问卷 normalize 略不同，复用就失效。可接受 — 信号确定性比信号普及度优先。

**Rollback**：单 migration 014 + 服务一段代码 + UI 一个 chip。`git revert` 安全；migration 是非破坏性的（仅扩 CHECK 枚举，旧数据 source_kind 都是 'ai_suggested' 或 'manual' 不冲突）。

## Closeout criteria

- Migration 014 落地、 `'reused'` 是合法 source_kind
- 上传**第二份**问卷给同客户 → 题目签名命中 → 自动预填、卡片有蓝色"沿用上次"chip
- 上传**第一份**或不同客户的问卷 → 行为不变
- toast 显示"自动沿用 X 题"
- 服务层 +3 单测；总 ~537 tests 全绿
- typecheck + biome clean

## 后续衔接

完成这块后下个排程项是 **MCP server v1**：暴露 carbonbook 的 inventory / questionnaire 数据给 Claude Desktop，可读、可调用、可订阅。是个独立的大子项目（~3-4 天），届时单开 spec + plan。
