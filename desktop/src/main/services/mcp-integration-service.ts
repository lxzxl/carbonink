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
