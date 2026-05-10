# carbonbook — 设计稿

- **项目名（工作名）**：carbonbook
- **创建日期**：2026-05-08
- **状态**：v1 design 已逐节与作者确认，待最终复核
- **目标**：为出口型中国小厂的 ESG 经理打造的本地 GHG 操盘工具

## 章节

1. 产品定位 & 用户故事
2. 整体架构（含 Service Layer）
3. 数据模型
4. AI Pipeline（可插拔 stages）
5. 算这一侧 — Inventory + ISO 14064-1 报告
6. 填这一侧 — 客户问卷
7. CBAM Add-on 模块
8. EF 库管理
9. MCP 服务暴露
10. 订阅 / License / 更新
11. 发版路径（phase-based）

---

## §1. 产品定位 & 用户故事

### 一句话定位

> **carbonbook** 是给"出口型中国小厂的 ESG 经理"用的本地 GHG 操盘工具——AI 当数据工程师，一个人独立完成原本需要协调 6 个部门、跑 2 周的碳盘查 + 客户问卷工作。

### 目标客户（窄定）

| 维度 | 描述 |
|---|---|
| **企业规模** | 50-200 人 |
| **业务类型** | 制造业出口商（纺织/服装、电子/3C、塑料/化工、金属机械、家居/玩具等） |
| **触发** | 2026 年新 ESG 报告要求：CSRD 大客户向供应链下传 Scope 3 问卷、CBAM 6 行业正式收费、A 股大客户《可持续发展报告指引》催供应商交数据 |
| **使用者** | ESG 经理 / 行政经理兼职 / 老板助理 / 合规专员（**1 个人**操盘整个 app） |
| **付费决策者** | 老板 / 总经理（被供应链或法规推着走，预算 ¥3k-30k/年合规支出） |

### 核心 JTBD（双入口共享一份内部清单）

**算（Inventory & Reports）**
- 录组织边界 + 设施
- 上传单据（电费单 PDF / 加油站发票 / 物流单据 Excel / 采购清单）
- AI 自动解析 + 归类 + 配 EF + 算 CO2e
- 输出：ISO 14064-1 风格 GHG 清单 PDF + 数据底表 Excel（GHG Protocol Scope/Category 分类）

**填（Customer Questionnaires）**
- 拖入客户发来的 Excel/PDF 问卷
- AI 解析问题 → mapping 到内部清单
- 缺数据的题目提示用户上传单据
- 系统记忆 mapping，下次同客户的问卷复用
- 内置 CDP supplier demo 模板；其他模板"用户首次填完即沉淀"

**CBAM Add-on（高单价模块，独立购买，v1.1 计划）**
- 仅 6 行业（钢/铝/水泥/化肥/电/氢）
- 嵌入式排放方法论 + CBAM Quarterly Report XML 输出
- v1.0 不发布；详见 §7（设计预案）+ §11（v1.1 backlog）

### 核心叙事（产品 marketing & sales 抓手）

> "你不用让 6 个部门改流程、不用上系统、不用招新人。把单据拍照 / 截图 / 微信导出丢进 carbonbook，AI 帮你算清账、填好表。**数据不出你的电脑**（只有 AI 调用走自己的 API key/订阅）。"

三个差异化标签：**单机隐私** · **AI 当数据工程师** · **算+填一份清单**。

### 商业模式

| 档 | 价格 | 内容 |
|---|---|---|
| **Base 年订阅** | $300-800 / 年 / 人 | 算+填全功能、ISO 14064 报告、通用问卷解析、CDP demo 模板、EF 库季度更新 |
| **CBAM Add-on**（v1.1 计划，v1.0 不发布） | $2,000-5,000 / 年 | CBAM 方法论 + XML 输出 + 6 行业专属 EF。详见 §7（设计预案） |
| **AI 调用** | **客户自付**（BYOT API key / OpenAI-compat endpoint；OAuth provider 视各 provider 公开支持情况开放） | 不进 carbonbook 的成本结构 |
| **更新机制** | 年付校验联网一次；EF snapshot 季度推送（10MB 增量） | 单机为主，最小云依赖 |

### 与 Seneca AERA 的继承关系

| 继承 | 故意砍掉 |
|---|---|
| Scope 1/2/3 + GHG Protocol Category 数据模型 | Org / BU / Facility 多层级（简化为 Org → Site） |
| Climatiq 爬虫思路 → 升级为自维护多源 EF 仓库（IPCC / DEFRA / OECC / IEA） | 实时 Climatiq API 依赖 |
| Excel 导入模板 | 17 个 APIComponent 的复杂遗留 |
| —— | Bi-temporal Data Blob 工程（用 SQLite + append-only event log 替代） |
| —— | Marcus Chatbot（独立 AI agent 路线，不进 v1） |
| —— | EPIC 多租户、Keycloak、Kafka 等所有 Web SaaS 基础设施 |

**新做（Seneca 没做）**：

- **v1.0**：客户问卷 AI 解析 + 自动 mapping、EF pin 副本版本化、BYOT API key + OpenAI-compat endpoint（OAuth provider 实验性按 provider 公开支持开放）、对外本机 MCP 服务暴露、单位中文 alias + 燃料密度跨 family 换算 + 维度校验（AERA 三块空白）
- **v1.1（计划）**：CBAM 嵌入式排放方法论 + Quarterly Report XML 输出 + 独立 license（详见 §7）

### v1 显式不做

- 多用户协作 / 团队权限
- 移动端
- **Linux 桌面发行版**（不在 roadmap 内；Electron 代码本身可移植，但不打包不签名不分发）
- 公网 / 云端第三方 REST API（本机 MCP 服务暴露见 §9 是 opt-in 的本地协议，不是公网 API，不与此条冲突）
- ESG 非 GHG 部分（社会、治理、生物多样性等）
- Scope 3 cat 2/3/8/10/11/12/13/14/15
- 实时 EF 在线查询（v2 考虑加 Climatiq BYOK）

---

## §2. 整体架构

### 进程拓扑（含 Service Layer）

引入 MCP server（详见 §9）后，业务逻辑必须从 IPC handler 下沉到独立 service layer，避免协议层之间的代码重复。Renderer-IPC + MCP + 任何未来协议（CLI / REST / WebSocket）都通过 service 调用，**不允许直接 import DB 或写 SQL**。

```
┌────────────────────────────────────────────────────────────────────┐
│                      ELECTRON APP (carbonbook)                     │
├──────────────────────────────────┬─────────────────────────────────┤
│      MAIN PROCESS (Node)         │     RENDERER PROCESS (Chromium) │
│                                  │                                 │
│  ┌─ IPC Handlers ┐ ┌─ MCP Srv ─┐ │   ┌───────────────────────────┐ │
│  │ inventory.*   │ │ resources │ │   │  TanStack Query / Store   │ │
│  │ documents.*   │ │ tools     │◄┼──►│  (consume IPC wrappers)   │ │
│  │ reports.*     │ │ prompts   │ │   └────────┬──────────────────┘ │
│  │ questionnaire.*│└─────┬─────┘ │            ▼                    │
│  └────────┬──────┘       │       │   ┌───────────────────────────┐ │
│           └──────┬───────┘       │   │  React + TanStack         │ │
│                  ▼               │   │  (Router/Form/Table/Virt) │ │
│   ┌── Service Layer ──┐          │   │  shadcn/ui + Tailwind v4  │ │
│   │ inventory-service │          │   │  Paraglide (zh-CN/en)     │ │
│   │ pipeline-service  │          │   └───────────────────────────┘ │
│   │ questionnaire-svc │          │                                 │
│   │ report-service    │          │                                 │
│   │ ef-service        │          │                                 │
│   └─┬──┬──────────┬───┘          │                                 │
│     │  │          │              │                                 │
│   ┌─▼─┐┌▼───┐ ┌──▼─────────┐    │                                 │
│   │DB ││ EF │ │ LLMClient  │    │                                 │
│   │app││ ro │ │ (pi-ai)    │    │                                 │
│   └─┬─┘└────┘ └──┬────┬────┘    │                                 │
│   ┌─▼─────┐     │    │ HTTPS    │                                 │
│   │Uploads│     │    │ user-key │                                 │
│   │FS hash│     │    │ /OAuth   │                                 │
│   └───────┘     │    ▼          │                                 │
│   ┌──────────┐  │ ┌────────────┴────────────────┐                 │
│   │OS Keystore│ │ │ AI Providers (BYOT or OAuth)│                 │
│   │(safeStor)│◄┘ │ OpenAI/Claude/Azure/DeepSeek/│                 │
│   └──────────┘   │ Qwen/OpenRouter/OpenAI-compat│                 │
│                  └─────────────────────────────┘                 │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ HTTPS（年付校验 + 季度 EF + auto-update）
                                  ▼
                  ┌──────────────────────────────────┐
                  │  carbonbook-cloud（最小云依赖）   │
                  │  • License 校验（年付/续费）      │
                  │  • EF snapshot CDN（季度增量）    │
                  │  • App 自动更新（electron-updater)│
                  │  Cloudflare Pages + R2 + Workers │
                  └──────────────────────────────────┘
```

### 关键架构决定

**1. AI 凭证只存 Main，永不进 Renderer**
- API key / OAuth token 加密后存在 OS Keychain（Electron `safeStorage`）
- 所有 LLM 调用从 Main 发起；Renderer 通过 IPC 发请求"用 AI 总结这个 PDF"，Main 执行真正的 HTTP
- 防止 XSS / 渲染层漏洞泄露凭证

**2. IPC 用 `@electron-toolkit/typed-ipc` + Zod（type-safe，原生 Electron 通道）**
- 共享 `TypeMap`：`{ 'org:create': (input: OrgCreateInput) => Organization, ... }`，main 端 `IpcListener<TypeMap>` 约束 `ipcMain.handle`、renderer 端 `IpcEmitter<TypeMap>` 约束 `ipcRenderer.invoke`
- 每个 handler 入口 Zod parse，类型 + 运行时双重保险
- Renderer 用一层薄 wrapper 把 `ipcRenderer.invoke('org:create', input)` 包成 `orgApi.create(input)`，再交给 TanStack Query 的 `useMutation` / `useQuery`，DX 跟 tRPC 客户端基本一致
- 历史决定：原本选 `electron-trpc`（v10 时代库），但 tRPC v11 把 transformer 移到 link 层后 electron-trpc 仍按 v10 假设运行 runtime.transformer → 客户端 NPE + 静默挂死。库已无活跃维护（last commit 2024-12），换 typed-ipc 切断这条死路径
- AI 流式输出 / 长任务进度走 `BrowserWindow.webContents.send` 自定义事件 channel（非 invoke，单向推送），renderer 用 `ipcRenderer.on` 订阅。MCP server 不走 IPC，独立跑在 `utilityProcess` 里通过 localhost socket 暴露（详见 §9）

**3. 三个 SQLite 文件，职责分明**

| 文件 | 路径 | 写性 | 用途 |
|---|---|---|---|
| `app.sqlite` | `<userData>/carbonbook/app.sqlite` | RW | 用户数据：组织、设施、活动数据、问卷、AI 提取记录、用户上传的自定义 EF（source='user'） |
| `ef_library.sqlite` | 随 app installer 发版，季度更新覆盖 | RO | EF 库（~670 条 + 版本化） + reference 数据：`unit_definition` (~180 单位) + `unit_alias` (中文别名) + `fuel_property` (燃料密度 / 热值)。详见 §3 单位与换算 |
| `cache.sqlite` | `<userData>/carbonbook/cache.sqlite` | RW，可删 | AI 解析临时缓存（按 file hash 去重） |

**4. 上传文件 content-addressed**
- 路径：`<userData>/carbonbook/uploads/<sha256[0:2]>/<sha256>.<ext>`
- AI 解析结果存 `app.sqlite` 的 `extraction` 表，FK 到文件 hash
- 用户重新上传同一份文件 → 命中缓存，不重复调 AI

**5. carbonbook-cloud 是唯一第一方服务，超薄**
- License 校验：年付一次，离线宽限 30 天
- EF snapshot CDN：每季度发 ~10MB SQLite 文件，签名校验
- auto-update：electron-updater 标准流程
- 全部在 Cloudflare Pages + R2 + Workers 上

**6. 数据流向（隐私承诺）**
- 用户单据 PDF / Excel：**只传给用户配置的 AI provider**（用户自己的 key/token），不经 carbonbook-cloud
- carbonbook-cloud 只看到：license token + EF snapshot 下载请求 + auto-update 检查
- 故意不收集用户的活动数据、报告内容、问卷答案——这是核心 marketing 卖点
- MCP 暴露后修订承诺为："数据不出你的电脑。你可以选择把 carbonbook 暴露给本机的 AI 工具（Claude Desktop / Cursor 等）使用——这些工具产生的 AI 调用走它们各自的认证，不经 carbonbook-cloud。"

### Tech Stack 决定

| 层 | 选择 |
|---|---|
| App 容器 | Electron（Node 主进程） |
| 运行时 | Node.js ≥ 22 |
| 包管理 | pnpm |
| 构建 / dev | electron-vite |
| 测试 | Vitest |
| 渲染框架 | React 18 + Vite |
| 路由 | TanStack Router |
| 数据/状态 | TanStack Query + TanStack Store |
| 表单 | TanStack Form |
| 表格 | TanStack Table + TanStack Virtual |
| 样式 | Tailwind v4 + shadcn/ui |
| i18n | Paraglide JS |
| 数据库 | better-sqlite3 |
| AI 抽象 | `@earendil-works/pi-ai` + 自家 `LLMClient` 包装 |
| MCP SDK | `@modelcontextprotocol/sdk` |
| 打包 / 分发 | electron-builder |

### Trade-off 表

| 选 | 替代 | 理由 |
|---|---|---|
| `@electron-toolkit/typed-ipc` + Zod | electron-trpc / tRPC | electron-trpc 已无活跃维护、tRPC v11 + electron-trpc 静默挂死（详见架构决定 #2）；typed-ipc 用 Electron 原生 channel，类型 + Zod 双保险，零 wire-format 依赖 |
| Cloudflare Pages+R2+Workers | 自建 VPS / Vercel / Supabase | 免费层够用、无服务器维护负担、Cloudflare 中国大陆访问通透 |
| safeStorage (OS keystore) | 自加密 + 文件存储 | 系统级安全；v1 覆盖 macOS Keychain + Windows Credential Manager。**Linux 不在产品 roadmap 内**——Electron 框架虽支持 Linux，但不打包发行 |
| 上传文件 FS + content-hash | 入库 BLOB | SQLite BLOB 性能差 + DB 文件膨胀；FS + hash 干净 |

---

## §3. 数据模型

### 设计原则

1. **Activity-row 颗粒（不是 monthly aggregate）** —— 每一笔活动数据 = 一行（一张电费单 = 一行；一笔燃油加注 = 一行）。AERA 选了 monthly aggregate 丢掉了审计追溯，AI 解析单据天然就是逐笔，强行汇总会丢字段。聚合视图在 SQL view / 查询时算。

2. **Immutable EF snapshot + activity 行 FK 到本地 pin 副本** —— EF 永不就地改写，每次更新发新 `dataset_version`。用户绑活动数据到 EF 时，系统先从 `emission_factor`（UNION 来自 `ef_library.sqlite` readonly 库 + `app.sqlite` 用户上传 EF）query 候选；选中后**把那行 EF 复制到 `app.sqlite` 的 `pinned_emission_factor` 表**（按复合 PK 去重），activity_data 的 FK 指向本地 pin 副本（同 DB 内 FK 实际可用）。这样：
   - EF 库 snapshot 替换后历史报告完全可复现
   - DB 层 FK 完整性能强制（不依赖 service-layer 自觉）
   - app.sqlite 自包含，备份/迁移/分享是单文件
   - 体积可控（每个 unique EF 只 pin 一次）
   - 用户想"用新 DEFRA 重算 2024 年"是显式操作 → 触发 audit_event 记录
   
   **SQLite 跨 attached DB 不支持普通 FK，所以"FK 直接指向 emission_factor"在 readonly 库这种部署模式下行不通**——pin 副本是这条原则的实现层落地，而不是冗余。这条根除 AERA 的 #1 痛点。

3. **Document → Extraction → Activity Data 三层** —— 上传文件入 documents（content-hash 寻址），AI 解析结果入 extractions（JSON + 模型/prompt 版本），activity_data 行可以 FK 到 extraction（来自 AI）或为 NULL（用户手填）。审计链完整。

4. **不上事件溯源 / Bi-temporal** —— AERA 的 Data Blob 工程是因为多租户 + 需要 query-as-of 时间点。我们单机 + 用户控制的 calculation_snapshot 已经够用。复杂度砍 80%。

5. **Calculation 可选物化为 snapshot** —— 日常算是 view 推导；用户点"freeze 2024 报告"才存 calculation_snapshot 表（含当时的所有 FK + 数值快照），用于报告复现。

### ER 概览

```
                                   ┌──────────────┐
                                   │ organization │ (单实体，单机=1 row)
                                   └──────┬───────┘
                                          │ 1
                                          ▼ N
              ┌───────────────────────► site ◄─────────────────────┐
              │                             │                       │
              │ 1                          │ 1                     │ N
              ▼ N                           ▼ N                     │
      reporting_period               emission_source                │
              │                             │                       │
              │ 1                          │ 1                     │
              ▼ N                           ▼ N                     │
        ┌──── activity_data ◄──────────────┘                        │
        │           │                                                │
        │           │ N (FK 在 app.sqlite 同库内)                     │
        │           ▼ 1                                               │
        │    ┌─────────────────────────────┐                          │
        │    │ pinned_emission_factor       │  ◄── INSERT OR IGNORE   │
        │    │ (在 app.sqlite，写入)         │      在用户绑定时由        │
        │    │ PK 同 emission_factor 复合键  │      service layer 拷贝    │
        │    └──────────────▲───────────────┘                          │
        │                   │ copy from (build-time / user-uploaded)   │
        │                   │                                          │
        │    ┌──────────────┴───────────────┐                          │
        │    │ emission_factor (UNION:      │                          │
        │    │  ef_library.sqlite [RO]      │                          │
        │    │  + app.sqlite source='user') │                          │
        │    │ PK: (code,year,source,geo,   │                          │
        │    │      ds_version)             │                          │
        │    └──────────────────────────────┘                          │
        │                                                            │
        │ N                                                          │
        ▼ 1                                                          │
   extraction ◄── 1 ── N ── document (content-hash addressed)        │
                                                                     │
   ┌─────────────────────────────────────────────────────────────────┘
   │ (问卷侧)
   ▼
   customer ──1─N── questionnaire ──1─N── question
                                              │
                                              │ N
                                              ▼ 1
                                       question_mapping  (记忆 mapping)
                                              │
                                              │ 1
                                              ▼ N
                                          answer (引用 activity_data 或 calc_snapshot)

   company_profile (key-value)        narrative_bank (开放题答案库)
   calculation_snapshot ──N─1── reporting_period
   audit_event (append-only)
   user_setting (license / BYOT keys / 偏好)
```

### 关键表 schema

#### `emission_factor`

EF 库（readonly，来自 ef_library.sqlite + 用户上传的可写 EF 在 app.sqlite，同表结构 source='user'，查询时 UNION 去重）

```sql
CREATE TABLE emission_factor (
  factor_code      TEXT NOT NULL,      -- 'electricity.grid.china.guangdong'
  year             INTEGER NOT NULL,   -- 2024
  source           TEXT NOT NULL,      -- 'oecc' | 'ipcc' | 'defra' | 'iea' | 'glec' | 'exiobase' | 'cbam_default_v2024' | 'cbam_measured' | 'user' | 'supplier_pcf'
  geography        TEXT NOT NULL,      -- ISO-3166-1/2 或 'global' / 'asia'
  dataset_version  TEXT NOT NULL,      -- '2024-q4' | 'AR6' | 'DEFRA-2024'
  -- 复合 PK 一锅端
  PRIMARY KEY (factor_code, year, source, geography, dataset_version),

  scope            INTEGER NOT NULL,   -- 1 / 2 / 3
  category         TEXT,               -- 'cat1' | 'cat4' | 'cat6' | 'cat9' (Scope 3) | NULL
  ghg_protocol_path TEXT,              -- e.g. 'scope2.purchased_electricity.location_based'
  input_unit       TEXT NOT NULL,      -- 'kWh' | 'L' | 'kg' | 'tonne_km' ...
  co2e_kg_per_unit REAL NOT NULL,      -- 主结果（CO2e kg / input_unit）
  ch4_kg_per_unit  REAL,               -- 可选：分气体（CBAM 需要）
  n2o_kg_per_unit  REAL,
  hfc_kg_per_unit  REAL,
  pfc_kg_per_unit  REAL,
  sf6_kg_per_unit  REAL,
  nf3_kg_per_unit  REAL,
  gwp_basis        TEXT NOT NULL,      -- 'AR5' | 'AR6'
  name_zh          TEXT,
  name_en          TEXT,
  description_zh   TEXT,
  description_en   TEXT,
  notes            TEXT,
  citation_url     TEXT
);
CREATE INDEX idx_ef_lookup ON emission_factor(factor_code, year, geography);
CREATE INDEX idx_ef_scope_cat ON emission_factor(scope, category);
```

#### `pinned_emission_factor`

EF 行的本地"快照副本"，在 app.sqlite 内，让 activity_data 的 FK 实际可用（SQLite 不支持跨 attached DB 的普通 FK）。当用户首次把某条活动数据绑定到一个 EF 时，service layer 把那行 EF 从 `emission_factor`（无论来自 readonly 库还是用户上传）原样复制到此表（INSERT OR IGNORE，按复合 PK 去重）。

```sql
CREATE TABLE pinned_emission_factor (
  -- 复合 PK 与 emission_factor 一致
  factor_code      TEXT NOT NULL,
  year             INTEGER NOT NULL,
  source           TEXT NOT NULL,
  geography        TEXT NOT NULL,
  dataset_version  TEXT NOT NULL,
  PRIMARY KEY (factor_code, year, source, geography, dataset_version),

  -- 计算和审计需要的字段（emission_factor 的子集 + 元数据）
  scope            INTEGER NOT NULL,
  category         TEXT,
  ghg_protocol_path TEXT,
  input_unit       TEXT NOT NULL,
  co2e_kg_per_unit REAL NOT NULL,
  ch4_kg_per_unit  REAL,
  n2o_kg_per_unit  REAL,
  hfc_kg_per_unit  REAL,
  pfc_kg_per_unit  REAL,
  sf6_kg_per_unit  REAL,
  nf3_kg_per_unit  REAL,
  gwp_basis        TEXT NOT NULL,
  name_zh          TEXT,
  name_en          TEXT,
  description_zh   TEXT,
  description_en   TEXT,
  citation_url     TEXT,

  -- pin 自身的元数据
  pinned_at        TEXT NOT NULL,             -- ISO8601 复制时间
  pinned_from      TEXT NOT NULL              -- 'ef_library@v2026.q3' | 'user_uploaded' | 'cbam_default@v2024'
);
```

EF 库季度更新换 readonly snapshot 时，pinned 行不动 → 历史 activity_data 仍然 FK 通且数值不变。用户走 EF Rebind 流程时（详见 §8），service layer 把新版本 EF 复制为新 pinned 行，把目标 activity_data 行的 FK 改指新 pin，原 pin 留着不删（其他历史数据可能还在引用）。

#### `activity_data`

```sql
CREATE TABLE activity_data (
  id               TEXT PRIMARY KEY,           -- ULID
  -- site_id + emission_source_id 复合 FK 到 emission_source(id, site_id)
  -- 保证 activity_data.site_id == emission_source.site_id（DB 层强制，service 不用 double check）
  site_id          TEXT NOT NULL,
  emission_source_id TEXT NOT NULL,
  FOREIGN KEY (emission_source_id, site_id)
    REFERENCES emission_source(id, site_id),
  reporting_period_id TEXT NOT NULL REFERENCES reporting_period(id),

  -- 时间维度
  occurred_at_start TEXT NOT NULL,             -- ISO8601
  occurred_at_end   TEXT NOT NULL,

  -- 量
  amount           REAL NOT NULL,
  unit             TEXT NOT NULL,              -- 必须可换算到 EF.input_unit

  -- EF 绑定（5 字段复合外键，指向 app.sqlite 内的 pinned_emission_factor）
  ef_factor_code      TEXT NOT NULL,
  ef_year             INTEGER NOT NULL,
  ef_source           TEXT NOT NULL,
  ef_geography        TEXT NOT NULL,
  ef_dataset_version  TEXT NOT NULL,
  FOREIGN KEY (ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version)
    REFERENCES pinned_emission_factor(factor_code, year, source, geography, dataset_version),

  -- 计算结果（冗余存 cache，输入变了重算）
  computed_co2e_kg REAL NOT NULL,
  computed_at      TEXT NOT NULL,

  -- 来源链
  extraction_id    TEXT REFERENCES extraction(id),  -- NULL = 手填
  notes            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_activity_period ON activity_data(reporting_period_id, emission_source_id);
CREATE INDEX idx_activity_extraction ON activity_data(extraction_id);
-- 用于 EF rebind audit / 影响分析（"哪些活动数据用了这版 EF"）
CREATE INDEX idx_activity_ef ON activity_data(ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version);
```

#### `emission_source`

```sql
CREATE TABLE emission_source (
  id              TEXT PRIMARY KEY,
  site_id         TEXT NOT NULL REFERENCES site(id),
  name            TEXT NOT NULL,           -- '外购电力（广东电网）'
  scope           INTEGER NOT NULL,
  category        TEXT,                    -- 'cat1' | 'cat4' | ...
  ghg_protocol_path TEXT,                  -- 'scope2.purchased_electricity.location_based'
  default_ef_query TEXT CHECK(default_ef_query IS NULL OR json_valid(default_ef_query)),  -- 默认 EF 查询条件，pipeline 自动绑
  template_origin  TEXT,                   -- 哪个行业 template 推荐的
  is_active        INTEGER DEFAULT 1,
  -- 让 activity_data 用复合 FK 把 site_id 和 emission_source 钉死一致
  UNIQUE (id, site_id)
);
```

#### `document` / `extraction`

```sql
CREATE TABLE document (
  id            TEXT PRIMARY KEY,             -- ULID
  sha256        TEXT NOT NULL UNIQUE,         -- content-addressed
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  storage_path  TEXT NOT NULL,                -- uploads/<sha2>/<sha>
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT                          -- 'user' | 'email_drop' | 'screenshot'
);

CREATE TABLE extraction (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES document(id),
  llm_provider  TEXT NOT NULL,                -- 'azure-openai' | 'anthropic' | ...
  llm_model     TEXT NOT NULL,                -- 'gpt-5' | 'claude-sonnet-4-6' ...
  prompt_version TEXT NOT NULL,               -- 内部版本号
  -- raw_response / parsed_json / error_json 都 nullable；具体什么 status 下哪些必填由下面的 lifecycle CHECK 强制
  raw_response  TEXT,                         -- LLM 原始输出（可能是非合法 JSON）；pending 时为 NULL
  parsed_json   TEXT CHECK(parsed_json IS NULL OR json_valid(parsed_json)),  -- 应用层 zod 校验通过后的结构化 JSON
  error_json    TEXT CHECK(error_json IS NULL OR json_valid(error_json)),    -- rejected 时的结构化错误描述（zod issues / provider error code / 等）
  status        TEXT NOT NULL CHECK(status IN ('pending', 'parsed', 'review_needed', 'rejected')),
  reviewed_by_user_at TEXT,                   -- 用户人工 confirm 时间
  cost_usd      REAL,                         -- AI 调用成本估算
  created_at    TEXT NOT NULL,
  -- 缓存键：同 (document, prompt, model) 不重复抽取（节省 token）
  UNIQUE (document_id, prompt_version, llm_provider, llm_model),
  -- Lifecycle：status 与字段填充的硬约束（DB 层强制 schema 与状态一致）
  --   pending          : 三列全 NULL（还没拿到响应）
  --   parsed/review    : raw + parsed 必填，error 必须 NULL（不允许残留过期错误）
  --   rejected         : parsed 必须 NULL；raw 或 error 至少一个 NOT NULL
  --                      （raw 为空覆盖 provider/network 错没有 body 的情况；
  --                       raw 非空覆盖 model 输出格式坏 / zod 校验失败的情况）
  CHECK (
    (status = 'pending' AND raw_response IS NULL AND parsed_json IS NULL AND error_json IS NULL)
    OR
    (status IN ('parsed', 'review_needed') AND raw_response IS NOT NULL AND parsed_json IS NOT NULL AND error_json IS NULL)
    OR
    (status = 'rejected' AND parsed_json IS NULL AND (raw_response IS NOT NULL OR error_json IS NOT NULL))
  )
);
```

#### 问卷系列

```sql
CREATE TABLE customer (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,                      -- 'Apple Inc.' / '沃尔玛'
  notes   TEXT
);

CREATE TABLE questionnaire (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customer(id),
  document_id   TEXT NOT NULL REFERENCES document(id),  -- 上传的原始问卷文件
  template_kind TEXT,                          -- 'cdp_supplier' | 'apple_scep' | 'walmart_pgp' | 'generic_excel' | NULL
  reporting_year INTEGER NOT NULL,
  status        TEXT NOT NULL,                 -- 'parsing' | 'mapping' | 'answering' | 'exported'
  due_date      TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE question (
  id              TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaire(id),
  question_signature TEXT NOT NULL,            -- 规范化文本 hash，跨问卷复用 mapping
  signature_version TEXT NOT NULL,             -- 例 'sig-v1' / 'sig-v2'；算法变更时升级
  normalized_text TEXT NOT NULL,               -- hash 出来之前的规范化文本（trim/lowercase/去标点/...）
  raw_text        TEXT NOT NULL,
  parsed_intent   TEXT,                        -- AI 归类的语义意图
  question_kind   TEXT NOT NULL CHECK(question_kind IN ('numerical', 'categorical', 'narrative')),
  expected_unit   TEXT,                        -- 'kWh' | 'tCO2e' | '%' | 'yes/no' | 'text'
  position        TEXT,                        -- '5.2.a' / 'C7.5'
  required        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_question_signature ON question(question_signature, signature_version);
-- 同一问卷里 position 唯一（部分索引：position 非 NULL 时强制）
CREATE UNIQUE INDEX uq_question_questionnaire_position
  ON question(questionnaire_id, position)
  WHERE position IS NOT NULL;

CREATE TABLE question_mapping (
  question_signature TEXT NOT NULL,
  signature_version  TEXT NOT NULL,             -- 与 question.signature_version 一致；算法升级时不破老 mapping
  customer_id        TEXT NOT NULL,
  -- 映射目标：仅这 3 类，不放原始 SQL（避免 schema 演进破 mapping / 注入风险 / MCP 自动化继承）
  mapping_kind       TEXT NOT NULL CHECK(mapping_kind IN ('inventory_path', 'literal', 'manual')),
  mapping_payload    TEXT NOT NULL CHECK(json_valid(mapping_payload)),
  confidence         REAL,                      -- AI 置信度 0-1
  reviewed_by_user_at TEXT,
  created_at         TEXT NOT NULL,
  PRIMARY KEY (question_signature, signature_version, customer_id)
);
-- 未来若需要更复杂查询：用 allowlisted query-template DSL（typed parameters，read-only，特定 view）
-- 而不是开放 raw SQL。该 DSL 不在 v1 范围。

CREATE TABLE answer (
  id              TEXT PRIMARY KEY,
  question_id     TEXT NOT NULL UNIQUE REFERENCES question(id),  -- 一题一答
  value           TEXT NOT NULL,
  unit            TEXT,
  source_kind     TEXT NOT NULL CHECK(source_kind IN ('mapped_inventory', 'manual', 'ai_suggested')),

  -- 类型化 source FK：4 个 nullable 列，业务上互斥
  source_calculation_snapshot_id TEXT REFERENCES calculation_snapshot(id),
  source_activity_data_id        TEXT REFERENCES activity_data(id),
  source_company_profile_key     TEXT REFERENCES company_profile(key),
  source_narrative_bank_id       TEXT REFERENCES narrative_bank(id),

  -- 不可变 source 快照：导出问卷后即使源数据变更，答案仍可解释
  -- JSON 内含当时的关键字段（如 amount, unit, computed_co2e_kg, EF version, snapshot_id 等）
  source_summary  TEXT CHECK(source_summary IS NULL OR json_valid(source_summary)),

  finalized_at    TEXT,

  -- DB-level 互斥：mapped_inventory 必填恰好一个 source FK；manual / ai_suggested 至多一个
  -- (布尔表达式 IS NOT NULL 在 SQLite 求值为 0/1，可直接相加)
  CHECK (
    (source_kind = 'mapped_inventory' AND
      ((source_calculation_snapshot_id IS NOT NULL) +
       (source_activity_data_id IS NOT NULL) +
       (source_company_profile_key IS NOT NULL) +
       (source_narrative_bank_id IS NOT NULL)) = 1)
    OR
    (source_kind IN ('manual', 'ai_suggested') AND
      ((source_calculation_snapshot_id IS NOT NULL) +
       (source_activity_data_id IS NOT NULL) +
       (source_company_profile_key IS NOT NULL) +
       (source_narrative_bank_id IS NOT NULL)) <= 1)
  )
);

CREATE TABLE company_profile (
  key         TEXT PRIMARY KEY,           -- 'esg_owner_name' | 'climate_policy_url' | 'sbti_status' | ...
  value       TEXT,                       -- 字符串、JSON、URL、日期
  kind        TEXT NOT NULL,              -- 'string' | 'date' | 'url' | 'json' | 'narrative'
  updated_at  TEXT NOT NULL,
  notes       TEXT
);

CREATE TABLE narrative_bank (
  id          TEXT PRIMARY KEY,
  topic       TEXT NOT NULL,               -- 'climate_governance' | 'risk_management' | 'targets' | ...
  language    TEXT NOT NULL,               -- 'zh' | 'en'
  body        TEXT NOT NULL,               -- 用户编辑过的标准答案文本
  last_used_at TEXT,
  used_count  INTEGER DEFAULT 0
);
```

#### `calculation_snapshot` / `audit_event`

```sql
CREATE TABLE calculation_snapshot (
  id                  TEXT PRIMARY KEY,
  reporting_period_id TEXT NOT NULL REFERENCES reporting_period(id),
  frozen_at           TEXT NOT NULL,
  ef_dataset_versions TEXT NOT NULL CHECK(json_valid(ef_dataset_versions)),  -- 当时所有用到的 EF version（审计用）
  total_co2e_kg       REAL NOT NULL,
  scope1_kg           REAL NOT NULL,
  scope2_kg_location  REAL NOT NULL,
  scope2_kg_market    REAL,
  scope3_kg_by_cat    TEXT NOT NULL CHECK(json_valid(scope3_kg_by_cat)),     -- {"cat1": ..., "cat4": ...}
  -- 不再存 activity_row_ids JSON 列；改用 calculation_snapshot_line 子表（详见下表）
  report_metadata     TEXT CHECK(report_metadata IS NULL OR json_valid(report_metadata)),
  pdf_path            TEXT,                    -- 落地 PDF
  excel_path          TEXT,                    -- 落地 Excel 底表
  parent_snapshot_id  TEXT REFERENCES calculation_snapshot(id),  -- 修订链
  revision            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_csnap_period_frozen ON calculation_snapshot(reporting_period_id, frozen_at);

-- 报告冻结时为每条纳入的活动数据生成一条不可变快照行
-- 这是 audit-grade source of truth：即使原 activity_data 后续被改 / 删，快照行不变，报告仍可重建
CREATE TABLE calculation_snapshot_line (
  id                            TEXT PRIMARY KEY,                -- ULID
  calculation_snapshot_id       TEXT NOT NULL REFERENCES calculation_snapshot(id) ON DELETE RESTRICT,

  -- 原始引用（仅作为 audit hint；可能后续被改/删）
  original_activity_data_id     TEXT,

  -- 冻结时的 site / source / period 标识 + name 快照（self-contained）
  site_id_at_freeze             TEXT NOT NULL,
  site_name_at_freeze           TEXT NOT NULL,
  emission_source_id_at_freeze  TEXT NOT NULL,
  emission_source_name_at_freeze TEXT NOT NULL,
  reporting_period_id_at_freeze TEXT NOT NULL,

  -- 时间维度
  occurred_at_start             TEXT NOT NULL,
  occurred_at_end               TEXT NOT NULL,

  -- 量 + 单位（含转换后量，对应 EF 的 input_unit）
  amount                        REAL NOT NULL,
  unit                          TEXT NOT NULL,
  ef_input_unit                 TEXT NOT NULL,
  converted_amount              REAL NOT NULL,

  -- EF 复合键 + EF 系数值（直接复制，不依赖 pinned_emission_factor 行还在）
  ef_factor_code                TEXT NOT NULL,
  ef_year                       INTEGER NOT NULL,
  ef_source                     TEXT NOT NULL,
  ef_geography                  TEXT NOT NULL,
  ef_dataset_version            TEXT NOT NULL,
  ef_co2e_kg_per_unit           REAL NOT NULL,
  ef_gwp_basis                  TEXT NOT NULL,

  -- 计算结果
  computed_co2e_kg              REAL NOT NULL,
  scope                         INTEGER NOT NULL,
  category                      TEXT,
  ghg_protocol_path             TEXT,

  -- 来源链（document hash 不可变，所以即使原文件丢失，hash 仍可作为索引；extraction_id 仅为参考）
  extraction_id_at_freeze       TEXT,
  document_id_at_freeze         TEXT,
  document_sha256_at_freeze     TEXT
);
CREATE INDEX idx_csl_snapshot ON calculation_snapshot_line(calculation_snapshot_id);
CREATE INDEX idx_csl_scope_cat ON calculation_snapshot_line(calculation_snapshot_id, scope, category);

CREATE TABLE audit_event (
  id            TEXT PRIMARY KEY,
  event_kind    TEXT NOT NULL,        -- 'ef_rebind' | 'snapshot_freeze' | 'license_activated' | ...
  payload       TEXT NOT NULL CHECK(json_valid(payload)),
  occurred_at   TEXT NOT NULL
);
CREATE INDEX idx_audit_occurred ON audit_event(occurred_at);
CREATE INDEX idx_audit_kind_occurred ON audit_event(event_kind, occurred_at);

-- audit_event 是 append-only：DB 层用 trigger 拒绝 UPDATE / DELETE
CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TRIGGER audit_event_no_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;
```

### 故意省略

| 不做 | 替代 |
|---|---|
| Bi-temporal valid_from/valid_to 时间维度 | Immutable EF snapshot + calculation_snapshot 物化 |
| 多租户隔离（tenant_id 散落在每张表） | 单机一个 organization，无需隔离 |
| 软删除（deleted_at） | 直接物理删除；audit_event 留痕 |
| 外键级联 ON DELETE CASCADE | 删除走业务层（Renderer 提示用户级联影响）；DB 层默认 RESTRICT 防误删 |
| 复杂 RBAC 表（role/permission/scope） | v1 单用户，无角色 |

### 关键约束 / 业务规则

0. **`PRAGMA foreign_keys = ON` 是强制启动配置**——SQLite 默认不强制 FK，必须每个 better-sqlite3 connection / migration runner / 测试 DB 启动时显式开启。app 启动时若发现该 PRAGMA 未生效，立即 abort（FK 不开整个数据完整性失效，绝不能默默继续）。CI 加一条 smoke test：插入故意违反 FK 的行必须失败。
1. **`activity_data.unit` 必须可转换到 `emission_factor.input_unit`**：写入前在应用层校验，详见下文"单位与换算"小节（`unit_definition` 表 + family 维度校验 + 中文 alias + 燃料密度跨 family）。
2. **`emission_factor` 来自 ef_library.sqlite（attach 为 readonly DB）+ app.sqlite 里的用户上传 EF（同表结构 source='user'）**：查询时 UNION，应用层去重。绑定到 activity_data 时通过 service layer 复制到 `pinned_emission_factor`（详见 §3 原则 2）。
3. **`question_signature` 算法版本化**：每条 question 同时存 `question_signature` + `signature_version` + `normalized_text`。同 (signature, signature_version, customer_id) 命中复用；signature_version 升级时旧 mapping 不破，service layer 在 lookup 时按版本兼容降级或一次性迁移。
4. **`extraction.parsed_json` schema**：用 zod 在应用层校验，schema 跟着 prompt_version 走（升级 prompt 同步升 schema）。DB 列额外用 `CHECK(json_valid(parsed_json))` 防止脏数据落库。
5. **ID 用 ULID**：单调时间序，跨机器无冲突，对 SQLite 索引友好。
6. **JSON 列必须 `CHECK(json_valid(...))`**：所有声明为 JSON 用途的列（`parsed_json` / `mapping_payload` / `default_ef_query` / `ef_dataset_versions` / `scope3_kg_by_cat` / `report_metadata` / `audit_event.payload` 等）都用 `TEXT NOT NULL CHECK(json_valid(col))` 或 nullable 时 `TEXT CHECK(col IS NULL OR json_valid(col))`——SQLite 不会因为列类型名是 JSON 就自动校验。
7. **`audit_event` 是 append-only**：用 SQLite trigger 拒绝 UPDATE / DELETE（schema 见上文）。这给 EF rebind 等历史变更提供 audit 不可篡改保证。

### 单位与换算

继承 Seneca AERA 已经落地的"表驱动单位换算"设计（`emission_factor_report_data_unit` 表 + `multiply_of_ratio / divide_of_ratio` 字段，覆盖 ~180 个单位 11+ family），但补 AERA 三个空白：

1. **中文 / 本地化 alias**：AERA 不支持。国内电费单写"度"（=kWh）、燃气写"立方米"（=m³），AI 解析单据 + 用户手填都要能识别这些 alias 归一化。
2. **跨 family 转换 via 燃料密度**：AERA 不支持。柴油用户输 100 升而 EF 是 kg-base，service 层要查 `fuel_property` 拿密度做转换。
3. **维度校验**：AERA 不强制。允许过 `kg-km` 这种乱拼复合单位。我们用 family 标签 + 写入前 dimension check 拒绝。

#### `unit_definition` 表（reference 数据，随 ef_library.sqlite 一起 readonly 发版）

```sql
CREATE TABLE unit_definition (
  unit              TEXT PRIMARY KEY,         -- 'kWh' | 'L' | 'kg' | 'tonne_km' | ...
  family            TEXT NOT NULL,            -- 'energy' | 'mass' | 'volume' | 'distance' | 'area' | 'time' | 'currency' | 'tonne_km' | 'count' | 'data' | ...
  -- 转换公式：base_value = input * multiply_of_ratio / divide_of_ratio
  -- family 内的 base unit (multiply=1, divide=1) 是该 family 的归一化单位
  multiply_of_ratio REAL NOT NULL,
  divide_of_ratio   REAL NOT NULL,
  display_order     INTEGER NOT NULL DEFAULT 100,
  display_name_zh   TEXT,
  display_name_en   TEXT
);
CREATE INDEX idx_unit_family ON unit_definition(family, display_order);
```

v1 内置 catalog (~180 单位)：

| Family | base unit | 常见单位 | AERA 是否覆盖 |
|---|---|---|---|
| `energy` | `kWh` | `kWh`, `MWh`, `GWh`, `J`, `kJ`, `MJ`, `GJ`, `TJ`, `kcal`, `therm`, `MMBTU` | ✅ |
| `mass` | `kg` | `kg`, `g`, `t`/`tonne`, `lb`, `short_ton` (注意 AERA 老 typo `shout ton` 已修) | ✅ |
| `volume` | `L` | `mL`, `L`, `m³`, `gal_us`, `gal_uk`, `bbl`, `scf` | ✅ |
| `distance` | `km` | `m`, `km`, `mi`, `nmi`, `ft` | ✅ |
| `area` | `m²` | `m²`, `km²`, `ha`, `ft²` | ✅ |
| `time` | `hour` | `s`, `min`, `hour`, `day`, `year`, `month` | ✅ |
| `currency` | —— | `CNY`, `USD`, `EUR`, `GBP`, `JPY`, `HKD` | ⚠️ AERA 用 fallback 汇率，**carbonbook v1 不自动换汇率**（见下） |
| `tonne_km` (复合) | `tonne_km` | `tonne_km`, `kg_km`, `tonne_mi`, `lb_mi` | ✅ |
| `passenger_km` | `passenger_km` | `passenger_km`, `passenger_mi` | ✅ |
| `data` | `GB` | `MB`, `GB`, `TB` | ✅ |
| `count` | `count` | `count` (无量纲) | ✅ |

#### `unit_alias` 表（中文 / 本地化别名，AERA 没做）

```sql
CREATE TABLE unit_alias (
  alias        TEXT PRIMARY KEY,           -- '度' | '立方米' | '公斤' | ...
  canonical_unit TEXT NOT NULL REFERENCES unit_definition(unit),
  language     TEXT NOT NULL,              -- 'zh' | 'en' | 'ja' | ...
  notes        TEXT
);
CREATE INDEX idx_unit_alias_canonical ON unit_alias(canonical_unit);
```

v1 内置示例：

| alias | canonical_unit | 语言 |
|---|---|---|
| `度`, `千瓦时`, `kw·h`, `kW⋅h`, `kwh` | `kWh` | zh / en（大小写） |
| `立方米`, `m3`, `m^3` | `m³` | zh / en |
| `公斤`, `千克` | `kg` | zh |
| `吨`, `公吨` | `t` | zh |
| `升` | `L` | zh |
| `公里` | `km` | zh |
| `美元`, `元` | `CNY` / `USD`（按上下文，需 prompt 消歧） | zh |

AI 解析单据时（§4 pipeline）prompt 把 canonical 列表 + 常见 alias 都喂给模型，让它输出 canonical；用户手填 UI 也接受 alias，service 层归一化。

#### `fuel_property` 表（cross-family 转换，AERA 没做）

```sql
CREATE TABLE fuel_property (
  fuel_code              TEXT PRIMARY KEY,            -- 'diesel' | 'gasoline' | 'natural_gas' | 'lpg' | 'coal_anthracite' | ...
  density_kg_per_L       REAL,                        -- 体积↔质量
  density_kg_per_m3      REAL,                        -- 气体常用
  lower_heating_value_MJ_per_kg REAL,                  -- 质量↔能量 (LHV)
  lower_heating_value_MJ_per_m3 REAL,                  -- 气体能量
  source                 TEXT NOT NULL,               -- 'IPCC_2006' | 'GB_T_213' | 'DEFRA_2024' | ...
  notes                  TEXT
);
```

v1 内置常见燃料 ~15-20 种（柴油 / 汽油 / 天然气 / LPG / 煤等）。当用户输 `100 L 柴油` 而 EF 是 `kg base` 时：

```
service 层流程：
  1. activity unit = 'L' (family=volume)
  2. EF input_unit = 'kg' (family=mass)
  3. family 不匹配 → 查 emission_source.fuel_code (用户在 onboarding 选)
  4. 查 fuel_property[fuel_code='diesel'] → density_kg_per_L=0.832
  5. converted_amount = 100 * 0.832 = 83.2 kg
  6. CO2e = 83.2 * EF.co2e_kg_per_unit
```

如果 source 没绑 fuel_code（如非燃料类排放），cross-family 转换直接抛 dimension mismatch 错误，UI 提示用户改单位或选不同 EF。

#### Service-layer 换算流程

```
write activity_data 时：
  1. user_unit = 输入或 alias 归一化后的 canonical
     (lookup unit_alias 把 '度' → 'kWh')
  2. (user_family, user_factors) = unit_definition[user_unit]
  3. (ef_family, ef_factors) = unit_definition[EF.input_unit]
  4. if user_family == ef_family:
       converted = amount * (user.multiply / user.divide) / (ef.multiply / ef.divide)
  5. elif fuel_code is bound and (user_family, ef_family) ∈ {(volume, mass), (volume, energy), (mass, energy)}:
       走 fuel_property 查表，三步换算
  6. else:
       throw DimensionMismatchError({ user_unit, ef_input_unit, fuel_code? })
  7. computed_co2e_kg = converted * EF.co2e_kg_per_unit
  8. 落 activity_data：原始 amount + user_unit
  9. 落 calculation_snapshot_line（freeze 时）：原始 amount + user_unit + converted_amount + ef_input_unit
```

**货币不自动换算**（与 AERA 不同）：spend-based EF 必须按报告期年度的官方汇率显式输入。汇率随时间漂移，自动换会导致历史报告不可复现。用户的活动数据 amount 直接用 EF 期望的 currency；不一致就抛错。Phase 1.5 起考虑加"按报告期 freeze 当时汇率"机制。

#### EF 候选筛选（与 §4 EFMatcher 联动）

EF 候选给用户选时，按 `unit_definition[EF.input_unit].family` 过滤掉 family 不兼容的（除非 emission_source 已绑 fuel_code 且能跨 family）。UI 上 disable 不兼容选项 + tooltip 解释。

#### v1 不做

- 用户自定义新单位 / family（要扩展 ef_library.sqlite snapshot 才支持）
- 复合单位代数生成（继承 AERA 硬编码 list；动态生成 `lb-nmi` 类组合留 v2）
- 跨年度货币历史汇率自动 freeze（v1.5）
- 单位精度 / 有效数字声明（v1 一律 IEEE 754 double / SQLite REAL）

#### 从 AERA 学到的具体教训

| AERA 教训 | carbonbook 应对 |
|---|---|
| `'shout ton'` 入库 typo（migration 后才修） | EF 库发版前 CI 跑 unit catalog 校验：每个 unit 必须 ∈ ISO/IEC 80000 常见名 + alias 拼写 lint |
| 没有 dimension check，允许 `kg + km` 这种乱拼 | service 层强制 family 校验 + UI EF 候选按 family 筛选 |
| 没有中文 alias，国内用户输入摩擦 | `unit_alias` 表 + AI prompt 含 alias 列表 |
| 没有 fuel density，跨 family 转换缺位 | `fuel_property` 表 + emission_source 绑 fuel_code |
| 货币用 fallback 汇率自动换，可能误导 | v1 不自动换；`currency` family 内强校验 user_unit == EF.input_unit |

---

## §4. AI Pipeline（可插拔 stages）

### 设计原则

1. **多步流水线，不做一锅端**：`分类 → 抽取 → 校验 → 映射 → 计算` 五步，每步单独 prompt 单独 schema。
2. **永远人审**：AI 抽取结果默认状态 `review_needed`，用户点 "Confirm" 才落到 `activity_data`。AI 是数据工程师，不是数据决策者。
3. **Prompt 跟着 schema 走版本号**：`prompt_version="2026-05.bill_v1"`，对应 `extraction.parsed_json` 的 zod schema 版本。
4. **流式输出 + 进度可见**：长 PDF / 多页 Excel 的抽取通过 pi-ai stream，Renderer 通过 `ipcRenderer.on('extraction:progress', ...)` 订阅 main 端 `webContents.send` 推送的 token / 进度事件（不走 invoke 通道）。
5. **缓存命中 `(document.sha256, prompt_version, llm_model)`**：相同文件 + 相同 prompt + 相同模型，直接复用上一次 `extraction.parsed_json`。

### 双轴抽象（不要混淆）

| 轴 | 抽象层 | 替换粒度 |
|---|---|---|
| **LLM Provider** | pi-ai + 自家 `LLMClient` | 用户在设置里切：Azure OpenAI / Claude / DeepSeek / OAuth / OpenAI-compat |
| **Pipeline Stage Backend** | Stage Registry | 每个 stage 独立 swappable，比如换掉文档解析器 |

这两轴正交：换 OCR 后端不影响 LLM 选择，反之亦然。

### Stage 接口定义

```ts
// src/main/pipeline/types.ts

interface DocumentLoader {
  readonly name: string;                          // 'pdf-parse' | 'tesseract' | 'llm-vision' | 'llama-parse' | ...
  readonly capabilities: {
    mimeTypes: string[];
    supportsOCR: boolean;
    supportsTables: boolean;
    requiresNetwork: boolean;
    costPerPageUSD?: number;
  };
  load(input: LoaderInput): Promise<NormalizedDocument>;
}

interface NormalizedDocument {
  pages: NormalizedPage[];
  metadata: { totalPages: number; language?: string; sourceMime: string };
}
interface NormalizedPage {
  index: number;
  text?: string;
  tables?: Table[];
  layout?: BBox[];
  imageDescription?: string;
}

interface DocumentClassifier {
  readonly name: string;
  classify(doc: NormalizedDocument): Promise<{ docType: DocType; confidence: number }>;
}

interface StructuredExtractor<T> {
  readonly name: string;
  readonly supportedDocTypes: DocType[];
  extract(doc: NormalizedDocument, schema: ZodSchema<T>): Promise<{ parsed: T; cost: Cost }>;
}

interface EFMatcher {
  readonly name: string;
  match(activity: ActivityClue): Promise<EFCandidate[]>;
}

interface AnswerGenerator {
  readonly name: string;
  generate(input: AnswerGenInput): Promise<{ answer: string; cost: Cost }>;
}
```

### 注册与编排

```ts
// 启动时注册 v1 默认实现
registry.registerLoader(new PdfParseLoader());      // 文本 PDF（免费、本地）
registry.registerLoader(new TesseractLoader());     // OCR（本地）
registry.registerLoader(new LlmVisionLoader(llm));  // vision LLM（BYOT）
// 未来：LlamaParse / MistralOcr / Docling / Reducto

// Pipeline 编排是配置驱动
type PipelineConfig = {
  documentLoader: { backend: string | 'auto' };
  classifier:     { backend: string };
  extractor:      { backend: string };
  efMatcher:      { backend: string };
  answerGen:      { backend: string };
};

async function runInventoryPipeline(doc: Document, cfg: PipelineConfig) {
  const loader     = registry.resolveLoader(doc.mimeType, cfg.documentLoader.backend);
  const norm       = await loader.load({ path: doc.path, ... });
  const { docType }= await registry.resolveClassifier(cfg.classifier.backend).classify(norm);
  const extractor  = registry.resolveExtractor(cfg.extractor.backend, docType);
  const { parsed } = await extractor.extract(norm, schemaFor(docType));
  const candidates = await registry.resolveEFMatcher(cfg.efMatcher.backend).match(parsed);
  return { extraction: parsed, efCandidates: candidates };
}
```

### v1 默认 backends

| Stage | v1 默认 | 备选（v1 内置可切） | 未来可加 |
|---|---|---|---|
| DocumentLoader | `auto`（pdf-parse 优先 → 失败 fallback Tesseract → 必要时 llm-vision） | `pdf-parse` / `tesseract` / `llm-vision` | `llama-parse` / `mistral-ocr` / `docling` / `reducto` |
| Classifier | `llm-cheap`（DeepSeek/Qwen） | `rule-based`（关键字 + 文件名） | embedding-similarity |
| Extractor | `llm-strong`（Claude/GPT-5） | `template-based`（针对国网电费单等高度结构化文档） | structured-output models |
| EFMatcher | `fts-plus-llm`（SQLite FTS 召回 → LLM 排序） | `fts-only`（无 LLM 兜底） | `embedding-similarity` |
| AnswerGenerator | `llm-strong` | `data-binding`（mapping 直读，不过 LLM） | —— |

### LLMClient 抽象（pi-ai 之上的薄壳）

```ts
// src/main/llm/client.ts
interface LLMClient {
  extract<T>(opts: {
    promptVersion: string;
    schema: ZodSchema<T>;
    input: { text?: string; images?: Buffer[]; files?: Buffer[] };
    providerHint?: 'cheap' | 'strong' | 'vision';
    onProgress?: (event: 'start' | 'token' | 'done') => void;
  }): Promise<{ parsed: T; cost_usd: number; provider: string; model: string }>;

  stream<T>(opts: { /* 同上 */ }): AsyncIterable<StreamEvent<T>>;

  configureProviders(chain: ProviderConfig[]): void;
}
```

`providerHint` 三档：
- `cheap` → DeepSeek / Qwen（分类、信号题）
- `strong` → Claude Sonnet / GPT-5（结构化抽取、长文档）
- `vision` → Claude / GPT-4o（OCR 图片、扫描件）

### 三模 AI 认证

| 模式 | 配置 | 客户场景 | 状态 |
|---|---|---|---|
| **A. BYOT API Key**（v1 主路） | 用户在设置里粘贴 key（OpenAI / Anthropic / Azure OpenAI / DeepSeek / Qwen / 任何 OpenAI 兼容 URL） | 默认；ESG 经理自己开账号付 API 账单 | ✅ stable |
| **B. OAuth Provider Login**（实验性，按 provider 公开支持情况开放） | 用户通过 OAuth 登录已支持的 provider，例如 Anthropic Console OAuth、Google Vertex AI Application Default Credentials、GitHub Copilot SDK preview。**不是直接复用 ChatGPT Plus / Claude Pro 这种消费者订阅做 API 调用**——那条路在大多数 provider 不被官方支持。 | 已有 Console / Cloud / Copilot OAuth 凭证的用户；具体可用性随 pi-ai 上游适配 | ⚠️ experimental |
| **C. Self-hosted / OpenAI-compat endpoint**（v1 企业主路） | 用户填 OpenAI-compatible URL（公司内部 Azure OpenAI 部署 / Ollama / vLLM / DeepSeek 自建） | 数据合规严的大客户、集团供应商 | ✅ stable |

### Prompt 库结构

```
src/main/llm/prompts/
├── classify.v1.ts                # 文档类型分类
├── extract.china_utility.v1.ts   # 国内电费单/水气费
├── extract.fuel_receipt.v1.ts    # 加油站发票
├── extract.freight_invoice.v1.ts # 物流单据
├── extract.po_bom.v1.ts          # 采购订单/BOM
├── extract.travel_expense.v1.ts  # 差旅
├── extract.questionnaire.v1.ts   # 问卷整体解析
├── map.question_to_inventory.v1.ts # 问题→clipboard映射
├── suggest.ef_candidates.v1.ts   # 给定活动量，建议 EF top-3
├── generate.answer.v1.ts         # 给定问题 + 数据，生成答案文本
└── _shared/                      # 共享 system prompts、JSON schema 描述
```

每个 prompt 文件导出：`{ version, systemPrompt, userPromptTemplate, outputSchema (zod) }`。

### 关键质量保障

| 风险 | 缓解 |
|---|---|
| AI 抽错单位（"5000 kWh" 看成 "5000 W·h"） | zod schema 内置 `enum` 单位列表 + 数值范围合理性 + UI 表单二次校对 |
| AI 编造 EF（hallucinate factor_code） | EF 候选只能从 emission_factor 表 query 出来，AI 仅做"在候选里挑 + 排序"，不允许自由生成 factor_code |
| 长 PDF 超 context window | Main 端预切片（按页/按表），分段抽取 → 合并 |
| 跨页拆分电费表头丢失 | 抽取时把"前 1 页 + 当前页"一起喂给 AI，重叠抽取 |
| Provider 突然拒绝 / rate limit | LLMClient 内置 fallback chain：primary 失败立即切 secondary |
| 用户重复上传同文件 | sha256 命中 → 直接复用 extraction，0 成本 |
| 用户改了 prompt（升 prompt_version） | 旧 extraction 保留；UI 显示"当前 prompt v2，此抽取来自 v1，可一键重抽" |

### 用户在哪里看到这些

`Settings → Advanced → Pipeline backends`（默认隐藏）：
- 普通用户：只看到 LLM provider 设置
- 高级用户：能切换每个 stage 的 backend

### 故意不抽象的层

| 不做 plugin | 理由 |
|---|---|
| 文件 ingest（sha256、FS 落地） | 没人会想换 sha256；FS 路径是约定 |
| Schema 校验（zod） | zod 是事实标准 |
| 计算 CO2e（amount × EF coefficient） | 是纯算术 |
| 单位换算 | 内置常量表足够 |

### v1 不做

- Fine-tune / RAG / 向量 DB
- Agent 多轮自决
- 多模态合并（同时上传 PDF + Excel + 图片让 AI 一锅端）

---

## §5. 算这一侧 — Inventory + ISO 14064-1 报告

### 用户旅程

```
第一次打开 app
      │
      ▼
┌──────────────────────────────────────────────────┐
│ 1. Onboarding Wizard（≤ 5 步）                    │
│   ① 公司基本信息（名称、所在地、行业）            │
│   ② 报告年度（默认 2025）+ GHG Protocol 版本（AR6）│
│   ③ 组织边界（Equity Share / Operational Control）│
│   ④ 添加 Site（首个 site 必填）                   │
│   ⑤ AI Provider 配置（BYOT key / OpenAI-compat │
│      endpoint；OAuth provider 视支持情况开放）   │
└──────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────┐
│ 2. Emission Source 目录                          │
│   - 系统预置常见 source（按行业 template 推荐）   │
│   - 用户勾选 + 可加自定义                          │
│   - 每个 source 标 scope/category，绑常用 EF 范围 │
└──────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────┐
│ 3. Activity Data 录入（三种入口并行）             │
│   ① "扔单据" — 拖文件进 Inbox，跑 §4 pipeline     │
│   ② "粘 Excel" — 直接粘 ESG 经理已有的 Excel      │
│   ③ "手填" — 单条快速录入（应急）                 │
└──────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────┐
│ 4. Inventory Dashboard                           │
│   - 按 Scope/Category 实时聚合 CO2e               │
│   - 数据质量信号（覆盖率、AI confidence、缺口）   │
│   - 同比/环比（≥2 年时）                          │
└──────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────┐
│ 5. "Generate Report" 一键产出                    │
│   - 选 reporting_period + 标准（ISO 14064-1）     │
│   - 系统冻结成 calculation_snapshot               │
│   - 输出 PDF + Excel 底表                         │
└──────────────────────────────────────────────────┘
```

### 行业模板预置

v1 内置 5 个行业 template：纺织/服装、电子/3C、塑料/化工、金属机械、家居/玩具。每个 template 列 ~15-25 个常见 emission_source（如 "外购电力（华东电网）"、"柴油叉车"、"压缩空气泄漏 R-22"、"原料钢材采购"）。用户勾选 + 删除 + 自定义。

### `default_ef_query` 例子

```json
{
  "factor_code_pattern": "electricity.grid.china.guangdong",
  "year": "$reporting_year",
  "source_priority": ["oecc", "iea"],
  "geography": "CN-44"
}
```

Pipeline 抽到一笔 activity data 时，先 query EF 候选 → 命中默认条件 → 自动绑 → confidence ≥ 阈值时跳过人审 EF 选择。

### 计算引擎

**触发时机**：实时增量。
- 写 / 改 `activity_data` 行时，立即 (re)compute `computed_co2e_kg`
- EF 库版本更新（季度 snapshot 拉下来）时**不**自动重算（保持历史可复现）；UI 显示"x 条数据可用更新版 EF 重算"，用户主动点

**聚合层级**：
```
activity_data (raw rows)
   ↓ SUM by reporting_period × scope × category
period_summary (view)
   ↓ SUM by reporting_period × scope
scope_summary (view)
   ↓ SUM by reporting_period
total_period_emissions (view)
```

不存 view 物化（SQLite 数据量级足够直接 query），但 `Generate Report` 时冻结成 `calculation_snapshot`。冻结后 calc_snapshot 不可改；要更新报告 = 新建 snapshot（带 `revision` 字段 + 父 snapshot id）。

### ISO 14064-1 风格报告内容

输出**两份文件**（一次生成）：

**A. 报告 PDF（zh + en 双语版双开）**

| Section | 内容 |
|---|---|
| Cover | 公司名 / 报告期 / 标准声明 / 报告日期 / 签字人位 |
| 1. 概述 | 公司简介、报告范围、组织边界（Operational Control 声明） |
| 2. 方法学 | GHG Protocol Corporate Standard + ISO 14064-1:2018 + GWP basis (AR6) |
| 3. 边界与排放源清单 | Site 列表 + emission_source 清单（按 Scope 分组） |
| 4. 排放数据 Summary | Scope 1 / 2 (location + market) / 3 (按 category) 总量 + 占比饼图 + 同比柱图 |
| 5. 数据来源与 EF | 用到的 EF 列表（factor_code, year, source, dataset_version） |
| 6. 数据质量 | 各 source 的活动数据覆盖率、人审比例、AI 抽取占比 |
| 7. 不确定性 | 定性说明（v1 不做定量蒙特卡洛） |
| 8. 减排倡议（占位） | 用户自填或留空 |
| 9. 声明与签字 | 自我声明本报告符合 ISO 14064-1 第 9 章关于"自我披露"的要求；签字栏 |

**B. Excel 数据底表（审计 / 大客户复核用）**

| Sheet | 内容 |
|---|---|
| `00_Summary` | 三 Scope 总览 + 同比 |
| `01_ActivityData` | 当时纳入计算的所有 activity_data 行（含 EF 复合 PK 5 字段） |
| `02_EmissionFactors` | 用到的 EF 全表（含 citation_url） |
| `03_Methodology` | 边界、GWP、计算公式 |
| `04_DataQuality` | 覆盖率、缺失项、人审记录 |

### 双语报告实现

- 报告模板用 `react-pdf`（renderer 端）渲染，i18n 用 Paraglide
- 用户在生成时选语言：`zh-only` / `en-only` / `bilingual`（双语两栏左右排版）
- 数据字段（公司名、source 名）支持双语字段：`name_zh` + `name_en`

### v1 不做

- 第三方核证 / Verification statement
- 定量不确定性分析（蒙特卡洛、Pedigree matrix）
- Biogenic CO2 / 碳移除
- 多版本 GHG Protocol（只支持 AR6 GWP）
- 报告里的"减排路径 / SBTi 目标"

---

## §6. 填这一侧 — 客户问卷

### 用户旅程

```
1. 用户拖入客户问卷文件 (Excel / PDF / 邮件附件)
        │
        ▼
2. New Questionnaire Wizard
   ① 选客户（已有 / 新建）
   ② 报告期（默认本年）
   ③ 客户希望的截止日期
   ④ 模板识别（AI 推断）
        │
        ▼
3. 文档走 §4 pipeline (extract.questionnaire)
   → 抽出所有 questions
   → 计算 question_signature
   → 标 question_kind: numerical/categorical/narrative
        │
        ▼
4. Auto-mapping
   - 对每题：query 该 customer 的 question_mapping 表
   - 命中（同客户同 signature 历史）→ 直接复用，confidence=1.0
   - 未命中 → AI 提议 mapping（top-3 候选 + confidence）
        │
        ▼
5. Mapping Review UI（左 question / 右 mapping 候选）
   - 高 confidence (≥0.85) 默认勾选
   - 低 confidence 用户必选
   - 用户修正 → 写回 question_mapping
        │
        ▼
6. Answer Generation
   - numerical/categorical：mapping → 直接读 inventory / profile
   - narrative：AI 用 company_profile + 上次同类答案 + 当前 inventory 起草
        │
        ▼
7. Answer Review UI
   - 每题展开：题面 / 答案 / 数据来源 / 编辑框
   - "数据来源"显示具体 activity_data row id 或 calc_snapshot id
        │
        ▼
8. Export
   - Excel 模板：写回原文件原单元格
   - PDF：生成填好答案的副本 PDF
   - 通用结构化（CDP）：导出符合 CDP 平台导入格式的 JSON/CSV
```

### 三种 question_kind 的不同处理

| Kind | 来源 | AI 角色 | 风险 |
|---|---|---|---|
| **numerical / data** | activity_data / calc_snapshot 查询 | 仅做单位转换 + 格式化 | 低（数据是用户已审过的） |
| **categorical** (yes/no, 选项) | company_profile / user_setting / 历史答题 | 给候选 + 解释 | 中（不能编造，必须有 source） |
| **narrative**（开放题） | company_profile.narrative_bank + AI 起草 | 起草，标 `[draft]` 标签，用户必审 | 高（最容易 hallucinate，永远人审） |

### Mapping 复用的两层命中

```
   新问卷 question
         │
         ▼ 算 question_signature
         │
   ┌─────┴──────────────────────────────────┐
   │                                         │
   ▼ Tier 1                                  ▼ Tier 2
查 question_mapping 表                    若 Tier 1 miss
  WHERE customer_id = X                   AI 抽语义找 inventory_path
  AND signature = Y                       confidence ≤ 阈值时
  → hit: 复用历史 mapping                 mark 'review_needed'
  → confidence = 1.0
```

跨客户通过 question_signature 命中（不只同客户内）——不同客户问到同一题面也能复用。

### 同一客户跨年度的"问卷 diff"

第二年同客户再来问卷时：
- 大部分 question_signature 命中历史 mapping → auto-fill
- UI 高亮"今年新增 / 今年删除 / 题面变化"的题
- 实际让客户感知：**第一次填一份问卷 5 天，第二次同客户 30 分钟**

### 跨客户的"问卷库"积累节奏

| 时点 | 内部资产 |
|---|---|
| 装上 carbonbook 第一周 | 0 mapping，全靠 AI 兜底 + 人审 |
| 填第 3 个客户问卷 | ~30% 题命中 question_signature |
| 用满一年（5-10 个客户问卷） | 60-80% 命中，narrative_bank 沉淀完整 |

### 输出格式

| 客户问卷格式 | v1 输出 |
|---|---|
| Excel（多 sheet 表单） | 写回原 .xlsx 文件原单元格；保留客户的样式/合并/批注 |
| PDF（可填写表单 / acroform） | 用 `pdf-lib` 填回 form fields |
| PDF（纯扫描 / 不可填） | 生成新 PDF：左边贴原始题面截图，右边渲染答案 |
| CDP supplier（结构化） | 导出符合 CDP Online Response System 导入格式的 JSON |
| 通用未识别 | Excel 答案表 + PDF 摘要双件齐发 |

### v1 不做

- 实时与客户 ESG 平台双向同步（CDP API、EcoVadis API、Apple SCEP API 自动提交）—— v2 再考虑
- AI agent 自己把问卷 deadline 加到日历 / 自动提醒
- 多人协作填同一问卷
- 问卷比对（"对比客户 A 的问卷答案 vs 客户 B 的"用于一致性检查）

---

## §7. CBAM Add-on 模块

> **状态：v1.1 设计附录（v1.0 不发布此模块）**
>
> 本章节是 CBAM Add-on 的完整设计预案。CBAM 模块在 v1.0 GA 之后启动，前提是已找到 1-2 个 CBAM 行业 design partner 验证。v1.0 的 license / UI / commercial 不含 CBAM。详见 §10 License Model 与 §11 v1.1 backlog。

### 范围 & 商业定位

只对 6 行业生效（钢铁 / 铝 / 水泥 / 化肥 / 电力 / 氢）。**License 单独购买**（$2-5k/年），主 license 没买这个 module 时整个 CBAM 入口 hidden。

商业故事极硬：**CBAM 2026 年 1 月正式收费**，错报 / 漏报 €10-50/吨 CO2 罚款 + 客户信任损失。

### 与基础 inventory 的关系

CBAM 不是"另起炉灶"——绝大多数 activity_data + emission_factor 复用 §3 的基础模型。CBAM 模块在上面**叠一层 product / installation / process 视角**：

```
基础 inventory                    CBAM 视角 (overlay)
─────────────                    ──────────────────
organization                      ─
   │
   ▼
   site ◄────────────────────────  cbam_installation (1:1 或 1:N)
   │
   ▼
   emission_source ◄─────────────  cbam_source_stream
                                       │
                                       │ N
                                       ▼ 1
                                   cbam_process (生产一种 cbam_product)
                                       │
                                       │ N
                                       ▼ 1
                                   cbam_product (绑 CN code)
```

**铁律**：activity_data 不复制。CBAM source_stream 引用同一笔 activity_data；只是聚合 / 算法不同。

### 数据模型（CBAM 专属表）

```sql
CREATE TABLE cbam_installation (
  id                TEXT PRIMARY KEY,
  site_id           TEXT NOT NULL REFERENCES site(id),
  cbam_registry_id  TEXT,
  country_code      TEXT NOT NULL,                 -- 'CN'
  precise_address   TEXT NOT NULL,
  contact_person    TEXT NOT NULL,
  unlocode          TEXT
);

CREATE TABLE cbam_product (
  id            TEXT PRIMARY KEY,
  cn_code       TEXT NOT NULL,                     -- 8 位 CN code, e.g. '72162100'
  description   TEXT NOT NULL,
  cn_sector     TEXT NOT NULL,                     -- 'iron_steel' | 'aluminium' | 'cement' | 'fertiliser' | 'electricity' | 'hydrogen'
  unit          TEXT NOT NULL                      -- 通常 'tonne'
);

CREATE TABLE cbam_process (
  id                  TEXT PRIMARY KEY,
  installation_id     TEXT NOT NULL REFERENCES cbam_installation(id),
  product_id          TEXT NOT NULL REFERENCES cbam_product(id),
  reporting_period_id TEXT NOT NULL REFERENCES reporting_period(id),
  output_quantity     REAL NOT NULL,
  output_unit         TEXT NOT NULL,
  methodology         TEXT NOT NULL                -- 'measured' | 'default' | 'hybrid'
);

CREATE TABLE cbam_source_stream (
  id                TEXT PRIMARY KEY,
  process_id        TEXT NOT NULL REFERENCES cbam_process(id),
  emission_source_id TEXT REFERENCES emission_source(id),
  stream_kind       TEXT NOT NULL,                          -- 'fuel' | 'process' | 'electricity' | 'heat_steam' | 'precursor'
  monitoring_method TEXT NOT NULL,                          -- 'CRT_M1' | 'CRT_M2' | 'CRT_default'
  -- coarse-grained allocation：emission_source 整体按比例归这条 stream
  allocation_share  REAL DEFAULT 1.0
);

-- 行级分配表（v1.1 必备）：CBAM 计算需要把具体 activity_data 行按 share 分配给 stream
-- 这保留"activity_data 不复制"的铁律（§7 原则），同时让分配做到 row 级精度
-- 一个 activity_data 可以被多个 stream 引用（不同 share），一条 stream 也能引用多笔 activity_data
CREATE TABLE cbam_source_stream_activity (
  stream_id         TEXT NOT NULL REFERENCES cbam_source_stream(id),
  activity_data_id  TEXT NOT NULL REFERENCES activity_data(id),
  allocation_share  REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (stream_id, activity_data_id)
);

CREATE TABLE cbam_embedded_emissions (
  process_id          TEXT NOT NULL REFERENCES cbam_process(id),
  reporting_period_id TEXT NOT NULL REFERENCES reporting_period(id),
  direct_se_kg_per_t  REAL NOT NULL,
  indirect_se_kg_per_t REAL NOT NULL,
  precursor_se_kg_per_t REAL,
  total_se_kg_per_t   REAL NOT NULL,
  methodology         TEXT NOT NULL,
  used_default        INTEGER NOT NULL,
  computed_at         TEXT NOT NULL,
  PRIMARY KEY (process_id, reporting_period_id)
);
```

### CBAM 计算引擎

```
针对每个 cbam_process × reporting_period:

  direct emissions   = Σ (cbam_source_stream where kind ∈ {'fuel','process'})
                         × allocation_share
                         × computed_co2e_kg from base activity_data
  indirect emissions = Σ (cbam_source_stream where kind = 'electricity')
                         × allocation_share
                         × computed_co2e_kg
  precursor          = (manual input or imported supplier PCF)

  direct_se_kg_per_t   = direct emissions / output_quantity
  indirect_se_kg_per_t = indirect emissions / output_quantity
  total_se_kg_per_t    = direct_se + indirect_se + precursor_se
```

整个公式 < 50 行 TS 代码，存 `src/main/services/cbam-calculator.ts`。

### CBAM Quarterly Report XML 输出

- 内置 EU 官方 XSD（CBAM Implementing Regulation 附件）
- 用 `xmlbuilder2` 生成 XML
- 内置 XSD 校验
- 输出文件：`cbam-quarterly-{period}-{org_id}.xml`
- 同时输出"人类可读"PDF Summary

### CBAM 模块独立 UI 入口

侧边栏顶部 toggle："Inventory" / "Questionnaires" / **"CBAM"**（仅 license 激活时显示）。

### Pricing 三档

| 档 | $2,000 | $3,500 | $5,000 |
|---|---|---|---|
| Installations 数量 | 1 | 3 | unlimited |
| Products 数量 | 5 | 20 | unlimited |
| Quarterly XML 导出 | ✅ | ✅ | ✅ |
| Verification 准备包 | —— | ✅ | ✅ |
| Precursor 上游 PCF 数据库 | —— | ✅ | ✅ |
| 优先 email support | —— | —— | ✅ |

### v1.1 MVP 不做（§7 本身是 v1.1 范畴；以下是 v1.1 内部进一步收紧的边界）

- CBAM Registry 直连 API
- Verification statement 自动生成
- CBAM 配额 / fee 估算
- Mass balance M3/M4 监测方法
- CBAM 上游 precursor 自动追溯（v1.1 MVP 让用户手填）

---

## §8. EF 库管理

### 双层架构

```
开发者侧（私有，作者维护）              客户侧（每台 carbonbook）
─────────────────────────             ──────────────────────────
carbonbook-ef-source repo             ef_library.sqlite (readonly, 随 app)
   │                                       ▲
   ├─ crawlers/      （各权威源爬虫）        │
   ├─ normalize/     （归一化到统一 schema）  │
   ├─ validate/      （校验 + 单元测试）      │
   ├─ build/         （生成 SQLite snapshot）│
   └─ release/       （签名 + 发到 CDN）─────┘
                                        │
                               carbonbook-cloud
                               (Cloudflare R2)
                               • ef_library_v2026.q3.sqlite
                               • manifest.json
                               • signature.bin
```

### 开发者侧：`carbonbook-ef-source` 项目

独立 GitHub repo（私有），不在 carbonbook 主 repo 里。

```
carbonbook-ef-source/
├── crawlers/
│   ├── ipcc-ar6.ts          # IPCC AR6 报告附录爬虫
│   ├── defra-ghg.ts         # UK DEFRA Conversion Factors
│   ├── iea-emissions.ts     # IEA Emissions Factors
│   ├── oecc-china-grid.ts   # 生态环境部省级电网
│   ├── exiobase.ts          # EXIOBASE spend-based EF
│   ├── glec-freight.ts      # GLEC v3.0 货运 EF
│   └── eu-cbam-default.ts   # CBAM 官方 default values
├── normalize/
│   ├── unit-mapping.ts
│   ├── geography.ts
│   └── factor-code.ts
├── validate/
│   ├── unit-sanity.ts
│   ├── completeness.ts
│   ├── citation-check.ts
│   └── coverage.ts
├── build/
│   └── snapshot.ts
├── release/
│   ├── sign.ts              # Ed25519 签名（私钥本地，不入 repo）
│   └── publish.ts
└── tests/                   # CI：每次 push 跑全套校验
```

### EF 库覆盖范围（v1 基线 ~670 条）

| 类别 | 数据源 | 条目数 |
|---|---|---|
| Scope 1 燃料 combustion | IPCC AR6 + 国标 | ~40 |
| Scope 1 制冷剂 GWP | IPCC AR5 & AR6 | ~30 |
| Scope 2 中国省级电网 | 生态环境部 OECC | ~200 |
| Scope 2 国家电网 | IEA Emissions Factors | ~150 |
| Scope 3 Cat 1 spend-based | EXIOBASE + DEFRA | ~80 |
| Scope 3 Cat 1 mass-based | DEFRA Material EF | ~50 |
| Scope 3 Cat 4/9 货运 | DEFRA + GLEC | ~80 |
| Scope 3 Cat 6 差旅 | DEFRA Travel | ~40 |
| **Total** | —— | **~670** |

如果加 stretch (Cat 5 + Cat 7) 再 ~80 条，到 ~750。SQLite 文件 5-10 MB。

### EF Snapshot 发布流程

发布是显式动作，不自动定时。每次发版打 git tag + changelog。

```
开发者本地：
  pnpm run crawl:defra 2025
  pnpm run normalize
  pnpm run validate
  pnpm run build
  → ef_library.sqlite + manifest.json
  pnpm run sign  (本地 Ed25519 私钥)
  → signature.bin
  pnpm run publish v2026.q3
  → 上传 R2 + 调 cloud API 更新 latest pointer
```

### Manifest 格式

```json
{
  "version": "2026.q3",
  "build_timestamp": "2026-08-15T10:00:00Z",
  "sqlite_sha256": "abc123...",
  "total_entries": 678,
  "by_source": {
    "ipcc": 71, "defra": 152, "iea": 154,
    "oecc": 215, "exiobase": 49, "glec": 37
  },
  "by_scope": { "1": 91, "2": 369, "3": 218 },
  "deprecated_factor_codes": ["electricity.grid.france.2020"],
  "added_factor_codes": ["electricity.grid.france.2024"],
  "citations_root": "https://carbonbook.app/citations/2026.q3/",
  "min_app_version": "1.2.0",
  "max_app_version": null,
  "notes_url": "https://carbonbook.app/release-notes/ef-2026.q3"
}
```

`min_app_version` 防止旧 app 拉到不兼容 schema 的 snapshot。

### 客户端：Update 流程

```
1. App 启动后异步检查（节流：每 24h 一次，UI 不阻塞）
   GET https://api.carbonbook.app/ef-library/latest

2. 比对本地 ef_library.sqlite 的 manifest version
   - 相同：no-op
   - 更新：UI 角标 + 一句话："新 EF 库 v2026.q3 可用"

3. 用户点 "Update Library"（默认手动）
   ┌─ 下载 ef_library_v2026.q3.sqlite + signature.bin
   ├─ 验签（嵌入的公钥 vs 签名）
   ├─ 校验 sqlite_sha256
   ├─ 写入 <userData>/ef-snapshots/v2026.q3.sqlite
   ├─ 原子切换 symlink
   └─ Renderer 通过 `ipcRenderer.on('ef-library-updated', ...)` 收到事件

4. 显示 diff
   "+47 added, ~12 updated, -3 deprecated"
   并列出受影响的 activity_data → 一键 rebind 选项
```

### 用户上传自定义 EF

`Settings → EF Library → Custom Factors → ➕`：表单 + AI 辅助按钮（粘贴 PCF 文档 → AI 抽取候选）+ CSV 批量上传 + 范围合理性校验。

用户 EF 存 `app.sqlite`（不是 readonly snapshot），与系统 EF 在查询时 UNION。

### EF Rebind（重绑活动数据到新版）

不自动重算（保护历史可复现），但给 UI 入口：

```
Settings → EF Library → Audit
  Found 19 activity rows pinned to deprecated EFs:
  [✓] 14 rows: DEFRA 2024 → DEFRA 2025
  [ ] 3 rows: OECC 2018 → OECC 2024
  [ ] 2 rows: IPCC AR5 → AR6

  [Rebind selected]  ← 触发：把新版本 EF 复制为新 pinned_emission_factor 行
                       批量改 activity_data 的 FK 指新 pin（原 pin 保留）
                       重算 computed_co2e_kg
                       audit_event 写一条 append-only 日志
```

### 双语 EF 命名

EF 主表 `name_zh` / `name_en` / `description_zh` / `description_en`。Crawler 端按原生语言填，另一语用 AI 翻译批量回填，标 `_translated`。UI 按 Paraglide 当前 locale 选。

### 离线 / 防火墙场景

部分客户 IT 环境屏蔽外网：Settings → "Manual Update File" 用户从 carbonbook.app 下载 zip → 拖入 → 验签流程相同。同时方便 enterprise 内部分发。

### v1 不做

- 主动 push 给客户
- EF 库的私有 fork / 多 channel
- 自动 rebind（永远显式）
- EF 库的 GraphQL 查询 API 给第三方
- LCA 全生命周期级 EF

---

## §9. MCP 服务暴露

### 设计原则

1. **Off by default, opt-in**：默认不开 MCP server。
2. **localhost-only by default**：开启时只 bind `127.0.0.1`，外部网络访问要二次开关 + pairing token。
3. **配对是访问的前提**：未配对客户端对 resources / tools / prompts 一律拒绝（返回 `permission_required`）。配对成功后 Read 权限自动 grant，Write 权限仍需单独 confirm。
4. **Service layer 共享**：MCP tools = service 函数 + 一层 schema 转换。
5. **配对配置一键复制**：UI 提供"copy config"按钮，输出 Claude Desktop / Cursor / Cherry Studio 各自 `mcp.json` 格式。

### 暴露的 MCP 内容（v1）

#### Resources（只读，URI 寻址）

| URI 模式 | 内容 |
|---|---|
| `carbonbook://organization` | 组织 + sites 概览 |
| `carbonbook://emission-sources` | source 目录 |
| `carbonbook://activity-data?period=2025&scope=2` | 按 query 过滤的活动数据 |
| `carbonbook://reports/snapshots` | 历史 calc_snapshot 列表 |
| `carbonbook://reports/{snapshot_id}` | 某次冻结报告 + 元数据 |
| `carbonbook://ef-library?code=electricity.grid.china.*` | EF 库查询 |
| `carbonbook://documents/{id}/extraction` | 文档抽取结果 |
| `carbonbook://questionnaires/{id}` | 问卷状态 + 答案 |

#### Tools（可调用）

| Tool name | 描述 | 写权 |
|---|---|---|
| `query_emissions` | 聚合查询：给定 period / scope / category | RO |
| `lookup_emission_factor` | EF 库查询 | RO |
| `match_question_to_inventory` | 给定题面，AI 找到对应的 inventory 数据路径 | RO |
| `add_activity_data` | 添加一笔活动数据 | **W** |
| `ingest_document` | 投递文件路径到 pipeline | **W** |
| `generate_report` | 触发报告生成 | **W** |
| `freeze_calculation_snapshot` | 冻结当前 inventory 状态为 snapshot | **W** |
| `export_questionnaire_answers` | 导出某问卷的答案到 Excel/PDF | **W** |

#### Prompts（预制）

| Prompt name | 用途 |
|---|---|
| `audit_scope3_coverage` | "审一下我 Scope 3 Cat 1 上一季度的数据完整度" |
| `draft_cfo_summary` | "给 CFO 起草一封邮件，总结 2025 年碳排放" |
| `compare_year_over_year` | "对比 2024 vs 2025 排放变化" |
| `prepare_for_customer_audit` | "客户 X 下周来审，列出所有相关数据" |

### 传输

| Transport | 触发场景 | 启动方式 |
|---|---|---|
| **stdio** | Claude Desktop / Cursor 把 carbonbook 当 MCP server **launch** | 用户 mcp.json 里指向 `carbonbook --mcp-stdio`；headless 模式 |
| **SSE / HTTP localhost** | carbonbook GUI 已运行，外部客户端 connect 进来 | GUI 进程内额外 bind `http://127.0.0.1:7842/mcp` |

### 进程模型（v1）

- **stdio headless 模式**：`carbonbook --mcp-stdio` 直接由 Electron main 进程跑（无 BrowserWindow），MCP SDK 走 stdin/stdout，service layer 直连 `app.sqlite`
- **SSE / HTTP localhost 模式（GUI 运行时）**：MCP server 跑在 Electron `utilityProcess` 子进程里，通过 `MessagePortMain` 与 main 通信调用 service layer。隔离 crash domain（MCP 异常不拖死 GUI）+ 让 better-sqlite3 连接独立池
- 不在 main 进程线程上直接 bind HTTP listener——避免 service layer 的 sync SQLite 调用阻塞 Electron 事件循环
- 用 `utilityProcess` 而不是 `child_process.fork` 是因为 utilityProcess 由 Electron 管理生命周期、自动随 app 退出关闭、原生支持 MessagePort

### 配对 token / 多客户端

- 每个外部 client 第一次连接需要"配对"——GUI 弹通知"Claude Desktop 想连接 carbonbook"
- 配对成功生成 token 存 OS Keychain
- Settings → Integrations 列表显示所有配对客户端 + 最近活动 + Revoke 按钮

### 写操作的 confirm 模式（GUI 运行时）

```
Settings → MCP Server → Write permissions:
  ○ Always ask（每次写操作弹 GUI confirm）
  ○ Per-session（每次启动后第一次写时确认）  ← 默认
  ○ Trusted clients only（只信任配对时勾过 "trust this client" 的）
  ○ Off（拒绝所有写）
```

### Headless stdio 模式的权限规则

当外部工具把 carbonbook 当 MCP server **launch**（即 `carbonbook --mcp-stdio`，没有 GUI 进程在跑）时，权限模型严格收紧——因为没有人类在屏幕前看 confirm 弹窗：

| 场景 | 行为 |
|---|---|
| **无配对历史**（OS Keychain 里没有任何 token） | 启动后所有 MCP 请求一律拒绝——**resources、tools、prompts 全部**返回 `{ permission_required: true, hint: "Open carbonbook GUI to pair this client first" }`。"Read 权限自动 grant"只对**已配对且 trusted 的**客户端生效；未配对就没有 Read。**不允许首次配对走 headless**——首次配对必须 GUI |
| **有配对 token 但未标记 trusted**（"配对成功"≠"信任"） | Headless stdio 仍然拒绝所有 MCP 请求，返回 `{ permission_required: true, hint: "Open carbonbook GUI to use this client" }`。Trusted 标记只能在 GUI 里给（Settings → Integrations → 勾选 "Trust this client"）。GUI 运行 + SSE 连接时，未 trusted 客户端走常规 confirm 弹窗 |
| **有配对 token 且 token 标记 trusted** | 自动启动 read-only：所有 resources + RO tools（`query_emissions` / `lookup_emission_factor` / `match_question_to_inventory`）正常工作 |
| **有配对 token + 写 tool 调用 + GUI 未运行** | 写 tools 一律返回 `{ permission_required: true, hint: "Open carbonbook GUI to confirm write operations" }`。不静默执行 |
| **有配对 token + 写 tool 调用 + GUI 同时运行** | 写 tools IPC 给 GUI 弹 confirm 对话框，与 SSE 模式一致 |

**铁律**：

1. **首次配对永远要 GUI**——防止"用户不知情就被某 AI 工具配对"
2. **Headless 写权限永远依赖 GUI 同时在跑**——不能在没有人类感知下改用户数据
3. **stdio 启动时检查 GUI 进程是否运行**：通过 lock file 或 named pipe 探测；GUI 在 → 写 tools 走 IPC + GUI confirm；GUI 不在 → 写 tools 全部 `permission_required`

这套规则保证 §9 的 "off by default + write confirm" 在 stdio launch 这条非 GUI 路径下依然 meaningful，不被绕过。

### 隐藏的好处

| 好处 | 说明 |
|---|---|
| **AI-native workflow** | 用任何 MCP-capable 工具问"我 Q3 Scope 2 多少"立刻拿答案 |
| **客户问卷新通道** | 客户用 ChatGPT / Cherry Studio，让 AI 直接 query carbonbook 帮答题 |
| **自动化无需写代码** | 用户在 Claude Desktop 用自然语言"每月 1 号生成上月报告" |
| **第三方集成** | 未来某 SaaS 想集成 carbonbook，他们的 AI agent 通过 MCP 接 |

### v1 不做

- **远程 MCP**（不 bind `0.0.0.0`，不上 OAuth）
- **MCP client** 模式（消费外部 MCP 如 QuickBooks/Stripe spend-based Cat 1）
- **Push 通知 / Resource subscription**（v1 复杂度高）
- **MCP 工具的细粒度权限**（v1 粗粒度 RO/W 足够）

---

## §10. 订阅 / License / 更新

### License 模型

```
┌──────────────────────────────────────────────────────────┐
│  Base License ($300-$800/年)                             │
│  features: ["inventory", "questionnaire", "iso14064"]    │
│  devices: 1 active                                       │
│  duration: 1 year                                        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  CBAM Add-on（v1.1 计划，独立 JWT）                       │
│  features: ["cbam"]                                      │
│  tier: "T1" | "T2" | "T3"                                │
│  duration: 1 year                                        │
│  注：v1.0 不签发此 license；以下 schema 为 v1.1 预案     │
└──────────────────────────────────────────────────────────┘
```

每 license = 一份 **JWT**，由 carbonbook 私钥（Ed25519）签发：

```json
{
  "iss": "carbonbook.app",
  "license_id": "lic_01H...",
  "user_id": "usr_01H...",
  "plan": "base@2026-q2",
  "features": ["inventory", "questionnaire", "iso14064"],
  "devices_max": 1,
  "issued_at": 1746700000,
  "expires_at": 1778236000,
  "grace_until": 1780828000,
  "support_until": 1781596000,
  "revocation_check_after": 1747304800
}
```

`grace_until` 由 cloud 计算 = `expires_at + 30 天`；`support_until` 是续费宽限的更长一档（如服务到期后还能拿 hotfix 更新）；`revocation_check_after` 通常 = `issued_at + 7 天`。

公钥嵌入 carbonbook 二进制；签名验证完全在本地。

### 激活流程

```
1. 用户在 carbonbook.app 完成支付（Stripe / 海外信用卡 / WeChat / Alipay 通过 Stripe China connector）
   → 拿到 license_key（一次性，邮件 + 网页）

2. App "License" 页面 → 粘贴 license_key
   → app 调 carbonbook-cloud /activate
   → cloud 验证 license_key 有效 + 注册当前 device_id
   → 返回签名好的 JWT

3. JWT 存 OS Keychain (safeStorage)
4. 之后每次启动：本地验签 → 解析 expires_at → 决定是否要 ping cloud
```

### License State Machine

License 在客户端有 4 个状态，由 JWT 字段 + 时间 + cloud 联网验证决定。**这套状态机是唯一的真相**——之前若有"过期立即 read-only"或"宽限期可写"等说法，以本节为准。

#### JWT 字段

| 字段 | 含义 |
|---|---|
| `expires_at` | 订阅截止时间（付费期最后一秒） |
| `grace_until` | 写入宽限期截止 = `expires_at + 30 天`（cloud 计算并写入 JWT） |
| `revocation_check_after` | 下次必须联网 ping cloud /verify 拿 revoke 状态的最早时间（典型 7 天间隔） |

#### 4 个状态 × 触发条件 × UI 行为

| 状态 | 触发条件 | UI 行为 |
|---|---|---|
| **active** | `now < expires_at` AND signature OK AND not revoked AND `now < revocation_check_after`（或最近 ping 成功） | 全功能；无 banner |
| **grace** | `expires_at ≤ now < grace_until` AND not revoked | 全功能 + 红色顶部 banner "请续费（剩余 X 天）" |
| **expired** | `now ≥ grace_until` OR signature 失效 OR 联网失败累计 > 30 天 | **Read-only**（详见下） |
| **revoked** | cloud `/verify` 返回 revoked（无视 expires_at） | **Read-only** 立即生效 |

#### 状态转换

```
       ┌────────┐  expires_at 到期    ┌────────┐
       │ active │ ─────────────────► │ grace  │
       └────┬───┘                     └────┬───┘
            │                              │
            │ revoked / 超过 30 天离线      │ grace_until 到期
            │                              │
            ▼                              ▼
       ┌─────────────────────────────────────┐
       │  read-only （expired or revoked）   │
       └────┬────────────────────────────────┘
            │ 用户续费 → cloud issue 新 JWT
            │ 下次 ping 拿到 → 切回 active
            ▼
       ┌────────┐
       │ active │
       └────────┘
```

#### Read-only 模式定义

- ✅ 允许：查看现有数据、导出 PDF/Excel、查 EF 库、settings 改 AI provider key（防止 key 失效卡死）
- ❌ 禁止：写 activity_data、生成新报告、调 AI 跑 pipeline、freeze calculation_snapshot、导出问卷答案（已 finalized 的可重导）、写 EF 库（包括用户上传）、MCP 写 tools
- 数据本身永远不动；恢复 license 后立刻能继续工作

#### Cloud /verify ping 节奏

- `now < revocation_check_after`：本地验签即可，不联网
- `now ≥ revocation_check_after`：启动时后台异步 ping，**非阻塞**
  - ✓ 成功 → 拿新 JWT（含新 `revocation_check_after`）
  - ✗ 网络失败 → 累计离线天数；累计 > 30 天 → expired
  - ✗ cloud 返回 `revoked` → 立即切 revoked

### 续费触发点（UI banner）

- `expires_at - 30 天` 起：UI 顶部 banner "续费即将到期"
- 进入 grace（已过 expires_at）：banner 转红色，显示宽限剩余天数
- 进入 read-only：全屏遮罩 + "续费恢复"按钮

续费流程：用户点 banner → 浏览器跳 `carbonbook.app/renew?license_id=...` → 支付完成 → cloud webhook 生成新 JWT → app 下次启动或下次 ping 拿到新 JWT → 无缝切回 active。

### 撤销 / 退款

- Stripe 30 天无理由退款（自助），webhook 通知 cloud 撤销 JWT
- 撤销不立刻生效（避免恶意撤销）：用户 app 在 7 天内下次 ping cloud 时拿到 revoked，进入 read-only
- 客户数据不受影响（FS + SQLite 都在本地）

### Device 转移

```
Settings → License → Active devices:
  ▸ MacBook Pro 16" (current)        [Deactivate]
  ▸ iMac 24" (last active 3 weeks ago)  [Deactivate]
  Available slots: 0/1
```

可购买"额外 device"add-on（+ $50/年加 1 个 active device）。

### Trial

- 14 天试用 license：邮箱注册即可（不要信用卡）
- Trial JWT features 跟付费一致
- 过期 → read-only；用户付费即转正

### CBAM Add-on 单独验证

```
Inventory feature:    Base license JWT 解析 features.includes("inventory")  → ✅
CBAM feature:         CBAM Add-on JWT  解析 features.includes("cbam")       → ✅
Questionnaire export: Base license JWT                                       → ✅
```

每个 license 独立 ping cloud / 独立续费 / 独立撤销。

### Auto-update

- `electron-updater` 拉 carbonbook-cloud R2 上的签名 .dmg / .exe
- Channels: `stable`（默认）/ `beta`（用户 opt-in）
- 同一 Ed25519 签名链
- 默认行为：后台下载，下次启动安装
- 平台：仅 macOS + Windows（Linux 不发行）

签名 / 公证：
- macOS：Apple Developer ID 签名 + notarization
- Windows：EV Code Signing

### 支付基础设施

| 渠道 | 用途 | 状态 |
|---|---|---|
| **Stripe**（USD 主） | 海外客户 + 国内有海外卡的客户 | v1 |
| **Stripe + 微信/支付宝**（Stripe 中国 connector） | 国内客户 RMB 支付 | v1（如能接通）/ v1.5 |
| **Lemonsqueezy** | 备选 PSP，处理税自动 | 可选备份 |
| **PayPal** | 拉美 / 中东 | v2 |
| **银行电汇 + 手工 issue license** | 大单 / 企业整单 | v1 但走客服流程 |

> **未来调整方向**（用户 future note）：付款方式简化候选——Lemonsqueezy/Paddle 接管 PSP + 税务自动化、Lifetime license 一次付清取消续费复杂度、WeChat Pay 直连 QR code 小额走通。

### Privacy: carbonbook-cloud 看得到什么

| 数据 | 是否传 cloud | 说明 |
|---|---|---|
| License key、device_id、app 版本、OS、country (from IP) | ✅ | 必要的 license 管理 |
| 邮箱（trial 注册 + 续费通知） | ✅ | 用户提供 |
| 排放数据 / activity_data / 报告 / 问卷 / AI 提问内容 | **❌ 永不** | 单机隐私核心承诺 |
| 错误堆栈 / crash report | ❌ 默认；可选 opt-in | Settings 显式开关，匿名化 |
| EF snapshot 下载请求 + 失败重试 | ✅ | 必要的 CDN 行为 |
| Auto-update 检查 | ✅ | 必要 |
| 用户的 AI provider | ❌ | 永远在本地，cloud 不知道 |
| 用户的 AI API key / OAuth token | ❌ | 永远在 OS Keychain |

Privacy policy 在 onboarding 页面给一段一句话总结："carbonbook-cloud 知道你买了 license、装在哪台电脑。它不知道你算了什么、填了什么、问了 AI 什么。"

### v1 不做

- Floating license / concurrent license（团队共享池）
- Volume discount 自动化
- 区域定价（中国本地 RMB 单独定价）—— v1.5 如果数据支持
- Bug bounty / responsible disclosure 流程
- License lend / family plan
- 邀请码 / referral

---

## §11. 发版路径（phase-based）

### Phase 流程

```
Phase 0: Foundation
   ↓
Phase 1: AI Pipeline + 算这一侧
   ↓ 里程碑 1: first-CO2e
Phase 2: 填这一侧 + MCP
   ↓ 里程碑 2: first-questionnaire
Phase 3: Closed Beta
   ↓ 反馈 → 调整
Phase 4: Cloud + License + 签名
   ↓ 里程碑 3: first-paying-customer
Phase 5: Public Launch
   ↓
v1.0 GA → 进入 v1.1 backlog（CBAM / 区域定价 等）
```

每个 phase 完成由 **Done 标准**驱动而非日历。作者自行控制时间。

### Phase 0 — Foundation

**目标**：能开发的脚手架 + 数据模型迁移 + 第一个 hello-world IPC 通路。

| 工作块 | Done 标准 |
|---|---|
| electron-vite + React + TanStack + Tailwind + Paraglide 脚手架 | `pnpm dev` 弹窗显示中英切换 |
| better-sqlite3 + migrations 框架；Service Layer 基类；`@electron-toolkit/typed-ipc` + Zod IPC | Renderer 调一个 IPC handler 拿数据库一行 |
| §3 数据模型 schema 全量落地；shadcn/ui 设计 token；侧边栏导航 + 主页骨架 | 全部表 CREATE，Dashboard 空页能跑 |
| safeStorage 凭证模块；OS Keychain 测试（macOS + Windows）；onboarding wizard 骨架 | Wizard 能走完 5 步，写到 organization/site/reporting_period 表 |

**Phase 0 Deliverable**: 启动空 app，过 wizard，建组织 + 1 个 site，看到空 inventory dashboard。

### Phase 1 — AI Pipeline + 算这一侧

**目标**："扔一张电费单 → AI 解析 → 落 activity_data → 看到第一笔 CO2e"。

| 工作块 | Done 标准 |
|---|---|
| pi-ai 集成 + 自家 `LLMClient`；BYOT key 设置 UI；Azure OpenAI / Claude / DeepSeek 三 provider 通 | Settings 页填 key，发一个测试 prompt 拿到响应 |
| DocumentLoader stage（pdf-parse + Tesseract + LLM-vision auto fallback）；document/extraction 表写入；sha256 缓存 | 拖入 PDF 显示文本 / 表格规范化 |
| Classifier + StructuredExtractor stage（v1 prompts: china_utility / fuel_receipt / freight）；zod schema validation；Stage Registry 落地 | 上传国网电费单 → AI 出 JSON → 通过 zod 校验 |
| EF Matcher（FTS+LLM）；Activity 录入人审 UI；computed_co2e_kg 实时计算 | **里程碑 1：first-CO2e** 端到端通 |

**EF 库内容并行进行**：从 Phase 0 起就拉爬虫 + 整理首批 670 条 EF SQLite snapshot。

**Phase 1 Deliverable**: 5 种典型单据（电费 / 加油 / 物流 / 采购 / 差旅）能各自跑通抽取 + 落 activity_data。

### Phase 2 — 填这一侧 + MCP

**目标**："拖入一份 CDP supplier 问卷 → 自动 mapping → 生成 80% 答案 → 导出 Excel"。

| 工作块 | Done 标准 |
|---|---|
| Customer / Questionnaire / Question 表 CRUD UI；问卷上传 + 整体 parse pipeline | CDP demo 问卷 60+ 题被拆出来 |
| question_signature 计算 + question_mapping 表 + AI mapping 建议 UI（左右分屏） | 用户点选 mapping，写回库，下次同 customer 命中 |
| Answer Generator stage（numerical / categorical / narrative 三路径）；company_profile + narrative_bank UI | 60 题中 ~40 题 AI 自动生成答案 |
| Export 模块（Excel 写回 / PDF 重排）；MCP server v1（resources + 8 个 tools + 配对 UI） | **里程碑 2：first-questionnaire** 端到端通；Claude Desktop 能 query carbonbook |

**Phase 2 Deliverable**: 真实模拟 1 份非 demo 问卷走通端到端，记录耗时 + 缺口。

### Phase 3 — Closed Beta

**目标**：5-10 个 design partner 上手，反馈直接灌到 backlog。

| 工作块 | Done 标准 |
|---|---|
| ISO 14064-1 PDF / Excel 报告模块（react-pdf + bilingual + Excel writer）；冻结 calculation_snapshot | 跑出一份能给客户看的 PDF + Excel |
| EF rebind UI；audit_event；EF library 自动检查更新流程；OAuth login 流程（实验性，限 provider 官方支持的 OAuth：Anthropic Console / Vertex AI ADC / Copilot SDK preview） | 模拟 EF 库换版后用户能 rebind |
| Closed Beta 招募；onboarding 教程 / 文档；macOS 开发版 + Windows 开发版能装 | 5+ 个用户拿到首版安装包 |
| Beta 反馈快速 iteration；优先修堵路 bug；UX 痛点收紧 | Bug list ≤ 10 P0；体验流畅度通过 |

**Phase 3 Deliverable**: 5+ design partners 装机；至少 2 个完成端到端 inventory + report 流程；至少 1 个完成端到端 questionnaire 流程；Beta 反馈整理成 v1.0 final scope checklist。

### Phase 4 — Cloud + License + 签名

**目标**：基础设施 production-ready；签名 + 公证；第一个付费客户。

| 工作块 | Done 标准 |
|---|---|
| carbonbook-cloud（Cloudflare Workers + R2 + KV）；License JWT issuance + activation API | 测试 license_key 走通 activation |
| Stripe Checkout 集成 + webhook + license auto-issue；落地页 pricing / activate / account（Cloudflare Pages） | 真支付 1 美刀走通端到端 |
| Apple Developer ID + notarization；Windows EV code signing；electron-updater 接 R2 | macOS dmg 双击不报警告，自动更新通；Win exe SmartScreen 不弹警告 |
| 14 天 trial 流程；read-only 兜底测试；Privacy policy / Terms / 用户 docs；中英 UI 校对 | **里程碑 3：first-paying-customer** |

**关键提前动作**（外部审批延迟，越早启动越好）：
- Phase 0 末就提交 Apple Developer ID 申请（拿证 1-3 周）
- Phase 1 中就申请 Windows EV Code Signing（最久，可能 2-4 周）
- Phase 2 就提交 Stripe China connector 申请（如要 v1 走 RMB）

**Phase 4 Deliverable**: 任意陌生用户能从落地页到激活到付费，全程自助。

### Phase 5 — Public Launch

| 工作块 | Done 标准 |
|---|---|
| 文档完善（user manual / FAQ / 视频 demo）；中文 + 英文双版 | docs.carbonbook.app 上线 |
| Product Hunt / 出海 SaaS 媒体 / 国内出口企业群曝光；HN 帖子；推特 thread | 发布日有 50+ 不重复落地页访问 |
| 第一波公开用户接入支持；hotfix 通道；bug triage 节奏定型 | 第一周售出 5-10 个 license |
| 月度 retro：feature usage 数据（在用户主动 opt-in 的 telemetry 下，匿名）+ churn 分析 → 写 v1.1 路线 | v1.1 priority list 输出 |

**Phase 5 Deliverable**: v1.0 公开发布，有第一批付费用户，有数据驱动的 v1.1 计划。

### 路径上的高风险点

| 风险 | 何时显形 | 缓解 |
|---|---|---|
| **AI 抽取准确度不达标**（国内电费单 / 物流单据格式碎片化） | Phase 1 中后段 | 提前准备 50 份真实样本调试 prompt；多模型并行调试；准备 fallback 到 LLM-vision |
| **EF 库整理工作量超估** | Phase 1 末 | 砍到 v1 必备 4 个 Cat（1/4/6/9）+ 3 个数据源（IPCC + DEFRA + OECC）即可；其他源滚 v1.1 |
| **MCP SDK 跨平台坑**（Windows stdio） | Phase 2 末 | 优先 SSE transport，stdio 作为 nice-to-have，跨平台 bug 滚到 v1.1 |
| **Apple 公证 / Windows 签名审批延迟** | Phase 4 中 | Phase 0 末就提申请；预留 cert 拿到手的 buffer |
| **Stripe 中国 connector 审批超时** | Phase 4 中 | 最坏情况 v1 只走 USD，RMB 转 v1.5 |
| **整体节奏偏慢、phase 4 之前体力不支** | Phase 3 末看势头 | 优先级 cut：MCP → v1.1；narrative_bank UI → v1.1；OAuth login → v1.1（保 BYOT 即可） |

### v1 不在主路径里、滚到后续

| 模块 | 何时 |
|---|---|
| **CBAM Add-on**（§7） | v1.1 —— 找到 1-2 个 CBAM 行业 design partner 再开 |
| MCP push subscription / 远程 / 多客户端配对 | v2 |
| 区域 RMB 定价 + 本地支付平台 | v1.5 |
| Floating license / 团队池 | v2 |
| Mobile companion app（仅查看） | v3 |

### Dependency policy

依赖版本范围按下列规则锁定，避免 supply-chain drift 与意外破坏性更新：

| 范围语法 | 适用 | 例 |
|---|---|---|
| `^x.y.z` (caret) | semver 严格的成熟库；同 major 内可自由 patch/minor 升 | `react`, `vite`, `zod`, `@tanstack/*`, `tailwindcss`, `electron-builder` |
| `~x.y.z` (tilde) | 过渡性版本 / 1.x 刚 cut / 仍在快速迭代且偶有 minor 破坏 | `typescript ~6.0.x`, `lucide-react ~1.x` |
| `x.y.z` (exact pin) | 工具链类，配置文件随版本变化、CI 易漂移 | `@biomejs/biome` |
| `>=x.y.z` (floor) | 运行时声明（`engines.node` 等），不直接锁 dep | `node >=24` |

**Major bump 触发审查**：任意 dependency 的 major 升级（含 Electron 季度发版）走单独 PR，至少跑一遍完整 acceptance（onboarding wizard + 一次真实 inventory 算 + 一次问卷答 + macOS+Windows 安装包 smoke）。

**EOL 库零容忍**：依赖跑在 EOL 版本（如 Electron 旧 major、Node EOL LTS）→ 计划 sprint 内升级。安全 patch 不能等。

**审计节奏**：每个 phase 收尾跑一次 `pnpm outdated` + npm registry / GitHub last-commit 抽查，僵尸库（>12 个月无 release 且有活跃替代）替换。Phase 0 的 audit 记录见 commit message。

---

## 附录 A — 术语表

| 缩写 | 含义 |
|---|---|
| ESG | Environmental, Social, Governance |
| GHG | Greenhouse Gas |
| CO2e | Carbon Dioxide Equivalent |
| CSRD | Corporate Sustainability Reporting Directive (EU) |
| CBAM | Carbon Border Adjustment Mechanism (EU) |
| CDP | Carbon Disclosure Project |
| EF | Emission Factor |
| GWP | Global Warming Potential |
| OECC | 中国生态环境部对外合作与交流中心（提供国家温室气体数据） |
| DEFRA | UK Department for Environment, Food and Rural Affairs |
| IEA | International Energy Agency |
| IPCC | Intergovernmental Panel on Climate Change |
| EXIOBASE | 全球 EE-MRIO 数据库（spend-based EF） |
| GLEC | Global Logistics Emissions Council |
| SBTi | Science Based Targets initiative |
| BYOT | Bring Your Own Token (用户自带 AI API key 或 OAuth) |
| MCP | Model Context Protocol |
| JWT | JSON Web Token |
| FTS | Full-Text Search (SQLite) |
| ULID | Universally Unique Lexicographically Sortable Identifier |
| PCF | Product Carbon Footprint |
| SE | Specific Embedded emissions（CBAM 专用术语） |
| AR5 / AR6 | IPCC Assessment Report 5/6（GWP 数据来源） |
| SCEP | Apple Supplier Clean Energy Program |
| CN code | EU Combined Nomenclature 商品编码 |

## 附录 B — Repository 结构

```
carbonbook/                       # 主 repo（v1 私有；后续可考虑开源部分组件如 pipeline contracts / MCP schemas）
├── .gitignore
├── docs/
│   └── specs/
│       └── 2026-05-08-carbonbook-design.md  # 本文
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── src/
│   ├── main/                     # Electron 主进程
│   │   ├── index.ts
│   │   ├── ipc/                  # IPC handlers（typed-ipc + Zod）
│   │   ├── mcp/                  # MCP server
│   │   ├── services/             # 业务逻辑（service layer）
│   │   ├── pipeline/             # AI pipeline stages
│   │   ├── llm/                  # LLMClient + prompts
│   │   ├── db/                   # better-sqlite3 + migrations
│   │   ├── license/              # JWT 验证
│   │   └── updater/              # auto-update
│   ├── preload/
│   ├── renderer/                 # React app
│   │   ├── routes/
│   │   ├── components/
│   │   ├── ui/                   # shadcn/ui
│   │   ├── i18n/                 # Paraglide
│   │   └── stores/
│   └── shared/                   # 主/渲染共享类型
└── test/

carbonbook-ef-source/             # 私有 repo（EF 数据治理）
└── (见 §8)

carbonbook-cloud/                 # 私有 repo（Cloudflare Workers）
├── workers/
│   ├── license-issue.ts
│   ├── license-verify.ts
│   ├── ef-snapshot-cdn.ts
│   └── stripe-webhook.ts
└── pages/                        # 落地页 (carbonbook.app)
```
