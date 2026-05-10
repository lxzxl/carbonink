import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeAppDb, openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { organizationHandlers } from '@main/ipc/handlers/organization';
import { sanitize } from '@main/ipc/sanitize';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Exercises the IPC handler layer + the sanitize wrapper that production
 * `setupIpc()` applies. We don't go through `ipcMain.handle` here — that
 * path is covered by Electron itself; the wiring of channel name → handler
 * → service → DB is what we want test coverage for.
 */
describe('organization IPC handlers', () => {
  let dbPath: string;
  let handlers: ReturnType<typeof organizationHandlers>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cb-ipc-${Date.now()}-${Math.random()}.sqlite`);
    const db = openAppDb(dbPath);
    runMigrations(db);
    const ctx = createIpcContext({ db, now: () => '2026-05-09T00:00:00Z' });
    handlers = organizationHandlers(ctx);
  });

  afterEach(() => {
    closeAppDb();
    try {
      rmSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('org:has-any returns false on empty DB, true after a create', () => {
    expect(handlers['org:has-any']?.()).toBe(false);
    handlers['org:create']?.({
      name_zh: 'Acme',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    expect(handlers['org:has-any']?.()).toBe(true);
  });

  it('org:create round-trips via org:get-by-id', () => {
    const created = handlers['org:create']?.({
      name_en: 'Acme Co.',
      country_code: 'US',
      boundary_kind: 'equity_share',
    });
    if (!created) throw new Error('handler returned undefined');
    expect(created.id).toBeTruthy();
    const fetched = handlers['org:get-by-id']?.({ id: created.id });
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name_en).toBe('Acme Co.');
    expect(fetched?.boundary_kind).toBe('equity_share');
  });

  it('org:create with invalid input throws ZodError (missing required field)', () => {
    expect(() =>
      handlers['org:create']?.({
        // No name_zh and no name_en — Zod refine should reject
        country_code: 'CN',
        boundary_kind: 'operational_control',
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      } as any),
    ).toThrow(z.ZodError);
  });

  it('org:complete-onboarding writes all 3 tables atomically', () => {
    const result = handlers['org:complete-onboarding']?.({
      organization: {
        name_zh: '中山钢铁',
        country_code: 'CN',
        boundary_kind: 'operational_control',
      },
      first_site: { name_zh: '主厂区', country_code: 'CN' },
      reporting_period: { year: 2025, granularity: 'annual' },
    });
    if (!result) throw new Error('handler returned undefined');
    expect(result.organization.id).toBeTruthy();
    expect(result.site.organization_id).toBe(result.organization.id);
    expect(result.reporting_period.organization_id).toBe(result.organization.id);

    // Round-trip via the listing channels to confirm data is queryable.
    const sites = handlers['org:list-sites']?.({ organization_id: result.organization.id });
    const periods = handlers['org:list-reporting-periods']?.({
      organization_id: result.organization.id,
    });
    expect(sites?.length).toBe(1);
    expect(periods?.length).toBe(1);
    expect(periods?.[0]?.year).toBe(2025);
  });

  describe('sanitize wrapper (error mapping at the IPC boundary)', () => {
    it('rewrites ZodError into a short field-level message', async () => {
      const wrapped = sanitize(
        'org:create',
        handlers['org:create'] as (...a: unknown[]) => unknown,
      );
      // Missing name_zh + name_en triggers the .refine() ZodError.
      await expect(
        wrapped({
          country_code: 'CN',
          boundary_kind: 'operational_control',
          // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        } as any),
      ).rejects.toThrow(/Invalid input for org:create:/);
    });

    it('hides raw better-sqlite3 errors behind a correlation-id message', async () => {
      // Force a UNIQUE-violation by re-creating the singleton organization.
      handlers['org:create']?.({
        name_en: 'First',
        country_code: 'CN',
        boundary_kind: 'equity_share',
      });
      const wrapped = sanitize(
        'org:create',
        handlers['org:create'] as (...a: unknown[]) => unknown,
      );
      // Singleton check throws "Organization already exists ..." — the sanitize
      // wrapper should swallow that message and emit only a correlation id.
      await expect(
        wrapped({
          name_en: 'Second',
          country_code: 'CN',
          boundary_kind: 'equity_share',
          // biome-ignore lint/suspicious/noExplicitAny: handler accepts schema-typed input
        } as any),
      ).rejects.toThrow(/^IPC handler org:create failed \[[0-9a-f-]{36}\]$/);
    });
  });
});
