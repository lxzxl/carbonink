# Pi.dev integration — spike to validate roadmap items 3-7

**Date:** 2026-05-26
**Conclusion:** Pi 集成对 carbonink 技术上可行。建议先做 **Roadmap Item 5（把现有 MCP server 发成 Pi 扩展）**——零风险、几小时内能拿到 Pi 生态的第一波反馈。然后做 **Item 3（用 `pi-ai` 替换 `llm-client.ts`）**——单文件改造，迁移面只有 583 行。Item 4（`pi-agent-core` 改写 answer-generation）必须等 Item 3 落地之后。

## Context

[Roadmap items 3-7](../ROADMAP.md) 提议在 carbonink 里集成 `earendil-works/pi` 生态。仓库的硬规则是"做之前必须先走 brainstorm → spec → plan"。这份 spike 是 brainstorm 之前的"先验证假设"环节，回答四个问题：

1. `pi-ai` / `pi-agent-core` 在 npm 上真的存在、能装、能用吗？
2. Electron 41 的 Node 运行时和 pi 的 engine 要求兼容吗？
3. 我们最关心的中国 provider（DeepSeek、Kimi、智谱、Qwen）pi-ai 真的原生支持吗？
4. 现有 `llm-client.ts` 的迁移面有多大？

## Package status on npm

| Package | Latest version | Engine | 说明 |
|---|---|---|---|
| `@earendil-works/pi-ai` | `0.75.5` (2026-05-23) | Node ≥ 22.19.0 | 统一 LLM API |
| `@earendil-works/pi-agent-core` | `0.75.5` | Node ≥ 22.19.0 | 有状态 agent runtime，依赖 pi-ai |
| `@earendil-works/pi-tui` | `0.75.5` | Node ≥ 22.19.0 | 差分渲染 TUI 库 |
| `@earendil-works/pi-coding-agent` | `0.75.5` | Node ≥ 22.19.0 | CLI agent（不在本次范围） |

发布节奏：约 1-2 天一个 patch。`0.74.0` 是 2026-05-07 首发，21 天里有 10 个版本。**这意味着我们的 `min-release-age=7` 会让最新 1-2 个版本不可装**——本次 spike 用了 `0.75.3`（2026-05-18 发布，8 天前）。这是 spike 期间唯一的小障碍，不是阻断。

## 兼容性验证

### Node version ✅

Electron 41.0.0 的 release notes 明确列出运行时为 **Node 24.14.0**。Pi 包要求 ≥ 22.19.0，远低于现状。

**注意**：[2026-05-25 的 Electron 42 升级 blocker doc](2026-05-25-electron-42-upgrade-blocker.md) 表格里把 Electron 41 的 Node 列为 "22.x"，这跟 Electron 官方 release notes 不符——v41 早就是 Node 24。下次重读那份 doc 时顺手修正。

### Module format ⚠️ ESM-only

`pi-ai` 是纯 ESM 包（`require()` 不行）。我们 desktop 的 `out/main/index.cjs` 是 CJS 入口，但 `electron-vite` 在 build 阶段已经处理过 ESM 转换（仓库里已有其他 ESM-only 包如 `@modelcontextprotocol/sdk`）。**应该无需改动**，但 spec 阶段要在 desktop 子项目里跑一次 `pnpm dev` 确认 vite-node 能解析。

### Schema validation: TypeBox vs Zod ✅ 已有结论，无需迁库

**初判**：`pi-ai` tool schema 用 TypeBox，全代码库 49 个文件在用 Zod，担心互通成本。

**复核（2026-05-26 当天）后的结论**：**不全迁。Zod 主战场 + TypeBox 仅在 pi-ai 工具边界**。

关键事实：

| 维度 | 结论 |
|---|---|
| Zod 4 (`^4.4.3`，desktop) | 原生支持 `z.toJSONSchema()` 输出 Draft 2020-12 JSON Schema |
| pi-ai 接受 JSON Schema | ✅ 可以——`parameters` 字段本质就是 JSON Schema |
| pi-ai `validateToolArguments` 对纯 JSON Schema 校验严格度 | ⚠️ 偏宽松（实测 `activity: 123` 未被拒）；对 TypeBox 构造的 schema 严格 |
| 推断原因 | pi-ai 内部用 AJV 校验，TypeBox 在 schema 上插入 symbol 标签触发严校验路径 |
| 现有 Zod 用法 | 49 文件，含 `.refine()` (`name_zh \|\| name_en`)、`.preprocess()` (helpers)，TypeBox 等价物明显累赘 |

**结论方案**：
- 全代码库（IPC handlers、LLM stages、shared/schemas、cloud API）继续用 Zod 4
- 仅在 Item 4 引入 agent tools 时，用 `import { Type } from '@earendil-works/pi-ai'` 写 ~5-10 个 tool schema——0 dep 增量
- 在 Item 3 (pi-ai 替换 llm-client) 里需要把 Zod schema 传给 pi-ai 的地方，用 `z.toJSONSchema(zSchema)` 转

**附带技术债**：cloud (`packages/shared` Zod 3.25, `worker` Zod 3.24) 应当**先**升到 Zod 4 与 desktop 对齐。这是独立的 ergonomics 改进，不依赖 Pi 整合，但做 Pi 整合前先做它会避免跨包版本踩坑。

### OAuth in Electron ✅ 可行

`pi-ai/oauth` 暴露 `loginAnthropic`、`loginOpenAICodex`、`loginGitHubCopilot`（spike 已确认导出）。`loginAnthropic` 接受 `onAuth(url, instructions)` 和 `onPrompt` 回调——这正是 Electron 友好的形态：
- `onAuth` 里调 `shell.openExternal(url)` 打开默认浏览器
- `onPrompt` 里弹一个 `BrowserWindow` 让用户粘贴验证码（或本地起 loopback HTTP 接 redirect）
- 凭证由调用方存储 → 直接复用 [`credential-service.ts`](../../desktop/src/main/services/credential-service.ts)（已用 Electron `safeStorage`）

**风险**：未在真实 Electron 进程里端到端测过。spec 阶段必须跑一次端到端 OAuth flow（用 Claude Pro 订阅账号）。

## 中国市场 provider 矩阵 ✅ 全覆盖

Spike 实测 `getProviders()` 返回 32 个 provider，其中中国市场相关的 11 个：

```
deepseek, kimi-coding, minimax, minimax-cn, moonshotai, moonshotai-cn,
xiaomi, xiaomi-token-plan-ams, xiaomi-token-plan-cn, xiaomi-token-plan-sgp, zai
```

`zai` = 智谱 GLM。`moonshotai-cn` / `xiaomi-token-plan-cn` 是国内 endpoint 变体（对企业客户的合规配置友好）。Qwen 通过 OpenAI-compatible 通道（DashScope）也能接，但不在内置列表。

### 模型成本数据已暴露

```js
getModel('deepseek', 'deepseek-v4-pro').cost
// → { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 }
```

意味着我们的 license 计量层可以直接读这个字段累计 USD 成本，不用自己维护价格表。**这是迁过去最大的隐性收益之一**。

## API surface 对比

### 现状：[`desktop/src/main/llm/llm-client.ts`](../../desktop/src/main/llm/llm-client.ts)

- 583 行单文件，依赖 `ai` + `@ai-sdk/{anthropic,azure,deepseek,openai,openai-compatible}` 5 个包
- 暴露：`LLMClient.getModel(provider) → LanguageModel`、`generateObject(schema, prompt)`、`streamObject(schema, prompt)`
- 业务消费方：`llm/stages/*`、`llm/report-narrative.ts`、`llm/vision-capability.ts`（仅 3 处入口）
- 错误类型：`SchemaMismatchError`、`ProviderNotConfiguredError`

### 目标：`@earendil-works/pi-ai`

- `getModel(provider, modelId) → Model`（带 cost、reasoning、modalities 元数据）
- `complete(model, context, options) → Response`
- `stream(model, context) → AsyncIterator<Event>`（含 text/thinking/toolcall delta 事件）
- 没有现成的 `generateObject` 等价物——结构化输出要表达为 tool call + `validateToolArguments`
- Util：`parseJsonWithRepair`、`isContextOverflow`、`calculateCost`（这三个直接能用）

### 迁移工作量估计

| 当前 file | 当前实现 | 迁后实现 | 估时 |
|---|---|---|---|
| `llm-client.ts` 主体 | Vercel AI SDK adapters | pi-ai `getModel` + provider 探测 | 1d |
| `generateObject(schema, ...)` 调用点 | zod schema → AI SDK | 表达为 tool call + TypeBox 适配 | 1d |
| `streamObject` 调用点 | AI SDK stream | pi-ai `stream` + event handling | 0.5d |
| `vision-capability.ts` | provider feature flag map | 读 `model.input` 数组判断 | 2h |
| 错误类型保留 | — | wrap pi-ai throw → 我们的 Error 类型 | 2h |
| 测试更新 | mock AI SDK | mock pi-ai 或起 fake provider | 1d |
| **合计** | — | — | **~4-5 个工作日** |

## Agent class 评估（为 Item 4 做准备）

`pi-agent-core` 的 `Agent` 类暴露的钩子：

```ts
new Agent({
  initialState: { systemPrompt, model, tools },
  getApiKey: (provider) => credentialService.get(provider),       // 直接接我们的凭证层
  beforeToolCall: ({ toolCall }) => { /* 权限/审计 */ },           // 接 audit-event-service
  afterToolCall: ({ result }) => { /* 落 snapshot */ },
  transformContext: (messages) => { /* 长会话裁剪 */ },             // 长上下文管理
  convertToLlm: (messages) => { /* 自定义消息 → LLM 消息 */ },     // 我们的 questionnaire 上下文
  toolExecution: 'parallel' | 'sequential',
  thinkingBudgets: { ... },
});
agent.prompt('给 Q2 这张油费发票生成答案');
agent.subscribe((event) => { /* 实时 UI */ });
agent.abort();
```

**结论**：钩子设计正好覆盖我们 [`answer-generation/`](../../desktop/src/main/services/answer-generation/) 的需求——凭证、审计、长上下文、自定义消息类型、并行 tool 调用全都有 first-class API。Item 4 的可行性比预期高很多。

## 风险与未决

| 风险 | 影响 | 缓解 |
|---|---|---|
| pi 包版本飞快（每 1-2 天发一版），`min-release-age=7` 会卡 | 装不到最新 | 接受 1 周延迟；或申请把 carbonink 加进允许列表 |
| ESM-only，electron-vite build 行为未端到端验证 | dev/build 可能要调整 | spec 阶段在 desktop 跑一次 `pnpm dev` + `pnpm build` |
| OAuth flow 未在真实 Electron 进程里端到端验证 | 万一卡在 loopback redirect 上 | spec 之后第一周 spike Anthropic OAuth |
| ~~TypeBox 引入会让 desktop deps + 1~~ **已消解** | — | 用 Zod 4 `z.toJSONSchema()` 输出 JSON Schema 喂 pi-ai；只在 agent tool 边界（~5-10 schema）用 pi-ai re-export 的 `Type`，0 dep 增量。详见上文 "Schema validation" 节 |
| Cloud 还在 Zod 3.24/3.25，desktop 已在 4.4.3 | 跨 package 共享 schema 时容易踩兼容性 | **Item 3 之前先做**：cloud 升 Zod 4 与 desktop 对齐 |
| pi 的 API 不稳定（0.x，patch 节奏快） | breaking change 风险 | 用 caret range `^0.75.x`，每周看一次 CHANGELOG |
| pi-ai 没有 `generateObject` 等价物 | 需要把结构化输出改写为 tool call | 已有方案；只是范式切换 |
| pi-ai `validateToolArguments` 对纯 JSON Schema 校验偏宽松 | 类型错误可能漏 | 在我们这层加一道 Zod parse 作为兜底；或 agent tool 边界统一用 pi-ai 的 `Type` 构造 |

## 推荐路径（前后两轮）

### 第一轮：Item 5（MCP 扩展发布）— 几小时

依据：MCP server 已经在跑（`desktop/src/mcp/index.ts`、`vite.mcp.config.ts`），Pi 已支持 MCP 桥接（[mavam/pi-mcporter](https://github.com/mavam/pi-mcporter) 是现成范例）。要做的只是包装 + 写一份"如何在 Pi 中使用 carbonink"教程。

收益：以最低成本进入 Pi 用户视野，拿到第一批早期反馈，对后续 Items 的优先级排序有真实信号。

### 第二轮：Item 3（pi-ai 替换 llm-client）— ~1 周

依据：迁移面集中在 1 个文件（583 行），3 个直接消费方。spike 已确认全部技术风险可控，最大未知是 OAuth 端到端在 Electron 里的体验——必须先做这步的 spike。

**前置**：先把 cloud Zod 3 → 4 升级做掉（约 0.5d，独立于 Pi 整合）。

后续：Item 4（pi-agent-core 改写 answer-generation）→ Item 6（cb-pi 扩展包）→ Item 7（pi-chat ChatOps）。

### 不推荐改路径的情况

- 如果 Item 5 反馈强烈表明"几乎没有 ESG 咨询师在用 Pi/Cursor/Claude Code"，则跳过 Item 6，转而把精力压到 Item 3 + 4。

## Spike 工件

- 隔离环境：`/tmp/pi-spike/`（package.json 仅声明 pi-ai + pi-agent-core）
- 脚本：`/tmp/pi-spike/spike.mjs`（验证导入、provider 列表、模型元数据、TypeBox 校验、Agent class、OAuth exports）
- 实际 stdout 完整保留在本 doc 的"中国 provider 矩阵"和"API surface"小节里

## 下一步（待用户确认）

1. 进入 **Item 5 的 brainstorm** —— 用户、边界、不做什么
2. 写 spec → 写 plan → code
3. Item 5 上线后，启动 Item 3 的 brainstorm

## References

- [Roadmap items 3-7](../ROADMAP.md)
- [pi.dev](https://pi.dev/)
- [earendil-works/pi monorepo](https://github.com/earendil-works/pi)
- [pi-ai README on GitHub](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)
- [pi-agent-core README on GitHub](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)
- [mavam/pi-mcporter](https://github.com/mavam/pi-mcporter) — MCP bridge pattern reference
- [salesforce/sf-pi](https://github.com/salesforce/sf-pi) — enterprise Pi extension pack reference
- [`desktop/src/main/llm/llm-client.ts`](../../desktop/src/main/llm/llm-client.ts) — current LLM client to be replaced
- [`desktop/src/mcp/index.ts`](../../desktop/src/mcp/index.ts) — MCP server to be packaged as Pi extension
- [`docs/research/2026-05-25-electron-42-upgrade-blocker.md`](2026-05-25-electron-42-upgrade-blocker.md) — Electron 41 node version (correction needed: it's 24.14.0, not 22.x)
