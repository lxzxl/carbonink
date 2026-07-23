import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceService } from '@main/services/workspace-service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
let svc: WorkspaceService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'carbonink-workspace-test-'));
  svc = new WorkspaceService(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('WorkspaceService', () => {
  it('bootstraps app.sqlite as the default active workspace on first load', () => {
    const registry = svc.load();
    expect(registry.workspaces).toHaveLength(1);
    expect(registry.workspaces[0]).toMatchObject({ name: '默认账套', file: 'app.sqlite' });
    expect(registry.active_id).toBe(registry.workspaces[0]?.id);
    expect(existsSync(join(dir, 'workspaces.json'))).toBe(true);
    expect(svc.activeDbPath()).toBe(join(dir, 'app.sqlite'));
  });

  it('creates workspaces with generated sqlite basenames', () => {
    const created = svc.create('  客户甲  ');
    if (!created.ok) throw new Error('expected ok');
    expect(created.workspace.name).toBe('客户甲');
    expect(created.workspace.file).toMatch(/^workspace-[0-9a-z]{26}\.sqlite$/);
    expect(svc.list()).toHaveLength(2);
    // Creation does not switch — the default stays active.
    expect(svc.activeWorkspace().file).toBe('app.sqlite');
  });

  it('rejects blank and overlong names', () => {
    expect(svc.create('   ')).toEqual({ ok: false, error: 'InvalidName' });
    expect(svc.create('x'.repeat(61))).toEqual({ ok: false, error: 'InvalidName' });
    expect(svc.rename(svc.activeWorkspace().id, ' ')).toBe(false);
  });

  it('renames and switches active by id', () => {
    const created = svc.create('客户甲');
    if (!created.ok) throw new Error('expected ok');
    expect(svc.rename(created.workspace.id, '客户甲（2026）')).toBe(true);
    expect(svc.setActive(created.workspace.id)).toBe(true);
    expect(svc.activeWorkspace().name).toBe('客户甲（2026）');
    expect(svc.activeDbPath()).toBe(join(dir, created.workspace.file));
    expect(svc.dbPathOf('missing')).toBeNull();
    expect(svc.setActive('missing')).toBe(false);
  });

  it('persists across instances and survives a corrupt active_id', () => {
    const created = svc.create('客户乙');
    if (!created.ok) throw new Error('expected ok');
    svc.setActive(created.workspace.id);

    const reloaded = new WorkspaceService(dir);
    expect(reloaded.activeWorkspace().name).toBe('客户乙');

    const raw = JSON.parse(readFileSync(join(dir, 'workspaces.json'), 'utf-8'));
    raw.active_id = 'gone';
    writeFileSync(join(dir, 'workspaces.json'), JSON.stringify(raw), 'utf-8');
    expect(new WorkspaceService(dir).activeWorkspace().file).toBe('app.sqlite');
  });

  it('remove: refuses active/last/unknown, archives the db file otherwise', () => {
    const active = svc.activeWorkspace();
    expect(svc.remove(active.id)).toEqual({ ok: false, error: 'ActiveWorkspace' });
    expect(svc.remove('missing')).toEqual({ ok: false, error: 'NotFound' });

    const created = svc.create('客户丙');
    if (!created.ok) throw new Error('expected ok');
    // Simulate an opened workspace: db file + wal sibling exist.
    writeFileSync(join(dir, created.workspace.file), 'db-bytes', 'utf-8');
    writeFileSync(join(dir, `${created.workspace.file}-wal`), 'wal-bytes', 'utf-8');

    const removed = svc.remove(created.workspace.id);
    if (!removed.ok) throw new Error('expected ok');
    expect(removed.archived_file).toMatch(new RegExp(`^${created.workspace.file}\\.deleted-`));
    expect(svc.list()).toHaveLength(1);
    // Original files are gone; archived renames exist.
    expect(existsSync(join(dir, created.workspace.file))).toBe(false);
    expect(existsSync(join(dir, removed.archived_file as string))).toBe(true);
    expect(existsSync(join(dir, `${created.workspace.file}-wal`))).toBe(false);
  });

  it('remove: a never-opened workspace archives nothing but leaves the registry clean', () => {
    const created = svc.create('客户丁');
    if (!created.ok) throw new Error('expected ok');
    const removed = svc.remove(created.workspace.id);
    expect(removed).toEqual({ ok: true, archived_file: null });
    expect(svc.list()).toHaveLength(1);
  });

  it('re-bootstraps when the registry file is unreadable garbage', () => {
    writeFileSync(join(dir, 'workspaces.json'), '{"version":99}', 'utf-8');
    const registry = svc.load();
    expect(registry.version).toBe(1);
    expect(registry.workspaces[0]?.file).toBe('app.sqlite');
  });
});
