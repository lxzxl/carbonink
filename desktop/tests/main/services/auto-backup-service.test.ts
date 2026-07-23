/**
 * Workspace-aware auto-backup pass (spec 2026-07-23-backup-workspace-aware):
 * every registered workspace gets its own `auto-backups/<id>/` snapshot
 * stream with per-workspace retention + due-check; flat pre-workspace
 * files migrate into the default workspace's stream; one broken
 * workspace never blocks the rest. All seams injected via overrides —
 * no Electron, no live-connection singleton.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAutoBackupIfDue } from '@main/services/auto-backup-service';
import type { Workspace, WorkspaceRegistry } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
let backupsDir: string;

const WS_A: Workspace = {
  id: 'ws-a',
  name: '默认账套',
  file: 'app.sqlite',
  created_at: '2026-07-01T00:00:00.000Z',
};
const WS_B: Workspace = {
  id: 'ws-b',
  name: '客户B',
  file: 'workspace-b.sqlite',
  created_at: '2026-07-02T00:00:00.000Z',
};

function writeRegistry(workspaces: Workspace[], activeId: string): void {
  const registry: WorkspaceRegistry = { version: 1, workspaces, active_id: activeId };
  writeFileSync(join(dir, 'workspaces.json'), `${JSON.stringify(registry, null, 2)}\n`);
}

/** Minimal real sqlite file with a marker table (no app migrations needed). */
function seedDb(file: string, marker: string): void {
  const db = new Database(join(dir, file));
  db.exec('CREATE TABLE m (v TEXT)');
  db.prepare('INSERT INTO m (v) VALUES (?)').run(marker);
  db.close();
}

function run(overrides?: Parameters<typeof runAutoBackupIfDue>[0]) {
  return runAutoBackupIfDue({
    userDataDir: dir,
    backupsDir,
    // Active-workspace export seam: production checkpoints the live
    // connection; here a straight copy of the active file is equivalent.
    exportActive: (target) => copyFileSync(join(dir, WS_A.file), target),
    ...overrides,
  });
}

function backupsIn(workspaceId: string): string[] {
  const wsDir = join(backupsDir, workspaceId);
  if (!existsSync(wsDir)) return [];
  return readdirSync(wsDir).filter((f) => f.startsWith('auto-'));
}

/** Backdate every backup in a workspace stream so it reads as stale. */
function backdate(workspaceId: string, hoursAgo: number): void {
  const wsDir = join(backupsDir, workspaceId);
  const when = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  for (const f of readdirSync(wsDir)) {
    utimesSync(join(wsDir, f), when, when);
  }
}

function readMarker(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    const row = db.prepare('SELECT v FROM m LIMIT 1').get() as { v: string } | undefined;
    return row?.v ?? '';
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'carbonink-auto-backup-'));
  backupsDir = join(dir, 'auto-backups');
  mkdirSync(backupsDir, { recursive: true });
  seedDb(WS_A.file, 'marker-a');
  seedDb(WS_B.file, 'marker-b');
  writeRegistry([WS_A, WS_B], WS_A.id);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runAutoBackupIfDue (workspace-aware)', () => {
  it('first pass snapshots EVERY workspace into its own subdirectory', () => {
    const result = run();

    expect(result.ran).toBe(true);
    expect(backupsIn(WS_A.id)).toHaveLength(1);
    expect(backupsIn(WS_B.id)).toHaveLength(1);

    // The inactive workspace's snapshot is a faithful copy (checkpoint +
    // copy path), openable as sqlite with its own data.
    const bBackup = backupsIn(WS_B.id)[0];
    if (!bBackup) throw new Error('no backup for ws-b');
    expect(readMarker(join(backupsDir, WS_B.id, bBackup))).toBe('marker-b');
  });

  it('a rerun within 24h skips everything (per-workspace due-check)', () => {
    run();
    const second = run();

    expect(second).toEqual({ ran: false, reason: 'recent' });
    expect(backupsIn(WS_A.id)).toHaveLength(1);
    expect(backupsIn(WS_B.id)).toHaveLength(1);
  });

  it('only the stale workspace gets a new snapshot', () => {
    run();
    backdate(WS_B.id, 25);
    // Distinct filename for the second snapshot (timestamp has 1s
    // granularity) — shift the injected clock a minute forward.
    const result = run({ now: () => Date.now() + 60_000 });

    expect(result.ran).toBe(true);
    expect(backupsIn(WS_A.id)).toHaveLength(1);
    expect(backupsIn(WS_B.id)).toHaveLength(2);
  });

  it('migrates flat pre-workspace files into the default workspace stream, preserving cadence', () => {
    const legacy = 'auto-20260101-000000.carbonink-backup';
    writeFileSync(join(backupsDir, legacy), 'legacy backup bytes');

    const result = run();

    // Moved under the app.sqlite-backed workspace, nothing flat left.
    expect(backupsIn(WS_A.id)).toContain(legacy);
    expect(readdirSync(backupsDir).filter((f) => f.startsWith('auto-'))).toHaveLength(0);
    // Its (fresh) mtime counts toward the due-check → A skipped this
    // pass, B still snapshotted.
    expect(backupsIn(WS_A.id)).toHaveLength(1);
    expect(backupsIn(WS_B.id)).toHaveLength(1);
    expect(result.ran).toBe(true);
  });

  it('skips a created-but-never-opened workspace (no db file yet)', () => {
    const wsC: Workspace = {
      id: 'ws-c',
      name: '新客户',
      file: 'workspace-c.sqlite',
      created_at: '2026-07-23T00:00:00.000Z',
    };
    writeRegistry([WS_A, WS_B, wsC], WS_A.id);

    const result = run();

    expect(result.ran).toBe(true);
    expect(backupsIn(WS_A.id)).toHaveLength(1);
    expect(backupsIn(WS_B.id)).toHaveLength(1);
    expect(backupsIn(wsC.id)).toHaveLength(0);
  });

  it('one corrupt workspace file does not block the others', () => {
    writeFileSync(join(dir, WS_B.file), 'this is not a sqlite database');

    const result = run();

    expect(result.ran).toBe(true);
    expect(backupsIn(WS_A.id)).toHaveLength(1);
    expect(backupsIn(WS_B.id)).toHaveLength(0);
  });

  it('prunes each workspace stream to its own retention window', () => {
    const wsDir = join(backupsDir, WS_A.id);
    mkdirSync(wsDir, { recursive: true });
    for (let i = 0; i < 8; i++) {
      const name = `auto-2026010${i}-000000.carbonink-backup`;
      writeFileSync(join(wsDir, name), `old snapshot ${i}`);
    }
    backdate(WS_A.id, 25);

    run();

    // 8 old + 1 new → pruned to 7; B has its own independent single.
    expect(backupsIn(WS_A.id)).toHaveLength(7);
    expect(backupsIn(WS_B.id)).toHaveLength(1);
  });
});
