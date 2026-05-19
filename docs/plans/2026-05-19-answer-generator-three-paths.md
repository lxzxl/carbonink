# Answer Generator 三路径 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让问卷的 numerical / categorical / narrative 三种题型走各自的 prompt + UI，不再强制 numerical。

**Architecture:** parse 时由抽取 LLM 给每道题标 `question_kind`，落库到 `question.question_kind`。生成时 `LLMClient.generateAnswer` 按 kind 切 prompt slice + zod value 长度上限。`AnswerReviewCard` 按 kind 切渲染（narrative 用 `<Textarea>`，非 numerical 隐藏 Unit）。

**Tech Stack:** zod、Effect 3、AI SDK 6、React 18、shadcn `<Textarea>` 已存在。**无新依赖。**

**Spec:** `docs/specs/2026-05-19-answer-generator-three-paths-design.md`

**Baseline:** 533 vitest 全绿（`088d19e`）。目标：~538 全绿。

---

## Task 1 — 抽取阶段 LLM 输出 question_kind

**Files:**
- Modify: `src/main/llm/llm-client.ts` — extractQuestions 的 zod schema 增 `question_kind` 字段、prompt 加分类说明
- Modify: `src/main/services/questionnaire-service.ts` — 把硬编码的 `'numerical'` 改成 `q.question_kind`
- Modify: `tests/main/services/questionnaire-service.test.ts` — mock LLM 返回多种 kind、断言 DB 落库正确

- [ ] **Step 1: Locate extractQuestions schema**

```bash
cd /Users/lxz/ws/personal/carbonbook
grep -n "extractQuestions\|normalized_text\|question_kind" src/main/llm/llm-client.ts | head -15
```

找到 extractQuestions 的 zod schema 定义位置。

- [ ] **Step 2: 扩 schema 加 question_kind**

在 extractQuestions 内：

```ts
const schema = z.object({
  questions: z.array(
    z.object({
      normalized_text: z.string(),
      raw_text: z.string(),
      expected_unit: z.string().nullable(),
      position: z.string(),
      question_kind: z.enum(['numerical', 'categorical', 'narrative']),  // 新增
    }),
  ),
});
```

- [ ] **Step 3: 改 extractQuestions 的 prompt**

在 prompt 里追加：

```
对每道题判断 question_kind：
- numerical：要求填数字 + 单位（如"年度用电量(kWh)"、"总人数"）
- categorical：要求短词答案（如"是否签署 SBTi 承诺"、"主要行业分类"、"报告期开始日期"）
- narrative：要求 1-3 句叙述（如"请描述贵公司气候转型计划"、"贵公司的可持续战略"）
判断不准则降级为 categorical。
```

- [ ] **Step 4: 改 questionnaire-service.ts 把硬编码 numerical 换掉**

```bash
grep -n "'numerical'" src/main/services/questionnaire-service.ts
```

找到 INSERT INTO question 的 SQL（约 128 行），把 `question_kind` 那个位置参数从硬编码 `'numerical'` 改成绑定 `q.question_kind`。

- [ ] **Step 5: 更新现有测试**

测试里 mock LLM 返回的 questions 应该包含 `question_kind`。把 mock 数据加上字段、再加一个测试断言不同 kind 落库正确。

- [ ] **Step 6: typecheck + 跑 service 测试**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -5
pnpm vitest run tests/main/services/questionnaire-service.test.ts --pool=threads 2>&1 | tail -10
```

期望：clean + 全绿。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(llm): classify question_kind during questionnaire extraction"
```

---

## Task 2 — generateAnswer prompt 按 kind 切换

**Files:**
- Modify: `src/main/llm/llm-client.ts` — generateAnswer 的 prompt 按 question.question_kind 切；value zod max length 按 kind 给

- [ ] **Step 1: 定义 KIND_INSTRUCTIONS 常量**

在 generateAnswer 函数内：

```ts
const KIND_INSTRUCTIONS: Record<typeof question.question_kind, string> = {
  numerical: '请返回数字字符串 + 单位。优先从 inventory 总排放 / 活动数据中推算。',
  categorical: '请返回一个短词答案（≤10 字），如"是"/"否"/"部分"/"不适用"或行业代码/类型名。',
  narrative: '请返回 1-3 句中文叙述（≤300 字），结合 inventory 给出可审计的回答。',
};
```

- [ ] **Step 2: 改 prompt 模板**

在 prompt 里加：

```
题目类型：${question.question_kind}
${KIND_INSTRUCTIONS[question.question_kind]}
```

放在 `<question>` 块**之前**。

- [ ] **Step 3: 切 zod value max length**

```ts
const valueMax =
  question.question_kind === 'narrative' ? 2000
  : 50;  // numerical / categorical

const schema = z.object({
  value: z.string().max(valueMax),
  unit: z.string().nullable(),
  source_summary: z.string().max(500),
});
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck 2>&1 | tail -3
```

- [ ] **Step 5: 不写新测试 — 现有 LLM 测试都是 mock，prompt 字符串不在测试断言里。但要确保现有 generateAnswer 单测仍通过（kind 默认填了 numerical 等价于现状）**

```bash
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads 2>&1 | tail -10
```

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(llm): generateAnswer prompt slices per question_kind + per-kind value length cap"
```

---

## Task 3 — AnswerReviewCard 按 kind 切渲染

**Files:**
- Modify: `src/renderer/components/AnswerReviewCard.tsx` — narrative 用 Textarea、非 numerical 隐藏 Unit
- 可能需要: `src/renderer/components/ui/textarea.tsx` — 若不存在则新建

- [ ] **Step 1: 确认 Textarea primitive 是否存在**

```bash
ls src/renderer/components/ui/textarea.tsx 2>/dev/null
```

不存在则参照 `input.tsx` 风格新建一个 thin wrapper。

- [ ] **Step 2: 在 AnswerReviewCard 内做 3 路径渲染**

参考 spec 的 JSX 块。关键点：
- `question.question_kind === 'narrative'` → 单列 `<Textarea rows={6}>`
- 否则 numerical / categorical → Value input
- 仅 `numerical` 渲染 Unit input
- 所有 input 在 `isFinalized` 时 readOnly + disabled（保持现有逻辑）

- [ ] **Step 3: typecheck + 渲染测试**

```bash
pnpm typecheck 2>&1 | tail -3
pnpm vitest run tests/renderer/ --pool=threads 2>&1 | tail -5
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat(ui): AnswerReviewCard renders Textarea for narrative, hides Unit for non-numerical"
```

---

## Task 4 — 服务端 unit 强制 null（非 numerical）

**Files:**
- Modify: `src/main/services/answer-generation/index.ts` — insertAnswer 时若 question_kind !== 'numerical' 则 unit 入库为 null

- [ ] **Step 1: 在 generate() 里读 question_kind 后、insertAnswer 之前**

```ts
const unit = question.question_kind === 'numerical' ? llmResult.unit : null;

return yield* insertAnswer(db, {
  ...
  unit,
  ...
});
```

理由：LLM 可能在 prompt 误解下给 narrative 题填了"句"或其他奇怪单位；强制 null 防污染下游导出。

- [ ] **Step 2: 同样在 save() 里 (option) —**

如果 save 也透传 unit，加同等保护。检查代码后决定。Save 接收用户输入，用户主动填的就尊重用户。skip。

- [ ] **Step 3: 加 1 个服务单测：narrative kind 的 generate 结果 unit 为 null**

参考现有 `LLMNoData when LLM returns an empty value` 测试样式：

```ts
it('narrative kind: unit stored as null even if LLM provided one', async () => {
  // seed a narrative question; LLM mock returns value='叙述...' unit='句'
  // assert DB row unit IS NULL
});
```

- [ ] **Step 4: typecheck + 服务测试**

```bash
pnpm typecheck 2>&1 | tail -3
pnpm vitest run tests/main/services/answer-generation-service.test.ts --pool=threads 2>&1 | tail -10
```

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix(answer): unit forced to null on non-numerical kinds at insert"
```

---

## Task 5 — Sweep + 全套测试

- [ ] **Step 1: 跑全套**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```

期望：~538 全绿（533 + 几个新测试）。

- [ ] **Step 2: typecheck + biome**

```bash
pnpm typecheck
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -3
```

- [ ] **Step 3: 最后提交 sweep**

```bash
git add -A
git commit -m "chore: biome sweep for three-path answer generator" || true
git log --oneline -8
```

---

## Closeout

子项目落地后能力：

- 上传任何混合题型的问卷 → 抽取阶段自动分类 → 每题用对应的 prompt 生成 → UI 按 kind 渲染
- numerical 现状不变（向后兼容）
- categorical 答案不带单位
- narrative 用 textarea 编辑、不带单位

**Done 标准（手工验证）**：

1. 把 `samples/test-questionnaire-2025.xlsx` 删几条改成混合题型（如加一道"请描述贵公司气候管理体系"）
2. 上传 → 详情页 → 13 道题里至少 1 题分类为 narrative、1 题 categorical
3. 点 narrative 题"生成答案" → 卡片渲染 textarea + 1-3 句中文答案 + 无 Unit 字段
4. 点 categorical 题"生成答案" → 短词答案 + 无 Unit 字段
5. numerical 题保持原有体验

**下一步**：question_mapping 表 + 同客户签名复用 — 接 sig 列已经在算只是没人查这件事。
