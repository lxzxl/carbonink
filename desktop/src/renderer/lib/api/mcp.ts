import type { McpClientId } from '@shared/types.js';
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
