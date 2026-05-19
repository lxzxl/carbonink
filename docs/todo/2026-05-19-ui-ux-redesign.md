# UI / UX Redesign — Backlog

**Date opened:** 2026-05-19
**Trigger:** 用户手动走问卷流程时反复发现 UI 不直观、按钮职责模糊、状态机和产品流脱节。
**Scope:** 整体重设计前先把已知问题列清，redesign 时统一处理。**不要逐条修补**，会越改越乱。

## 已知问题（按发现顺序）

### 1. `确认全部答案` 按钮（`/questionnaires/$id`）—— dead button

- **现状**：调 `questionnaire:finalize` → 仅执行 `UPDATE questionnaire SET status = 'answering'`。没影响答题动作、不锁定答案、不阻止后续修改。
- **为什么没用**：每张卡片自己的 `保存并定稿` + `撤销定稿` 才是真正的答案锁定机制（`088d19e`）。这个按钮是 phase-1 早期占位、被 phase-2.2b 的卡片机制取代后忘删。
- **命名错位**："确认全部答案"暗示完成 / 锁定，但产生的 status 是 `'answering'`（答题中），语义反了。
- **redesign 时**：要么彻底删（含 IPC 和 service.finalizeAnswering），要么重新定义为"批量定稿所有未定稿答案" + 切换到一个真正的终态（如 `'ready_for_export'`）。
- **保留 commit**：用户 2026-05-19 决定先留着、等整体重设计统一处理。

### 2. 问卷状态机 `parsing → mapping → answering → exported` 和真实流程脱节

- **DB 约束**（migration 005）：`CHECK(status IN ('parsing', 'mapping', 'answering', 'exported'))`
- **实际产品流**：用户上传 .xlsx → 直接看到 AnswerReviewCard 列表 → 点生成答案 → 编辑 / 定稿 → 导出。没有 mapping 和 answering 的过渡感。
- **现状不一致**：
  - 上传后 status = `'mapping'`（永远停在这里，除非用户点上面那个 dead 按钮）
  - 用户答完所有题 + 全部定稿 → status 仍是 `'mapping'`
  - 用户导出 → status = `'exported'`
- **redesign 时**：要么简化为 `draft → exported` 两态，要么把状态变成"已定稿题数 / 总题数"这种可观察派生值，去掉 status 字段的写死语义。

### 3. AnswerReviewCard 渲染密度 / 视觉层级

- **现状**：每张卡片占垂直空间大，10+ 道题需要大量滚动
- **没有**：折叠 / 分组 / 进度概览
- **redesign 时**：考虑左侧列表 + 右侧详情 双栏，或者题目分组（按 sheet / 按分类），或者列表 + 抽屉
- **当前补丁不要做**：等整体重设计

### 4. `生成答案` 单题 vs `生成所有未答` 批量按钮位置不统一

- 单题按钮在卡片里
- 批量按钮在页面底部、和 `导出 Excel` 并列
- 视觉上"全选 / 批量"和"导出"并列、和卡片的"单题"分离
- **redesign 时**：把所有批量动作收到工具栏（顶部 sticky 或选中模式），单题动作留在卡片里

### 5. 问卷"状态"在页眉只显示英文 enum 值

- 标题下方目前是 `2025 · mapping · test-questionnaire-2025.xlsx`
- `mapping` 这种是开发用的内部 enum，用户看不懂
- **redesign 时**：要么映射成中文 / 进度文案，要么换成进度条 / 已定稿/总数

### 6. 导出后 `已定稿` 状态不可视化

- 卡片定稿后只有右上角一个小 chip
- 整张卡片的 affordance（input 灰、按钮换成"撤销定稿"）虽然写了、但视觉上仍然像可编辑
- **redesign 时**：考虑整张卡片换底色 / 加左侧 accent / 折叠到只显示一行

### 7. 整体设计风格不统一

- 不同页面的 padding / 圆角 / 间距 / 字号有偏差
- shadcn primitives 用法不一致（有的用 Button variant outline、有的不用）
- **redesign 时**：先建一遍 design tokens，统一字号梯队、间距、卡片样式，再覆盖各页面

---

## 不在 redesign 范围（明确**不**统一处理）

- 数据模型 / IPC / Effect 服务层：稳定，redesign 只动渲染层
- 抽取阶段（5 个 stage）的 ExtractionReview 流程：和问卷流程是两套，独立 redesign
- 路由 API / 设置页：独立子项目，redesign 不动

---

## redesign 启动条件

用户主动触发。在那之前任何 UI 改动都要克制 —— 修明显 bug 可以、做"顺手优化"不可以。
