import { runMigrations } from '@main/db/migrate';
import { McpIntegrationService, type PathResolver } from '@main/services/mcp-integration-service';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

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
      args: ['/Applications/CarbonInk.app/Contents/Resources/app.asar.unpacked/out/mcp/index.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});
