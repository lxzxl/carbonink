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

---

## 3. 用 `@earendil-works/pi-ai` 替换内部 LLM 客户端

**目标**：把 `desktop/src/main/llm/llm-client.ts` 换成 pi 生态的统一多供应商 LLM API。pi-ai 已经做好了 OpenAI / Anthropic / Google / OpenRouter 适配、流式、prompt caching 协议、OAuth 这些"我们要么自己写一遍要么半成品"的部分。

**已经有的相关代码**：
- `desktop/src/main/llm/llm-client.ts`（当前自研客户端）
- `desktop/src/main/llm/vision-capability.ts`（vision 能力探测）
- `desktop/src/main/llm/report-narrative.ts`、`stages/`（业务消费方）
- `desktop/src/main/services/credential-service.ts`（BYOK 凭证管理）

**技术取舍**：
- 收益：用户 BYOK 任意 OpenAI 兼容 API（含 DeepSeek、Qwen、智谱），不再需要每接一个 provider 改一次代码。
- 收益：pi-ai 内部已实现 Anthropic / Gemini 的 prompt cache 上报，对今后的成本控制很有用。
- 参考：[apmantza/pi-free](https://github.com/apmantza/pi-free) 证明 pi-ai 接国产模型可行。
- 风险：pi-ai 自己的计费 hook 是否能让 license 服务做 token 计量？需要先验。
- 风险：要保留一层薄 adapter 防止 vendor lock-in，万一 pi-ai 出问题能切回去。

**集成点**：
- 纯 main process 内部改造，renderer 不动。
- `llm/stages/` 当前调用 `LLMClient` 的位置都是少数几个入口，可逐步迁。
- credential-service.ts 的 provider 列表要扩，UI 上"AI provider 设置"页面要同步。

**开放问题**：
- pi-ai 的 OAuth 流程在 Electron 里跑得通吗（loopback redirect）？
- license 计量怎么 hook 到 pi-ai 的请求生命周期？
- 是不是应该把这事和 item 1（marketing 客服）的 pi.dev 验证合并做一次决策？

---

## 4. 用 `@earendil-works/pi-agent-core` 重写 answer-generation 流水线

**目标**：当前 `answer-generation/` 是线性 pipeline（extraction → classification → EF match → answer）。换成 agent runtime 后，agent 可以在循环里看到中间结果、主动调 `lookup_ef("柴油")`、不满意就再 `search_documents(...)`、token budget 内自我纠错。

**已经有的相关代码**：
- `desktop/src/main/services/answer-generation/`
- `desktop/src/main/services/extraction-service.ts`
- `desktop/src/main/services/ef-matcher/`、`ef-matcher-service.ts`
- `desktop/src/main/services/classification-service.ts`
- `desktop/src/main/services/calculation-service.ts`（agent 可调工具的天然候选）

**技术取舍**：
- 收益：自动填问卷准确率从"固定 pipeline + 用户兜底"提升到"agent 自主纠错 + 主动提问"。
- 收益：pi-agent-core 已处理 tool-call retry、context window 管理、turn loop——省下半年工作。
- 成本：当前 pipeline 可预测、易调试；agent 化后调试复杂度上升，需要 traces。
- 强依赖：**必须先完成方向 3（pi-ai）**。

**集成点**：
- service 接口保持不变，内部替换为 agent loop。
- AnswerReviewCard 可以新增"agent 思考过程"侧栏，展示工具调用链。
- 复用现有 `extraction-service` / `ef-matcher-service` 包装为 agent tools。

**开放问题**：
- 失控兜底：单次 answer 最多多少 turns / tokens？
- agent 输出怎么映射回现有的 answer schema 和 snapshot 模型？
- 是否要引入 [traceroot-ai/traceroot](https://github.com/traceroot-ai/traceroot)（YC S25 的 agent 可观测性）？
- 离线/无 API key 用户走老 pipeline 兜底？

---

## 5. ✅ 已完成（v1 + v1.1，2026-05-26）— Settings → MCP integration

实施落地为**通用 MCP 多客户端集成 + 跨 host Agent Skill 安装器**——非 Pi-specific（参见 [Pi integration rationale memory](../../../../../.claude/projects/-Users-lxz-ws-personal/memory/project_pi_integration_rationale.md)）。

**v1**（[spec](specs/2026-05-26-pi-mcp-extension-design.md), [plan](plans/2026-05-26-pi-mcp-integration-ux.md), commits 7effd31..f8bfe83）
- McpIntegrationService — detect / configure / remove / 备份 / mutex / 审计
- IPC 4 channels + license-gate + 跨进程类型
- Settings UI: 4 客户端表格（Claude Desktop / Code / Cursor + Pi 手动设置 modal）
- ELECTRON_RUN_AS_NODE 运行时（不依赖用户装 Node）

**v1.1**（[spec § v1.1](specs/2026-05-26-pi-mcp-extension-design.md), [plan](plans/2026-05-26-mcp-skill-installer.md), commits 0ae419e..215b16c）
- AgentSkillService — 一键安装 portable [Agent Skill](https://agentskills.io) 到 `~/.agents/skills/` + 检测到的 host symlink
- Settings UI 重排为 Step 1 (Install Skill) → Step 2 (Configure MCP)
- 跨 host 通用（Claude Code / Pi / Codex），non-developer 一键安装替代 `npx skills`

**留作 follow-up**：
- 首次启动 popup 引导（Design B）
- Cursor / Claude Desktop skill 自动安装路径
- 「打开 agent 会话并预加载 skill」按钮

---

## ~~6.~~ `cb-pi` 扩展包（已被 v1.1 跨 host skill 取代，不再独立做）

v1 brainstorm 时已经申明"引入 Pi 是内部架构学习，对外保持通用 MCP，不绑定 Pi"。v1.1 的 portable Agent Skill 已经覆盖了 cb-pi 设想里的核心价值（terminal-based 咨询师工作流）——以**跨 host 中性**的方式，而非 Pi-only。

如果将来仍想做 Pi-only 增强（pi-tui 渲染、pi-status-bar 等），请新开独立 spec 并解释为何违反"不绑 Pi"原则。

---

## 7. `pi-chat` 企业 ChatOps（飞书/钉钉/企微 + 沙箱 VM）

**目标**：客户在 Slack / 钉钉 / 飞书 / 企微 里 @ 碳本机器人，查自己组织的数据、催进度、看 dashboard。每个客户组织一个隔离 VM，数据合规友好。

**已经有的相关代码**：
- 依赖方向 3（pi-ai）和方向 5（MCP）。
- 完全云端实现，desktop 不动。

**技术取舍**：
- 上游 [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat) 已支持 Discord/Telegram + Gondolin micro-VM 隔离。
- 中国市场必须新写飞书/钉钉/企微连接器（这是真活）。
- VM 隔离对运维成本冲击较大，需要评估。

**集成点**：
- 客户绑定一个 organization → 一个 VM → MCP 只连到该客户的数据子集。
- license 模型可能需要新增"bot seat"维度。
- 跟 desktop 应用的数据同步：bot 改的东西要回流给桌面端吗？

**开放问题**：
- 商业模型衔接：bot 算几个 seat？
- 中国市场连接器谁维护？外包还是自研？
- VM 沙箱对单客户的运维成本？要不要先用容器替代 VM？
- 法务/合规：客户数据进 VM 等同于数据出本地，对 PIPL / 信安要重新审。

