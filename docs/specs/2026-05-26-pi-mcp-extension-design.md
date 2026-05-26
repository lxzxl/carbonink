# MCP Integration UX — Design

**Date:** 2026-05-26
**Status:** spec
**Trigger:** [Roadmap Item 5](../ROADMAP.md) → [Pi integration spike](../research/2026-05-26-pi-integration-spike.md) recommends starting here as the lowest-risk entry to the Pi ecosystem. Brainstorm clarified that the goal is **general-purpose MCP support**, not Pi-specific packaging.

## Goal

The MCP server in [`desktop/src/mcp/`](../../desktop/src/mcp/) already exposes 9 tools + 2 resource types and works end-to-end. What's missing is **discoverability and connection** — today the only way to use it is by manually editing some MCP client's config file with absolute paths that break the moment the app moves.

Ship a Settings sub-page that auto-configures the major MCP clients (Claude Desktop, Claude Code, Cursor) so an existing CarbonInk user can opt them into reading their carbon data in two clicks. Stay general-purpose: no Pi-specific extension packaging, no marketing surface, no Skill.md.

Strategic context: introducing Pi/MCP to carbonink is **internal architecture learning, not a customer-facing Pi push** (recorded as a project-scope principle in the user's agent memory; relevant for all downstream Pi roadmap items). v1 of Item 5 is the cheapest credible proof we understand how to expose carbonink data through a standard agent protocol.

## Architecture

Three layers, mirroring the existing IPC handler pattern:

```
┌─ desktop/src/main/services/mcp-integration-service.ts ───┐  ← new
│   detectClients(): Record<ClientId, ClientStatus>         │
│   configureClient(id): { configPath, backupPath }         │
│   removeClient(id): { configPath, backupPath? }           │
│   getServerEntry(): { command, args, env }                │
└───────────────────────────────────────────────────────────┘
                          ▲
                          │ IPC
┌─ desktop/src/main/ipc/handlers/mcp-integration.ts ───────┐  ← new
└───────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─ desktop/src/renderer/routes/settings/integrations.tsx ──┐  ← new
│   Master toggle + per-client rows                         │
└───────────────────────────────────────────────────────────┘

Reused unchanged:
• desktop/src/mcp/* — the MCP server itself
• vite.mcp.config.ts — its build script
• desktop/src/main/services/audit-event-service.ts — for traceability
• desktop/messages/* — paraglide i18n
```

The MCP server is **spawned on demand** by each MCP client over stdio; nothing runs from CarbonInk's side until a client connects. That's a property of the existing server, not a design choice we're making. Implication: the master toggle in Settings does NOT start/stop a process — it governs whether the Settings page lets the user add/remove client config entries. The server itself is reachable as long as the binary path on disk is valid.

### Runtime: `ELECTRON_RUN_AS_NODE=1`

Production users do not have `node` on PATH. We exploit Electron's built-in Node runtime by passing `ELECTRON_RUN_AS_NODE=1` as an env var, which makes the Electron binary behave as a vanilla Node process:

```json
{
  "command": "<process.execPath>",
  "args": ["<unpacked path to out/mcp/index.js>"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

This eliminates the "requires node on PATH" support burden entirely. The price: a hard dependency on the user's installed CarbonInk binary location, which is fine — these clients only exist because CarbonInk is installed.

### Path resolution (dev vs production)

| | binary (`command`) | server (`args[0]`) |
|---|---|---|
| Dev (`pnpm dev`) | `process.execPath` (electron-vite's Electron) | `path.join(app.getAppPath(), 'out/mcp/index.js')` |
| Production | `process.execPath` (CarbonInk.app/.exe) | `path.join(process.resourcesPath, 'app.asar.unpacked/out/mcp/index.js')` |

Distinguished via `app.isPackaged`. Dev mode still lets you configure clients (handy for local debugging) but adds a warning toast: "Dev build paths. Reconfigure after switching to a packaged build."

## Components

### `mcp-integration-service.ts` (main process)

```ts
type ClientId = 'claudeDesktop' | 'claudeCode' | 'cursor' | 'pi';

type ClientStatus =
  | { installed: false }
  | { installed: true; configured: false; configPath: string }
  | { installed: true; configured: true;  configPath: string;
      entryDiffersFromCurrent: boolean };

type ServerEntry = {
  command: string;
  args: string[];
  env: { ELECTRON_RUN_AS_NODE: '1' };
};

interface McpIntegrationService {
  detectClients(): Promise<Record<ClientId, ClientStatus>>;
  configureClient(id: ClientId): Promise<{
    configPath: string;
    backupPath: string | null;  // null when noChange
    noChange?: true;
  }>;
  removeClient(id: ClientId): Promise<{
    configPath: string;
    backupPath: string | null;
  }>;
  getServerEntry(): ServerEntry;
}
```

Pi's `ClientStatus` is special: `installed` reflects whether `~/.pi/` exists, but `configured` is always `false` and `configureClient('pi')` throws `PiNotSupportedError` — the UI hides the Configure button and renders a "View setup instructions" link instead.

Per-path mutex via `Map<string, Promise<void>>` serializes overlapping calls to the same config file.

### `ipc/handlers/mcp-integration.ts`

Three IPC channels matching the service API. Zod schemas validate input (`ClientId` enum). Reuses [`sanitize.ts`](../../desktop/src/main/ipc/sanitize.ts) for path-bearing responses.

### `routes/settings/integrations.tsx`

New Settings sub-page accessible from the existing Settings shell. Layout:

```
┌─ Integrations ────────────────────────────────────────────┐
│ [ ] Enable MCP integration                                 │
│      Let external AI tools read (and write) your carbon    │
│      data through the Model Context Protocol.              │
│                                                            │
│ Server binary:  /Applications/CarbonInk.app/...            │
│ Server script:  .../app.asar.unpacked/out/mcp/index.js     │
│                                                            │
│ Clients                                                    │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Claude Desktop      [Configured ✓]    [Reconfigure]   │ │
│ │ Claude Code         [Not configured]  [Configure]     │ │
│ │ Cursor              [Not detected]    [—]             │ │
│ │ Pi                  [Manual setup]    [View guide →]  │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

The "Server binary" / "Server script" rows are intentionally exposed for debugging — when a configured client fails, the first question is always "is that path still valid?" and answering it should not require devtools.

## Data flow

### Detect (on page mount + manual refresh)

Per client: stat the canonical config path; if present, parse and look for an entry matching either `"carbonink"` (the canonical key) or any key whose `args[0]` resolves to our `out/mcp/index.js`. The second check catches legacy `"carbonbook"` keys and user-renamed entries.

If found and the resolved entry equals `getServerEntry()` byte-for-byte → `configured: true, entryDiffersFromCurrent: false`. Otherwise `entryDiffersFromCurrent: true` and the button reads "Reconfigure."

### Configure

1. Read existing config (or `{}` if missing). Create parent dir if needed (mode 0755).
2. If existing carbonink entry equals target → return `{ noChange: true }`, no backup, no write.
3. Otherwise: write `<path>.carbonink-bak-<ISO timestamp>` containing the pre-merge content.
4. Mutate the parsed object: insert `mcpServers.carbonink = getServerEntry()`. If a legacy key was found (different name, same path), delete it in the same write.
5. Atomic write: `fs.writeFile(<tmp>, ...)` then `fs.rename(<tmp>, <final>)`.
6. Audit-log `mcp_integration.configure` with `{ clientId, configPath, backupPath, replacedKey? }`.
7. Return `{ configPath, backupPath }`.
8. Toast: **"Configured `<ClientName>`. Restart `<ClientName>` to apply."**

### Remove

Mirror of configure: backup, delete `mcpServers.carbonink`, atomically write. If `mcpServers` becomes `{}`, delete the key entirely to keep the config tidy. No-op if entry was never present.

### Backup retention

After each backup write, list `<path>.carbonink-bak-*` files for the same target, sort by mtime desc, delete all but the newest 3. Never touch backups whose name doesn't match our pattern.

## Per-client config formats

### Claude Desktop

```
macOS:    ~/Library/Application Support/Claude/claude_desktop_config.json
Windows:  %APPDATA%\Claude\claude_desktop_config.json
Linux:    ~/.config/Claude/claude_desktop_config.json
```

Top-level shape: `{ mcpServers: { [key]: { command, args, env? } }, ... }`. We write only `mcpServers.carbonink`; everything else is preserved.

### Claude Code

```
macOS/Linux:  ~/.claude.json
Windows:      %USERPROFILE%\.claude.json
```

Top-level is a large config object with `mcpServers` as one key. Same entry shape as Claude Desktop. We touch only `mcpServers.carbonink`; the dozens of other Claude Code keys (cached experiments, onboarding state, oauth tokens, etc.) are preserved verbatim. **Critical**: never parse-then-stringify in a way that drops unknown keys.

### Cursor

```
macOS/Linux:  ~/.cursor/mcp.json
Windows:      %USERPROFILE%\.cursor\mcp.json
```

Top-level shape: `{ mcpServers: {...} }`. Entry shape is more flexible than Claude (supports both stdio `{command, args, env}` and HTTP `{type, url, headers}`); we write stdio identical to the Claude format.

### Pi (deferred)

Pi's coding-agent docs ([packages/coding-agent/docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs)) have no `mcp.md`. Pi reaches MCP through a bridge extension like [mavam/pi-mcporter](https://github.com/mavam/pi-mcporter), not a unified `mcpServers` config. Writing Pi's config in v1 means installing and configuring that extension — meaningfully more work and a Pi-specific code path.

v1 surfaces a **"View Pi setup guide"** link that opens a docs page explaining how to install pi-mcporter and register the carbonink server manually. When Pi gains native `mcpServers`-style config (likely soon given the ecosystem direction), promote it to first-class auto-configure.

## Naming conflicts and historical entries

The repo currently has three names for the same thing:

- **`carbonbook`** — git repo + spike doc filenames
- **`carbonink`** — `package.json` name, productName, MCP server's `Server({ name: 'carbonink' })`
- **`CarbonInk`** — user-facing brand

We standardize on **`carbonink`** for the MCP config key. Detection treats `carbonbook` (and anything whose `args[0]` matches our `out/mcp/index.js` regardless of key name) as a stale prior install; "Reconfigure" deletes the old key and writes the canonical one in the same atomic write.

If the user has a legitimate `carbonink` key pointing at a different MCP server (extremely unlikely but possible), Reconfigure pops a confirmation: "An entry named 'carbonink' exists pointing at `<other-path>`. Overwrite?"

## Error handling

| Scenario | Behavior |
|---|---|
| Config file is invalid JSON | Detection returns `{ error: 'invalid_json', path }`; UI shows the path with a hint to fix or back it up manually. We never try to repair. |
| Config file is read-only | Error toast with the OS error message verbatim. |
| Backup write fails | Abort the whole operation; main config untouched. |
| Atomic write fails after backup wrote | Tmp file left on disk; path logged; backup remains. User can restore from backup if needed. |
| `out/mcp/index.js` missing on disk | Detection returns all clients disabled; Settings shows red banner "MCP server file missing — reinstall CarbonInk." No Configure buttons render. |
| User moved CarbonInk.app between Configure and Reconfigure | Detection's `entryDiffersFromCurrent` flag flips → button text changes to "Reconfigure" → click rewrites with new path. |
| Two simultaneous Configure clicks | Per-path mutex serializes; second call returns idempotent `{ noChange: true }`. |
| Client doesn't pick up new config | Out of scope — toast tells user to restart the client. |

## Non-functional changes outside this feature

### `electron-builder.yml` — asarUnpack

The bundled MCP server script must be **outside** `app.asar` so MCP clients can `spawn` it. Add to [`electron-builder.yml`](../../desktop/electron-builder.yml):

```yaml
asarUnpack:
  - out/mcp/**
```

Without this, packaged builds fail at runtime with `ENOENT` when a client tries to spawn the server. Spike doc captured this as a hidden risk; this design promotes it to a hard requirement.

### Documentation page for Pi manual setup

A short markdown page describing the pi-mcporter route, linked from the "View Pi setup guide" button. v1 ships it as an inline modal/popover inside the Settings page (no new marketing-site URL needed — keeps the spec self-contained). If we later want a public URL, promote it to `cloud/web/src/pages/docs/`.

## Testing

### Unit — `tests/main/services/mcp-integration-service.test.ts`

`detectClients`:
- All three (Claude Desktop, Claude Code, Cursor) absent → all `installed: false`
- Present but `mcpServers` missing → `installed: true, configured: false`
- Present with `mcpServers.carbonink` matching target → `installed: true, configured: true, entryDiffersFromCurrent: false`
- Present with legacy `carbonbook` key pointing at our script → `configured: true, entryDiffersFromCurrent: true`
- Present but invalid JSON → `{ error: 'invalid_json' }`

`configureClient`:
- First write: parent dir missing → created; no backup (no origin file)
- Second write with same content → `{ noChange: true }`, no backup, no write
- Different content → backup created, atomic rename happened, audit event logged
- Backup write fails → throws; main file unchanged
- Legacy key present → deleted in same write as new key inserted
- Concurrent calls to same client → second resolves with no-change

`removeClient`:
- Removes the key; if `mcpServers` empty afterward, removes that too
- No entry present → no-op

Backup retention: write 5 backups → only newest 3 remain on disk.

**Test fixtures**: real `fs` against `os.tmpdir()` per test, never mocked. Atomic write semantics must be exercised for real.

### IPC — `tests/main/ipc/mcp-integration-handlers.test.ts`

Sanity tests against the same patterns as [`tests/main/ipc/settings-handlers.test.ts`](../../desktop/tests/main/ipc/settings-handlers.test.ts). Zod validation rejects invalid `clientId`.

### Renderer — `tests/renderer/settings-integrations.test.tsx`

React Testing Library:
- Master toggle off → all Configure buttons disabled
- Configure click → IPC mock invoked, loading state, success toast
- Status chip text matches client state
- Pi row shows "View guide" link instead of Configure

### Manual smoke (release notes)

```
1. pnpm desktop:build && open out/mac/CarbonInk.app
2. Settings → Integrations → MCP — verify Claude Desktop/Code/Cursor detection
3. Click Configure Claude Desktop → verify ~/Library/.../claude_desktop_config.json updated
4. Restart Claude Desktop — verify the carbonink MCP server is listed and lists 9 tools
5. In Claude Desktop ask "list all questionnaires" — verify real data returns
6. Move CarbonInk.app to a different folder; reopen Settings — verify Reconfigure
7. Click Remove — verify entry deleted; backup file remains on disk
```

### Out of testing scope

- E2E with real Pi/Claude Code/Cursor (CI can't install all three)
- Windows path edge cases (manual smoke on Windows before release)
- MCP server's own functional tests (covered indirectly through existing service tests)

## Out of scope (explicit)

- ❌ Pi auto-configure (deferred until Pi adds native `mcpServers` config)
- ❌ Skill.md / Pi extension packaging (against the internal-architecture rationale recorded in agent memory)
- ❌ npm publish of any package
- ❌ First-run popup / auto-detect-and-prompt (deferred to v1.x — design B from brainstorm)
- ❌ Default-on auto-configure (rejected; violates least surprise)
- ❌ Runtime health monitoring of MCP server (user discovers issues through their client)
- ❌ Per-tool permission prompts (`set_answer`, `create_activity` ship unguarded — audit-event + undo-manager cover the recovery story)
- ❌ Migration of user-created entries pointing at third-party MCP servers (only legacy carbonink/carbonbook keys get auto-rewritten)
- ❌ iCloud-Drive sync of `mcpServers` across multiple Macs (non-issue; configs are local)

### Verified smoke run (record date + result here when first done)

| Date | Builder | Platform | Step 1 (build) | Step 2 (detect) | Step 3 (configure) | Step 4 (Claude lists tools) | Step 5 (data query) | Step 6 (move app → Reconfigure) | Step 7 (remove) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-05-26 | lxz | macOS (darwin arm64, dev mode) | ⚠️ dev only — packaged `electron-builder` blocked by pre-existing schema issues (mac.notarize boolean, win.sign) outside MCP scope; `pnpm dev` + `pnpm build:mcp` succeed | ✅ | ✅ Claude Desktop (then Claude Code to expose carbonink to mcporter) | ✅ | ✅ via Claude Desktop direct + Pi via pi-mcporter + skill | N/A (not exercised — dev paths anyway) | ✅ after legacy-carbonbook symmetry fix (`a003f75`) |

### Bugs surfaced + fixed during smoke

- `a003f75` — `removeClient` only matched key name `carbonink`, missed legacy `carbonbook` entries. Symmetric `args[0]` match now mirrors `configureClient`.
- `271f72b` — `McpSection` mutations ignored `{ok:false}` returns from IPC handler; success toast fired regardless. Now branches on `r.ok` with discriminated-union handling.
- `bf4517b` — `ConfigureResult.backupPath: string` (non-nullable) was hidden via `as string` cast; first-write returns `null` legitimately. Type widened, cast removed.

---

### v1.1 Verified smoke run

| Date | Builder | Platform | Step 1 (UI renders both steps) | Step 2 (detect) | Step 3 (install) | Step 4 (symlinks created) | Step 5 (agent auto-calls via skill) | Step 6 (update flow) | Step 7 (remove) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-05-26 | lxz | macOS (darwin arm64, dev mode) | ✅ Step 1 Skill panel above Step 2 MCP table | ✅ | ✅ | ✅ canonical at `~/.agents/skills/carbonink-mcp/`, symlinks to `~/.claude/skills/`, `~/.pi/agent/skills/` | ✅ pi + Claude Code answer "how many questionnaires" via MCP without explicit `mcporter` hint | not explicitly re-tested (service has unit coverage) | ✅ |

### Follow-ups surfaced during v1.1 smoke (not blocking)

- Packaged build remains blocked by pre-existing `electron-builder` v26 schema issues in `electron-builder.yml` (mac.notarize must be boolean, win.sign/signingHashAlgorithms unknown). Not MCP-related; separate fix needed before next release.
- Manual smoke step 6 ("move app → Reconfigure") deferred since dev paths under `node_modules` are inherently unstable; only meaningful after packaged build.
- `npx skills` (vercel-labs/skills) integration explicitly out of scope per v1.1 brainstorm — ESG-consultant audience won't run terminal commands. In-app installer covers them. Reconsider if developer-user demand grows.

## References

---

## v1.1 — Agent Skill Installer

**Date:** 2026-05-26 (same-day increment)
**Status:** spec
**Trigger:** v1 smoke surfaced two real problems: (1) Pi via pi-mcporter doesn't auto-call MCP tools because of pi-mcporter's "CLI > MCP" single-bridge design, so the user has to explicitly say "use mcporter to ...", and (2) ESG-consultant users won't run `npx skills add` from a terminal. Solution: ship a portable [Agent Skill](https://agentskills.io/specification) (`SKILL.md`) that teaches any MCP-aware agent when and how to call carbonink, with a **one-click in-app installer** so non-technical users get the same outcome as `npx skills add` users.

### Goal

Lift the Settings → MCP page from "configure the MCP server" to **"integrate with AI agents"**. Step 1 is **install the Skill** (the missing primer that makes agents actually call our MCP tools). Step 2 is **configure the MCP server in each AI agent** (the existing v1 work). The Skill section is the new headline; MCP becomes the technical prerequisite.

Non-developer users (the target audience for CarbonInk) get a single big button that copies the bundled `SKILL.md` into all installed agent skill directories. Developer users can still install via [`npx skills`](https://github.com/vercel-labs/skills) or `git clone` against the same bundled file (mirrored to a public repo).

### Architecture

```
┌─ desktop/agent-skill/SKILL.md ─────────────┐  ← bundled source of truth
│ (already exists from v1)                    │
└─────────────────────────────────────────────┘
                  │
                  │ electron-builder extraResources: agent-skill/**
                  ▼
┌─ <Resources>/agent-skill/SKILL.md ─────────┐  ← available at runtime
└─────────────────────────────────────────────┘
                  │
                  │ AgentSkillService.install()
                  ▼
┌─ ~/.agents/skills/carbonink-mcp/SKILL.md ──┐  ← canonical install location
└─────────────────────────────────────────────┘
                  │
                  │ symlinks per detected host
                  ▼
┌─ ~/.claude/skills/carbonink-mcp     ───────┐ (if ~/.claude/skills/ exists)
│  ~/.pi/agent/skills/carbonink-mcp    ───────┐ (if ~/.pi/agent/skills/ exists)
│  ~/.codex/skills/carbonink-mcp       ───────┐ (if ~/.codex/skills/ exists)
└─────────────────────────────────────────────┘
```

The canonical location is **`~/.agents/skills/`** (the shared cross-host convention; pi and Claude Code both already follow it via symlinks). Per-host dirs get symlinks ONLY if their parent dir already exists — avoids creating phantom config for hosts the user doesn't have installed.

### Components

#### `agent-skill-service.ts` (main process, new)

```ts
type AgentHost = 'claudeCode' | 'claudeDesktop' | 'cursor' | 'pi' | 'codex' | 'agentsShared';

type HostStatus =
  | { installed: false }
  | { installed: true; linkPath: string; isOurSymlink: boolean };

type SkillInstallStatus =
  | { state: 'not_installed' }
  | { state: 'installed'; canonicalPath: string; hostsLinked: AgentHost[]; needsUpdate: boolean }
  | { state: 'modified_by_user'; canonicalPath: string; hostsLinked: AgentHost[] };

interface AgentSkillService {
  detect(): Promise<SkillInstallStatus & { detectedHosts: AgentHost[] }>;
  install(): Promise<{ canonicalPath: string; hostsLinked: AgentHost[] }>;
  update(): Promise<{ canonicalPath: string; hostsLinked: AgentHost[] }>;
  remove(): Promise<{ removed: string[] }>;
  getBundledShasum(): Promise<string>;
}
```

State derivation:
- `not_installed` — `~/.agents/skills/carbonink-mcp/SKILL.md` doesn't exist
- `installed` — exists; sha matches bundled (`needsUpdate: false`) or differs (`needsUpdate: true`)
- `modified_by_user` — exists; sha differs from bundled BUT the file has user-added marker / differs in non-trivial ways. v1.1 keeps it simple: if sha differs and the install was through us, just call it `needsUpdate: true`. Genuine user-edits are not detected separately; user manually edited files are overwritten on Update (with a backup).

#### `ipc/handlers/agent-skill.ts` (new)

Four channels matching the service API. Reuses `license-gate.ts` for the three mutation channels (install/update/remove).

#### `routes/settings/integrations.tsx` (existing `McpSection.tsx`) — UI restructure

Top of section: new **Step 1 — Install Agent Skill** panel with one big button. Existing v1 four-client table becomes **Step 2 — Configure MCP Clients** below it. Layout:

```
┌─ 集成 AI Agent ────────────────────────────────────────────┐
│                                                            │
│ 步骤 1 · 安装 Agent Skill                                   │
│ ────────────────────────────                                │
│ 让 AI agent 知道何时该查询碳墨数据。                          │
│                                                            │
│ 状态: 未安装                              [一键安装]         │
│ — 或 —                                                     │
│ 状态: 已安装 ✓ — 同步给 X 个 host         [更新] [移除]      │
│   • Claude Code                                            │
│   • Pi                                                     │
│   • Cursor                                                 │
│                                                            │
│ [▾ 高级 / 其他工具]                                          │
│   完整 host → path 表 (printkk-style fallback)             │
│                                                            │
│ 步骤 2 · 配置 MCP 客户端                                     │
│ ────────────────────────────                                │
│ [现有 v1 四客户端表格不变]                                    │
└────────────────────────────────────────────────────────────┘
```

The "高级" disclosure section lists the per-host paths (read-only info) for users who prefer manual install or use a host we don't auto-detect.

### Data flow

#### Detect (page mount + after install/remove)

```
renderer mount
  └─ ipc.skill.detect()
       └─ service.detect()
            ├─ stat ~/.agents/skills/carbonink-mcp/SKILL.md → installed?
            ├─ if installed: sha256 → compare to bundled sha → needsUpdate?
            ├─ scan symlinks in ~/.claude/skills/, ~/.pi/agent/skills/,
            │    ~/.codex/skills/, ~/.cursor/rules/, etc.
            │    → which ones point at our canonical?
            └─ stat each host's parent dir → detectedHosts (where install would land)
```

Returns `{ state, hostsLinked, detectedHosts, needsUpdate }`.

#### Install

```
1. mkdir -p ~/.agents/skills/carbonink-mcp/
2. copy bundled SKILL.md → ~/.agents/skills/carbonink-mcp/SKILL.md
3. for each detectedHost (parent dir exists):
     symlink ~/.<host>/skills/carbonink-mcp → relative path to canonical
4. audit-log 'agent_skill.install' with { hostsLinked }
5. return { canonicalPath, hostsLinked }
```

Toast: **"已安装 Skill — 同步给 N 个 host。重启 AI agent 让 skill 生效。"**

#### Update

```
1. read existingRaw = readFileSync(canonical)
2. read bundledRaw = readFileSync(bundled)
3. if existingRaw === bundledRaw: return { noChange: true }
4. backup: write <canonical>.carbonink-bak-<ts>-<pid>
5. atomic write: tmp + rename → canonical
6. (symlinks are unchanged — they already point at canonical)
7. audit-log 'agent_skill.update'
```

#### Remove

```
1. for each ~/.<host>/skills/carbonink-mcp that's a symlink owned by us:
     unlink
2. for the canonical dir: backup the SKILL.md, then rm -rf
3. audit-log 'agent_skill.remove' with { removed: [paths...] }
```

### Host detection table

| Host | Parent dir checked | Link path on install |
|---|---|---|
| `agentsShared` | always (canonical install) | `~/.agents/skills/carbonink-mcp/` (real dir, not symlink) |
| `claudeCode` | `~/.claude/skills/` | `~/.claude/skills/carbonink-mcp → ../../.agents/skills/carbonink-mcp` |
| `pi` | `~/.pi/agent/skills/` | `~/.pi/agent/skills/carbonink-mcp → ../../../.agents/skills/carbonink-mcp` |
| `codex` | `~/.codex/skills/` | `~/.codex/skills/carbonink-mcp → ../../.agents/skills/carbonink-mcp` |
| `cursor` | `.cursor/rules/` in `cwd` (project-level only — Cursor pattern differs) | skip in v1.1; mention in advanced disclosure |
| `claudeDesktop` | no skill mechanism (system prompt is per-app) | skip |

v1.1 ships Claude Code + Pi + Codex auto-linking, plus the canonical agentsShared write. Cursor and Claude Desktop are advisory-only (printkk-style table).

### Bundling

Update `electron-builder.yml`:

```yaml
extraResources:
  - from: agent-skill
    to: agent-skill
```

This copies `desktop/agent-skill/{SKILL.md,README.md}` to `<App>/Contents/Resources/agent-skill/` on macOS, and equivalent on Windows. Service reads from `process.resourcesPath/agent-skill/SKILL.md` in production, `path.join(process.cwd(), 'desktop/agent-skill/SKILL.md')` in dev.

### Out of scope (v1.1)

- ❌ Auto-install on first launch / first-run popup (deferred to v1.2)
- ❌ `npx skills` integration UI (let advanced users use it from terminal — they already know how)
- ❌ Cursor + Claude Desktop auto-install (different convention; not symlink-friendly)
- ❌ Detecting user-edited skill files separately from "needs update" (overwrite + backup is the v1.1 model)
- ❌ Update notifications outside the Settings page (no toast tray nag)
- ❌ Per-skill versioning / rollback (skill is monolithic for v1.1)

### Naming reconciliation with v1 spec

The v1 "Out of scope" list said `❌ Skill.md / Pi extension packaging`. That referred specifically to **Pi-specific** Skill packaging (cb-pi pack, Pi-only conventions). The v1.1 skill is **portable / cross-host** and aligns with the agentskills.io standard — different category, doesn't conflict with the "internal architecture learning, not Pi-specific push" principle.

### Testing (v1.1)

Unit tests on `agent-skill-service.ts`:
- detect: returns `not_installed` when canonical absent
- detect: returns `installed` + correct `hostsLinked` when symlinks present
- detect: distinguishes our symlinks from random files at the same path (`isOurSymlink`)
- detect: sha mismatch → `needsUpdate: true`
- install: creates canonical + symlinks only for hosts with existing parent dir
- install: doesn't create phantom dirs for missing hosts
- install: idempotent (second call no-ops)
- update: writes backup, atomic rename, audit logged
- update: noChange branch
- remove: cleans both symlinks and canonical; backs up canonical SKILL.md

IPC tests follow `tests/main/ipc/mcp-integration-handlers.test.ts` pattern.

Renderer tests — same pattern as McpSection (component-level).

Manual smoke (added to the v1 smoke table):
1. `pnpm desktop:build && pnpm exec electron-builder --mac --publish never`
2. Launch packaged app
3. Settings → Integrations → click 一键安装
4. Verify `~/.agents/skills/carbonink-mcp/SKILL.md` exists + has bundled content
5. Verify expected symlinks exist (Claude Code + Pi + Codex if installed)
6. Restart agent host → ask "list carbonink questionnaires" → agent auto-uses MCP without explicit hint
7. Click 移除 → verify symlinks gone, canonical backed up

## References

- [Roadmap Item 5](../ROADMAP.md)
- [Pi integration spike 2026-05-26](../research/2026-05-26-pi-integration-spike.md)
- [Existing MCP server source](../../desktop/src/mcp/)
- [vite.mcp.config.ts build script](../../desktop/vite.mcp.config.ts)
- [electron-builder.yml](../../desktop/electron-builder.yml) — must add `asarUnpack`
- [audit-event-service.ts](../../desktop/src/main/services/audit-event-service.ts)
- [Settings handlers test pattern](../../desktop/tests/main/ipc/settings-handlers.test.ts)
- [MCP spec — server config](https://modelcontextprotocol.io/docs/concepts/servers)
- [mavam/pi-mcporter](https://github.com/mavam/pi-mcporter) — Pi bridge extension referenced in Pi deferral
- [Claude Desktop MCP docs](https://modelcontextprotocol.io/quickstart/user)
- [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol)
