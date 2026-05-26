import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  /** Override home directory (testing). Defaults to os.homedir(). */
  home?: string;
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

  private get home(): string {
    return this.deps.home ?? homedir();
  }

  private clientConfigPath(id: ClientId): string {
    const h = this.home;
    switch (id) {
      case 'claudeDesktop':
        if (process.platform === 'darwin')
          return join(h, 'Library/Application Support/Claude/claude_desktop_config.json');
        if (process.platform === 'win32')
          return join(
            process.env.APPDATA ?? join(h, 'AppData/Roaming'),
            'Claude/claude_desktop_config.json',
          );
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
    let parsed: {
      mcpServers?: Record<
        string,
        { command?: string; args?: string[]; env?: Record<string, string> }
      >;
    };
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
}
