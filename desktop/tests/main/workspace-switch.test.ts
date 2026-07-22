import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceService } from '@main/services/workspace-service';
import { configureWorkspaceSwitch, requestWorkspaceSwitch } from '@main/workspace-switch';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
let workspaceService: WorkspaceService;
let calls: string[];
let scheduled: Array<() => void>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'carbonink-switch-test-'));
  workspaceService = new WorkspaceService(dir);
  calls = [];
  scheduled = [];
  configureWorkspaceSwitch({
    workspaceService,
    cleanupIpc: () => calls.push('cleanupIpc'),
    closeAppDb: () => calls.push('closeAppDb'),
    openAppDb: (path: string) => {
      calls.push(`openAppDb:${path}`);
      return {} as Database;
    },
    runMigrations: () => calls.push('runMigrations'),
    setupIpc: () => calls.push('setupIpc'),
    reloadWindow: () => calls.push('reloadWindow'),
    schedule: (fn) => scheduled.push(fn),
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('requestWorkspaceSwitch', () => {
  it('replies ok, marks active, then runs the teardown→reopen→reload sequence', () => {
    const created = workspaceService.create('客户甲');
    if (!created.ok) throw new Error('expected ok');

    const result = requestWorkspaceSwitch(created.workspace.id);
    expect(result).toEqual({ ok: true });
    // Active is flipped immediately; the swap itself is deferred.
    expect(workspaceService.activeWorkspace().id).toBe(created.workspace.id);
    expect(calls).toEqual([]);

    scheduled[0]?.();
    expect(calls).toEqual([
      'cleanupIpc',
      'closeAppDb',
      `openAppDb:${join(dir, created.workspace.file)}`,
      'runMigrations',
      'setupIpc',
      'reloadWindow',
    ]);
  });

  it('rejects unknown ids without scheduling anything', () => {
    expect(requestWorkspaceSwitch('missing')).toEqual({ ok: false });
    expect(scheduled).toHaveLength(0);
  });

  it('switching to the already-active workspace is an ok no-op', () => {
    const active = workspaceService.activeWorkspace();
    expect(requestWorkspaceSwitch(active.id)).toEqual({ ok: true });
    expect(scheduled).toHaveLength(0);
  });
});
