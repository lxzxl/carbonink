import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { workspaceHandlers } from '@main/ipc/handlers/workspace';
import { configureWorkspaceSwitch } from '@main/workspace-switch';
import type { Database as DatabaseType } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => import('../../stubs/electron'));

let db: DatabaseType;
let tmp: string;
let handlers: ReturnType<typeof workspaceHandlers>;
let scheduled: Array<() => void>;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  tmp = mkdtempSync(join(tmpdir(), 'carbonink-workspace-ipc-'));
  const ctx = createIpcContext(
    { db, now: () => '2026-07-22T00:00:00.000Z' },
    { userDataDir: tmp, uploadsDir: join(tmp, 'uploads') },
  );
  scheduled = [];
  configureWorkspaceSwitch({
    workspaceService: ctx.workspaceService,
    cleanupIpc: vi.fn(),
    closeAppDb: vi.fn(),
    openAppDb: vi.fn().mockReturnValue({} as DatabaseType),
    runMigrations: vi.fn(),
    setupIpc: vi.fn(),
    reloadWindow: vi.fn(),
    schedule: (fn) => scheduled.push(fn),
  });
  handlers = workspaceHandlers(ctx);
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('workspace:* handler glue', () => {
  it('lists the bootstrapped default and creates/renames/switches', () => {
    const initial = handlers['workspace:list']?.() ?? [];
    expect(initial).toHaveLength(1);
    expect(handlers['workspace:get-active']?.()).toMatchObject({ file: 'app.sqlite' });

    const created = handlers['workspace:create']?.({ name: '客户甲' });
    if (!created?.ok) throw new Error('expected ok');
    expect(handlers['workspace:rename']?.({ id: created.workspace.id, name: '客户甲2026' })).toEqual(
      { ok: true },
    );

    expect(handlers['workspace:switch']?.({ id: created.workspace.id })).toEqual({ ok: true });
    expect(scheduled).toHaveLength(1);
    expect(handlers['workspace:get-active']?.()).toMatchObject({ name: '客户甲2026' });
  });

  it('propagates InvalidName and unknown-id failures', () => {
    expect(handlers['workspace:create']?.({ name: '   ' })).toEqual({
      ok: false,
      error: 'InvalidName',
    });
    expect(handlers['workspace:rename']?.({ id: 'missing', name: 'x' })).toEqual({ ok: false });
    expect(handlers['workspace:switch']?.({ id: 'missing' })).toEqual({ ok: false });
  });
});
