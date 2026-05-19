# Answer Generator — 三路径补全（numerical / categorical / narrative）

**Date:** 2026-05-19
**Phase:** Phase 2 Block 3（部分）
**Status:** Approved by user 2026-05-19; ready for plan.
**Predecessor:** Phase 2.2b/c（auto-answer + Excel 导出）+ `088d19e`（unfinalize action）
**Successor:** question_mapping 表 + 跨问卷复用（用户选的下一项）

## Why

`question_kind` 列在 DB 里早就有（`'numerical' | 'categorical' | 'narrative'`），但当前所有路径都强制 `'numerical'`：

- `questionnaire-service.ts:128` — `INSERT INTO question (..., question_kind, ...) VALUES (..., 'numerical', ...)`
- LLMClient.generateAnswer prompt 假设答案是"数字 + 单位"
- AnswerReviewCard 永远渲染 `Value + Unit` 两个 input

结果是问卷里非数字题（公司名称、行业分类、是否签署 SBT、可持续战略叙述等）都被按 numerical 走，prompt 不匹配、UI 也不合适。CDP 等真实问卷 30-50% 都是非 numerical 题，这是 Phase 2 主路径上一个明显缺口。

## Scope

**In scope:**
- 抽取阶段 LLM 输出新增 `question_kind` 字段；落库到 `question.question_kind`
- `LLMClient.generateAnswer` 接收 question_kind，按 kind 切换 prompt slice
- `AnswerGenerationService.generate` 透传 kind；空值守卫对 narrative 放宽（短答案不算空）
- `AnswerReviewCard` 按 kind 切换渲染：
  - numerical：Value input + Unit input（现状不动）
  - categorical：Value input（短文本），Unit 隐藏
  - narrative：Textarea（多行 6 row 起步），Unit 隐藏
- 测试：服务层 3 个新单测覆盖三路径；UI 渲染单测加 narrative/categorical 分支

**Out of scope:**
- `company_profile` / `narrative_bank` 表的 CRUD UI — 表已在 DB（Phase 0），录入 UI 是**另一个**子项目。本次 narrative 路径只读 inventory 上下文，不依赖这两张表的内容。
- 问卷已经入库的旧问题不回填 kind — 重新上传或新问卷生效即可。不写 migration，不写 backfill 脚本。
- 用户手动改 question_kind 的 UI — 边缘需求，YAGNI。
- categorical 的选项枚举 — 不预先列出 "是/否/部分"，让 LLM 自己出短词。预定义枚举留到用户反馈说"我要选项 dropdown"再做。

## Design

### 1. 抽取阶段分类

`LLMClient.extractQuestions(cells)` 当前返回 `{ questions: [{normalized_text, raw_text, expected_unit, position}, ...] }`。扩展返回值：

```ts
type ExtractedQuestion = {
  normalized_text: string;
  raw_text: string;
  expected_unit: string | null;
  position: string;
  question_kind: 'numerical' | 'categorical' | 'narrative';  // 新增
};
```

prompt 追加：

> 对每道题判断 `question_kind`：
> - `numerical`：要求填数字 + 单位（如"年度用电量(kWh)"）
> - `categorical`：要求短词答案（如"是否签署 SBTi 承诺"、"主要行业分类"）
> - `narrative`：要求 1-3 句叙述（如"请描述贵公司的气候转型计划"）
> 判断不准则降级为 `categorical`。

zod schema 加 `z.enum(['numerical', 'categorical', 'narrative'])`。

落库：`questionnaire-service.ts` 把硬编码的 `'numerical'` 改成 `q.question_kind`。

### 2. 答案生成 prompt 切换

`LLMClient.generateAnswer(config, question, inventory)` 当前 question 类型：

```ts
question: {
  raw_text: string;
  expected_unit?: string | null;
  question_kind: 'numerical' | 'categorical' | 'narrative';
}
```

question_kind 已经在签名里，但 prompt 没用它。现在按 kind 选 prompt：

```ts
const KIND_INSTRUCTIONS = {
  numerical: '请返回数字字符串 + 单位。优先从 inventory 总排放 / 活动数据中推算。',
  categorical: '请返回一个短词答案（≤10 字），如"是"/"否"/"部分"/"不适用"或行业代码/类型名。',
  narrative: '请返回 1-3 句中文叙述（≤300 字），结合 inventory 给出可审计的回答。',
};

const prompt = `你是一名碳核算助理。下面是一道供应商问卷的题目，以及当前组织 ${year} 年度的 inventory 数据。
题目类型：${question.question_kind}
${KIND_INSTRUCTIONS[question.question_kind]}

<question>
${question.raw_text}
${question.expected_unit ? `期望单位：${question.expected_unit}` : ''}
</question>

<inventory>
活动数据行数：${activity_count}
活动数据摘要：${activities_summary}
${totals ? `总排放：${JSON.stringify(totals)}` : '无总排放快照。'}
</inventory>

返回 JSON: { value: <答案字符串>, unit: <numerical 必填、其他用 null>, source_summary: <1-2 句中文> }

如果 inventory 里没有相关数据，value 用空字符串 ""，source_summary 解释为何无法回答。`;
```

zod schema 不变（`value: string, unit: string|null, source_summary: string`）。

### 3. 空值守卫 — 对 narrative 不变，对 numerical/categorical 仍然拦

当前 `AnswerGenerationService.generate` 里：

```ts
if (llmResult.value.trim() === '') {
  return yield* Effect.fail(new LLMNoData(...));
}
```

这条规则对**所有 kind 都成立** — LLM 真没数据时一律返回 `""`。narrative 不需要特别放宽。检查保持不变。

但有个 narrative 特有的边界：LLM 可能返回 200 字的真叙述，长度远超 numerical。`source_summary` 限制 500 字够用；`value` 当前没限。zod 里给 narrative 的 value 加上 `.max(2000)` 防意外大输出（categorical 也加 `.max(50)`）：

```ts
const valueSchema =
  question.question_kind === 'numerical' ? z.string().max(50)
  : question.question_kind === 'categorical' ? z.string().max(50)
  : z.string().max(2000);  // narrative
```

实现上把 schema 构造从静态移到函数内、随 kind 切换。

### 4. AnswerReviewCard 渲染分支

新增一个 `<Textarea>` UI primitive（如果还没有）。然后：

```tsx
{question.question_kind === 'narrative' ? (
  <div className="flex flex-col gap-1">
    <Label>{m.answer_value()}</Label>
    <Textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      rows={6}
      readOnly={isFinalized}
      disabled={isFinalized}
    />
  </div>
) : (
  // numerical or categorical
  <div className="flex flex-wrap gap-3">
    <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
      <Label>{m.answer_value()}</Label>
      <Input ... />
    </div>
    {question.question_kind === 'numerical' && (
      <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
        <Label>{m.answer_unit()}</Label>
        <Input ... />
      </div>
    )}
  </div>
)}
```

unit 字段在非 numerical 时永远 `null` 入库（service 保存时直接 `unit: null`）。

### 5. ActivityForm prefill — 暂不动

ActivityForm 是问卷流程**外**的东西（document extraction 阶段用）。它的 prefill 逻辑不受 question_kind 影响。本次不动。

## Decision points

| 决策 | 选 | 理由 |
|---|---|---|
| kind 检测时机 | parse 时（一次） | 是 question 的属性、不是 answer 的；落库后多次答题都用得上 |
| categorical 选项 | LLM 自由短词 | 预定义枚举要分类法，先 YAGNI |
| narrative 长度上限 | zod `value.max(2000)` | 防 LLM 偶尔超长跑飞 |
| narrative UI | `<Textarea rows={6}>` | 视觉提示"这是大段文本"，6 行约 200 字 |
| LLMNoData 守卫 | 三 kind 一视同仁 | LLM 真没数据就返回空，这条线对所有 kind 成立 |
| company_profile / narrative_bank | 本次**不**接 | 等表的 CRUD UI 子项目；narrative 第一版只读 inventory |
| 旧问卷回填 | 不做 | 重传或新建即生效 |

## Risk + rollback

**Risk 1：LLM 分类不准。** 真实问卷里 "公司总员工数" 可能被判 numerical（其实是 integer 但单位"人"是非物理单位）。问题不大：numerical 路径给个数字字符串、Unit 输空 / 填 "人" 都能用。降级路径是写到 prompt 里："判断不准则降级为 categorical"。

**Risk 2：narrative 输出污染 Excel 导出。** Excel cell 容纳 32k 字符，2000 字符叙述完全装得下。不会溢出。

**Risk 3：旧问卷已经全是 numerical，看着像 bug。** 在 detail 页加个提示？v1 不做 — 文档里说"重传生效"够了。

**Rollback：** 4 个改动：classify prompt / generate prompt / 服务的 schema 切换 / Card 渲染。`git revert` 任意一个都安全。DB schema 不动，向后兼容。

## Closeout criteria

- 上传新问卷 → 题目分类正确（人工肉眼检查 13 道题里 narrative/categorical 各至少 1 个）
- 点 narrative 题的"生成答案" → 卡片渲染 textarea、答案 1-3 句中文、Unit 不出现
- 点 categorical 题的"生成答案" → 卡片渲染普通 input、答案短词、Unit 不出现
- numerical 题 → 现状不变
- 533 → ~538 tests 全绿（service +3 测试一种 kind、UI +1-2 smoke）
- typecheck + biome 干净

## 后续衔接

完成这块后下个排程项是 **question_mapping 表 + 同客户签名复用**。signature 已经在算（`questionnaire-service.ts:132` `createHash('sha256')...`），但只是写到 `question.question_signature` 列、没有跨问卷查询。下个子项目就把那部分接通。
