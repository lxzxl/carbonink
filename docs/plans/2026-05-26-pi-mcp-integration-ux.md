# MCP Integration UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of the Settings → Integrations sub-page that auto-configures Claude Desktop, Claude Code, and Cursor to use CarbonInk's existing MCP server. Pi gets a manual setup link (deferred). All writes are backed up, atomic, idempotent, and audit-logged.

**Architecture:** New main-process `McpIntegrationService` owns per-client detect / configure / remove logic. Existing `mcp.ts` IPC handler is rewritten to delegate to the service over a fresh set of channels. UI rewrites the existing `McpSection` component into a multi-client table. Runtime uses `ELECTRON_RUN_AS_NODE=1` so end users do not need Node on PATH. `electron-builder.yml` gets `asarUnpack: out/mcp/**` so the server script is spawn-able from packaged builds.

**Tech Stack 增量：** 无新 dep。沿用现有 service / IPC / preload bridge / TanStack Query / shadcn / paraglide / vitest / biome 模式。

**Spec：** [docs/specs/2026-05-26-pi-mcp-extension-design.md](../specs/2026-05-26-pi-mcp-extension-design.md)

**Scope 边界：**
- ✅ Claude Desktop + Claude Code + Cursor 三家 auto-config
- ✅ Pi: detect + manual setup modal（不写配置）
- ✅ Backup with retention (keep last 3)
- ✅ Atomic write (tmp + rename)
- ✅ Idempotency (no-change short-circuit)
- ✅ Legacy `carbonbook` key auto-replace
- ✅ Audit-event for configure/remove
- ✅ Per-path mutex for concurrent calls
- ✅ `ELECTRON_RUN_AS_NODE=1` 运行时
- ✅ `asarUnpack: out/mcp/**`
- ❌ Pi 自动配置（等 Pi 加 native mcpServers config）
- ❌ Skill.md / Pi 扩展包
- ❌ npm publish
- ❌ First-run popup
- ❌ Runtime health monitoring of MCP server
- ❌ Per-tool permission prompts（audit + undo 兜底）

**Verification gate（每个 task 完成后）：**
```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check <changed-files>
```

Full `pnpm desktop:build` + manual smoke only at Task 12.

---

## File Structure

**新建：**
- `src/main/services/mcp-integration-service.ts` — 全部 detect/configure/remove 逻辑
- `tests/main/services/mcp-integration-service.test.ts` — vitest unit tests
- `tests/main/ipc/mcp-integration-handlers.test.ts` — IPC layer tests

**重写（覆盖原文件）：**
- `src/main/ipc/handlers/mcp.ts` — 新 channels，delegate 给 service
- `src/renderer/lib/api/mcp.ts` — 新 API surface 匹配新 channels
- `src/renderer/components/settings/McpSection.tsx` — multi-client table + master toggle + Pi modal

**修改：**
- `src/main/ipc/context.ts` — 加 `mcpIntegrationService` 字段
- `src/main/ipc/types.ts` — 删旧 `mcp:get-status` / `mcp:write-claude-config`，加 4 个新 channel
- `src/main/ipc/license-gate.ts` — `mcp:write-claude-config` → `mcp:configure` / `mcp:remove`
- `src/preload/bridge.ts` — channel allowlist 更新
- `messages/en.json` + `messages/zh-CN.json` — 删旧 `settings_mcp_*` 键，加新键集（同一 commit）
- `electron-builder.yml` — 加 `asarUnpack: out/mcp/**`

**删除：** 无（所有改动通过修改原文件实现）

---

## Type Definitions Used Across Tasks

Define **once** in `src/main/services/mcp-integration-service.ts` (Task 1) and reference from later tasks:

```ts
export type ClientId = 'claudeDesktop' | 'claudeCode' | 'cursor' | 'pi';

export type ClientStatus =
  | { installed: false }
  | { installed: true; configured: false; configPath: string }
  | { installed: true; configured: true; configPath: string; entryDiffersFromCurrent: boolean }
  | { installed: true; error: 'invalid_json'; configPath: string };

export type ServerEntry = {
  command: string;
  args: string[];
  env: { ELECTRON_RUN_AS_NODE: '1' };
};

export type DetectResult = Record<ClientId, ClientStatus>;

export type ConfigureResult =
  | { configPath: string; backupPath: string; noChange?: false }
  | { configPath: string; backupPath: null; noChange: true };

export type RemoveResult = { configPath: string; backupPath: string | null };

export class PiNotSupportedError extends Error {
  constructor() {
    super('Pi auto-configure is not supported in v1. Use the manual setup guide.');
    this.name = 'PiNotSupportedError';
  }
}

export interface PathResolver {
  /** Absolute path to the Electron binary used as Node runtime (`process.execPath` in main). */
  electronBinaryPath(): string;
  /** Absolute path to `out/mcp/index.js`, dev vs packaged-unpacked aware. */
  mcpScriptPath(): string;
  /** Whether the MCP script file exists on disk right now. */
  mcpScriptExists(): boolean;
}
```

---

### Task 1: McpIntegrationService scaffold + PathResolver + getServerEntry

**Files:**
- Create: `src/main/services/mcp-integration-service.ts`
- Create: `tests/main/services/mcp-integration-service.test.ts`

- [ ] **Step 1: 写 failing test — getServerEntry shape**

```ts
// tests/main/services/mcp-integration-service.test.ts
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { McpIntegrationService, type PathResolver } from '@main/services/mcp-integration-service';
import { runMigrations } from '@main/db/migrate';

function makeService(overrides: Partial<{ paths: PathResolver; now: () => Date }> = {}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const paths: PathResolver = overrides.paths ?? {
    electronBinaryPath: () => '/Applications/CarbonInk.app/Contents/MacOS/CarbonInk',
    mcpScriptPath: () =>
      '/Applications/CarbonInk.app/Contents/Resources/app.asar.unpacked/out/mcp/index.js',
    mcpScriptExists: () => true,
  };
  const now = overrides.now ?? (() => new Date('2026-05-26T12:00:00Z'));
  return { svc: new McpIntegrationService({ db, paths, now }), db };
}

describe('McpIntegrationService.getServerEntry', () => {
  it('returns the canonical entry with ELECTRON_RUN_AS_NODE=1', () => {
    const { svc } = makeService();
    expect(svc.getServerEntry()).toEqual({
      command: '/Applications/CarbonInk.app/Contents/MacOS/CarbonInk',
      args: [
        '/Applications/CarbonInk.app/Contents/Resources/app.asar.unpacked/out/mcp/index.js',
      ],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: FAIL with `Cannot find module '@main/services/mcp-integration-service'`

- [ ] **Step 3: 实现最小服务**

```ts
// src/main/services/mcp-integration-service.ts
import type Database from 'better-sqlite3';

export type ClientId = 'claudeDesktop' | 'claudeCode' | 'cursor' | 'pi';

export type ClientStatus =
  | { installed: false }
  | { installed: true; configured: false; configPath: string }
  | { installed: true; configured: true; configPath: string; entryDiffersFromCurrent: boolean }
  | { installed: true; error: 'invalid_json'; configPath: string };

export type ServerEntry = {
  command: string;
  args: string[];
  env: { ELECTRON_RUN_AS_NODE: '1' };
};

export type DetectResult = Record<ClientId, ClientStatus>;

export type ConfigureResult =
  | { configPath: string; backupPath: string; noChange?: false }
  | { configPath: string; backupPath: null; noChange: true };

export type RemoveResult = { configPath: string; backupPath: string | null };

export class PiNotSupportedError extends Error {
  constructor() {
    super('Pi auto-configure is not supported in v1. Use the manual setup guide.');
    this.name = 'PiNotSupportedError';
  }
}

export interface PathResolver {
  electronBinaryPath(): string;
  mcpScriptPath(): string;
  mcpScriptExists(): boolean;
}

export interface McpIntegrationDeps {
  db: Database.Database;
  paths: PathResolver;
  now: () => Date;
}

export class McpIntegrationService {
  constructor(private readonly deps: McpIntegrationDeps) {}

  getServerEntry(): ServerEntry {
    return {
      command: this.deps.paths.electronBinaryPath(),
      args: [this.deps.paths.mcpScriptPath()],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }
}
```

- [ ] **Step 4: 跑 test 确认 pass**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: PASS — 1 test green.

- [ ] **Step 5: 跑 verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check src/main/services/mcp-integration-service.ts tests/main/services/mcp-integration-service.test.ts
```
Expected: typecheck passes, biome clean.

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/src/main/services/mcp-integration-service.ts desktop/tests/main/services/mcp-integration-service.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): service scaffold with getServerEntry

ELECTRON_RUN_AS_NODE-based entry removes Node-on-PATH requirement.
PathResolver injection keeps the service testable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: detectClients (Claude Desktop, Claude Code, Cursor, Pi)

**Files:**
- Modify: `src/main/services/mcp-integration-service.ts`
- Modify: `tests/main/services/mcp-integration-service.test.ts`

- [ ] **Step 1: 写 failing tests — detect 各种状态组合**

Add to `tests/main/services/mcp-integration-service.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach } from 'vitest';

function makeServiceWithTmpHome() {
  const home = join(tmpdir(), `mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(home, { recursive: true });
  const db = new Database(':memory:');
  runMigrations(db);
  const paths: PathResolver = {
    electronBinaryPath: () => '/fake/binary',
    mcpScriptPath: () => '/fake/out/mcp/index.js',
    mcpScriptExists: () => true,
  };
  const svc = new McpIntegrationService({ db, paths, now: () => new Date('2026-05-26T12:00:00Z'), home });
  return { svc, home, db };
}

describe('McpIntegrationService.detectClients', () => {
  it('all not installed when no config files exist', async () => {
    const { svc } = makeServiceWithTmpHome();
    const r = await svc.detectClients();
    expect(r.claudeDesktop).toEqual({ installed: false });
    expect(r.claudeCode).toEqual({ installed: false });
    expect(r.cursor).toEqual({ installed: false });
    expect(r.pi).toEqual({ installed: false });
  });

  it('Claude Desktop installed but mcpServers missing → configured:false', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ preferences: {} }));
    const r = await svc.detectClients();
    expect(r.claudeDesktop).toEqual({ installed: true, configured: false, configPath: cfg });
  });

  it('Claude Desktop with matching carbonink entry → configured:true, not differing', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({
      mcpServers: {
        carbonink: {
          command: '/fake/binary',
          args: ['/fake/out/mcp/index.js'],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    }));
    const r = await svc.detectClients();
    expect(r.claudeDesktop).toEqual({
      installed: true,
      configured: true,
      configPath: cfg,
      entryDiffersFromCurrent: false,
    });
  });

  it('Claude Desktop with legacy carbonbook key pointing at our script → entryDiffersFromCurrent:true', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({
      mcpServers: {
        carbonbook: { command: 'node', args: ['/fake/out/mcp/index.js'] },
      },
    }));
    const r = await svc.detectClients();
    expect(r.claudeDesktop).toMatchObject({
      installed: true,
      configured: true,
      entryDiffersFromCurrent: true,
    });
  });

  it('Claude Desktop config is invalid JSON → returns error:invalid_json', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, '{ not valid json');
    const r = await svc.detectClients();
    expect(r.claudeDesktop).toEqual({
      installed: true,
      error: 'invalid_json',
      configPath: cfg,
    });
  });

  it('Pi installed (has ~/.pi/) → installed:true, configured:false (manual)', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    mkdirSync(join(home, '.pi'), { recursive: true });
    const r = await svc.detectClients();
    expect(r.pi).toEqual({ installed: true, configured: false, configPath: join(home, '.pi') });
  });
});
```

- [ ] **Step 2: 跑 tests 确认 fail (detectClients 不存在 / home 参数不存在)**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: FAIL — `detectClients is not a function` and `home is not declared`.

- [ ] **Step 3: 实现 detectClients + 接受 home 注入**

Update `src/main/services/mcp-integration-service.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ... existing code, then update McpIntegrationDeps:
export interface McpIntegrationDeps {
  db: Database.Database;
  paths: PathResolver;
  now: () => Date;
  /** Override home directory (testing). Defaults to os.homedir(). */
  home?: string;
}

// Below the class members, add:

  private get home(): string {
    return this.deps.home ?? require('node:os').homedir();
  }

  private clientConfigPath(id: ClientId): string {
    const h = this.home;
    switch (id) {
      case 'claudeDesktop':
        if (process.platform === 'darwin')
          return join(h, 'Library/Application Support/Claude/claude_desktop_config.json');
        if (process.platform === 'win32')
          return join(process.env.APPDATA ?? join(h, 'AppData/Roaming'), 'Claude/claude_desktop_config.json');
        return join(h, '.config/Claude/claude_desktop_config.json');
      case 'claudeCode':
        return join(h, '.claude.json');
      case 'cursor':
        return join(h, '.cursor/mcp.json');
      case 'pi':
        return join(h, '.pi');
    }
  }

  async detectClients(): Promise<DetectResult> {
    return {
      claudeDesktop: this.detectMcpJsonClient('claudeDesktop'),
      claudeCode: this.detectMcpJsonClient('claudeCode'),
      cursor: this.detectMcpJsonClient('cursor'),
      pi: this.detectPi(),
    };
  }

  private detectMcpJsonClient(id: Exclude<ClientId, 'pi'>): ClientStatus {
    const configPath = this.clientConfigPath(id);
    if (!existsSync(configPath)) return { installed: false };
    let parsed: { mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> };
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return { installed: true, error: 'invalid_json', configPath };
    }
    const servers = parsed.mcpServers ?? {};
    const target = this.getServerEntry();
    const ourScriptPath = target.args[0];

    // Look for our entry under any key whose args[0] matches our script.
    const existingEntry = Object.entries(servers).find(([, v]) => v?.args?.[0] === ourScriptPath);

    if (!existingEntry) return { installed: true, configured: false, configPath };

    const [, entry] = existingEntry;
    const entryDiffersFromCurrent =
      entry.command !== target.command ||
      JSON.stringify(entry.args) !== JSON.stringify(target.args) ||
      JSON.stringify(entry.env ?? null) !== JSON.stringify(target.env);

    return { installed: true, configured: true, configPath, entryDiffersFromCurrent };
  }

  private detectPi(): ClientStatus {
    const piDir = this.clientConfigPath('pi');
    if (!existsSync(piDir)) return { installed: false };
    return { installed: true, configured: false, configPath: piDir };
  }
```

Also add to top of file: `import { homedir } from 'node:os';` and replace the `require('node:os')` with `homedir()`:

```ts
private get home(): string {
  return this.deps.home ?? homedir();
}
```

- [ ] **Step 4: 跑 tests 确认全部 pass**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check src/main/services/mcp-integration-service.ts tests/main/services/mcp-integration-service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/src/main/services/mcp-integration-service.ts desktop/tests/main/services/mcp-integration-service.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): detectClients for Claude Desktop, Code, Cursor, Pi

Detects via canonical config paths per platform. Identifies our entry
by args[0] matching the MCP script (catches legacy carbonbook key).
Pi treated as manual setup, always configured:false.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: configureClient with atomic write, backup, idempotency, mutex, legacy key replacement

**Files:**
- Modify: `src/main/services/mcp-integration-service.ts`
- Modify: `tests/main/services/mcp-integration-service.test.ts`

- [ ] **Step 1: 写 failing tests**

Append to test file:

```ts
import { readFileSync as readSync } from 'node:fs';

describe('McpIntegrationService.configureClient', () => {
  it('Pi throws PiNotSupportedError', async () => {
    const { svc } = makeServiceWithTmpHome();
    await expect(svc.configureClient('pi')).rejects.toBeInstanceOf(PiNotSupportedError);
  });

  it('first write: creates parent dir, no backup, audit logged', async () => {
    const { svc, home, db } = makeServiceWithTmpHome();
    const result = await svc.configureClient('claudeDesktop');
    expect(result.noChange).toBeFalsy();
    expect(result.backupPath).toBeNull();
    const cfg = JSON.parse(readSync(result.configPath, 'utf-8'));
    expect(cfg.mcpServers.carbonink).toEqual({
      command: '/fake/binary',
      args: ['/fake/out/mcp/index.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('second identical write: noChange:true, no backup, no rewrite', async () => {
    const { svc } = makeServiceWithTmpHome();
    const first = await svc.configureClient('claudeDesktop');
    const beforeMtime = require('node:fs').statSync(first.configPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 10)); // ensure clock tick
    const second = await svc.configureClient('claudeDesktop');
    expect(second).toEqual({
      configPath: first.configPath,
      backupPath: null,
      noChange: true,
    });
    expect(require('node:fs').statSync(first.configPath).mtimeMs).toBe(beforeMtime);
  });

  it('different existing content: writes backup with ISO timestamp', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }));
    const result = await svc.configureClient('claudeDesktop');
    expect(result.backupPath).toMatch(/\.carbonink-bak-\d{4}-\d{2}-\d{2}T/);
    const merged = JSON.parse(readSync(cfg, 'utf-8'));
    expect(merged.mcpServers.other).toBeDefined(); // preserved
    expect(merged.mcpServers.carbonink).toBeDefined(); // added
  });

  it('legacy carbonbook key + same script: deletes old key, writes carbonink', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({
      mcpServers: { carbonbook: { command: 'node', args: ['/fake/out/mcp/index.js'] } },
    }));
    await svc.configureClient('claudeDesktop');
    const merged = JSON.parse(readSync(cfg, 'utf-8'));
    expect(merged.mcpServers.carbonbook).toBeUndefined();
    expect(merged.mcpServers.carbonink).toBeDefined();
  });

  it('concurrent configure calls: second resolves as noChange after first writes', async () => {
    const { svc } = makeServiceWithTmpHome();
    const [a, b] = await Promise.all([
      svc.configureClient('claudeDesktop'),
      svc.configureClient('claudeDesktop'),
    ]);
    // One wrote, the other saw no change. Order is non-deterministic.
    const wrote = [a, b].filter((r) => !r.noChange);
    const skipped = [a, b].filter((r) => r.noChange);
    expect(wrote.length).toBe(1);
    expect(skipped.length).toBe(1);
  });

  it('preserves unknown top-level keys in Claude Code huge config', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, '.claude.json');
    writeFileSync(cfg, JSON.stringify({
      mcpServers: {},
      hasCompletedOnboarding: true,
      oauthAccount: { secret: 'preserved' },
    }));
    await svc.configureClient('claudeCode');
    const merged = JSON.parse(readSync(cfg, 'utf-8'));
    expect(merged.hasCompletedOnboarding).toBe(true);
    expect(merged.oauthAccount.secret).toBe('preserved');
    expect(merged.mcpServers.carbonink).toBeDefined();
  });
});
```

- [ ] **Step 2: 跑 tests 确认 fail**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: FAIL on all new tests (`configureClient is not a function`).

- [ ] **Step 3: 实现 configureClient + helpers**

Add to `src/main/services/mcp-integration-service.ts`:

```ts
import { mkdirSync, renameSync, statSync, unlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

// At class member level:
private readonly mutexByPath = new Map<string, Promise<void>>();

async configureClient(id: ClientId): Promise<ConfigureResult> {
  if (id === 'pi') throw new PiNotSupportedError();

  const configPath = this.clientConfigPath(id);
  return this.withPathMutex(configPath, async () => {
    const target = this.getServerEntry();

    // 1. Read existing or default {}
    let existing: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
    let existingRaw: string | null = null;
    if (existsSync(configPath)) {
      try {
        existingRaw = readFileSync(configPath, 'utf-8');
        existing = JSON.parse(existingRaw);
      } catch {
        throw new Error(`Refusing to overwrite invalid JSON at ${configPath}`);
      }
    }

    // 2. Build the merged config (drop legacy keys pointing at our script)
    const servers = (existing.mcpServers as Record<string, { args?: string[] }> | undefined) ?? {};
    const ourScript = target.args[0];
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(servers)) {
      const v = value as { args?: string[] };
      // Drop any key (other than 'carbonink') that points at our script.
      if (key !== 'carbonink' && v?.args?.[0] === ourScript) continue;
      cleaned[key] = value;
    }
    cleaned.carbonink = target;
    const merged = { ...existing, mcpServers: cleaned };

    // 3. Idempotency: if existingRaw matches what we'd write, no-op.
    const nextRaw = `${JSON.stringify(merged, null, 2)}\n`;
    if (existingRaw === nextRaw) {
      return { configPath, backupPath: null, noChange: true };
    }

    // 4. Write backup if there was an existing file
    let backupPath: string | null = null;
    if (existingRaw !== null) {
      const ts = this.deps.now().toISOString().replace(/[:.]/g, '-');
      backupPath = `${configPath}.carbonink-bak-${ts}`;
      writeFileSync(backupPath, existingRaw, 'utf-8');
    }

    // 5. Atomic write: tmp + rename
    mkdirSync(dirname(configPath), { recursive: true });
    const tmpPath = `${configPath}.carbonink-tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, nextRaw, 'utf-8');
    renameSync(tmpPath, configPath);

    return { configPath, backupPath: backupPath as string };
  });
}

private async withPathMutex<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prior = this.mutexByPath.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => {
    release = r;
  });
  this.mutexByPath.set(path, prior.then(() => current));
  await prior;
  try {
    return await fn();
  } finally {
    release();
    // Clean up: if the latest queued promise is ours, drop the map entry.
    if (this.mutexByPath.get(path) === prior.then(() => current)) {
      this.mutexByPath.delete(path);
    }
  }
}
```

- [ ] **Step 4: 跑 tests 确认 pass**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: PASS — all tests green (7 existing + 7 new = 14).

- [ ] **Step 5: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check src/main/services/mcp-integration-service.ts tests/main/services/mcp-integration-service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/src/main/services/mcp-integration-service.ts desktop/tests/main/services/mcp-integration-service.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): configureClient with backup, atomic write, mutex

Idempotent: identical content → noChange, no rewrite. Legacy carbonbook
keys pointing at our script are dropped in the same write. Per-path
mutex serializes concurrent calls. Pi throws PiNotSupportedError.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: removeClient + backup retention (keep last 3)

**Files:**
- Modify: `src/main/services/mcp-integration-service.ts`
- Modify: `tests/main/services/mcp-integration-service.test.ts`

- [ ] **Step 1: 写 failing tests**

Append:

```ts
describe('McpIntegrationService.removeClient', () => {
  it('Pi throws PiNotSupportedError', async () => {
    const { svc } = makeServiceWithTmpHome();
    await expect(svc.removeClient('pi')).rejects.toBeInstanceOf(PiNotSupportedError);
  });

  it('removes carbonink key; if mcpServers becomes empty, removes the key too', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    await svc.configureClient('claudeDesktop');
    const result = await svc.removeClient('claudeDesktop');
    expect(result.backupPath).toMatch(/\.carbonink-bak-/);
    const cfg = JSON.parse(readSync(result.configPath, 'utf-8'));
    expect(cfg.mcpServers).toBeUndefined();
  });

  it('preserves sibling mcpServers entries', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({
      mcpServers: { other: { command: 'x', args: [] } },
    }));
    await svc.configureClient('claudeDesktop');
    await svc.removeClient('claudeDesktop');
    const after = JSON.parse(readSync(cfg, 'utf-8'));
    expect(after.mcpServers).toEqual({ other: { command: 'x', args: [] } });
  });

  it('no-op when entry absent', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ mcpServers: {} }));
    const result = await svc.removeClient('claudeDesktop');
    expect(result.backupPath).toBeNull();
  });
});

describe('backup retention', () => {
  it('keeps only the 3 newest .carbonink-bak-* files per target', async () => {
    let counter = 0;
    const { svc, home } = (() => {
      const base = makeServiceWithTmpHome();
      // Override `now` to return monotonically increasing timestamps.
      (base.svc as unknown as { deps: { now: () => Date } }).deps.now = () =>
        new Date(2026, 4, 26, 12, 0, counter++);
      return base;
    })();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });

    // Write 5 *different* configs so each configure produces a real backup.
    for (let i = 0; i < 5; i++) {
      writeFileSync(cfg, JSON.stringify({ mcpServers: {}, marker: i }));
      await svc.configureClient('claudeDesktop');
    }

    const backups = readdirSync(dirname(cfg)).filter((f) => f.includes('.carbonink-bak-'));
    expect(backups.length).toBe(3);
  });
});
```

- [ ] **Step 2: 跑 tests 确认 fail**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: FAIL on new tests.

- [ ] **Step 3: 实现 removeClient + backup retention**

Add to service:

```ts
async removeClient(id: ClientId): Promise<RemoveResult> {
  if (id === 'pi') throw new PiNotSupportedError();
  const configPath = this.clientConfigPath(id);
  return this.withPathMutex(configPath, async () => {
    if (!existsSync(configPath)) return { configPath, backupPath: null };
    const existingRaw = readFileSync(configPath, 'utf-8');
    let existing: { mcpServers?: Record<string, unknown> } & Record<string, unknown>;
    try {
      existing = JSON.parse(existingRaw);
    } catch {
      throw new Error(`Refusing to overwrite invalid JSON at ${configPath}`);
    }
    const servers = (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
    if (!servers.carbonink) return { configPath, backupPath: null };

    const { carbonink: _drop, ...remaining } = servers;
    const next: Record<string, unknown> = { ...existing };
    if (Object.keys(remaining).length === 0) {
      delete next.mcpServers;
    } else {
      next.mcpServers = remaining;
    }
    const nextRaw = `${JSON.stringify(next, null, 2)}\n`;
    if (nextRaw === existingRaw) return { configPath, backupPath: null };

    const ts = this.deps.now().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.carbonink-bak-${ts}`;
    writeFileSync(backupPath, existingRaw, 'utf-8');

    const tmpPath = `${configPath}.carbonink-tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, nextRaw, 'utf-8');
    renameSync(tmpPath, configPath);

    this.pruneBackups(configPath);
    return { configPath, backupPath };
  });
}

/** Keep only the 3 newest backups matching `<configPath>.carbonink-bak-*`. */
private pruneBackups(configPath: string): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) return;
  const base = configPath.split('/').pop() ?? configPath.split('\\').pop() ?? configPath;
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.carbonink-bak-`))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { f } of backups.slice(3)) {
    try {
      unlinkSync(join(dir, f));
    } catch {
      // best effort
    }
  }
}
```

Also call `this.pruneBackups(configPath)` at the end of `configureClient` after the successful write (just before the `return`).

- [ ] **Step 4: 跑 tests 确认 pass**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: PASS — all 19 tests green.

- [ ] **Step 5: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check src/main/services/mcp-integration-service.ts tests/main/services/mcp-integration-service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/src/main/services/mcp-integration-service.ts desktop/tests/main/services/mcp-integration-service.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): removeClient + backup retention (keep 3)

Backup cleanup runs after both configure and remove. Removes the
mcpServers key entirely if carbonink was the only entry, keeping the
target config tidy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Audit-event integration

**Files:**
- Modify: `src/main/services/mcp-integration-service.ts`
- Modify: `tests/main/services/mcp-integration-service.test.ts`

- [ ] **Step 1: 写 failing tests — audit rows inserted**

Append:

```ts
describe('audit logging', () => {
  it('configureClient writes mcp_integration.configure audit row', async () => {
    const { svc, db } = makeServiceWithTmpHome();
    await svc.configureClient('claudeDesktop');
    const rows = db
      .prepare(`SELECT event_kind, payload FROM audit_event WHERE event_kind LIKE 'mcp_integration.%'`)
      .all() as Array<{ event_kind: string; payload: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].event_kind).toBe('mcp_integration.configure');
    const payload = JSON.parse(rows[0].payload);
    expect(payload.clientId).toBe('claudeDesktop');
    expect(payload.noChange).toBeFalsy();
  });

  it('noChange configure does NOT write an audit row', async () => {
    const { svc, db } = makeServiceWithTmpHome();
    await svc.configureClient('claudeDesktop');
    await svc.configureClient('claudeDesktop'); // no-op
    const rows = db
      .prepare(`SELECT COUNT(*) AS c FROM audit_event WHERE event_kind = 'mcp_integration.configure'`)
      .get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('removeClient writes mcp_integration.remove audit row', async () => {
    const { svc, db } = makeServiceWithTmpHome();
    await svc.configureClient('claudeDesktop');
    await svc.removeClient('claudeDesktop');
    const rows = db
      .prepare(`SELECT event_kind FROM audit_event WHERE event_kind LIKE 'mcp_integration.%' ORDER BY occurred_at`)
      .all() as Array<{ event_kind: string }>;
    expect(rows.map((r) => r.event_kind)).toEqual([
      'mcp_integration.configure',
      'mcp_integration.remove',
    ]);
  });
});
```

- [ ] **Step 2: 跑 tests 确认 fail**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: FAIL — no audit rows present.

- [ ] **Step 3: 实现 audit-event inserts**

Add a private helper to the service:

```ts
import { randomUUID } from 'node:crypto';

private recordAudit(eventKind: string, payload: Record<string, unknown>): void {
  this.deps.db.prepare(
    `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
  ).run(randomUUID(), eventKind, JSON.stringify(payload), this.deps.now().toISOString());
}
```

Call it from `configureClient` (only when NOT noChange, just before `return`):
```ts
this.recordAudit('mcp_integration.configure', {
  clientId: id,
  configPath,
  backupPath,
});
```

And from `removeClient` (only when backup was written, just before `return`):
```ts
this.recordAudit('mcp_integration.remove', {
  clientId: id,
  configPath,
  backupPath,
});
```

- [ ] **Step 4: 跑 tests 确认 pass**

Run: `pnpm --filter carbonink exec vitest run tests/main/services/mcp-integration-service.test.ts`
Expected: PASS — all 22 tests green.

- [ ] **Step 5: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check src/main/services/mcp-integration-service.ts tests/main/services/mcp-integration-service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/src/main/services/mcp-integration-service.ts desktop/tests/main/services/mcp-integration-service.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): audit log configure/remove events

Inserts mcp_integration.configure / mcp_integration.remove rows into
audit_event for traceability. noChange paths skip audit (no real
mutation).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: IPC layer rewrite — new channels, replace old handler

**Files:**
- Modify: `src/main/ipc/types.ts`
- Modify: `src/main/ipc/context.ts`
- Modify: `src/main/ipc/setup.ts` (no functional change; just verify handler still registered)
- Modify: `src/main/ipc/handlers/mcp.ts` (full rewrite)
- Modify: `src/main/ipc/license-gate.ts`
- Modify: `src/preload/bridge.ts`
- Create: `tests/main/ipc/mcp-integration-handlers.test.ts`

- [ ] **Step 1: 写 failing test — handler delegates to service**

```ts
// tests/main/ipc/mcp-integration-handlers.test.ts
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@main/db/migrate';
import { McpIntegrationService } from '@main/services/mcp-integration-service';
import { mcpHandlers } from '@main/ipc/handlers/mcp';
import type { IpcContext } from '@main/ipc/context';

function makeCtx() {
  const db = new Database(':memory:');
  runMigrations(db);
  const mcpIntegrationService = new McpIntegrationService({
    db,
    paths: {
      electronBinaryPath: () => '/fake/bin',
      mcpScriptPath: () => '/fake/script.js',
      mcpScriptExists: () => true,
    },
    now: () => new Date('2026-05-26T12:00:00Z'),
  });
  const ctx = { db, mcpIntegrationService } as unknown as IpcContext;
  return { ctx, mcpIntegrationService };
}

describe('mcpHandlers', () => {
  it('mcp:detect delegates to service.detectClients', async () => {
    const { ctx, mcpIntegrationService } = makeCtx();
    const spy = vi.spyOn(mcpIntegrationService, 'detectClients').mockResolvedValue({
      claudeDesktop: { installed: false },
      claudeCode: { installed: false },
      cursor: { installed: false },
      pi: { installed: false },
    });
    const handlers = mcpHandlers(ctx);
    const result = await handlers['mcp:detect']!();
    expect(spy).toHaveBeenCalledOnce();
    expect(result.claudeDesktop).toEqual({ installed: false });
  });

  it('mcp:configure rejects invalid clientId via zod', async () => {
    const { ctx } = makeCtx();
    const handlers = mcpHandlers(ctx);
    await expect(handlers['mcp:configure']!({ clientId: 'not-a-client' } as never)).rejects.toThrow();
  });

  it('mcp:configure with pi returns a friendly error (not raw exception)', async () => {
    const { ctx } = makeCtx();
    const handlers = mcpHandlers(ctx);
    const r = await handlers['mcp:configure']!({ clientId: 'pi' });
    expect(r).toEqual({ ok: false, error: 'pi_not_supported' });
  });

  it('mcp:get-server-entry returns the current entry', async () => {
    const { ctx } = makeCtx();
    const handlers = mcpHandlers(ctx);
    const r = await handlers['mcp:get-server-entry']!();
    expect(r).toEqual({
      command: '/fake/bin',
      args: ['/fake/script.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

Run: `pnpm --filter carbonink exec vitest run tests/main/ipc/mcp-integration-handlers.test.ts`
Expected: FAIL — type errors on `IpcContext` missing `mcpIntegrationService` and channel names not in `IpcTypeMap`.

- [ ] **Step 3: 加 service 到 IpcContext**

In `src/main/ipc/context.ts`:

1. Add imports at top:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { McpIntegrationService, type PathResolver } from '@main/services/mcp-integration-service.js';
// `app` is already imported from 'electron' near the top of the file.
```

2. Add to `IpcContext` interface (next to existing service fields):
```ts
  mcpIntegrationService: McpIntegrationService;
```

3. In `createIpcContext` (search for `new SettingsService(` to find the service-wiring block), construct the path resolver as standalone functions then pass them in:

```ts
  const mcpScriptPath = (): string => {
    if (app.isPackaged) {
      return join(
        app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
        'out', 'mcp', 'index.js',
      );
    }
    return join(process.cwd(), 'out', 'mcp', 'index.js');
  };
  const paths: PathResolver = {
    electronBinaryPath: () => process.execPath,
    mcpScriptPath,
    mcpScriptExists: () => existsSync(mcpScriptPath()),
  };
  const mcpIntegrationService = new McpIntegrationService({
    db,
    paths,
    now: () => new Date(),
  });
```

4. Add `mcpIntegrationService` to the returned context object.

- [ ] **Step 4: 更新 `IpcTypeMap`**

In `src/main/ipc/types.ts`, find `mcp:get-status` and `mcp:write-claude-config` lines and replace with:

```ts
  // mcp-integration domain (Settings → Integrations sub-page)
  'mcp:detect': () => Promise<import('@main/services/mcp-integration-service.js').DetectResult>;
  'mcp:configure': (input: { clientId: import('@main/services/mcp-integration-service.js').ClientId }) =>
    Promise<
      | { ok: true; result: import('@main/services/mcp-integration-service.js').ConfigureResult }
      | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
    >;
  'mcp:remove': (input: { clientId: import('@main/services/mcp-integration-service.js').ClientId }) =>
    Promise<
      | { ok: true; result: import('@main/services/mcp-integration-service.js').RemoveResult }
      | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
    >;
  'mcp:get-server-entry': () => import('@main/services/mcp-integration-service.js').ServerEntry;
```

- [ ] **Step 5: 重写 `src/main/ipc/handlers/mcp.ts`**

Replace entire file with:

```ts
import { z } from 'zod';
import { PiNotSupportedError } from '@main/services/mcp-integration-service.js';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const clientIdSchema = z.enum(['claudeDesktop', 'claudeCode', 'cursor', 'pi']);
const configureInput = z.object({ clientId: clientIdSchema });
const removeInput = z.object({ clientId: clientIdSchema });

export function mcpHandlers(ctx: IpcContext): { [K in keyof IpcTypeMap]?: IpcTypeMap[K] } {
  return {
    'mcp:detect': () => ctx.mcpIntegrationService.detectClients(),

    'mcp:configure': async (input) => {
      const { clientId } = configureInput.parse(input);
      try {
        const result = await ctx.mcpIntegrationService.configureClient(clientId);
        return { ok: true, result };
      } catch (e) {
        if (e instanceof PiNotSupportedError) return { ok: false, error: 'pi_not_supported' };
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('invalid JSON')) return { ok: false, error: 'invalid_json', message: msg };
        return { ok: false, error: 'io_error', message: msg };
      }
    },

    'mcp:remove': async (input) => {
      const { clientId } = removeInput.parse(input);
      try {
        const result = await ctx.mcpIntegrationService.removeClient(clientId);
        return { ok: true, result };
      } catch (e) {
        if (e instanceof PiNotSupportedError) return { ok: false, error: 'pi_not_supported' };
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('invalid JSON')) return { ok: false, error: 'invalid_json', message: msg };
        return { ok: false, error: 'io_error', message: msg };
      }
    },

    'mcp:get-server-entry': () => ctx.mcpIntegrationService.getServerEntry(),
  };
}
```

- [ ] **Step 6: 更新 `src/main/ipc/license-gate.ts`**

Find the existing `'mcp:write-claude-config',` line and replace with:

```ts
  // MCP integration writes (file mutations on user's other-app configs)
  'mcp:configure',
  'mcp:remove',
```

- [ ] **Step 7: 更新 `src/preload/bridge.ts`**

In the channel allowlist, replace:
```ts
  'mcp:get-status',
  'mcp:write-claude-config',
```
with:
```ts
  'mcp:detect',
  'mcp:configure',
  'mcp:remove',
  'mcp:get-server-entry',
```

- [ ] **Step 8: 跑 IPC test 确认 pass**

Run: `pnpm --filter carbonink exec vitest run tests/main/ipc/mcp-integration-handlers.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 9: 跑 full test suite (确保不退化 baseline)**

Run: `pnpm --filter carbonink test -- --run`
Expected: ≥ 662 tests pass. **If anything else broke, fix before continuing.**

- [ ] **Step 10: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check \
  src/main/ipc/handlers/mcp.ts \
  src/main/ipc/context.ts \
  src/main/ipc/types.ts \
  src/main/ipc/license-gate.ts \
  src/preload/bridge.ts \
  tests/main/ipc/mcp-integration-handlers.test.ts
```

- [ ] **Step 11: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add \
  desktop/src/main/ipc/handlers/mcp.ts \
  desktop/src/main/ipc/context.ts \
  desktop/src/main/ipc/types.ts \
  desktop/src/main/ipc/license-gate.ts \
  desktop/src/preload/bridge.ts \
  desktop/tests/main/ipc/mcp-integration-handlers.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): IPC layer (detect/configure/remove/get-server-entry)

Replaces the previous mcp:get-status + mcp:write-claude-config pair.
Service-backed via McpIntegrationService on IpcContext. License gate
covers the two mutation channels. Renderer-facing errors are
discriminated unions (pi_not_supported / invalid_json / io_error).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Renderer API replacement

**Files:**
- Modify: `src/renderer/lib/api/mcp.ts`

**Architectural note**: renderer can't import from `@main/*` (separate process, no shared bundle). Move types to `@shared/types.ts` so both main and renderer can import them.

- [ ] **Step 1: Move types to `src/shared/types.ts`**

In `src/shared/types.ts`, append:

```ts
// MCP integration types (cross-process — used by main service, IPC layer, renderer)
export type McpClientId = 'claudeDesktop' | 'claudeCode' | 'cursor' | 'pi';

export type McpClientStatus =
  | { installed: false }
  | { installed: true; configured: false; configPath: string }
  | { installed: true; configured: true; configPath: string; entryDiffersFromCurrent: boolean }
  | { installed: true; error: 'invalid_json'; configPath: string };

export type McpDetectResult = Record<McpClientId, McpClientStatus>;

export type McpServerEntry = {
  command: string;
  args: string[];
  env: { ELECTRON_RUN_AS_NODE: '1' };
};

export type McpConfigureResult =
  | { configPath: string; backupPath: string; noChange?: false }
  | { configPath: string; backupPath: null; noChange: true };

export type McpRemoveResult = { configPath: string; backupPath: string | null };
```

- [ ] **Step 2: Update `mcp-integration-service.ts` to re-export from shared**

In `src/main/services/mcp-integration-service.ts`, replace the inline type declarations (the `ClientId`, `ClientStatus`, `ServerEntry`, `DetectResult`, `ConfigureResult`, `RemoveResult` exports) with re-exports from shared:

```ts
import type {
  McpClientId, McpClientStatus, McpDetectResult, McpServerEntry,
  McpConfigureResult, McpRemoveResult,
} from '@shared/types.js';

// Re-export under the local names the service implementation uses internally.
export type ClientId = McpClientId;
export type ClientStatus = McpClientStatus;
export type DetectResult = McpDetectResult;
export type ServerEntry = McpServerEntry;
export type ConfigureResult = McpConfigureResult;
export type RemoveResult = McpRemoveResult;

// PiNotSupportedError and PathResolver stay local — not needed in renderer.
```

Existing usages inside the service file continue to compile because the names are the same.

- [ ] **Step 3: Update `src/main/ipc/types.ts` imports**

Change the channel definitions to import from `@shared/types.js` instead of the service:

```ts
import type {
  McpDetectResult, McpClientId, McpServerEntry,
  McpConfigureResult, McpRemoveResult,
} from '@shared/types.js';

// Then update the channels (replace the inline import() forms from Task 6 Step 4):
  'mcp:detect': () => Promise<McpDetectResult>;
  'mcp:configure': (input: { clientId: McpClientId }) => Promise<
    | { ok: true; result: McpConfigureResult }
    | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
  >;
  'mcp:remove': (input: { clientId: McpClientId }) => Promise<
    | { ok: true; result: McpRemoveResult }
    | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
  >;
  'mcp:get-server-entry': () => McpServerEntry;
```

- [ ] **Step 4: Replace renderer API**

Replace entire `src/renderer/lib/api/mcp.ts` with:

```ts
import { ipcInvoke as invoke } from '@renderer/lib/ipc';
import type {
  McpClientId, McpConfigureResult, McpDetectResult, McpRemoveResult, McpServerEntry,
} from '@shared/types';

export const mcpApi = {
  detect: () => invoke('mcp:detect') as Promise<McpDetectResult>,
  configure: (clientId: McpClientId) =>
    invoke('mcp:configure', { clientId }) as Promise<
      | { ok: true; result: McpConfigureResult }
      | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
    >,
  remove: (clientId: McpClientId) =>
    invoke('mcp:remove', { clientId }) as Promise<
      | { ok: true; result: McpRemoveResult }
      | { ok: false; error: 'pi_not_supported' | 'invalid_json' | 'io_error'; message?: string }
    >,
  getServerEntry: () => invoke('mcp:get-server-entry') as Promise<McpServerEntry>,
};
```

(Look at `src/renderer/lib/api/settings.ts` or any other existing `lib/api/*.ts` file to confirm the exact `ipcInvoke` import path. Adjust if the existing pattern is different.)

- [ ] **Step 5: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check \
  src/shared/types.ts \
  src/main/services/mcp-integration-service.ts \
  src/main/ipc/types.ts \
  src/renderer/lib/api/mcp.ts
```

Expected: typecheck clean (no more `@main/services/...` import in renderer). Existing tests still pass — typecheck would have caught any drift in the IPC channel signatures.

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add \
  desktop/src/shared/types.ts \
  desktop/src/main/services/mcp-integration-service.ts \
  desktop/src/main/ipc/types.ts \
  desktop/src/renderer/lib/api/mcp.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): cross-process types in shared, renderer API surface

Move type defs to @shared/types so renderer can consume them. Service
file re-exports under its internal names for backward compat with the
already-committed service implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Rewrite McpSection UI (master toggle + per-client table + Pi modal)

**Files:**
- Modify: `src/renderer/components/settings/McpSection.tsx`

- [ ] **Step 1: 重写组件**

Replace entire file with:

```tsx
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@renderer/components/ui/dialog';
import { Label } from '@renderer/components/ui/label';
import { Switch } from '@renderer/components/ui/switch';
import { mcpApi } from '@renderer/lib/api/mcp';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import type { McpClientId, McpClientStatus, McpServerEntry } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const CLIENTS: ReadonlyArray<{ id: McpClientId; labelKey: () => string }> = [
  { id: 'claudeDesktop', labelKey: m.settings_mcp_client_claude_desktop },
  { id: 'claudeCode', labelKey: m.settings_mcp_client_claude_code },
  { id: 'cursor', labelKey: m.settings_mcp_client_cursor },
  { id: 'pi', labelKey: m.settings_mcp_client_pi },
];

export function McpSection() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(true);

  const detectQuery = useQuery({
    queryKey: ['mcp:detect'],
    queryFn: mcpApi.detect,
    refetchInterval: 10_000,
  });
  const serverEntryQuery = useQuery({
    queryKey: ['mcp:server-entry'],
    queryFn: mcpApi.getServerEntry,
  });

  const configureMut = useMutation({
    mutationFn: (id: McpClientId) => mcpApi.configure(id),
    onSuccess: (r, id) => {
      if (r.ok) {
        toast.success(m.settings_mcp_configured({ client: clientLabel(id) }));
      } else if (r.error === 'invalid_json') {
        toast.error(m.settings_mcp_invalid_json(), { description: r.message });
      } else {
        toast.error(m.settings_mcp_configure_failed(), { description: r.message });
      }
      qc.invalidateQueries({ queryKey: ['mcp:detect'] });
    },
    onError: (e) => toast.error(m.settings_mcp_configure_failed(), { description: friendlyErrorDescription(e) }),
  });

  const removeMut = useMutation({
    mutationFn: (id: McpClientId) => mcpApi.remove(id),
    onSuccess: (r, id) => {
      if (r.ok) toast.success(m.settings_mcp_removed({ client: clientLabel(id) }));
      else toast.error(m.settings_mcp_remove_failed(), { description: r.message });
      qc.invalidateQueries({ queryKey: ['mcp:detect'] });
    },
  });

  const detect = detectQuery.data;
  const serverEntry = serverEntryQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} id="mcp-enable" />
        <Label htmlFor="mcp-enable" className="text-sm">{m.settings_mcp_master_toggle()}</Label>
      </div>
      <p className="text-xs text-muted-foreground">{m.settings_mcp_master_toggle_help()}</p>

      {serverEntry && (
        <div className="space-y-1 rounded-md border p-3 bg-muted/30">
          <Label className="text-xs">{m.settings_mcp_binary_label()}</Label>
          <code className="text-xs block truncate font-mono">{serverEntry.command}</code>
          <Label className="text-xs pt-2">{m.settings_mcp_script_label()}</Label>
          <code className="text-xs block truncate font-mono">{serverEntry.args[0]}</code>
        </div>
      )}

      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {CLIENTS.map(({ id, labelKey }) => (
          <li key={id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <div className="text-sm font-medium">{labelKey()}</div>
              <div className="text-xs text-muted-foreground">
                {detect ? renderStatusText(detect[id]) : '...'}
              </div>
            </div>
            <ClientAction
              id={id}
              status={detect?.[id]}
              disabled={!enabled || configureMut.isPending || removeMut.isPending}
              onConfigure={() => configureMut.mutate(id)}
              onRemove={() => removeMut.mutate(id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function clientLabel(id: McpClientId): string {
  switch (id) {
    case 'claudeDesktop': return m.settings_mcp_client_claude_desktop();
    case 'claudeCode': return m.settings_mcp_client_claude_code();
    case 'cursor': return m.settings_mcp_client_cursor();
    case 'pi': return m.settings_mcp_client_pi();
  }
}

function renderStatusText(s: McpClientStatus | undefined): string {
  if (!s) return '';
  if (!s.installed) return m.settings_mcp_status_not_installed();
  if ('error' in s) return m.settings_mcp_status_invalid_json();
  if (!s.configured) return m.settings_mcp_status_not_configured();
  if (s.entryDiffersFromCurrent) return m.settings_mcp_status_needs_reconfigure();
  return m.settings_mcp_status_configured();
}

function ClientAction({
  id, status, disabled, onConfigure, onRemove,
}: {
  id: McpClientId;
  status: McpClientStatus | undefined;
  disabled: boolean;
  onConfigure: () => void;
  onRemove: () => void;
}) {
  if (id === 'pi') return <PiSetupButton />;
  if (!status || !status.installed || ('error' in status)) {
    return <Button size="sm" variant="outline" disabled>{m.settings_mcp_action_unavailable()}</Button>;
  }
  if (!status.configured) {
    return <Button size="sm" disabled={disabled} onClick={onConfigure}>{m.settings_mcp_action_configure()}</Button>;
  }
  if (status.entryDiffersFromCurrent) {
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={disabled} onClick={onConfigure}>{m.settings_mcp_action_reconfigure()}</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onRemove}>{m.settings_mcp_action_remove()}</Button>
      </div>
    );
  }
  return <Button size="sm" variant="outline" disabled={disabled} onClick={onRemove}>{m.settings_mcp_action_remove()}</Button>;
}

function PiSetupButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">{m.settings_mcp_action_view_pi_guide()}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_mcp_pi_guide_title()}</DialogTitle>
          <DialogDescription>{m.settings_mcp_pi_guide_intro()}</DialogDescription>
        </DialogHeader>
        <div className="text-sm space-y-2">
          <p>{m.settings_mcp_pi_guide_step1()}</p>
          <pre className="bg-muted p-2 rounded text-xs">pi install mavam/pi-mcporter</pre>
          <p>{m.settings_mcp_pi_guide_step2()}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check src/renderer/components/settings/McpSection.tsx
```

Expected: typecheck will FAIL with "missing message key" errors. That's intentional — Task 10 (i18n keys) adds them. Continue without committing this task; bundle the commit with Task 10.

---

### Task 9: i18n keys for MCP section (en + zh-CN)

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

- [ ] **Step 1: 删除旧 keys + 新增完整 key 集 — `messages/en.json`**

Remove these obsolete keys:
```
settings_mcp_binary_label
settings_mcp_config_label
settings_mcp_copy_done
settings_mcp_status_available
settings_mcp_status_not_built
settings_mcp_status_pending
settings_mcp_title
settings_mcp_write_button
settings_mcp_write_done
settings_mcp_write_failed
```

Add (keep `settings_mcp_binary_label` because the new UI still uses it; also keep `settings_mcp_title`):

```json
"settings_mcp_title": "MCP integration",
"settings_mcp_master_toggle": "Enable MCP integration",
"settings_mcp_master_toggle_help": "When off, the buttons below are disabled. Already-configured clients keep working until you click Remove.",
"settings_mcp_binary_label": "Server binary",
"settings_mcp_script_label": "Server script",
"settings_mcp_client_claude_desktop": "Claude Desktop",
"settings_mcp_client_claude_code": "Claude Code",
"settings_mcp_client_cursor": "Cursor",
"settings_mcp_client_pi": "Pi",
"settings_mcp_status_not_installed": "Not detected",
"settings_mcp_status_not_configured": "Detected, not configured",
"settings_mcp_status_configured": "Configured ✓",
"settings_mcp_status_needs_reconfigure": "Configured but path is stale — click Reconfigure",
"settings_mcp_status_invalid_json": "Config file is not valid JSON — open and fix manually",
"settings_mcp_action_configure": "Configure",
"settings_mcp_action_reconfigure": "Reconfigure",
"settings_mcp_action_remove": "Remove",
"settings_mcp_action_unavailable": "—",
"settings_mcp_action_view_pi_guide": "View setup guide",
"settings_mcp_configured": "Configured {client}. Restart {client} to apply.",
"settings_mcp_removed": "Removed CarbonInk from {client}.",
"settings_mcp_configure_failed": "Failed to write config",
"settings_mcp_remove_failed": "Failed to remove config",
"settings_mcp_invalid_json": "Config file is not valid JSON",
"settings_mcp_pi_guide_title": "Connect CarbonInk to Pi",
"settings_mcp_pi_guide_intro": "Pi doesn't ship a native mcpServers config yet. Use the pi-mcporter bridge extension:",
"settings_mcp_pi_guide_step1": "1. Install the bridge extension in Pi:",
"settings_mcp_pi_guide_step2": "2. Restart Pi. The carbonink MCP server will be auto-detected."
```

- [ ] **Step 2: 同步 zh-CN 翻译 — `messages/zh-CN.json`**

Remove the same 10 obsolete keys, add:

```json
"settings_mcp_title": "MCP 集成",
"settings_mcp_master_toggle": "启用 MCP 集成",
"settings_mcp_master_toggle_help": "关闭后下方按钮被禁用。已配置的客户端仍可使用，直到你点击「移除」。",
"settings_mcp_binary_label": "服务器可执行文件",
"settings_mcp_script_label": "服务器脚本",
"settings_mcp_client_claude_desktop": "Claude Desktop",
"settings_mcp_client_claude_code": "Claude Code",
"settings_mcp_client_cursor": "Cursor",
"settings_mcp_client_pi": "Pi",
"settings_mcp_status_not_installed": "未检测到",
"settings_mcp_status_not_configured": "已检测到，未配置",
"settings_mcp_status_configured": "已配置 ✓",
"settings_mcp_status_needs_reconfigure": "已配置但路径过期 — 请点「重新配置」",
"settings_mcp_status_invalid_json": "配置文件不是合法 JSON — 请手动打开修复",
"settings_mcp_action_configure": "配置",
"settings_mcp_action_reconfigure": "重新配置",
"settings_mcp_action_remove": "移除",
"settings_mcp_action_unavailable": "—",
"settings_mcp_action_view_pi_guide": "查看接入指南",
"settings_mcp_configured": "已配置 {client}。请重启 {client} 让改动生效。",
"settings_mcp_removed": "已从 {client} 中移除 CarbonInk。",
"settings_mcp_configure_failed": "写入配置失败",
"settings_mcp_remove_failed": "移除配置失败",
"settings_mcp_invalid_json": "配置文件不是合法 JSON",
"settings_mcp_pi_guide_title": "把 CarbonInk 接入 Pi",
"settings_mcp_pi_guide_intro": "Pi 暂未提供原生 mcpServers 配置。请用 pi-mcporter 桥接扩展：",
"settings_mcp_pi_guide_step1": "1. 在 Pi 里安装桥接扩展：",
"settings_mcp_pi_guide_step2": "2. 重启 Pi，carbonink MCP server 会自动被检测到。"
```

- [ ] **Step 3: 编译 paraglide messages**

Run: `pnpm --filter carbonink exec paraglide-js compile --project ./project.inlang`
Expected: success, regenerates `src/renderer/paraglide/`.

(If you don't know the exact paraglide command, check `desktop/package.json` scripts for one that mentions paraglide.)

- [ ] **Step 4: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check messages/en.json messages/zh-CN.json src/renderer/components/settings/McpSection.tsx
```

Expected: typecheck passes (McpSection no longer references missing keys), tests still ≥ 662.

- [ ] **Step 5: Commit (bundles Task 8 + Task 9)**

```bash
git -C /Users/lxz/ws/personal/carbonbook add \
  desktop/messages/en.json \
  desktop/messages/zh-CN.json \
  desktop/src/renderer/paraglide \
  desktop/src/renderer/components/settings/McpSection.tsx
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(mcp-integration): multi-client Settings UI + bilingual i18n

Master toggle + per-client rows (Configure / Reconfigure / Remove)
for Claude Desktop / Claude Code / Cursor. Pi gets a setup-guide
modal pointing at pi-mcporter. Removes legacy single-client UI keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: electron-builder.yml asarUnpack

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: 加 asarUnpack 配置**

Find the `files:` block in `desktop/electron-builder.yml`. Below it (top-level), add:

```yaml
# Unpack the MCP server script so external MCP clients can spawn it
# at <Resources>/app.asar.unpacked/out/mcp/index.js. Files inside
# app.asar cannot be spawned as Node scripts via ELECTRON_RUN_AS_NODE.
asarUnpack:
  - out/mcp/**
```

- [ ] **Step 2: Verification gate (smoke build, dry-run optional)**

A full `pnpm --filter carbonink build` followed by inspecting `out/mac/CarbonInk.app/Contents/Resources/app.asar.unpacked/out/mcp/index.js` confirms it's unpacked. Defer the actual build to Task 12's manual smoke section to avoid 5-min builds between every commit.

- [ ] **Step 3: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/electron-builder.yml
git -C /Users/lxz/ws/personal/carbonbook commit -m "build(electron-builder): asarUnpack out/mcp for ELECTRON_RUN_AS_NODE spawning

Without this, packaged builds ship the MCP server script inside
app.asar, where it can't be spawned by external MCP clients via
the Electron-as-Node trick.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Update manual smoke checklist in spec

**Files:**
- Modify: `docs/specs/2026-05-26-pi-mcp-extension-design.md`

- [ ] **Step 1: 在 spec 末尾 Testing 节加一个 Verified Smoke Run 表**

Append before the `## References` section:

```markdown
### Verified smoke run (record date + result here when first done)

| Date | Builder | Platform | Step 1 (build) | Step 2 (detect) | Step 3 (configure) | Step 4 (Claude lists tools) | Step 5 (data query) | Step 6 (move app → Reconfigure) | Step 7 (remove) |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |
```

This is a placeholder for the first executor to fill in once they've done the manual smoke. It documents that v1 has been validated end-to-end at least once.

- [ ] **Step 2: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add docs/specs/2026-05-26-pi-mcp-extension-design.md
git -C /Users/lxz/ws/personal/carbonbook commit -m "docs(mcp-integration): add verified-smoke-run table to spec

Empty row for executors to fill in after first successful end-to-end
smoke run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Manual smoke + final verification

**Files:** none (validation only). After this passes, the v1 feature is shipped.

- [ ] **Step 1: 全量构建**

```bash
pnpm --filter carbonink build
pnpm --filter carbonink exec electron-builder --mac --publish never
```

Expected: produces `desktop/release/CarbonInk-<version>.dmg` and `out/mac/CarbonInk.app`.

- [ ] **Step 2: Verify asarUnpack worked**

```bash
ls -la /Users/lxz/ws/personal/carbonbook/desktop/release/mac/CarbonInk.app/Contents/Resources/app.asar.unpacked/out/mcp/
```

Expected: `index.js` is present.

- [ ] **Step 3: Launch + sanity check Settings → Integrations**

```bash
open /Users/lxz/ws/personal/carbonbook/desktop/release/mac/CarbonInk.app
```

In the app: Settings → MCP. Verify:
- Master toggle defaults to on
- Server binary path shown points to `CarbonInk.app/Contents/MacOS/CarbonInk`
- Server script path shown points to `.../app.asar.unpacked/out/mcp/index.js`
- Claude Desktop row shows correct detection state (likely "Detected, not configured" if you've never set it up via the new code)

- [ ] **Step 4: Configure Claude Desktop**

Click "Configure" on the Claude Desktop row. Expected:
- Success toast: "Configured Claude Desktop. Restart Claude Desktop to apply."
- Inspect `~/Library/Application Support/Claude/claude_desktop_config.json` — `mcpServers.carbonink` present with `ELECTRON_RUN_AS_NODE: '1'`
- Backup file `claude_desktop_config.json.carbonink-bak-<timestamp>` exists in same dir
- audit_event table has a `mcp_integration.configure` row (check via DB browser or `mcp:list-questionnaires` proxy)

- [ ] **Step 5: Restart Claude Desktop, verify tool listing**

Quit and reopen Claude Desktop. In a new chat, type `/list-mcp` (or whatever the Claude command is — they show MCP servers in the tools panel). Expected: `carbonink` listed with 9 tools.

- [ ] **Step 6: Test a real query**

In Claude Desktop, ask: "List all my CarbonInk questionnaires."
Expected: Claude calls `list_questionnaires`, returns the actual rows from your local SQLite.

- [ ] **Step 7: Test Reconfigure flow**

Quit CarbonInk. Drag `CarbonInk.app` from one folder to another. Reopen. Settings → MCP. Expected: Claude Desktop row now shows "Configured but path is stale — click Reconfigure". Click Reconfigure → success.

- [ ] **Step 8: Test Remove**

Click Remove on the Claude Desktop row. Expected:
- Success toast
- `~/Library/Application Support/Claude/claude_desktop_config.json` no longer has `mcpServers.carbonink`
- (If `mcpServers` was empty afterward, the key itself is removed)
- New backup file exists from before the removal

- [ ] **Step 9: Fill in Verified Smoke Run table from Task 11**

Edit `docs/specs/2026-05-26-pi-mcp-extension-design.md`, the table row added in Task 11. Fill in date, your name, platform, ✓ for each step that passed.

- [ ] **Step 10: Final commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add docs/specs/2026-05-26-pi-mcp-extension-design.md
git -C /Users/lxz/ws/personal/carbonbook commit -m "docs(mcp-integration): record first verified smoke run

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done

- All 12 tasks committed
- `pnpm --filter carbonink test` ≥ 662 + new tests (target ~22 new tests)
- `pnpm --filter carbonink typecheck` clean
- New code lint-clean on scoped `biome check`
- Manual smoke run completed and recorded in spec
- electron-builder.yml has `asarUnpack: out/mcp/**`
- License gate covers `mcp:configure` and `mcp:remove`
- All i18n keys exist in both `en.json` and `zh-CN.json` (same commit)

## Known Follow-ups (not v1)

- First-run popup when a new MCP client is detected (brainstorm Design B)
- Pi native auto-configure (when Pi adds `mcpServers` config)
- Per-tool permission prompts (currently relying on audit-event + undo-manager)
- e2e Playwright with at least one real MCP client (CI cost concerns)
