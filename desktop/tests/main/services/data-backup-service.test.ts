/**
 * DataBackupService against the workspace-aware path contract
 * (spec 2026-07-23-backup-workspace-aware): export / import / reset must
 * operate on the file the live connection was opened on — with client
 * workspaces that is NOT always `<userData>/app.sqlite`. A decoy
 * `app.sqlite` sits in userData in every test; the old hardcoded-path
 * behavior would hit it and fail these assertions.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAppDb, openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { DataBackupService } from '@main/services/data-backup-service';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userDataDir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userDataDir,
    relaunch: vi.fn(),
    quit: vi.fn(),
  },
}));

import { app } from 'electron';

const DECOY_CONTENT = 'DECOY app.sqlite — the pre-workspace hardcoded target';

let dir: string;
let wsPath: string;
let service: DataBackupService;

/** Create a real migrated CarbonInk db at `path` with a marker row. */
function seedDb(path: string, marker: string): void {
  const db = new Database(path);
  runMigrations(db);
  db.exec('CREATE TABLE IF NOT EXISTS test_marker (v TEXT)');
  db.prepare('INSERT INTO test_marker (v) VALUES (?)').run(marker);
  db.close();
}

function readMarker(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    const row = db.prepare('SELECT v FROM test_marker LIMIT 1').get() as { v: string } | undefined;
    return row?.v ?? '';
  } finally {
    db.close();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), 'carbonink-data-backup-'));
  state.userDataDir = dir;
  // Decoy at the legacy hardcoded location — must never be touched.
  writeFileSync(join(dir, 'app.sqlite'), DECOY_CONTENT);
  // The ACTIVE workspace is a non-default file, as after a workspace switch.
  wsPath = join(dir, 'workspace-abc.sqlite');
  seedDb(wsPath, 'marker-active-workspace');
  openAppDb(wsPath);
  service = new DataBackupService();
  vi.mocked(app.relaunch).mockClear();
  vi.mocked(app.quit).mockClear();
});

afterEach(() => {
  closeAppDb();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe('DataBackupService (workspace-aware paths)', () => {
  it('exportToFile copies the ACTIVE workspace db, not app.sqlite', () => {
    const target = join(dir, 'out.carbonink-backup');
    const result = service.exportToFile(target);

    expect(result.bytes_written).toBeGreaterThan(0);
    expect(readMarker(target)).toBe('marker-active-workspace');
    // Decoy untouched and NOT the source of the copy.
    expect(readFileSync(join(dir, 'app.sqlite'), 'utf8')).toBe(DECOY_CONTENT);
  });

  it('importFromFile replaces the ACTIVE workspace db and schedules a relaunch', () => {
    const backupPath = join(dir, 'restore-me.carbonink-backup');
    seedDb(backupPath, 'marker-from-backup');

    const result = service.importFromFile(backupPath);
    expect(result).toEqual({ ok: true });

    expect(readMarker(wsPath)).toBe('marker-from-backup');
    expect(readFileSync(join(dir, 'app.sqlite'), 'utf8')).toBe(DECOY_CONTENT);

    vi.advanceTimersByTime(300);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('importFromFile rejects a non-CarbonInk sqlite-less file without touching anything', () => {
    const bogus = join(dir, 'bogus.bin');
    writeFileSync(bogus, 'not a database at all');

    const result = service.importFromFile(bogus);
    expect(result.ok).toBe(false);
    expect(readMarker(wsPath)).toBe('marker-active-workspace');
    vi.advanceTimersByTime(300);
    expect(app.relaunch).not.toHaveBeenCalled();
  });

  it('reset deletes the ACTIVE workspace db and leaves other files alone', () => {
    service.reset();

    expect(existsSync(wsPath)).toBe(false);
    expect(readFileSync(join(dir, 'app.sqlite'), 'utf8')).toBe(DECOY_CONTENT);

    vi.advanceTimersByTime(300);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
  });
});
