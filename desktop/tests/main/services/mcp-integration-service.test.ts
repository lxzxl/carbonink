import { mkdirSync, mkdtempSync, readFileSync as readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import {
  McpIntegrationService,
  type PathResolver,
  PiNotSupportedError,
} from '@main/services/mcp-integration-service';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const tmpDirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeService(overrides: Partial<{ paths: PathResolver; now: () => Date }> = {}) {
  const db = new Database(':memory:');
  dbs.push(db);
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
  const home = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  tmpDirs.push(home);
  const db = new Database(':memory:');
  dbs.push(db);
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

describe('McpIntegrationService.configureClient', () => {
  it('Pi throws PiNotSupportedError', async () => {
    const { svc } = makeServiceWithTmpHome();
    await expect(svc.configureClient('pi')).rejects.toBeInstanceOf(PiNotSupportedError);
  });

  it('first write: creates parent dir, no backup, audit logged', async () => {
    const { svc } = makeServiceWithTmpHome();
    const result = await svc.configureClient('claudeDesktop');
    expect(result.noChange).toBeFalsy();
    expect(result.backupPath).toBeNull();
    const cfg = JSON.parse(readSync(result.configPath, 'utf-8'));
    expect(cfg.mcpServers.carbonink).toEqual({
      command: '/fake/binary',
      args: ['/fake/out/mcp/index.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('second identical write: noChange:true, no backup, no rewrite', async () => {
    const { svc } = makeServiceWithTmpHome();
    const first = await svc.configureClient('claudeDesktop');
    const beforeMtime = require('node:fs').statSync(first.configPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));
    const second = await svc.configureClient('claudeDesktop');
    expect(second).toEqual({
      configPath: first.configPath,
      backupPath: null,
      noChange: true,
    });
    expect(require('node:fs').statSync(first.configPath).mtimeMs).toBe(beforeMtime);
  });

  it('different existing content: writes backup with ISO timestamp', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }));
    const result = await svc.configureClient('claudeDesktop');
    expect(result.backupPath).toMatch(/\.carbonink-bak-\d{4}-\d{2}-\d{2}T/);
    const merged = JSON.parse(readSync(cfg, 'utf-8'));
    expect(merged.mcpServers.other).toBeDefined();
    expect(merged.mcpServers.carbonink).toBeDefined();
  });

  it('legacy carbonbook key + same script: deletes old key, writes carbonink', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: { carbonbook: { command: 'node', args: ['/fake/out/mcp/index.js'] } },
      }),
    );
    await svc.configureClient('claudeDesktop');
    const merged = JSON.parse(readSync(cfg, 'utf-8'));
    expect(merged.mcpServers.carbonbook).toBeUndefined();
    expect(merged.mcpServers.carbonink).toBeDefined();
  });

  it('concurrent configure calls: second resolves as noChange after first writes', async () => {
    const { svc } = makeServiceWithTmpHome();
    const [a, b] = await Promise.all([
      svc.configureClient('claudeDesktop'),
      svc.configureClient('claudeDesktop'),
    ]);
    const wrote = [a, b].filter((r) => !r.noChange);
    const skipped = [a, b].filter((r) => r.noChange);
    expect(wrote.length).toBe(1);
    expect(skipped.length).toBe(1);
  });

  it('preserves unknown top-level keys in Claude Code huge config', async () => {
    const { svc, home } = makeServiceWithTmpHome();
    const cfg = join(home, '.claude.json');
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {},
        hasCompletedOnboarding: true,
        oauthAccount: { secret: 'preserved' },
      }),
    );
    await svc.configureClient('claudeCode');
    const merged = JSON.parse(readSync(cfg, 'utf-8'));
    expect(merged.hasCompletedOnboarding).toBe(true);
    expect(merged.oauthAccount.secret).toBe('preserved');
    expect(merged.mcpServers.carbonink).toBeDefined();
  });
});
