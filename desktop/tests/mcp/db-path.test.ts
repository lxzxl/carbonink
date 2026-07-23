/**
 * Workspace-aware DB path resolution for the standalone MCP server
 * (spec 2026-07-23-mcp-workspace-aware). Before this fix the server
 * always read `app.sqlite` — the DEFAULT workspace — so an external
 * agent queried the wrong client's ledger whenever the desktop app was
 * working in another workspace.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeWorkspaceFile, defaultDbPath } from '../../src/mcp/db';

let dir: string;

function writeRegistry(content: unknown): void {
  writeFileSync(
    join(dir, 'workspaces.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'carbonink-mcp-db-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('activeWorkspaceFile', () => {
  it('falls back to app.sqlite when no registry exists (pre-workspace install)', () => {
    expect(activeWorkspaceFile(dir)).toBe('app.sqlite');
  });

  it('resolves the active workspace file from the registry', () => {
    writeRegistry({
      version: 1,
      workspaces: [
        { id: 'ws-a', name: '默认账套', file: 'app.sqlite', created_at: 'x' },
        { id: 'ws-b', name: '客户B', file: 'workspace-b.sqlite', created_at: 'x' },
      ],
      active_id: 'ws-b',
    });
    expect(activeWorkspaceFile(dir)).toBe('workspace-b.sqlite');
  });

  it('degrades to the first workspace when active_id dangles', () => {
    writeRegistry({
      version: 1,
      workspaces: [{ id: 'ws-a', name: 'A', file: 'workspace-a.sqlite', created_at: 'x' }],
      active_id: 'ws-gone',
    });
    expect(activeWorkspaceFile(dir)).toBe('workspace-a.sqlite');
  });

  it('basenames a tampered file entry so the path cannot escape userData', () => {
    writeRegistry({
      version: 1,
      workspaces: [{ id: 'ws-a', name: 'A', file: '../../evil.sqlite', created_at: 'x' }],
      active_id: 'ws-a',
    });
    expect(activeWorkspaceFile(dir)).toBe('evil.sqlite');
  });

  it('falls back to app.sqlite on corrupt JSON or wrong version', () => {
    writeRegistry('{not json');
    expect(activeWorkspaceFile(dir)).toBe('app.sqlite');
    writeRegistry({ version: 2, workspaces: [], active_id: 'x' });
    expect(activeWorkspaceFile(dir)).toBe('app.sqlite');
  });
});

describe('defaultDbPath', () => {
  it('CARBONINK_MCP_DB override still wins over registry resolution', () => {
    const prev = process.env.CARBONINK_MCP_DB;
    process.env.CARBONINK_MCP_DB = '/tmp/override.sqlite';
    try {
      expect(defaultDbPath()).toBe('/tmp/override.sqlite');
    } finally {
      if (prev === undefined) delete process.env.CARBONINK_MCP_DB;
      else process.env.CARBONINK_MCP_DB = prev;
    }
  });
});
