import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const svc = new McpIntegrationService({
    db,
    paths,
    now: () => new Date('2026-05-26T12:00:00Z'),
    home,
  });
  return { svc, home, db };
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
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          carbonink: {
            command: '/fake/binary',
            args: ['/fake/out/mcp/index.js'],
            env: { ELECTRON_RUN_AS_NODE: '1' },
          },
        },
      }),
    );
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
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          carbonbook: { command: 'node', args: ['/fake/out/mcp/index.js'] },
        },
      }),
    );
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
