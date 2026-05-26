# Agent Skill Installer Implementation Plan (v1.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app "Install Agent Skill" button to Settings → Integrations. One click copies the bundled `SKILL.md` to `~/.agents/skills/carbonink-mcp/` and creates symlinks for each detected agent host (Claude Code / Pi / Codex). Status/Update/Remove flows mirror v1's MCP-config pattern.

**Architecture:** New `AgentSkillService` (main process) + 4 new IPC channels (`skill:detect/install/update/remove`) + UI restructure in `McpSection.tsx` (new Step 1 panel above the existing v1 Step 2 four-client table). `electron-builder.yml` gets `extraResources` so the bundled SKILL.md is reachable at runtime.

**Tech Stack 增量：** none. Reuse existing service / IPC / TanStack Query / shadcn / paraglide / vitest / biome patterns.

**Spec:** [docs/specs/2026-05-26-pi-mcp-extension-design.md § v1.1](../specs/2026-05-26-pi-mcp-extension-design.md)

**Scope 边界：**
- ✅ Install / Update / Remove via Settings UI button
- ✅ Canonical location `~/.agents/skills/carbonink-mcp/` (cross-host shared dir)
- ✅ Per-host symlinks ONLY for hosts whose parent dir already exists (Claude Code / Pi / Codex)
- ✅ SHA-256 comparison drives "needs update" status
- ✅ Backup on Update / Remove (same pattern as v1 MCP)
- ✅ Audit-event for install / update / remove
- ✅ Bundled SKILL.md via electron-builder `extraResources`
- ✅ "Advanced" disclosure section showing host-paths table
- ❌ Cursor / Claude Desktop auto-install (different convention; advisory-only in UI)
- ❌ First-run auto-install popup
- ❌ npx skills integration UI (advanced users use terminal)
- ❌ User-edit detection separate from "needs update"

**Verification gate (every task):**
```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check <changed-files>
```

---

## File Structure

**新建：**
- `desktop/src/main/services/agent-skill-service.ts` — service
- `desktop/tests/main/services/agent-skill-service.test.ts` — vitest
- `desktop/src/main/ipc/handlers/agent-skill.ts` — IPC handlers
- `desktop/tests/main/ipc/agent-skill-handlers.test.ts` — IPC tests

**修改：**
- `desktop/src/main/ipc/context.ts` — add `agentSkillService`
- `desktop/src/main/ipc/types.ts` — add 4 channels
- `desktop/src/main/ipc/license-gate.ts` — gate 3 mutation channels
- `desktop/src/main/ipc/setup.ts` — register handler factory
- `desktop/src/preload/bridge.ts` — allowlist update
- `desktop/src/shared/types.ts` — add `AgentHost`, `SkillInstallStatus`, etc.
- `desktop/src/renderer/lib/api/mcp.ts` — add `skillApi` (or new file)
- `desktop/src/renderer/components/settings/McpSection.tsx` — add Step 1 panel
- `desktop/messages/en.json` + `zh-CN.json` — new keys (paired commit)
- `desktop/electron-builder.yml` — `extraResources: agent-skill/**`

---

## Types defined once in `@shared/types.ts` (Task 3)

```ts
export type AgentHost = 'claudeCode' | 'pi' | 'codex' | 'agentsShared';

export type SkillInstallState =
  | { state: 'not_installed' }
  | { state: 'installed'; canonicalPath: string; hostsLinked: AgentHost[]; needsUpdate: boolean };

export type SkillDetectResult = SkillInstallState & {
  detectedHosts: AgentHost[];
};

export type SkillInstallResult = {
  canonicalPath: string;
  hostsLinked: AgentHost[];
  backupPath: string | null;
};

export type SkillRemoveResult = {
  removed: string[];
  backupPath: string | null;
};
```

---

### Task 1: AgentSkillService scaffold + detectHosts + detect()

**Files:**
- Create: `desktop/src/main/services/agent-skill-service.ts`
- Create: `desktop/tests/main/services/agent-skill-service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/main/services/agent-skill-service.test.ts
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@main/db/migrate';
import { AgentSkillService, type SkillResolver } from '@main/services/agent-skill-service';

const tmpDirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeService(opts: { bundledContent?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'skill-test-'));
  tmpDirs.push(home);
  const bundledPath = join(home, 'bundled-SKILL.md');
  writeFileSync(bundledPath, opts.bundledContent ?? '# bundled skill v1\nhello\n');
  const db = new Database(':memory:');
  runMigrations(db);
  dbs.push(db);
  const resolver: SkillResolver = {
    bundledSkillPath: () => bundledPath,
  };
  const svc = new AgentSkillService({
    db,
    resolver,
    now: () => new Date('2026-05-26T12:00:00Z'),
    home,
  });
  return { svc, home, db, bundledPath };
}

describe('AgentSkillService.detect', () => {
  it('returns not_installed when canonical dir missing', async () => {
    const { svc } = makeService();
    const r = await svc.detect();
    expect(r.state).toBe('not_installed');
    expect(r.detectedHosts).toContain('agentsShared');
  });

  it('detects Claude Code host when ~/.claude/skills exists', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    const r = await svc.detect();
    expect(r.detectedHosts).toContain('claudeCode');
  });

  it('detects Pi host when ~/.pi/agent/skills exists', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.pi/agent/skills'), { recursive: true });
    const r = await svc.detect();
    expect(r.detectedHosts).toContain('pi');
  });

  it('returns installed + needsUpdate:false when content matches bundled', async () => {
    const { svc, home } = makeService({ bundledContent: '# v2\n' });
    const canon = join(home, '.agents/skills/carbonink-mcp');
    mkdirSync(canon, { recursive: true });
    writeFileSync(join(canon, 'SKILL.md'), '# v2\n');
    const r = await svc.detect();
    expect(r.state).toBe('installed');
    if (r.state === 'installed') {
      expect(r.needsUpdate).toBe(false);
    }
  });

  it('returns installed + needsUpdate:true when content differs from bundled', async () => {
    const { svc, home } = makeService({ bundledContent: '# v2\n' });
    const canon = join(home, '.agents/skills/carbonink-mcp');
    mkdirSync(canon, { recursive: true });
    writeFileSync(join(canon, 'SKILL.md'), '# v1\n');
    const r = await svc.detect();
    if (r.state === 'installed') {
      expect(r.needsUpdate).toBe(true);
    }
  });

  it('hostsLinked reflects existing symlinks pointing at canonical', async () => {
    const { svc, home } = makeService();
    const canon = join(home, '.agents/skills/carbonink-mcp');
    mkdirSync(canon, { recursive: true });
    writeFileSync(join(canon, 'SKILL.md'), '# bundled skill v1\nhello\n');
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    require('node:fs').symlinkSync('../../.agents/skills/carbonink-mcp', join(home, '.claude/skills/carbonink-mcp'));
    const r = await svc.detect();
    if (r.state === 'installed') {
      expect(r.hostsLinked).toContain('claudeCode');
    }
  });
});
```

- [ ] **Step 2: Run tests — confirm FAIL** (`Cannot find module ...`)

```bash
pnpm --filter carbonink exec vitest run tests/main/services/agent-skill-service.test.ts
```

- [ ] **Step 3: Implement minimal service**

```ts
// src/main/services/agent-skill-service.ts
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type {
  AgentHost,
  SkillDetectResult,
} from '@shared/types.js';

export type { AgentHost, SkillDetectResult } from '@shared/types.js';

export interface SkillResolver {
  bundledSkillPath(): string;
}

export interface AgentSkillDeps {
  db: Database.Database;
  resolver: SkillResolver;
  now: () => Date;
  /** Override home directory (testing). Defaults to os.homedir(). */
  home?: string;
}

const SKILL_DIR_NAME = 'carbonink-mcp';
const SKILL_FILE = 'SKILL.md';

const HOST_PARENT_DIRS: Record<Exclude<AgentHost, 'agentsShared'>, (h: string) => string> = {
  claudeCode: (h) => join(h, '.claude/skills'),
  pi: (h) => join(h, '.pi/agent/skills'),
  codex: (h) => join(h, '.codex/skills'),
};

export class AgentSkillService {
  constructor(private readonly deps: AgentSkillDeps) {}

  private get home(): string {
    return this.deps.home ?? homedir();
  }

  private canonicalDir(): string {
    return join(this.home, '.agents/skills', SKILL_DIR_NAME);
  }

  private canonicalFile(): string {
    return join(this.canonicalDir(), SKILL_FILE);
  }

  async detect(): Promise<SkillDetectResult> {
    const detectedHosts: AgentHost[] = ['agentsShared'];
    for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
      if (existsSync(HOST_PARENT_DIRS[host](this.home))) {
        detectedHosts.push(host);
      }
    }

    const canonical = this.canonicalFile();
    if (!existsSync(canonical)) {
      return { state: 'not_installed', detectedHosts };
    }

    const installedSha = sha256(readFileSync(canonical));
    const bundledSha = sha256(readFileSync(this.deps.resolver.bundledSkillPath()));
    const needsUpdate = installedSha !== bundledSha;

    const hostsLinked: AgentHost[] = ['agentsShared'];
    for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
      const linkPath = join(HOST_PARENT_DIRS[host](this.home), SKILL_DIR_NAME);
      if (this.isOurSymlink(linkPath)) hostsLinked.push(host);
    }

    return {
      state: 'installed',
      canonicalPath: this.canonicalDir(),
      hostsLinked,
      needsUpdate,
      detectedHosts,
    };
  }

  private isOurSymlink(linkPath: string): boolean {
    try {
      const stat = lstatSync(linkPath);
      if (!stat.isSymbolicLink()) return false;
      const target = readlinkSync(linkPath);
      // Target should resolve to our canonical dir
      return target.endsWith(`/.agents/skills/${SKILL_DIR_NAME}`) || target.endsWith(`\\.agents\\skills\\${SKILL_DIR_NAME}`);
    } catch {
      return false;
    }
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
```

- [ ] **Step 4: Run tests — confirm PASS** (all 6 green)

- [ ] **Step 5: Verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink exec biome check src/main/services/agent-skill-service.ts tests/main/services/agent-skill-service.test.ts
```

Typecheck may FAIL because `@shared/types` doesn't yet have `AgentHost`/`SkillDetectResult`. Add them inline in the service file as a temporary fallback, OR add the shared types now (Task 3 will move them properly):

```ts
// Temporary local types — Task 3 moves these to @shared/types.ts
export type AgentHost = 'claudeCode' | 'pi' | 'codex' | 'agentsShared';
export type SkillDetectResult =
  | { state: 'not_installed'; detectedHosts: AgentHost[] }
  | { state: 'installed'; canonicalPath: string; hostsLinked: AgentHost[]; needsUpdate: boolean; detectedHosts: AgentHost[] };
```

(Better: just add them to `@shared/types.ts` now to avoid two-step migration. The IPC layer in Task 3 will use the same names.)

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/src/main/services/agent-skill-service.ts desktop/tests/main/services/agent-skill-service.test.ts desktop/src/shared/types.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "$(cat <<'EOF'
feat(agent-skill): service scaffold + detect

Returns not_installed | installed{hostsLinked, needsUpdate}, detects parent
dirs for Claude Code / Pi / Codex hosts. SHA-256 of canonical vs bundled
drives needsUpdate. Symlinks identified by target path tail-match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: install + update + remove

**Files:**
- Modify: `desktop/src/main/services/agent-skill-service.ts`
- Modify: `desktop/tests/main/services/agent-skill-service.test.ts`

- [ ] **Step 1: Write failing tests** (append)

```ts
describe('AgentSkillService.install', () => {
  it('creates canonical dir + SKILL.md from bundled', async () => {
    const { svc, home, bundledPath } = makeService({ bundledContent: '# fresh skill\n' });
    const r = await svc.install();
    expect(r.canonicalPath).toBe(join(home, '.agents/skills/carbonink-mcp'));
    expect(require('node:fs').readFileSync(join(r.canonicalPath, 'SKILL.md'), 'utf-8')).toBe('# fresh skill\n');
    expect(r.hostsLinked).toEqual(['agentsShared']);
  });

  it('symlinks for hosts whose parent dir exists', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    mkdirSync(join(home, '.pi/agent/skills'), { recursive: true });
    const r = await svc.install();
    expect(r.hostsLinked).toEqual(expect.arrayContaining(['claudeCode', 'pi', 'agentsShared']));
    expect(require('node:fs').lstatSync(join(home, '.claude/skills/carbonink-mcp')).isSymbolicLink()).toBe(true);
    expect(require('node:fs').lstatSync(join(home, '.pi/agent/skills/carbonink-mcp')).isSymbolicLink()).toBe(true);
  });

  it('does not create phantom dirs for hosts without parent', async () => {
    const { svc, home } = makeService();
    // No ~/.codex/skills/ exists
    await svc.install();
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  it('idempotent: second install no-ops when content matches', async () => {
    const { svc } = makeService();
    await svc.install();
    const r = await svc.install();
    expect(r.backupPath).toBeNull();
  });

  it('records audit event on first install', async () => {
    const { svc, db } = makeService();
    await svc.install();
    const rows = db.prepare(`SELECT event_kind FROM audit_event WHERE event_kind = 'agent_skill.install'`).all() as Array<{ event_kind: string }>;
    expect(rows.length).toBe(1);
  });
});

describe('AgentSkillService.update', () => {
  it('writes backup and replaces canonical when bundled differs', async () => {
    const { svc, home, bundledPath } = makeService({ bundledContent: '# v1\n' });
    await svc.install();
    writeFileSync(bundledPath, '# v2 updated\n');
    const r = await svc.update();
    expect(r.backupPath).toMatch(/\.carbonink-bak-/);
    expect(require('node:fs').readFileSync(join(home, '.agents/skills/carbonink-mcp/SKILL.md'), 'utf-8')).toBe('# v2 updated\n');
  });

  it('no-op when canonical equals bundled', async () => {
    const { svc } = makeService();
    await svc.install();
    const r = await svc.update();
    expect(r.backupPath).toBeNull();
  });
});

describe('AgentSkillService.remove', () => {
  it('removes symlinks and canonical dir, backs up SKILL.md', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    await svc.install();
    const r = await svc.remove();
    expect(r.backupPath).toMatch(/\.carbonink-bak-/);
    expect(existsSync(join(home, '.agents/skills/carbonink-mcp'))).toBe(false);
    expect(existsSync(join(home, '.claude/skills/carbonink-mcp'))).toBe(false);
  });

  it('no-op when not installed', async () => {
    const { svc } = makeService();
    const r = await svc.remove();
    expect(r.backupPath).toBeNull();
    expect(r.removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

- [ ] **Step 3: Implement** install/update/remove

Add to service file:

```ts
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

// Inside class:

async install(): Promise<{ canonicalPath: string; hostsLinked: AgentHost[]; backupPath: string | null }> {
  const bundledRaw = readFileSync(this.deps.resolver.bundledSkillPath());
  const canonicalDir = this.canonicalDir();
  const canonical = this.canonicalFile();

  let backupPath: string | null = null;
  if (existsSync(canonical)) {
    const existing = readFileSync(canonical);
    if (sha256(existing) === sha256(bundledRaw)) {
      // Already up-to-date; just ensure symlinks
      const hostsLinked = this.ensureSymlinks(canonicalDir);
      return { canonicalPath: canonicalDir, hostsLinked, backupPath: null };
    }
    backupPath = `${canonical}.carbonink-bak-${this.tsForFilename()}-${process.pid}`;
    writeFileSync(backupPath, existing);
  }

  mkdirSync(canonicalDir, { recursive: true });
  const tmpPath = `${canonical}.carbonink-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, bundledRaw);
  renameSync(tmpPath, canonical);

  const hostsLinked = this.ensureSymlinks(canonicalDir);

  this.recordAudit('agent_skill.install', {
    canonicalPath: canonicalDir,
    hostsLinked,
    backupPath,
  });

  return { canonicalPath: canonicalDir, hostsLinked, backupPath };
}

async update(): Promise<{ canonicalPath: string; hostsLinked: AgentHost[]; backupPath: string | null }> {
  // Update is essentially the same as install when canonical exists
  return this.install();
}

async remove(): Promise<{ removed: string[]; backupPath: string | null }> {
  const canonicalDir = this.canonicalDir();
  const canonical = this.canonicalFile();
  const removed: string[] = [];

  // Symlinks first
  for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
    const linkPath = join(HOST_PARENT_DIRS[host](this.home), SKILL_DIR_NAME);
    if (this.isOurSymlink(linkPath)) {
      try {
        unlinkSync(linkPath);
        removed.push(linkPath);
      } catch {
        // best effort
      }
    }
  }

  let backupPath: string | null = null;
  if (existsSync(canonical)) {
    const existing = readFileSync(canonical);
    backupPath = `${canonical}.carbonink-bak-${this.tsForFilename()}-${process.pid}`;
    writeFileSync(backupPath, existing);
  }

  if (existsSync(canonicalDir)) {
    // Remove the dir but preserve the backup file we just wrote
    // (Backup is at <canonical>.carbonink-bak-* in PARENT, not inside canonicalDir)
    rmSync(canonicalDir, { recursive: true, force: true });
    removed.push(canonicalDir);
  }

  if (removed.length > 0) {
    this.recordAudit('agent_skill.remove', { removed, backupPath });
  }

  return { removed, backupPath };
}

private ensureSymlinks(canonicalDir: string): AgentHost[] {
  const hosts: AgentHost[] = ['agentsShared'];
  for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
    const parentDir = HOST_PARENT_DIRS[host](this.home);
    if (!existsSync(parentDir)) continue;
    const linkPath = join(parentDir, SKILL_DIR_NAME);
    // Idempotent: skip if already our symlink
    if (this.isOurSymlink(linkPath)) {
      hosts.push(host);
      continue;
    }
    // If something else exists there, skip (don't overwrite user content)
    if (existsSync(linkPath)) continue;
    try {
      const rel = relative(parentDir, canonicalDir);
      symlinkSync(rel, linkPath);
      hosts.push(host);
    } catch {
      // best effort
    }
  }
  return hosts;
}

private tsForFilename(): string {
  return this.deps.now().toISOString().replace(/[:.]/g, '-');
}

private recordAudit(eventKind: string, payload: Record<string, unknown>): void {
  this.deps.db.prepare(
    `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
  ).run(randomUUID(), eventKind, JSON.stringify(payload), this.deps.now().toISOString());
}
```

Note: the backup path needs the canonical's parent dir to still exist (so we can write the backup OUTSIDE the to-be-deleted canonicalDir). The backup file is at `<canonical>.carbonink-bak-*` which is INSIDE canonicalDir. **Fix**: write backup OUTSIDE canonicalDir, e.g. `${canonicalDir}.carbonink-bak-${ts}-SKILL.md` so it survives the `rmSync`.

Update the remove method:
```ts
  backupPath = `${canonicalDir}.carbonink-bak-${this.tsForFilename()}-${process.pid}-SKILL.md`;
  writeFileSync(backupPath, existing);  // writes to ~/.agents/skills/carbonink-mcp.carbonink-bak-...-SKILL.md
```

And same for install:
```ts
  backupPath = `${canonicalDir}.carbonink-bak-${this.tsForFilename()}-${process.pid}-SKILL.md`;
```

- [ ] **Step 4: Run tests — confirm PASS** (15 total)

- [ ] **Step 5: Verification gate** + **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/src/main/services/agent-skill-service.ts desktop/tests/main/services/agent-skill-service.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "$(cat <<'EOF'
feat(agent-skill): install / update / remove with symlink + audit

install creates canonical SKILL.md + per-host symlinks for detected hosts
(Claude Code / Pi / Codex). update reuses install (idempotent when sha
matches). remove tears down symlinks + canonical dir with a backup of
SKILL.md to a path that survives the rmSync. All three log audit events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: IPC layer + cross-process types

**Files:**
- Modify: `desktop/src/shared/types.ts` (if not already done in Task 1)
- Modify: `desktop/src/main/ipc/types.ts` — add 4 channels
- Modify: `desktop/src/main/ipc/context.ts` — add `agentSkillService`
- Modify: `desktop/src/main/ipc/setup.ts` — register handler factory
- Modify: `desktop/src/main/ipc/license-gate.ts` — gate `skill:install`/`update`/`remove`
- Modify: `desktop/src/preload/bridge.ts` — allowlist
- Create: `desktop/src/main/ipc/handlers/agent-skill.ts`
- Create: `desktop/tests/main/ipc/agent-skill-handlers.test.ts`

- [ ] **Step 1: Add shared types** (if not already)

In `desktop/src/shared/types.ts`, append:

```ts
export type AgentHost = 'claudeCode' | 'pi' | 'codex' | 'agentsShared';

export type SkillDetectResult =
  | { state: 'not_installed'; detectedHosts: AgentHost[] }
  | { state: 'installed'; canonicalPath: string; hostsLinked: AgentHost[]; needsUpdate: boolean; detectedHosts: AgentHost[] };

export type SkillInstallResult = {
  canonicalPath: string;
  hostsLinked: AgentHost[];
  backupPath: string | null;
};

export type SkillRemoveResult = {
  removed: string[];
  backupPath: string | null;
};
```

- [ ] **Step 2: Add IPC channel definitions**

In `desktop/src/main/ipc/types.ts`, find the existing `mcp:*` channels and add below them:

```ts
import type {
  AgentHost, SkillDetectResult, SkillInstallResult, SkillRemoveResult,
} from '@shared/types.js';

// Agent skill installer (Step 1 of Settings → Integrations)
  'skill:detect': () => Promise<SkillDetectResult>;
  'skill:install': () => Promise<
    | { ok: true; result: SkillInstallResult }
    | { ok: false; error: 'io_error'; message?: string }
  >;
  'skill:update': () => Promise<
    | { ok: true; result: SkillInstallResult }
    | { ok: false; error: 'io_error'; message?: string }
  >;
  'skill:remove': () => Promise<
    | { ok: true; result: SkillRemoveResult }
    | { ok: false; error: 'io_error'; message?: string }
  >;
```

- [ ] **Step 3: Wire into context**

In `desktop/src/main/ipc/context.ts`:

```ts
import { AgentSkillService, type SkillResolver } from '@main/services/agent-skill-service.js';

// In IpcContext:
  agentSkillService: AgentSkillService;

// In createIpcContext (next to existing mcpIntegrationService block):
  const skillResolver: SkillResolver = {
    bundledSkillPath: () => {
      if (app.isPackaged) {
        return join(process.resourcesPath, 'agent-skill', 'SKILL.md');
      }
      return join(process.cwd(), 'desktop', 'agent-skill', 'SKILL.md');
    },
  };
  const agentSkillService = new AgentSkillService({
    db,
    resolver: skillResolver,
    now: () => new Date(),
  });

// In returned context object:
  agentSkillService,
```

- [ ] **Step 4: Write failing IPC test**

```ts
// tests/main/ipc/agent-skill-handlers.test.ts
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@main/db/migrate';
import { AgentSkillService } from '@main/services/agent-skill-service';
import { agentSkillHandlers } from '@main/ipc/handlers/agent-skill';
import type { IpcContext } from '@main/ipc/context';

function makeCtx() {
  const home = mkdtempSync(join(tmpdir(), 'skill-ipc-'));
  const bundled = join(home, 'SKILL.md');
  writeFileSync(bundled, '# bundled\n');
  const db = new Database(':memory:');
  runMigrations(db);
  const agentSkillService = new AgentSkillService({
    db,
    resolver: { bundledSkillPath: () => bundled },
    now: () => new Date('2026-05-26T12:00:00Z'),
    home,
  });
  const ctx = { db, agentSkillService } as unknown as IpcContext;
  return { ctx, agentSkillService };
}

describe('agentSkillHandlers', () => {
  it('skill:detect delegates to service', async () => {
    const { ctx, agentSkillService } = makeCtx();
    const spy = vi.spyOn(agentSkillService, 'detect');
    const handlers = agentSkillHandlers(ctx);
    await handlers['skill:detect']!();
    expect(spy).toHaveBeenCalled();
  });

  it('skill:install wraps result in {ok:true}', async () => {
    const { ctx } = makeCtx();
    const handlers = agentSkillHandlers(ctx);
    const r = await handlers['skill:install']!();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.canonicalPath).toBeDefined();
  });

  it('skill:install catches errors → {ok:false, error:"io_error"}', async () => {
    const { ctx, agentSkillService } = makeCtx();
    vi.spyOn(agentSkillService, 'install').mockRejectedValue(new Error('disk full'));
    const handlers = agentSkillHandlers(ctx);
    const r = await handlers['skill:install']!();
    expect(r).toEqual({ ok: false, error: 'io_error', message: 'disk full' });
  });
});
```

- [ ] **Step 5: Implement handlers**

```ts
// src/main/ipc/handlers/agent-skill.ts
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

function wrapResult<T>(p: Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: 'io_error'; message?: string }> {
  return p.then(
    (result) => ({ ok: true as const, result }),
    (e: unknown) => ({
      ok: false as const,
      error: 'io_error' as const,
      message: e instanceof Error ? e.message : String(e),
    }),
  );
}

export function agentSkillHandlers(ctx: IpcContext): { [K in keyof IpcTypeMap]?: IpcTypeMap[K] } {
  return {
    'skill:detect': () => ctx.agentSkillService.detect(),
    'skill:install': () => wrapResult(ctx.agentSkillService.install()),
    'skill:update': () => wrapResult(ctx.agentSkillService.update()),
    'skill:remove': () => wrapResult(ctx.agentSkillService.remove()),
  };
}
```

- [ ] **Step 6: Register handler factory in `setup.ts`**

Add `agentSkillHandlers` import and add to `HANDLER_FACTORIES` array.

- [ ] **Step 7: Update license gate**

In `desktop/src/main/ipc/license-gate.ts`, add to the gated list:

```ts
  'skill:install',
  'skill:update',
  'skill:remove',
```

- [ ] **Step 8: Update preload allowlist**

In `desktop/src/preload/bridge.ts`, add 4 channels to the allowlist.

- [ ] **Step 9: Run all tests + verification gate**

```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check \
  src/shared/types.ts \
  src/main/ipc/types.ts \
  src/main/ipc/context.ts \
  src/main/ipc/setup.ts \
  src/main/ipc/license-gate.ts \
  src/preload/bridge.ts \
  src/main/ipc/handlers/agent-skill.ts \
  tests/main/ipc/agent-skill-handlers.test.ts
```

- [ ] **Step 10: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add \
  desktop/src/shared/types.ts \
  desktop/src/main/ipc/types.ts \
  desktop/src/main/ipc/context.ts \
  desktop/src/main/ipc/setup.ts \
  desktop/src/main/ipc/license-gate.ts \
  desktop/src/preload/bridge.ts \
  desktop/src/main/ipc/handlers/agent-skill.ts \
  desktop/tests/main/ipc/agent-skill-handlers.test.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "$(cat <<'EOF'
feat(agent-skill): IPC layer (skill:detect/install/update/remove)

Wires AgentSkillService into IpcContext. Mutation channels gated by
license. Cross-process types in @shared/types so renderer can consume.
Handler wraps service exceptions into {ok:false, error:'io_error'}
discriminated union (consistent with mcp:configure shape).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Renderer API + McpSection UI restructure

**Files:**
- Modify: `desktop/src/renderer/lib/api/mcp.ts` — add `skillApi` exports
- Modify: `desktop/src/renderer/components/settings/McpSection.tsx` — new Step 1 panel

- [ ] **Step 1: Add renderer API**

In `desktop/src/renderer/lib/api/mcp.ts`, append:

```ts
import type {
  SkillDetectResult, SkillInstallResult, SkillRemoveResult,
} from '@shared/types';

export const skillApi = {
  detect: () => invoke('skill:detect') as Promise<SkillDetectResult>,
  install: () => invoke('skill:install') as Promise<
    | { ok: true; result: SkillInstallResult }
    | { ok: false; error: 'io_error'; message?: string }
  >,
  update: () => invoke('skill:update') as Promise<
    | { ok: true; result: SkillInstallResult }
    | { ok: false; error: 'io_error'; message?: string }
  >,
  remove: () => invoke('skill:remove') as Promise<
    | { ok: true; result: SkillRemoveResult }
    | { ok: false; error: 'io_error'; message?: string }
  >,
};
```

- [ ] **Step 2: Modify `McpSection.tsx` to add Step 1 panel above existing content**

Wrap the existing return block: add a new component `<SkillStep />` that renders the Step 1 panel, then the existing UI becomes `<Step2McpClients />` (visually labeled "步骤 2").

```tsx
import { skillApi } from '@renderer/lib/api/mcp';
import type { AgentHost, SkillDetectResult } from '@shared/types';

// ... existing imports

function SkillStep() {
  const qc = useQueryClient();
  const detectQuery = useQuery({
    queryKey: ['skill:detect'],
    queryFn: skillApi.detect,
    refetchInterval: 10_000,
  });

  const installMut = useMutation({
    mutationFn: () => skillApi.install(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(m.settings_skill_installed({ count: String(r.result.hostsLinked.length) }));
      } else {
        toast.error(m.settings_skill_install_failed(), { description: r.message });
      }
      qc.invalidateQueries({ queryKey: ['skill:detect'] });
    },
  });

  const updateMut = useMutation({
    mutationFn: () => skillApi.update(),
    onSuccess: (r) => {
      if (r.ok) toast.success(m.settings_skill_updated());
      else toast.error(m.settings_skill_install_failed(), { description: r.message });
      qc.invalidateQueries({ queryKey: ['skill:detect'] });
    },
  });

  const removeMut = useMutation({
    mutationFn: () => skillApi.remove(),
    onSuccess: (r) => {
      if (r.ok) toast.success(m.settings_skill_removed());
      else toast.error(m.settings_skill_install_failed(), { description: r.message });
      qc.invalidateQueries({ queryKey: ['skill:detect'] });
    },
  });

  const d = detectQuery.data;
  if (!d) return <p className="text-sm text-muted-foreground">{m.settings_skill_loading()}</p>;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{m.settings_skill_step_title()}</h3>
      <p className="text-xs text-muted-foreground">{m.settings_skill_step_help()}</p>

      {d.state === 'not_installed' ? (
        <div className="flex items-center justify-between rounded-md border p-3 bg-card">
          <div>
            <div className="text-sm font-medium">{m.settings_skill_status_not_installed()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {m.settings_skill_will_install_to({ hosts: d.detectedHosts.filter(h => h !== 'agentsShared').join(', ') || m.settings_skill_no_hosts() })}
            </div>
          </div>
          <Button onClick={() => installMut.mutate()} disabled={installMut.isPending}>
            {m.settings_skill_action_install()}
          </Button>
        </div>
      ) : (
        <div className="rounded-md border p-3 bg-card space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {d.needsUpdate ? m.settings_skill_status_outdated() : m.settings_skill_status_installed({ count: String(d.hostsLinked.length) })}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{d.canonicalPath}</div>
            </div>
            <div className="flex gap-2">
              {d.needsUpdate && (
                <Button size="sm" onClick={() => updateMut.mutate()} disabled={updateMut.isPending}>
                  {m.settings_skill_action_update()}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => removeMut.mutate()} disabled={removeMut.isPending}>
                {m.settings_skill_action_remove()}
              </Button>
            </div>
          </div>
          <ul className="text-xs text-muted-foreground list-disc pl-5">
            {d.hostsLinked.map((h) => <li key={h}>{hostLabel(h)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function hostLabel(h: AgentHost): string {
  switch (h) {
    case 'agentsShared': return '~/.agents/skills/';
    case 'claudeCode': return 'Claude Code (~/.claude/skills/)';
    case 'pi': return 'Pi (~/.pi/agent/skills/)';
    case 'codex': return 'Codex (~/.codex/skills/)';
  }
}
```

Then in the main `McpSection` return:

```tsx
return (
  <div className="space-y-6">
    <SkillStep />
    <div className="border-t pt-6 space-y-4">
      <h3 className="text-sm font-medium">{m.settings_mcp_step_title()}</h3>
      <p className="text-xs text-muted-foreground">{m.settings_mcp_step_help()}</p>
      {/* existing master toggle + client list */}
    </div>
  </div>
);
```

(Wrap the existing UI in the second `<div>`.)

- [ ] **Step 3: Verification gate**

Typecheck will fail until Task 5 (i18n keys) lands. That's expected — proceed.

- [ ] **Step 4: Commit (bundle with Task 5)**

Defer commit to Task 5 since UI references new i18n keys.

---

### Task 5: i18n keys

**Files:**
- Modify: `desktop/messages/en.json`
- Modify: `desktop/messages/zh-CN.json`

- [ ] **Step 1: Add to `en.json`**

```json
"settings_skill_step_title": "Step 1 · Install Agent Skill",
"settings_skill_step_help": "Lets AI agents know when to query your CarbonInk data. One copy goes to ~/.agents/skills/; symlinks are created for each detected agent host.",
"settings_skill_loading": "Detecting…",
"settings_skill_status_not_installed": "Not installed",
"settings_skill_status_installed": "Installed ✓ — synced to {count} host(s)",
"settings_skill_status_outdated": "Installed — update available",
"settings_skill_will_install_to": "Will sync to: {hosts}",
"settings_skill_no_hosts": "no agent hosts detected (only ~/.agents/skills/)",
"settings_skill_action_install": "Install",
"settings_skill_action_update": "Update",
"settings_skill_action_remove": "Remove",
"settings_skill_installed": "Installed Skill — synced to {count} host(s). Restart your AI agent to use it.",
"settings_skill_updated": "Skill updated.",
"settings_skill_removed": "Skill removed.",
"settings_skill_install_failed": "Skill operation failed",
"settings_mcp_step_title": "Step 2 · Configure MCP Clients",
"settings_mcp_step_help": "The Skill above tells agents WHEN to query CarbonInk. The MCP configuration below tells them HOW (which server, what tools)."
```

- [ ] **Step 2: Add matching `zh-CN.json`**

```json
"settings_skill_step_title": "步骤 1 · 安装 Agent Skill",
"settings_skill_step_help": "让 AI agent 知道何时该查询你的 CarbonInk 数据。会复制到 ~/.agents/skills/，并为检测到的每个 agent 创建 symlink。",
"settings_skill_loading": "检测中…",
"settings_skill_status_not_installed": "未安装",
"settings_skill_status_installed": "已安装 ✓ — 已同步到 {count} 个 host",
"settings_skill_status_outdated": "已安装 — 可更新",
"settings_skill_will_install_to": "将同步到: {hosts}",
"settings_skill_no_hosts": "未检测到 agent host（仅 ~/.agents/skills/）",
"settings_skill_action_install": "安装",
"settings_skill_action_update": "更新",
"settings_skill_action_remove": "移除",
"settings_skill_installed": "已安装 Skill — 同步到 {count} 个 host。请重启 AI agent 让 skill 生效。",
"settings_skill_updated": "Skill 已更新。",
"settings_skill_removed": "Skill 已移除。",
"settings_skill_install_failed": "Skill 操作失败",
"settings_mcp_step_title": "步骤 2 · 配置 MCP 客户端",
"settings_mcp_step_help": "上方的 Skill 告诉 agent 何时 该查询 CarbonInk；下方的 MCP 配置告诉它 如何 查（用哪个 server、有哪些工具）。"
```

- [ ] **Step 3: Compile paraglide + verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check messages/en.json messages/zh-CN.json src/renderer/components/settings/McpSection.tsx src/renderer/lib/api/mcp.ts
```

- [ ] **Step 4: Commit (bundles Task 4 + 5)**

```bash
git -C /Users/lxz/ws/personal/carbonbook add \
  desktop/messages/en.json \
  desktop/messages/zh-CN.json \
  desktop/src/renderer/paraglide \
  desktop/src/renderer/components/settings/McpSection.tsx \
  desktop/src/renderer/lib/api/mcp.ts
git -C /Users/lxz/ws/personal/carbonbook commit -m "$(cat <<'EOF'
feat(agent-skill): Step 1 Skill installer panel + bilingual i18n

Settings → Integrations now leads with a one-click Install Agent Skill
panel above the v1 MCP client config (now Step 2). Status reflects which
hosts got symlinks; Update offered when bundled SKILL.md changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: electron-builder extraResources

**Files:**
- Modify: `desktop/electron-builder.yml`

- [ ] **Step 1: Add `extraResources` block**

Find the `asarUnpack:` block (added in v1 Task 10). Add a sibling:

```yaml
extraResources:
  - from: agent-skill
    to: agent-skill
```

This copies `desktop/agent-skill/{SKILL.md,README.md}` to `<App>/Contents/Resources/agent-skill/` on macOS (and equivalent on Windows).

- [ ] **Step 2: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add desktop/electron-builder.yml
git -C /Users/lxz/ws/personal/carbonbook commit -m "$(cat <<'EOF'
build(electron-builder): bundle agent-skill/** for in-app installer

AgentSkillService reads bundled SKILL.md from process.resourcesPath
in production builds. extraResources is the cleanest way to ship a
flat dir alongside the asar bundle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Manual smoke (USER ACTION)

After Tasks 1-6 commit, restart `pnpm dev` so the new IPC service is loaded, then:

1. **Settings → Integrations** — verify new Step 1 panel renders with status "未安装"
2. Click **安装** — verify toast says "已安装 — 同步到 N 个 host"
3. Verify on disk:
   ```bash
   ls -la ~/.agents/skills/carbonink-mcp/
   ls -la ~/.claude/skills/carbonink-mcp 2>/dev/null
   ls -la ~/.pi/agent/skills/carbonink-mcp 2>/dev/null
   ls -la ~/.codex/skills/carbonink-mcp 2>/dev/null
   ```
4. **Edit `desktop/agent-skill/SKILL.md` slightly** (add a line), restart dev, refresh Settings
5. Status should change to "已安装 — 可更新" → click 更新 → verify file content updated
6. Click **移除** → verify all symlinks gone, canonical SKILL.md backed up at `~/.agents/skills/carbonink-mcp.carbonink-bak-*-SKILL.md`
7. **Re-install + test in pi**: open pi in any dir, ask "how many questionnaires do I have?" — should auto-call mcporter without needing the explicit "use mcporter" hint

Fill the result into the v1.1 row of the smoke table in `docs/specs/2026-05-26-pi-mcp-extension-design.md` then commit.

---

## Definition of Done

- All 6 implementer tasks committed
- Manual smoke (Task 7) recorded in spec
- `pnpm --filter carbonink test` ≥ baseline + ~15 new tests
- typecheck clean, biome clean on changed files
- electron-builder.yml has both `asarUnpack: out/mcp/**` AND `extraResources: agent-skill`
- License gate covers the 3 new mutation channels

## Known follow-ups (not v1.1)

- First-run popup offering Install on initial app launch
- Cursor / Claude Desktop install paths (different file conventions)
- "Open in agent" buttons that spawn a fresh agent session with the skill already loaded
- Auto-update Skill content when CarbonInk updates (currently requires user to click Update)
