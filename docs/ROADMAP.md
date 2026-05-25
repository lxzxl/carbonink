# CarbonInk — Roadmap

发布后的中长期功能想法。和 `docs/todo/`（已知问题积压）和 `docs/plans/`（已批准的实施计划）三者分工：
roadmap 只记"想做"，没排期、没承诺。要做之前必须先走 brainstorm → spec → plan 的常规流程。

---

## 1. 智能客服 + 上线销售页面

**目标**：在 `cloud/web/` 上加一个对话式客服，回答潜在用户对产品的问题（适用场景、定价、ISO 14064-1 覆盖度、和竞品的差异等），降低销售漏斗里的"读 FAQ 读不下去"流失。

**技术取舍 / 当作个人面试项目来打磨**：

- **LLM**：用 DeepSeek。理由：成本低、中文表现强、和目标用户语言一致；面试时可讲清"为什么没选 GPT/Claude"。
- **Agent harness 自研**：不直接套 LangChain / LlamaIndex 这类框架，自己设计 agent 主循环 + 工具调用协议 + 错误处理。目的就是为了能在面试里完整讲一遍 harness 的设计决策（工具 schema、turn loop、context window 管理、失败重试、observability）。
- **记忆方案对比**：在实现过程中要至少跑通 2-3 种记忆方案再做取舍。候选：
  - 纯滑动窗口（baseline）
  - 摘要式记忆（每 N 轮压一次）
  - 向量检索 + 长期记忆（embedding + 一个轻量向量库）
  - 结构化记忆（用产品自己的 schema，例如"用户问过哪些 SKU"）
  - 最终选一种、写清取舍理由——这本身就是个面试故事。
- **首选 agent harness：[pi.dev](https://pi.dev/)**。pi.dev 本身就是 agent harness 工具，能用 pi.dev 跑就用它。这里和上一条"自研 harness"不冲突：把 pi.dev 当作底层 runtime（turn loop / 工具调用协议 / observability 这一层），自研工作落在"在 pi.dev 之上"——agent 的提示设计、工具集（FAQ 检索、定价查询、可选的真实 API 调用）、记忆策略、降级路径。面试故事就从"为什么选 pi.dev、它的抽象帮我省了什么、不够用的地方我怎么补"展开，比从零造 harness 更可信。
  - 需要先花一两天验证 pi.dev 的几个关键点：是否支持 DeepSeek（不是 OpenAI/Anthropic 的话能不能接）、cost / latency、self-host vs hosted、能否部署到 Cloudflare Worker（marketing 站点的同源约束），如果其中任何一项不通，再回退到自研 harness。

**集成点**：
- 前端：`cloud/web/` 是 hybrid Astro（marketing pages 走 prerender，portal pages 走 SSR via `@astrojs/cloudflare`）。新增客服只需加一个 React/Astro 组件 + 一条 `POST /api/v1/chat` 路由（落到 `cloud/worker/` 的 API），无需新开 worker。
- 后端：DeepSeek API key 通过 Cloudflare Worker secret 注入；不能暴露在浏览器端。
- 数据：对话日志要不要落盘？落到哪？（D1？R2？）——和产品数据 SQLite 完全隔离，因为是云端 + 匿名访问。

**开放问题**：
- 客服能不能调用产品的真实 API（例如查 EF 库存）？还是纯 RAG over FAQ？前者面试更亮、但安全面要重做。
- 是否要做引导式（"我想看排放因子" → 按钮）vs 纯自然语言？

---

## 2. App 内 Wizard / 引导提示

**目标**：降低首次用户的教育成本和学习成本。现状是用户上手 碳墨 桌面端要自己摸索"上传文件 → 抽取 → 审核 → 答题 → 导出"这一整套流程，没有任何 in-app 引导。

**已经有的相关代码**：
- `desktop/src/renderer/routes/onboarding/` 已经有 5 步 wizard（Phase 0 task-22～26），但那是**一次性**的组织/site/AI provider 初始化，做完就不再出现。
- 不是这里说的"功能性 wizard"。

**新 wizard 应该覆盖的点**：
- 首次进入"问卷"页面：解释什么是问卷、上传 .xlsx 后会发生什么。
- 首次进入"抽取阶段"页面：解释 5 个 stage（freight / fuel / purchase / travel / questionnaire）的区别。
- 首次见到 AnswerReviewCard：解释"生成答案" / "保存并定稿" / "撤销定稿"分别意味着什么。
- 首次见到 EF rebind UI：解释为什么排放因子可以换、换了以后旧 snapshot 会不会失效。
- ISO 14064-1 报告导出前：解释 Scope 1/2/3 在导出里怎么分组。

**实现方向（待 brainstorm）**：
- 用 shadcn `Tooltip` / `Popover` + localStorage 标记 "已看过"？
- 还是引一个 product tour 库（react-joyride 之类）？
- 引导文案走 paraglide messages，中英双语对齐。

**风险**：
- 引导过多 = 噪音；只在用户**首次**进入某个屏幕时触发，且要可永久 dismiss。
- 和 [UI/UX redesign backlog](todo/2026-05-19-ui-ux-redesign.md) 有交集——redesign 重排页面布局后，wizard 的锚点也要跟着重做。**先做 redesign 再做 wizard**，否则白干。

