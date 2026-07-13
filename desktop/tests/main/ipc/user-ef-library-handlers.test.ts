import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { userEfLibraryHandlers } from '@main/ipc/handlers/user-ef-library';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { showOpenDialog, showSaveDialog } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', async () => {
  const stub = await import('../../stubs/electron');
  return { ...stub, dialog: { ...stub.dialog, showOpenDialog, showSaveDialog } };
});

const CSV = ['name_zh,scope,year,input_unit,co2e_kg_per_unit', '柴油,1,2024,L,2.68'].join('\n');

let db: Database.Database;
let tmp: string;
let handlers: ReturnType<typeof userEfLibraryHandlers>;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  tmp = mkdtempSync(join(tmpdir(), 'carbonink-ef-lib-ipc-'));
  const ctx = createIpcContext(
    { db, now: () => '2026-07-12T00:00:00.000Z' },
    { uploadsDir: join(tmp, 'uploads') },
  );
  handlers = userEfLibraryHandlers(ctx);
  showOpenDialog.mockReset();
  showSaveDialog.mockReset();
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function pickCsv(content = CSV, filename = 'factors.csv') {
  const path = join(tmp, filename);
  writeFileSync(path, content, 'utf-8');
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] });
  return handlers['ef-library:pick-file']?.();
}

describe('ef-library:pick-file', () => {
  it('returns canceled when the dialog is dismissed', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(handlers['ef-library:pick-file']?.()).resolves.toEqual({ canceled: true });
  });

  it('stages a picked csv and returns the preview', async () => {
    const result = await pickCsv();
    if (!result || result.canceled !== false || !('preview' in result)) {
      throw new Error('expected a preview');
    }
    expect(result.preview.filename).toBe('factors.csv');
    expect(result.preview.validation.valid_count).toBe(1);
  });

  it('folds parse failures into the error variant', async () => {
    const result = await pickCsv('whatever', 'factors.txt');
    expect(result).toEqual({
      canceled: false,
      error: { _tag: 'EfImportParseFailed', code: 'unsupported_file_type', detail: 'factors.txt' },
    });
  });

  it('reports an unreadable path as file_read_failed', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [join(tmp, 'does-not-exist.csv')],
    });
    const result = await handlers['ef-library:pick-file']?.();
    expect(result).toEqual({
      canceled: false,
      error: { _tag: 'EfImportParseFailed', code: 'file_read_failed' },
    });
  });
});

describe('staged import round-trip through handlers', () => {
  it('imports, lists, revalidates, and deletes via IPC glue', async () => {
    const picked = await pickCsv();
    if (!picked || picked.canceled !== false || !('preview' in picked)) {
      throw new Error('expected a preview');
    }
    const { token, mapping } = picked.preview;

    const revalidated = handlers['ef-library:revalidate']?.({ token, mapping });
    expect(revalidated?.valid_count).toBe(1);

    const imported = handlers['ef-library:import']?.({
      token,
      name: '台账',
      version: 'v1',
      allow_replace: false,
      mapping,
    });
    expect(imported).toMatchObject({ ok: true, imported_count: 1 });

    const libraries = handlers['ef-library:list']?.();
    expect(libraries).toHaveLength(1);
    expect(libraries?.[0]).toMatchObject({ name: '台账', source: 'user:台账', factor_count: 1 });

    const deleted = handlers['ef-library:delete']?.({ id: libraries?.[0]?.id as string });
    expect(deleted).toEqual({ ok: true, deleted_factor_count: 1 });
    expect(handlers['ef-library:list']?.()).toHaveLength(0);
  });

  it('discard invalidates the staged token', async () => {
    const picked = await pickCsv();
    if (!picked || picked.canceled !== false || !('preview' in picked)) {
      throw new Error('expected a preview');
    }
    expect(handlers['ef-library:discard']?.({ token: picked.preview.token })).toEqual({
      ok: true,
    });
    const result = handlers['ef-library:import']?.({
      token: picked.preview.token,
      name: 'X',
      version: '',
      allow_replace: false,
      mapping: picked.preview.mapping,
    });
    expect(result).toEqual({ ok: false, error: { _tag: 'TokenExpired' } });
  });

  it('zod-rejects malformed inputs', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      handlers['ef-library:revalidate']?.({ token: '', mapping: {} } as any),
    ).toThrow(z.ZodError);
    expect(() =>
      handlers['ef-library:import']?.({
        token: 't',
        name: 'X',
        version: '',
        allow_replace: 'yes',
        mapping: { scope: -1 },
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      } as any),
    ).toThrow(z.ZodError);
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
    expect(() => handlers['ef-library:delete']?.({} as any)).toThrow(z.ZodError);
  });
});

describe('ef-library:save-template', () => {
  it('returns canceled when the save dialog is dismissed', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await expect(handlers['ef-library:save-template']?.()).resolves.toEqual({ canceled: true });
  });

  it('writes the template xlsx to the chosen path', async () => {
    const target = join(tmp, 'template.xlsx');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const result = await handlers['ef-library:save-template']?.();
    expect(result).toEqual({ ok: true, path: target });
    expect(statSync(target).size).toBeGreaterThan(0);
  });
});
