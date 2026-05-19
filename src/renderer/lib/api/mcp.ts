import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `mcp:*` IPC channels.
 *
 * Phase 2 Block 4 — MCP Server status and Claude Desktop config integration.
 * `getStatus` reports whether the MCP binary is built and whether Claude
 * Desktop is already configured to connect to carbonbook.
 * `writeClaudeConfig` performs a merge-write into
 * ~/Library/Application Support/Claude/claude_desktop_config.json.
 */
export const mcpApi = {
  getStatus: () => invoke('mcp:get-status'),
  writeClaudeConfig: () => invoke('mcp:write-claude-config'),
};
