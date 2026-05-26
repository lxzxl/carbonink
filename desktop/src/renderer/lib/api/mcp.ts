import type {
  McpClientId,
  SkillDetectResult,
  SkillInstallResult,
  SkillRemoveResult,
} from '@shared/types.js';
import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `mcp:*` IPC channels.
 *
 * Phase 2 redesign — the MCP service now exposes per-client detect /
 * configure / remove operations plus a `getServerEntry()` query for
 * the manual-setup fallback (Pi, future clients). The Settings →
 * Integrations sub-page consumes all four; AppSidebar derives a
 * single "any configured?" state from `detect()` for its status dot.
 */
export const mcpApi = {
  detect: () => invoke('mcp:detect'),
  configure: (clientId: McpClientId) => invoke('mcp:configure', { clientId }),
  remove: (clientId: McpClientId) => invoke('mcp:remove', { clientId }),
  getServerEntry: () => invoke('mcp:get-server-entry'),
};

/**
 * Per-domain renderer wrapper for the `skill:*` IPC channels (v1.1).
 *
 * The Agent Skill installer is Step 1 of Settings → Integrations
 * (above the v1 MCP client config in Step 2). `detect()` is polled
 * periodically so the UI tracks out-of-band changes; `install` /
 * `update` / `remove` mutate the user's `~/.agents/skills/carbonink/`
 * canonical copy and the per-host symlinks (claudeCode/pi/codex).
 *
 * The result casts mirror the IpcTypeMap declarations — kept explicit
 * here to make the consumer-facing API surface easy to read in
 * isolation from the main-process side.
 */
export const skillApi = {
  detect: () => invoke('skill:detect') as Promise<SkillDetectResult>,
  install: () =>
    invoke('skill:install') as Promise<
      { ok: true; result: SkillInstallResult } | { ok: false; error: 'io_error'; message?: string }
    >,
  update: () =>
    invoke('skill:update') as Promise<
      { ok: true; result: SkillInstallResult } | { ok: false; error: 'io_error'; message?: string }
    >,
  remove: () =>
    invoke('skill:remove') as Promise<
      { ok: true; result: SkillRemoveResult } | { ok: false; error: 'io_error'; message?: string }
    >,
};
