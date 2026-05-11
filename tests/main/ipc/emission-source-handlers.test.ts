import { runMigrations } from '@main/db/migrate';
import { createIpcContext, type IpcContext } from '@main/ipc/context';
import { emissionSourceHandlers } from '@main/ipc/handlers/emission-source';
import type { Organization, Site } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Smoke coverage for emission-source IPC glue. The bulk of CRUD behaviour
 * (FK violations, soft-delete semantics, listByOrganization JOIN) is asserted
 * in `emission-source-service.test.ts`; here we verify the IPC wrapper
 * Zod-parses input + delegates without dropping any fields.
 */
describe('emission-source IPC handlers', () => {
  let db: Database.Database;
  let ctx: IpcContext;
  let handlers: ReturnType<typeof emissionSourceHandlers>;
  let org: Organization;
  let site: Site;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    ctx = createIpcContext({ db, now: () => '2026-05-11T00:00:00.000Z' });
    handlers = emissionSourceHandlers(ctx);
    org = ctx.organizationService.createOrganization({
      name_en: 'Acme',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    site = ctx.organizationService.createSite({
      organization_id: org.id,
      name_en: 'HQ',
      country_code: 'CN',
    });
  });

  afterEach(() => db.close());

  it('source:create round-trips via source:get-by-id', () => {
    const created = handlers['source:create']?.({
      site_id: site.id,
      name: 'Boiler #1',
      scope: 1,
      category: 'fuel.stationary',
    });
    if (!created) throw new Error('handler returned undefined');
    expect(created.id).toBeTruthy();
    expect(created.is_active).toBe(true);

    const fetched = handlers['source:get-by-id']?.({ id: created.id });
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe('Boiler #1');
  });

  it('source:list-by-site and source:list-by-org both return the new row', () => {
    handlers['source:create']?.({
      site_id: site.id,
      name: 'Grid meter',
      scope: 2,
      category: 'electricity.grid',
    });
    const bySite = handlers['source:list-by-site']?.({ site_id: site.id });
    const byOrg = handlers['source:list-by-org']?.({ organization_id: org.id });
    expect(bySite?.length).toBe(1);
    expect(byOrg?.length).toBe(1);
  });

  it('source:create rejects invalid scope via ZodError', () => {
    expect(() =>
      handlers['source:create']?.({
        site_id: site.id,
        name: 'Bad',
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        scope: 5 as any,
      }),
    ).toThrow(z.ZodError);
  });

  it('source:update patches name and source:delete soft-deletes', () => {
    const created = handlers['source:create']?.({
      site_id: site.id,
      name: 'Original',
      scope: 1,
    });
    if (!created) throw new Error('handler returned undefined');

    const updated = handlers['source:update']?.({
      id: created.id,
      name: 'Renamed',
    });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.is_active).toBe(true);

    handlers['source:delete']?.({ id: created.id });
    const afterDelete = handlers['source:get-by-id']?.({ id: created.id });
    expect(afterDelete?.is_active).toBe(false);
  });
});
