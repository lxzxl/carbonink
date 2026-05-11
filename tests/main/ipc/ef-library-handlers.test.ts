import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { efLibraryHandlers } from '@main/ipc/handlers/ef-library';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Smoke coverage for the read-only catalog handlers. Service-layer behaviour
 * (filter semantics, seed counts, etc.) is asserted in `ef-service.test.ts` —
 * here we just verify the IPC glue: input Zod-parsing + delegation.
 */
describe('ef-library IPC handlers', () => {
  let db: Database.Database;
  let handlers: ReturnType<typeof efLibraryHandlers>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const ctx = createIpcContext({ db, now: () => '2026-05-11T00:00:00.000Z' });
    handlers = efLibraryHandlers(ctx);
  });

  afterEach(() => db.close());

  it('ef:list with empty filter returns the full seeded catalog', () => {
    const rows = handlers['ef:list']?.({});
    // Migration 008 seeds 12 EFs.
    expect(rows?.length).toBe(12);
  });

  it('ef:list applies scope filter', () => {
    const rows = handlers['ef:list']?.({ scope: 2 });
    expect(rows?.length).toBeGreaterThan(0);
    for (const r of rows ?? []) expect(r.scope).toBe(2);
  });

  it('ef:list rejects invalid scope via ZodError', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
    expect(() => handlers['ef:list']?.({ scope: 7 } as any)).toThrow(z.ZodError);
  });

  it('ef:get-by-pk round-trips a known seeded EF', () => {
    const row = handlers['ef:get-by-pk']?.({
      factor_code: 'electricity.grid.cn.east.2024',
      year: 2024,
      source: 'MEE_China',
      geography: 'CN-East',
      dataset_version: '2024.q4',
    });
    expect(row).not.toBeNull();
    expect(row?.factor_code).toBe('electricity.grid.cn.east.2024');
  });

  it('ef:get-by-pk rejects missing fields via ZodError', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      handlers['ef:get-by-pk']?.({ factor_code: 'x' } as any),
    ).toThrow(z.ZodError);
  });

  it('units:list returns the canonical unit catalog', () => {
    const rows = handlers['units:list']?.();
    expect(rows?.length).toBeGreaterThan(0);
    const codes = new Set((rows ?? []).map((r) => r.unit));
    expect(codes.has('kWh')).toBe(true);
    expect(codes.has('kg')).toBe(true);
  });
});
