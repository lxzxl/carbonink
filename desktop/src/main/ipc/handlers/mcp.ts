import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

function resolveBinaryPath(): string {
  // Production: app.getAppPath() points to app.asar (or app.asar.unpacked).
  // Dev: __dirname is wherever the main bundle runs from.
  // We always emit out/mcp/index.js relative to the app root.
  if (app.isPackaged) {
    // app.asar.unpacked needed because index.js requires `node:sqlite`
    const unpacked = app.getAppPath().replace('app.asar', 'app.asar.unpacked');
    return join(unpacked, 'out', 'mcp', 'index.js');
  }
  // Dev: process.cwd() points to project root when launched via electron-vite
  return join(process.cwd(), 'out', 'mcp', 'index.js');
}

function resolveClaudeConfigPath(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
      'Claude',
      'claude_desktop_config.json',
    );
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

function readClaudeConfig(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

type ClaudeConfig = {
  mcpServers?: Record<string, { command: string; args: string[] }>;
};

export function mcpHandlers(_ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'mcp:get-status': () => {
      const binaryPath = resolveBinaryPath();
      const binaryBuilt = existsSync(binaryPath);
      const claudeConfigPath = resolveClaudeConfigPath();
      const config = readClaudeConfig(claudeConfigPath) as ClaudeConfig | null;
      const ourServer = config?.mcpServers?.carbonink;
      const referencesUs = !!ourServer && ourServer.args?.includes(binaryPath);
      return {
        binary_path: binaryBuilt ? binaryPath : null,
        binary_built: binaryBuilt,
        claude_config_path: claudeConfigPath,
        claude_config_present: !!config,
        claude_config_references_us: referencesUs,
      };
    },

    'mcp:write-claude-config': () => {
      try {
        const binaryPath = resolveBinaryPath();
        if (!existsSync(binaryPath)) {
          return {
            ok: false,
            error: 'MCP binary not built. Run `pnpm build` first.',
          };
        }
        const claudeConfigPath = resolveClaudeConfigPath();
        mkdirSync(dirname(claudeConfigPath), { recursive: true });
        const existing = (readClaudeConfig(claudeConfigPath) as ClaudeConfig | null) ?? {};
        const updated: ClaudeConfig = {
          ...existing,
          mcpServers: {
            ...(existing.mcpServers ?? {}),
            carbonink: { command: 'node', args: [binaryPath] },
          },
        };
        writeFileSync(claudeConfigPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
