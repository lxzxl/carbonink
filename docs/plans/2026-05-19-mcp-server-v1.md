# MCP Server v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 落地 standalone stdio MCP server，提供 6 read + 3 write tools + 2 resources，UI 端在 settings 加配置 section + 顶栏状态指示器。

**Architecture:** electron-vite 构建 `out/mcp/index.cjs`；Claude Desktop spawn 它、通过 `node:sqlite` 直接读写 `~/Library/Application Support/carbonbook/app.sqlite`。WAL 模式并发安全。Electron UI 进程不与 MCP 进程通讯，只读 fs 元信息（binary 是否存在 + Claude Desktop config 是否引用）。

**Tech Stack:** `@modelcontextprotocol/sdk` (npm)、`node:sqlite`（Node 22+ 内建模块、engines 已 `>=24`）、electron-vite 多入口 build。

**Spec:** `docs/specs/2026-05-19-mcp-server-v1-design.md`

**Baseline:** 537 vitest 全绿（`2e6f1e5`）。目标：~547。

---

## Task 1 — `node:sqlite` 探针 + electron-vite 多入口 build + skeleton MCP server

**Files:**
- Create: `src/mcp/index.ts` — skeleton stdio server (no tools yet, just initializes + handles list_tools returning empty)
- Create: `src/mcp/db.ts` — `node:sqlite` 封装、提供 `openAppDb(): Database`
- Modify: `electron.vite.config.ts` — 加 `mcp` 入口
- Modify: `package.json` — 加 `@modelcontextprotocol/sdk` 依赖

- [ ] **Step 0**:
  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  git branch --show-current
  git log --oneline -3
  pnpm rebuild better-sqlite3 2>&1 | tail -2
  ```

- [ ] **Step 1: 验 `node:sqlite` 可用**

  Node 22 加入实验性 `node:sqlite` 模块、Node 24 稳定。先确认运行时支持：

  ```bash
  node --version
  node --experimental-sqlite -e "
    const sqlite = require('node:sqlite');
    console.log('node:sqlite ok', typeof sqlite.DatabaseSync);
  " 2>&1 || node -e "
    const sqlite = require('node:sqlite');
    console.log('node:sqlite ok', typeof sqlite.DatabaseSync);
  " 2>&1
  ```

  期望：打印 `node:sqlite ok function`（DatabaseSync 是 sync 接口、足够 MCP 用）。

  若不支持 → 在此 task 切到 `sql.js`：`pnpm add sql.js` + 重写 db.ts 用 sql.js API。其余 plan 不变。

- [ ] **Step 2: 装 MCP SDK**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm add @modelcontextprotocol/sdk
  ```

- [ ] **Step 3: 写 db.ts**

  `src/mcp/db.ts`：

  ```ts
  import { DatabaseSync } from 'node:sqlite';
  import { join } from 'node:path';
  import { homedir } from 'node:os';
  import { existsSync } from 'node:fs';

  /** 与 main 进程一致的 userData 路径解析。
   * macOS: ~/Library/Application Support/carbonbook
   * Linux: ~/.config/carbonbook
   * Windows: %APPDATA%/carbonbook
   * 允许通过环境变量 CARBONBOOK_MCP_DB 覆盖（测试用）。 */
  export function defaultDbPath(): string {
    if (process.env.CARBONBOOK_MCP_DB) return process.env.CARBONBOOK_MCP_DB;
    const home = homedir();
    if (process.platform === 'darwin') {
      return join(home, 'Library', 'Application Support', 'carbonbook', 'app.sqlite');
    }
    if (process.platform === 'win32') {
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'carbonbook', 'app.sqlite');
    }
    return join(home, '.config', 'carbonbook', 'app.sqlite');
  }

  export function openAppDb(path = defaultDbPath()): DatabaseSync {
    if (!existsSync(path)) {
      throw new Error(`carbonbook DB not found at ${path}. Launch the app at least once.`);
    }
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  }
  ```

- [ ] **Step 4: 写 skeleton MCP server**

  `src/mcp/index.ts`：

  ```ts
  #!/usr/bin/env node
  import { Server } from '@modelcontextprotocol/sdk/server/index.js';
  import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
  import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

  const server = new Server(
    { name: 'carbonbook', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [],  // T3 / T4 fill in
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  ```

- [ ] **Step 5: electron-vite 多入口 build**

  读现有 `electron.vite.config.ts` — 应有 `main` 和 `preload` 两个入口。加 `mcp`：

  ```ts
  // electron.vite.config.ts (示意)
  export default defineConfig({
    main: { ... },
    preload: { ... },
    renderer: { ... },
    // 加：
    // 多输出走插件或者自己加一个 sub-config
  });
  ```

  electron-vite 没原生多 main 入口的概念。简单做法：用一个独立的 vite config 给 mcp：

  - Create `vite.mcp.config.ts`:
    ```ts
    import { defineConfig } from 'vite';
    import { resolve } from 'node:path';
    export default defineConfig({
      build: {
        outDir: 'out/mcp',
        target: 'node22',
        lib: { entry: resolve(__dirname, 'src/mcp/index.ts'), formats: ['cjs'], fileName: 'index' },
        rollupOptions: { external: ['node:sqlite', '@modelcontextprotocol/sdk', 'node:path', 'node:os', 'node:fs'] },
      },
    });
    ```

  - 加 npm script `build:mcp`：`vite build -c vite.mcp.config.ts`
  - 改 `build` script 串入：`pnpm run build:mcp && electron-vite build`

  或者更省事的方案是把它扔到 electron-vite 的 `main.entry` 数组 — 看 electron-vite docs 看是否支持。

- [ ] **Step 6: typecheck + 试跑**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm build:mcp 2>&1 | tail -5
  ls out/mcp/
  node out/mcp/index.cjs <<< ""  # 应该静默等输入；Ctrl-C 退出
  ```

  期望：build 成功、binary 在、运行不报错。

- [ ] **Step 7: commit**

  ```bash
  git add -A
  git commit -m "feat(mcp): skeleton stdio MCP server + node:sqlite db helper + electron-vite mcp entry"
  ```

---

## Task 2 — DB read 函数 + 6 read tools

**Files:**
- Create: `src/mcp/queries.ts` — 纯函数包装 sqlite 查询（与 main 服务层独立、不引 Effect）
- Modify: `src/mcp/index.ts` — 注册 6 个 read tools

- [ ] **Step 1: queries.ts**

  按 spec 列的 6 个 read tools 写对应函数。每个函数签名：

  ```ts
  import type { DatabaseSync } from 'node:sqlite';

  export function listQuestionnaires(db: DatabaseSync) {
    return db.prepare(`
      SELECT q.id, c.name AS customer_name, q.reporting_year, q.status,
             (SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id) AS question_count
        FROM questionnaire q
        JOIN customer c ON c.id = q.customer_id
       ORDER BY q.created_at DESC
    `).all();
  }

  export function getQuestionnaire(db: DatabaseSync, id: string) {
    const q = db.prepare('SELECT * FROM questionnaire WHERE id = ?').get(id);
    if (!q) return null;
    const customer = db.prepare('SELECT * FROM customer WHERE id = ?').get(q.customer_id);
    const document = db.prepare('SELECT * FROM document WHERE id = ?').get(q.document_id);
    const questions = db.prepare('SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position').all(id);
    return { questionnaire: q, customer, document, questions };
  }

  export function listQuestions(db: DatabaseSync, questionnaireId: string) {
    return db.prepare('SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position').all(questionnaireId);
  }

  export function getAnswer(db: DatabaseSync, questionId: string) {
    return db.prepare('SELECT * FROM answer WHERE question_id = ?').get(questionId) ?? null;
  }

  export function listActivities(db: DatabaseSync, opts: { reporting_period_id?: string; year?: number }) {
    if (opts.reporting_period_id) {
      return db.prepare('SELECT * FROM activity_data WHERE reporting_period_id = ?').all(opts.reporting_period_id);
    }
    if (opts.year) {
      return db.prepare(`
        SELECT a.* FROM activity_data a
        JOIN reporting_period rp ON rp.id = a.reporting_period_id
        WHERE rp.year = ?
      `).all(opts.year);
    }
    return db.prepare('SELECT * FROM activity_data').all();
  }

  export function listEmissionSources(db: DatabaseSync, opts: { organization_id?: string } = {}) {
    if (opts.organization_id) {
      return db.prepare(`
        SELECT es.* FROM emission_source es
        JOIN site s ON s.id = es.site_id
        WHERE s.organization_id = ?
      `).all(opts.organization_id);
    }
    return db.prepare('SELECT * FROM emission_source').all();
  }
  ```

- [ ] **Step 2: 在 index.ts 注册 tools**

  改 ListToolsRequestSchema handler 返回 6 个工具的 schema；CallToolRequestSchema switch on name 调对应 query 函数。

  ```ts
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'list_questionnaires', description: '...', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_questionnaire', description: '...', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      // ... 6 个
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const db = openAppDb();
    try {
      switch (request.params.name) {
        case 'list_questionnaires':
          return { content: [{ type: 'text', text: JSON.stringify(listQuestionnaires(db), null, 2) }] };
        case 'get_questionnaire':
          return { content: [{ type: 'text', text: JSON.stringify(getQuestionnaire(db, request.params.arguments.id), null, 2) }] };
        // ... 6 个
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    } finally {
      db.close();
    }
  });
  ```

- [ ] **Step 3: 单测 — queries.ts**

  在 `tests/mcp/queries.test.ts` 加 6 个测试。每个测试：
  - 用 better-sqlite3 创建临时 in-memory DB（vitest 还在用 Electron-ABI 之前 → 用 Node-ABI，看 vitest 进程身份；测试期间应该是 Node-ABI）
  - 跑 migrations、seed 数据、调 queries.ts 的函数、断言

  但注意：queries.ts 用的是 `node:sqlite`，测试里用的是 `better-sqlite3` — API 不同。要么测试也用 `node:sqlite`、要么把 queries.ts 抽出一个接受抽象 `Database` 接口的层。

  **简化方案**：让 queries.ts 接受一个 minimal interface（`prepare(sql).get(...) / prepare(sql).all(...)`）。两个 sqlite 客户端都满足。测试就能用 better-sqlite3 + 现有测试 helpers。

- [ ] **Step 4: rebuild + tests**

  ```bash
  pnpm typecheck 2>&1 | tail -5
  pnpm build:mcp 2>&1 | tail -3
  pnpm vitest run tests/mcp/ --pool=threads 2>&1 | tail -10
  pnpm vitest run --pool=threads 2>&1 | tail -5
  ```

- [ ] **Step 5: commit**

  ```bash
  git add -A
  git commit -m "feat(mcp): 6 read tools (list/get questionnaires, questions, answers, activities, sources)"
  ```

---

## Task 3 — 3 write tools

**Files:**
- Modify: `src/mcp/queries.ts` — 加 3 个写函数
- Modify: `src/mcp/index.ts` — 注册 3 个 write tools
- Modify: `tests/mcp/queries.test.ts` — 加 3 个测试

- [ ] **Step 1: 写函数**

  ```ts
  export function setAnswer(db: DatabaseSync, input: {
    question_id: string;
    value: string;
    unit?: string | null;
    finalize?: boolean;
  }) {
    const now = new Date().toISOString();
    const finalizedAt = input.finalize ? now : null;
    const existing = db.prepare('SELECT id FROM answer WHERE question_id = ?').get(input.question_id);
    if (existing) {
      db.prepare(`
        UPDATE answer SET value = ?, unit = ?, source_kind = 'manual', finalized_at = ?
        WHERE question_id = ?
      `).run(input.value, input.unit ?? null, finalizedAt, input.question_id);
    } else {
      const id = randomUUID();
      db.prepare(`
        INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
        VALUES (?, ?, ?, ?, 'manual', NULL, ?)
      `).run(id, input.question_id, input.value, input.unit ?? null, finalizedAt);
    }
    return db.prepare('SELECT * FROM answer WHERE question_id = ?').get(input.question_id);
  }

  // createActivity / createEmissionSource: 参考 service layer 的现有 SQL；
  // 但 EF pinning 那一套需要重写（pinned_emission_factor 的 INSERT-from-emission_factor 行为）
  // 或者强制 MCP 写入必须用已经 pinned 的 EF — 简化 v1
  ```

  **设计决定**：v1 的 create_activity 要求 caller 提供已经 pinned 的 EF composite PK。MCP 不自动 pin。如果 EF 没 pinned，返回错误信息让用户去 carbonbook GUI 先用一次 EF（自动 pin）。这避免了在 MCP 里复制 EfPinningService 的逻辑。

- [ ] **Step 2: 注册 tools + 调用分发**

- [ ] **Step 3: 测试**

  - `setAnswer` 写一道现有 question → 答案 row 存在、source_kind='manual'、finalize 翻 finalized_at
  - `createActivity` 用已 pin 的 EF → activity 行存在、computed_co2e_kg 算对
  - `createEmissionSource` → 行存在

- [ ] **Step 4: rebuild + tests + commit**

  ```bash
  git commit -m "feat(mcp): 3 write tools (set_answer, create_activity, create_emission_source)"
  ```

---

## Task 4 — 2 resources（inventory + questionnaire）

**Files:**
- Modify: `src/mcp/index.ts` — 加 ListResources + ReadResource handlers
- Modify: `src/mcp/queries.ts` — 加 `inventoryTotals(year)` 函数

- [ ] **Step 1: queries — totals**

  ```ts
  export function inventoryTotals(db: DatabaseSync, year: number) {
    return db.prepare(`
      SELECT
        SUM(a.computed_co2e_kg) AS total_co2e_kg,
        SUM(CASE WHEN es.scope = 1 THEN a.computed_co2e_kg ELSE 0 END) AS scope1_kg,
        SUM(CASE WHEN es.scope = 2 THEN a.computed_co2e_kg ELSE 0 END) AS scope2_kg,
        SUM(CASE WHEN es.scope = 3 THEN a.computed_co2e_kg ELSE 0 END) AS scope3_kg,
        COUNT(a.id) AS activity_count
        FROM activity_data a
        JOIN emission_source es ON es.id = a.emission_source_id
        JOIN reporting_period rp ON rp.id = a.reporting_period_id
       WHERE rp.year = ?
    `).get(year);
  }
  ```

- [ ] **Step 2: register resource handlers**

  ListResources：返回 carbonbook 当前组织所有 reporting_period 的 inventory URI + 所有 questionnaire 的 URI。
  ReadResource：parse URI，路由到 `inventoryTotals(year)` 或 `getQuestionnaire(id)`。

- [ ] **Step 3: test + commit**

  ```bash
  git commit -m "feat(mcp): resources inventory://{year} and questionnaire://{id}"
  ```

---

## Task 5 — Settings 页面 MCP section

**Files:**
- Modify: `src/renderer/components/SettingsDrawerContent.tsx`（或 settings 主组件） — 加 MCP section
- Modify: `src/main/ipc/types.ts` — 加 `mcp:get-status` 和 `mcp:write-claude-config` channels
- Modify: `src/main/ipc/handlers/` — 加 mcp handler
- Modify: `src/preload/bridge.ts` — allowlist
- Modify: `src/renderer/lib/api/` — 加 mcpApi

- [ ] **Step 1: IPC channels**

  ```ts
  // src/main/ipc/types.ts
  'mcp:get-status': () => {
    binary_path: string | null;
    binary_built: boolean;
    claude_config_path: string;
    claude_config_present: boolean;
    claude_config_references_us: boolean;
  };
  'mcp:write-claude-config': () => { ok: true } | { ok: false; error: string };
  ```

- [ ] **Step 2: handler 实现**

  - `mcp:get-status`:
    - resolve binary path: `app.isPackaged ? path.join(app.getAppPath(), 'out/mcp/index.cjs') : path.resolve(__dirname, '../../mcp/index.cjs')`（dev mode）
    - check existsSync
    - resolve claude_desktop_config.json 路径（macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`）
    - read + JSON.parse + check `.mcpServers.carbonbook?.args[0] === binary_path`
  - `mcp:write-claude-config`:
    - read config（不存在则用 `{}` 初始化）
    - merge `mcpServers.carbonbook = { command: 'node', args: [binary_path] }`
    - write back

- [ ] **Step 3: UI section**

  按 spec 草图渲染。

- [ ] **Step 4: typecheck + test + commit**

  ```bash
  git commit -m "feat(ui): MCP settings section — binary path + one-click Claude Desktop config"
  ```

---

## Task 6 — 顶栏状态指示器

**Files:**
- Modify: `src/renderer/routes/__root.tsx` — sidebar 加 MCP chip
- 复用 T5 的 `mcp:get-status` IPC

- [ ] **Step 1: useQuery + chip**

  ```tsx
  const mcpStatus = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
  });
  ```

  Chip 状态：
  - `mcpStatus.data?.claude_config_references_us` → 绿点 `MCP`
  - `mcpStatus.data?.binary_built && !claude_config_references_us` → 黄点 `MCP·待配置`
  - !binary_built → 灰点 `MCP·未构建`

  点击跳设置页 MCP section。

- [ ] **Step 2: i18n keys (3 个状态文案)**

- [ ] **Step 3: test + commit**

  ```bash
  git commit -m "feat(ui): top-bar MCP status chip with 10s poll"
  ```

---

## Task 7 — Sweep + manual verification

- [ ] **Step 1: 全套 vitest + typecheck + biome**

  ```bash
  cd /Users/lxz/ws/personal/carbonbook
  pnpm rebuild better-sqlite3 2>&1 | tail -2
  pnpm vitest run --pool=threads 2>&1 | tail -5
  pnpm typecheck
  pnpm format 2>&1 | tail -3
  pnpm exec biome check --write 2>&1 | tail -3
  pnpm build 2>&1 | tail -5
  ls -la out/mcp/
  ```

- [ ] **Step 2: 手动 sanity（不强制）**

  - 看 binary 是否能裸跑：`node out/mcp/index.cjs` → 等 stdin，Ctrl-C 退
  - 手写一个 MCP test client（或直接用 SDK 的 CLI） send list_tools，看是否回 9 个工具
  - 接到 Claude Desktop：copy binary path → 写进 `claude_desktop_config.json` → 重启 Claude Desktop → 在对话里问 "list my questionnaires" → 看是否 invoke list_questionnaires

- [ ] **Step 3: final commit**

  ```bash
  git add -A
  git commit -m "chore: biome sweep for MCP server v1" || true
  git log --oneline -10
  ```

---

## Closeout

落地后能力：

- `pnpm build` 产出 `out/mcp/index.cjs`
- Claude Desktop 配置后能直接 list/get/set 问卷答案、create activity、create emission source
- carbonbook Settings 页面 MCP section 展示路径 + "一键写入" Claude config
- 顶栏 chip 显示 MCP 配置状态、10s 刷新

**Done 标准（手工）**：
1. `pnpm build`
2. Settings → MCP section → "一键写入 Claude Desktop config"
3. 重启 Claude Desktop
4. 在 Claude Desktop 对话里输入 "use carbonbook to list questionnaires" → 看到列表
5. "use carbonbook to set the answer of question X to 14820 kWh" → carbonbook UI 切回去就能看到（refetchOnFocus 触发刷新）

**Test count target**：~547（537 + 6 read + 3 write + 1 inventory totals）

---

## 三个子项目全部完成后

可以一次性 manual walkthrough：
- #1 三路径：上传一份混合 narrative/categorical/numerical 的问卷、看分类是否对、各类型 UI 渲染是否对
- #2 复用：给同客户上第二份、看蓝 chip + toast 计数 + value 预填
- #3 MCP：Claude Desktop 接入后 list + 写测试

落地清单（一旦三件全完）：
- 5 spec docs + 5 plan docs
- 大约 20 个 commit
- vitest 537 → ~547+
- typecheck + biome 干净
- 提供完整 manual test fixtures（已在 `samples/`）

下一步：MCP redesign 后期可能加 Prompts、audit 标注、SSE transport 支持远程 — 留 backlog。
