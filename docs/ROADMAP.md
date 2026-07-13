# CarbonInk — Roadmap

发布后的中长期功能想法。roadmap 只记"想做"，没排期、没承诺；要做之前必须先走
brainstorm → spec → plan 的常规流程。

> 注：`specs/`、`plans/`、`research/`、`todo/`、`release-notes/`、`archive/` 均为
> **本地保留、不纳入 git** 的开发过程产物（见 `.gitignore`）。下文指向它们的相对链接
> 只在本地 checkout 里有效，GitHub 上看不到。

---

## 0. ✅ 已完成 — 开源免费转型（2026-06-01）

CarbonInk 转为**纯开源免费（MIT）**：移除桌面端整套 licensing/激活系统、下线云端
license+支付 worker、网站删除定价/激活/账户页并改为"免费 + 开源"呈现、仓库根加 MIT
`LICENSE`。设计与计划见本地 `specs/` + `plans/`（`2026-06-01-open-source-free-pivot`）。

> 产品不再收费。下文已据此去掉销售/定价语境——见第 1 节。

---

## 1. 智能客服（产品答疑）

**目标**：在 `cloud/web/` 上加一个对话式客服，回答用户对产品的问题（适用场景、ISO 14064-1 覆盖度、和其他工具的差异、怎么上手等），降低"读 FAQ 读不下去"的流失。产品免费开源，这里纯做产品答疑，不涉及销售/定价。

**技术取舍 / 当作个人面试项目来打磨**：

- **LLM**：用 DeepSeek。理由：成本低、中文表现强、和目标用户语言一致；面试时可讲清"为什么没选 GPT/Claude"。
- **Agent harness 自研**：不直接套 LangChain / LlamaIndex 这类框架，自己设计 agent 主循环 + 工具调用协议 + 错误处理。目的就是为了能在面试里完整讲一遍 harness 的设计决策（工具 schema、turn loop、context window 管理、失败重试、observability）。
- **记忆方案对比**：在实现过程中要至少跑通 2-3 种记忆方案再做取舍。候选：
  - 纯滑动窗口（baseline）
  - 摘要式记忆（每 N 轮压一次）
  - 向量检索 + 长期记忆（embedding + 一个轻量向量库）
  - 结构化记忆（用产品自己的 schema，例如"用户问过哪些 SKU"）
  - 最终选一种、写清取舍理由——这本身就是个面试故事。
- **首选 agent harness：[pi.dev](https://pi.dev/)**。pi.dev 本身就是 agent harness 工具，能用 pi.dev 跑就用它。这里和上一条"自研 harness"不冲突：把 pi.dev 当作底层 runtime（turn loop / 工具调用协议 / observability 这一层），自研工作落在"在 pi.dev 之上"——agent 的提示设计、工具集（FAQ 检索、功能/覆盖度查询、可选的真实 API 调用）、记忆策略、降级路径。面试故事就从"为什么选 pi.dev、它的抽象帮我省了什么、不够用的地方我怎么补"展开，比从零造 harness 更可信。
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
- 风险：要保留一层薄 adapter 防止 vendor lock-in，万一 pi-ai 出问题能切回去。

**集成点**：
- 纯 main process 内部改造，renderer 不动。
- `llm/stages/` 当前调用 `LLMClient` 的位置都是少数几个入口，可逐步迁。
- credential-service.ts 的 provider 列表要扩，UI 上"AI provider 设置"页面要同步。

**开放问题**：
- pi-ai 的 OAuth 流程在 Electron 里跑得通吗（loopback redirect）？
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

## 4.5. ✅ 已完成（v2.0，2026-05-27 → 05-29）— Inbound 供应商问卷（Scope 3 Cat 1）

源自 2026-05-27 的产品反思（["问卷不应该是数据来源吗？"](../docs/specs/2026-05-27-inbound-questionnaire-cat1.md#trigger)）。v1 把 questionnaire 设计成 outbound-only（用我方数据填客户问卷）；v2.0 加入对偶的 inbound 流（向供应商发问卷收数据，自动转 activity_data 行）。

**v2.0 范围**（[spec](specs/2026-05-27-inbound-questionnaire-cat1.md), [plan](plans/2026-05-27-inbound-questionnaire-cat1.md), commits `e598258`..`a94c910` + UI 拆分与修复 `8cd045e`..`aea2c63`）
- 单一内置模板：Cat 1 Supplier Disclosure（7 题：3 元数据 + 1 Tier 1 PCF + 3 Tier 2 分配排放）
- 交付方式：xlsx 邮件往返（无 cloud surface 扩展、无 supplier auth）
- 服务层：`InboundQuestionnaireService.createDraft / exportBlankXlsx / importFilledXlsx / getIngestPreview / ingest`
- xlsx render + parse with hidden sentinel sheet（防止误导外发表 / 错供应商 xlsx）
- 入库时 Tier 2 走 sentinel pinned EF（直填 kgCO2e），Tier 1 路径在 review 页面 inline 收"采购数量"再乘 PCF
- 状态机：draft → sent → received → ingested，每步 audit_event
- UI：In/Out **完全分开**为两个顶级导航 —「披露填报」(`/questionnaires`, outbound) 与「供应商披露」(`/supplier-disclosures`, inbound)；inbound detail 按 status 分支动作栏，独立 `/supplier-disclosures/$id/ingest` review-and-confirm 页；入库的 activity 行回链到来源披露
- 数据库迁移 017：questionnaire.direction、customer.role、question.tier、activity_data.{inbound_question_id, inbound_tier}

**目前状态**：✅ 全部 13 tasks 完成，**932/932** 测试通过、typecheck + biome（改动文件）干净。T13 smoke 经 live `pnpm dev` bug-fix 迭代验证（导入/入库/备注/挂载 4 个 bug 已修），`/supplier-disclosures` 页纳入 Playwright tour（`tour-05b`）防回归。`pnpm dist:mac` 未本轮重跑（无 native/builder 变更），发版前再验。

**留作 v2.1+**：
- Tier 3（供应商报活动数据，我方换算）
- Cat 4 上游运输 / Cat 5 废弃物 / Cat 6 商旅外包等多模板
- 模板编辑器 UI（用户自定义问题）
- 自动从存量 AD 推断 Tier 1 的采购数量（消除 review 页手填）
- Cloud-hosted 供应商填表 portal（避开邮件往返摩擦）
- `customer` → `counterparty` 表重命名 + role 字段重新定义
- 完整 i18n key 迁移（v2.0 内嵌中文，未走 paraglide）

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
- 跟 desktop 应用的数据同步：bot 改的东西要回流给桌面端吗？

**开放问题**：
- 中国市场连接器谁维护？外包还是自研？
- VM 沙箱对单客户的运维成本？要不要先用容器替代 VM？
- 法务/合规：客户数据进 VM 等同于数据出本地，对 PIPL / 信安要重新审。

---

## 8. 竞品对标 backlog（2026-07-11 竞品调研）

源自本地调研报告 `research/2026-07-11-competitor-analysis.md`（deep-research 工作
流：21 个来源、88 条候选声明、25 条送 3 票对抗验证、23 条存活）。下列条目只记
"竞品已验证过需求、值得考虑"，动手前照常走 brainstorm → spec → plan。厂商数字
（因子量、客户数、100% 通过率）均为**厂商自述**，引用须写"宣称"。

### 8.1 值得吸收的功能亮点（按需求验证强度排序）

1. **批量活动数据 → EF 自动映射 + 提取后异常检测**（Avarni 账单提取+百万行映射、
   Workiva "AI EF matching" 卖点、Greenly 400+ 质量检查+异常检测、碳阻迹碳云 LLM
   ——四家跨市场在售，信号最强）
   - 现状：AI 提取按单据走 5 stage；缺"整表批量数据 → EF 自动匹配"与提取后自动
     校验/异常提示。`ef-matcher-service` 已有匹配内核；方向 4（pi-agent-core 化）
     天然装得下"匹配 → 校验 → 自我纠错"循环。

2. ✅ **审计就绪功能集补全：通用证据附件 + 端到端数据血缘 + 审计历史**（Workiva 把
   audit-ready 定义成这张清单；Watershed "每个数字可追溯"、Normative "每条因子标
   注来源+版本"同向）——**v1 已完成（2026-07-11，commits `baafda4` + `e5bf632`）**
   - 落地：迁移 018 `evidence_attachment`（activity_data/answer 通用证据附件，走
     content-addressed document 存储）；`activity_data.created/.deleted` +
     `evidence.attached/.removed` 审计事件补全；`AuditEventService.listByRecord`
     单记录时间线；`LineageService` 一次调用返回端到端链（来源单据/供应商披露/手工
     → 活动行 → pinned EF → 下游答案 + 冻结快照）；renderer 溯源 Drawer（血缘链 +
     证据增删/预览 + 审计时间线），/activities 行与 AnswerReviewCard 双入口；手工行
     显式"手工录入"来源标记。测试 900 → 942。
   - spec/plan：本地 `specs/2026-07-11-audit-evidence-lineage.md` + 同名 plan。
   - **留作 v2**：版本 diff/回滚（本轮只做事件时间线）；evidence 附件计入报告导出；
     发版前 live `pnpm dev` GUI smoke（本轮为 vitest + 路由级集成验证）。

3. **顾问多客户工作流**（Avarni 已产品化：按客户计算规则保证逐年口径一致、客户只
   读交付报告、白标 logo/配色、按客户计价）
   - CarbonInk 主用户就是多客户顾问。可做：按组织的计算规则预设、导出报告白标、
     面向客户的只读交付物。

4. ✅ **用户自带排放因子库**（Avarni 支持上传自购/自定义因子库；规模对标均为宣称：
   CCDB 30万+ / Normative 349k / Greenly 300k / Avarni 65k）——**v1 已完成（2026-07-12）**
   - 原判断（成立）：自建库拼规模拼不过；开放导入（官方库、自购 ecoinvent、行业库）
     + pinned snapshot 溯源是更合理的路线，与"因子来源+版本可见"的审计叙事互相加强。
   - 落地：迁移 019 `user_ef_library` 注册表；xlsx/csv 导入（GB18030 兜底解码、公式取
     缓存值防格式截断、20MB/5 万行上限）；列映射自动识别（中英表头别名）+ 手动调整 +
     逐行校验（错误行跳过并报行号+错误码，警告不阻断；结构化错误码走 paraglide，非
     inbound 式内嵌中文）；因子直接落 `emission_factor` 的 `user:<库名>` source 命名
     空间——复合 PK 隔离内置库、`ef_fts` 触发器自动索引，EfPicker / AI 匹配 / pin /
     血缘面板零改动全兼容；原始文件内容寻址存档（`doc_type='ef_library'`，/documents
     隐藏），审计可核对 sha256；同名库需确认后整库替换；删除库只清目录——已 pin 快照
     与既有活动数据数字不受影响（审计叙事闭环）；审计事件 `ef_library.imported` /
     `.deleted`（payload 只带计数/库名/版本/sha256）；UI：Settings → 因子库 section
     （导入 drawer：选文件→映射→校验预览→导入 + 模板下载 + 库列表/删除），EfPicker
     行加自有库徽标。测试 937 → 993（新增 56：parser/mapping/service/IPC/renderer）。
     live GUI smoke ✅（2026-07-13，e2e `ef-library-import.spec.ts`：真实 Electron +
     真实 SQLite 走完 选文件→中文表头自动映射→校验预览(3 有效/1 错误行)→导入→
     同名替换确认→删除库，仅 stub 原生文件对话框；5 张截图在
     `desktop/tests/e2e/screenshots/ef-library-0*.png`）。
   - spec/plan：本地 `specs/2026-07-11-user-ef-library-import.md` + 同名 plan。
   - 留作 v2：库内因子浏览/检索页（现仅注册表管理）；同名替换时的行级 diff 预览；
     ecoinvent 等专有导出格式的适配器；导入因子参与 `/sources` 目录推荐。

5. ◐ **供应商问卷状态追踪 + 提醒，并把"零账户"明说成卖点**（Avarni/Persefoni 用免
   费供应商账户降门槛；Workiva 用平台内置问卷、无 xlsx 离线往返）
   - v2.0 inbound 已有 draft→sent→received→ingested 状态机 + 状态筛选 chips。
   - **逾期追踪 v1 已完成（2026-07-11）**：sent 过 due_date ⇒ 行内红色"逾期 N 天"
     徽标 + "逾期"筛选 chip + 计数（spec：本地
     `specs/2026-07-11-inbound-overdue-tracking.md`）。
   - **逾期提醒 v2 已完成（2026-07-13）**：启动时系统通知（每本地日至多一条聚合，
     点击聚焦窗口并深链列表页，`app:navigate` push 通道）；侧边栏「供应商披露」
     逾期计数徽标（destructive 色，与列表共用查询缓存与判定 helper）；迁移 020
     `customer.email` + 催办邮件（mailto 模板带截止日/逾期天数/组织署名，无邮箱
     先弹窗收集落库；新建向导可选填）；详情页 meta 行逾期红字（v1 defer 项）
     （spec：本地 `specs/2026-07-13-inbound-overdue-reminders.md`）。测试
     1000 → 1018。
   - 仍留：营销上把"供应商零账户、零平台注册"讲出来（cloud/web 侧）。

6. **AI 生成披露报告**（碳阻迹碳云已产品化生成符合 CDP/ESG 框架的图文报告）
   - `report-narrative.ts` 已有叙事生成雏形，可扩展为按披露框架结构化输出。

### 8.2 定位弹药：可信利用的竞品痛点（营销/对比页用，必须带 caveat）

| 痛点 | 实证 | Caveat | 反击点 |
|---|---|---|---|
| 云端免费工具停服即失数据 | SME Climate Hub 免费计算器（Normative 开发）2025-01-31 停用，官方公告"不再能访问账号或数据" | 有预告+导出窗口，是有序日落，不可说"跑路" | local-first，数据永在本地 SQLite |
| 免费路线没有软件 | GHG Protocol 官方工具全部 Excel+PDF，自认需组合多个工具；唯一在线工具 2023-08 停服 | 原文"Many tools"非"全部" | 免费层的一体化+审计轨迹替代 |
| 非英语数据不被原生支持 + AI 黑箱复核负担 | Avarni 用户须先译英文、逐条核对 AI 分类（2023 Capterra 评论 + English-only 收录） | 单条 2023 评论；Avarni 2025-06 称已提升精度 | 双语结构性对齐 + 每条提取回链原始单据 |
| 中国市场价格门槛 | 碳阻迹传统客单价数万-百万元（2021 披露） | 其 2026-06-30 已推 88 元/月 Carbon Agent 下探 | 不能只讲免费：**免费+本地数据主权+审计级+顾问工作流**组合叙事 |

### 8.3 警示与缺口

- **不可引用**："全行业定价不透明+全云部署"被 0-3 否决（Greenly/Persefoni 公开价
  格或有免费档）；"GHGP 国际电力因子须向 IEA 付费"被 1-2 否决。
- **本轮零存活证据、待下轮调研**：Microsoft/IBM/Salesforce/SAP 巨头套件；金蝶/
  用友/远景方舟等中国 ERP 系；G2/Reddit 大样本差评（G2/Gartner 抓取被拒）；
  openLCA/Brightway 邻域；头部真实成交价。
- **中国头部已 AI 化+低价化**（碳云 LLM、Carbon Agent 88 元/月）——AI 在中国不是
  "人无我有"，差异化落点：**可核查（回链单据）、BYOK、本地数据主权**。
- 机会信号（待证实）：碳阻迹起家于 ISO 14067 产品碳足迹，组织层面 ISO 14064-1
  盘查是其 2021 年才"还将整合"的方向——中国市场组织盘查工具可能存在相对空档。

