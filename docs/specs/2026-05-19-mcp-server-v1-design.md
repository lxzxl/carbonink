# MCP Server v1 — Standalone Stdio Binary

**Date:** 2026-05-19
**Phase:** Phase 2 Block 4（部分 — MCP server，不含其他 Block 4 内容）
**Status:** Approved by user 2026-05-19; ready for plan.
**Predecessor:** question_signature reuse (`2e6f1e5`).

## Why

carbonbook 的差异化卖点之一就是 MCP — 让 Claude Desktop 等客户端能直接 query/操作用户的 inventory 和问卷。原 Phase 2 spec 把"MCP server v1（resources + 8 tools + 配对 UI）"放在 first-questionnaire 里程碑的 deliverable。落地这个就把"非 GUI 协议入口"接通。

## Scope

**In scope:**
- Standalone Node binary at `out/mcp/index.cjs`，由 electron-vite 一并构建
- Stdio transport，由 Claude Desktop spawn
- 直接打开同一份 `~/Library/Application Support/carbonbook/app.sqlite`（macOS）/ 等效 Windows 路径
- **6 个 read tools**：list_questionnaires / get_questionnaire / list_questions / get_answer / list_activities / list_emission_sources
- **3 个 write tools**：set_answer（含 finalize 标志）/ create_activity / create_emission_source
- **2 个 resources**：`inventory://{year}` 返回 totals、`questionnaire://{id}` 返回完整问卷视图
- 设置页 MCP section：展示 binary 绝对路径 + "复制到 Claude Desktop 配置"的代码片段 + 检测 `claude_desktop_config.json` 是否已引用
- 顶栏状态指示器：`MCP: Available / Not configured / Not built`

**Out of scope:**
- HTTP/SSE transport — stdio only
- 远程客户端 / 多客户端配对 — v2
- 写操作的 GUI 二次确认 — v1 直接生效；用户不放心就在 Settings 关掉
- license / OAuth 鉴权 — 本地 stdio 不需要
- MCP Prompts — v1 只做 Resources + Tools
- Audit log UI / MCP 操作的回放 — 后续子项目

## Architecture

### 进程模型

```
Claude Desktop
    │  spawn (stdio)
    ▼
out/mcp/index.cjs   ←──────  carbonbook (Electron)
    │                                  │
    └────► ~/Library/.../app.sqlite ◄──┘
              (WAL mode, 并发读写)
```

两个进程都直接读写同一个 sqlite 文件。SQLite WAL 模式支持并发：MCP 写时 carbonbook UI 读不被 block；UI 写时 MCP 读不被 block。同时写需要短暂 serialization 但对我们的频率（人类速度）影响为零。

### SQLite ABI 问题

carbonbook 主进程用 better-sqlite3 + Electron-ABI（通过 electron-rebuild）。Claude Desktop spawn MCP 时是 **Node 进程**，需要 Node-ABI 的 sqlite client。三种方案，**plan 阶段决定**：

1. **`node:sqlite`（Node 22+ 内建）** — 零依赖、零 ABI 问题、但 API 与 better-sqlite3 不同；engines 已是 `>=24`，可用。**推荐**。
2. **`sql.js`（WASM）** — 纯 JS，跨 Node 版本可用；慢一些（写操作 10-100x）但 MCP 工作负载是人类速度。
3. **独立 node_modules + Node-ABI better-sqlite3** — 复用 schema 知识但分发复杂、需要 prebuild 二进制。

选 `node:sqlite` 作为第一推荐方案 — Node 24+ 已稳定支持，无 ABI 困扰，无依赖增加。Plan 第一个 task 验证 `node:sqlite` 的 readiness。

### Tool list

#### Read

| Tool | Args | Returns |
|---|---|---|
| `list_questionnaires` | `()` | `Array<{id, customer_name, reporting_year, status, question_count}>` |
| `get_questionnaire` | `{id}` | `{questionnaire, customer, document, questions[]}` |
| `list_questions` | `{questionnaire_id}` | `Array<Question>` |
| `get_answer` | `{question_id}` | `Answer | null` |
| `list_activities` | `{reporting_period_id?, year?}` | `Array<ActivityData>` — 任一过滤可用 |
| `list_emission_sources` | `{organization_id?}` | `Array<EmissionSource>` |

#### Write

| Tool | Args | Returns |
|---|---|---|
| `set_answer` | `{question_id, value, unit?, finalize?}` | `Answer`（写入后） |
| `create_activity` | `ActivityDataCreateInput`（同 IPC channel） | `ActivityData`（含 computed_co2e_kg） |
| `create_emission_source` | `EmissionSourceCreateInput` | `EmissionSource` |

**写操作的 source_kind 标注**：`set_answer` 写入时统一标 `source_kind='manual'`（同 GUI 的用户手填）— Claude Desktop 操作等价于用户手动操作，不引入新的 source_kind。审计角度后续可加 'mcp' 标注，但 v1 简化。

### Resources

| URI | Returns |
|---|---|
| `inventory://{year}` | `{total_co2e_kg, scope1_kg, scope2_kg, scope3_kg, activity_count}` |
| `questionnaire://{id}` | 同 `get_questionnaire` 但格式化为可读文本 |

Resources 在 MCP 里是 LLM 可"挂载阅读"的内容，与 tools 不同。Claude 会在对话中读这些 URI 当背景资料，而不是显式调用。

### Settings UI section

新增一块在 `/Settings`：

```
MCP Server （Claude Desktop 集成）

状态：✓ Available — Claude Desktop 已配置 carbonbook
（or "⚠ Not configured — 复制下方配置到 Claude Desktop"）

Binary 路径：
   /Applications/carbonbook.app/Contents/Resources/app.asar.unpacked/out/mcp/index.cjs
   [复制]

Claude Desktop 配置（添加到 ~/Library/Application Support/Claude/claude_desktop_config.json）：
   {
     "mcpServers": {
       "carbonbook": {
         "command": "node",
         "args": ["<binary 路径>"]
       }
     }
   }
   [一键写入] [复制片段]

⚪ 已启用 MCP（关闭后即使 Claude Desktop 已配置也会被服务端拒绝）
```

"一键写入" 是个高优先级 UX — 减少手工配置出错。读 `~/Library/Application Support/Claude/claude_desktop_config.json` → merge mcpServers → 写回。若文件不存在 / Claude Desktop 没装则禁用按钮。

### 顶栏状态指示器

`__root.tsx` 的 sidebar 区域加一个小 chip（点击跳设置页）：

| 状态 | 显示 |
|---|---|
| Binary built + Claude Desktop config 已引用 | 绿点 `MCP` |
| Binary built but Claude Desktop config 未引用 | 黄点 `MCP·待配置` |
| Binary not built（dev 模式还没 build） | 灰点 `MCP·未构建` |

状态来自 `useQuery({queryKey: ['mcp:status']})`，每 10s 轮询一次（无需实时；状态变化频率极低）。背后是新 IPC channel `mcp:get-status` → 在 main 端做两个 fs.existsSync 检查 + 一个 JSON 解析。

## Decision points

| 决策 | 选 | 理由 |
|---|---|---|
| Transport | stdio | 本地、零鉴权、Claude Desktop 唯一支持的稳定 transport |
| 部署 | standalone binary | 用户已选；进程独立、ABI 解耦 |
| SQLite client | `node:sqlite`（plan 验证后定） | engines 已 >=24；无 ABI 问题 |
| 写操作 | 直接生效、不要 GUI 确认 | 用户已选 |
| Source kind 标注 | 写入用 `'manual'` | 等价于人工操作；不引入新枚举 |
| Audit log | 不在 v1 接 | 后续子项目；目前 audit_event triggers 已存在但 MCP 没显式触发 |
| Resources 是否实现 | 2 个简单 URI | 让 Claude 能挂载阅读 inventory 摘要 |
| Prompts | 不在 v1 | 后续子项目，需要 prompt template 设计 |
| Settings 一键写入 Claude Desktop config | 是 | 减少手工出错；最高 UX 杠杆 |
| 顶栏状态指示器 | 是 | 用户已选；轮询 10s 足够 |

## Risk + rollback

**Risk 1：`node:sqlite` API 差异**。`better-sqlite3` 的 prepare/run/all 模式不是 `node:sqlite` 的原生 API。Plan T1 第一件事就是写个 throwaway 探针确认 `node:sqlite` 可用 + 写一个 readQuestionnaire 验 API。如果差异大到难以承受，回退 `sql.js`。

**Risk 2：并发写冲突**。SQLite WAL 模式下，同一时刻 ONLY ONE writer。MCP write + UI write 同时发生时其中一个会阻塞最多几十 ms。可接受。极端情况下 SQLITE_BUSY 错误 — 我们用 `journal_mode=WAL + busy_timeout=5000`（5秒）来缓解。

**Risk 3：Production .app bundle 路径**。在打包的 .app 里，`out/mcp/index.cjs` 在 `app.asar.unpacked/` 下，路径长。Settings UI 检测时要看 `app.getAppPath()` + `out/mcp/index.cjs`。dev 模式下路径不同（直接是 `out/mcp/index.cjs` 相对源码）。两种环境都要支持。

**Risk 4：claude_desktop_config.json 写入冲突**。如果 Claude Desktop 正在跑且我们改了它的配置文件，下次启动 Claude 会拾起。但运行中的 Claude 不会重新读 — 用户得重启 Claude Desktop。Settings UI 要明确提示这一点。

**Rollback**：删 out/mcp、撤销 settings UI section、删 IPC channel、删顶栏 chip。`git revert` 整个子项目链。无 schema 变更、无 migration 风险。

## Closeout criteria

- `pnpm build` 后存在 `out/mcp/index.cjs`、可被 `node out/mcp/index.cjs` 直接运行（启动 + 等 stdio 输入）
- Claude Desktop 配置好后能调用 6 read + 3 write tools，结果与 carbonbook UI 一致
- 写 tool 写入后、carbonbook UI 在下次 query 刷新时能看到（refetchOnFocus 已开 — 切回 carbonbook 窗口就刷）
- Settings 页 MCP section：检测 binary、检测 config、"一键写入" 可用
- 顶栏 chip：状态正确
- Tests: ~545+（read tools 6 × 1 + write tools 3 × 1 + 2 resources + 1 status detection + sweep）
- typecheck / biome 干净

## 后续

完成 #3 后：
- Phase 2 Block 4 剩下：**PDF 重排导出**（CDP PDF 问卷的 read-modify-write）— 用户未要求、留 backlog
- Phase 3 候选：ISO 14064-1 PDF/Excel 报告、EF rebind UI、audit_event UI
- MCP v1.5：Prompts 模板、audit 标注、写操作的 GUI 确认 mode
