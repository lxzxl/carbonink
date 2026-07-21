import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext, type IpcContext } from '@main/ipc/context';
import { activityImportHandlers } from '@main/ipc/handlers/activity-import';
import type { ActivityImportEfChoice } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));

vi.mock('electron', async () => {
  const stub = await import('../../stubs/electron');
  return { ...stub, dialog: { ...stub.dialog, showOpenDialog } };
});

const GRID_EF: ActivityImportEfChoice = {
  factor_code: 'electricity.grid.cn.national.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN',
  dataset_version: '2024.q4',
};

const CSV = [
  '排放源,描述,数量,单位',
  'Grid meter,电网电力,1000,kWh',
  'Grid meter,电网电力,1200,kWh',
].join('\n');

let db: Database.Database;
let tmp: string;
let ctx: IpcContext;
let handlers: ReturnType<typeof activityImportHandlers>;
let orgId: string;
let periodId: string;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  tmp = mkdtempSync(join(tmpdir(), 'carbonink-activity-import-ipc-'));
  ctx = createIpcContext(
    { db, now: () => '2026-07-21T00:00:00.000Z' },
    { uploadsDir: join(tmp, 'uploads') },
  );
  handlers = activityImportHandlers(ctx);
  showOpenDialog.mockReset();

  const org = ctx.organizationService.createOrganization({
    name_en: 'Acme Co',
    country_code: 'CN',
    boundary_kind: 'operational_control',
  });
  orgId = org.id;
  const site = ctx.organizationService.createSite({
    organization_id: org.id,
    name_en: 'HQ',
    country_code: 'CN',
  });
  periodId = ctx.organizationService.createReportingPeriod({
    organization_id: org.id,
    year: 2024,
    granularity: 'annual',
  }).id;
  ctx.emissionSourceService.create({
    site_id: site.id,
    name: 'Grid meter',
    scope: 2,
    category: 'electricity.grid',
  });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function pickCsv(content = CSV, filename = 'ledger.csv') {
  const path = join(tmp, filename);
  writeFileSync(path, content, 'utf-8');
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] });
  return handlers['activity-import:pick-file']?.();
}

describe('activity-import:pick-file', () => {
  it('returns canceled when the dialog is dismissed', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(handlers['activity-import:pick-file']?.()).resolves.toEqual({ canceled: true });
  });

  it('folds parse failures into the error variant', async () => {
    const result = await pickCsv('x', 'ledger.txt');
    expect(result).toEqual({
      canceled: false,
      error: { _tag: 'EfImportParseFailed', code: 'unsupported_file_type', detail: 'ledger.txt' },
    });
  });
});

describe('full wizard round-trip through handler glue', () => {
  it('pick → revalidate → sources → groups → confirm → import', async () => {
    const picked = await pickCsv();
    if (!picked || picked.canceled !== false || !('preview' in picked)) {
      throw new Error('expected a preview');
    }
    const { token, mapping } = picked.preview;

    const validation = handlers['activity-import:revalidate']?.({
      token,
      mapping,
      period_id: periodId,
    });
    expect(validation?.valid_count).toBe(2);

    const sources = handlers['activity-import:list-sources']?.({
      token,
      organization_id: orgId,
    });
    expect(sources?.[0]?.resolved_source_id).not.toBeNull();

    const groups = handlers['activity-import:list-groups']?.({ token }) ?? [];
    expect(groups).toHaveLength(1);
    const groupKey = (groups[0] as { key: string }).key;

    expect(
      handlers['activity-import:confirm-group']?.({
        token,
        group_key: groupKey,
        ef: GRID_EF,
        fuel_code: null,
      }),
    ).toEqual({ ok: true });

    const result = handlers['activity-import:import']?.({ token });
    expect(result).toMatchObject({ ok: true, imported_count: 2 });

    const rows = db.prepare('SELECT COUNT(*) AS n FROM activity_data').get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it('discard expires the token', async () => {
    const picked = await pickCsv();
    if (!picked || picked.canceled !== false || !('preview' in picked)) {
      throw new Error('expected a preview');
    }
    expect(handlers['activity-import:discard']?.({ token: picked.preview.token })).toEqual({
      ok: true,
    });
    expect(
      handlers['activity-import:revalidate']?.({
        token: picked.preview.token,
        mapping: {},
        period_id: periodId,
      }),
    ).toBeNull();
  });
});
