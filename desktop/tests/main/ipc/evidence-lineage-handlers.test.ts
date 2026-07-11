import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext, type IpcContext } from '@main/ipc/context';
import { auditHandlers } from '@main/ipc/handlers/audit';
import { evidenceHandlers } from '@main/ipc/handlers/evidence';
import { lineageHandlers } from '@main/ipc/handlers/lineage';
import type { ActivityData, ActivityLineage } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

/**
 * IPC glue for the audit-readiness channels (evidence:*, lineage:get,
 * audit:list-by-record). Service semantics live in
 * evidence-service.test.ts / lineage-service.test.ts; this file checks
 * Zod boundaries + the Uint8Array→Buffer hop + end-to-end wiring through
 * createIpcContext.
 */
describe('evidence + lineage IPC handlers', () => {
  let db: Database.Database;
  let uploadsDir: string;
  let ctx: IpcContext;
  let evidence: ReturnType<typeof evidenceHandlers>;
  let lineage: ReturnType<typeof lineageHandlers>;
  let audit: ReturnType<typeof auditHandlers>;
  let activity: ActivityData;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    uploadsDir = mkdtempSync(join(tmpdir(), 'carbonink-evidence-ipc-'));
    ctx = createIpcContext({ db, now: () => '2026-07-11T00:00:00.000Z' }, { uploadsDir });
    evidence = evidenceHandlers(ctx);
    lineage = lineageHandlers(ctx);
    audit = auditHandlers(ctx);

    const org = ctx.organizationService.createOrganization({
      name_en: 'Acme',
      country_code: 'CN',
      boundary_kind: 'operational_control',
    });
    const site = ctx.organizationService.createSite({
      organization_id: org.id,
      name_en: 'HQ',
      country_code: 'CN',
    });
    const period = ctx.organizationService.createReportingPeriod({
      organization_id: org.id,
      year: 2024,
      granularity: 'annual',
    });
    const source = ctx.emissionSourceService.create({
      site_id: site.id,
      name: 'Grid meter',
      scope: 2,
      category: 'electricity.grid',
    });
    activity = ctx.activityDataService.create({
      emission_source_id: source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ef_factor_code: 'electricity.grid.cn.national.2024',
      ef_year: 2024,
      ef_source: 'MEE_China',
      ef_geography: 'CN',
      ef_dataset_version: '2024.q4',
    });
  });

  afterEach(() => {
    db.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('add → list → lineage → per-record audit → remove, end to end', () => {
    const bytes = new Uint8Array(Buffer.from('%PDF-1.4 ipc evidence'));
    const added = evidence['evidence:add']?.({
      activity_data_id: activity.id,
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes,
      note: 'january bill',
    });
    if (!added) throw new Error('handler returned undefined');
    expect(added.activity_data_id).toBe(activity.id);
    expect(added.size_bytes).toBe(bytes.length);

    const listed = evidence['evidence:list']?.({ activity_data_id: activity.id });
    expect(listed?.map((r) => r.id)).toEqual([added.id]);

    const chain = lineage['lineage:get']?.({
      entity: 'activity_data',
      id: activity.id,
    }) as ActivityLineage;
    expect(chain.source).toEqual({ kind: 'manual' });
    expect(chain.evidence.map((e) => e.id)).toEqual([added.id]);
    expect(chain.pinned_ef?.factor_code).toBe('electricity.grid.cn.national.2024');

    const timeline = audit['audit:list-by-record']?.({ activity_data_id: activity.id });
    expect(timeline?.map((e) => e.event_kind)).toEqual(
      expect.arrayContaining(['activity_data.created', 'evidence.attached']),
    );

    evidence['evidence:remove']?.({ id: added.id });
    expect(evidence['evidence:list']?.({ activity_data_id: activity.id })).toEqual([]);
    const after = audit['audit:list-by-record']?.({ activity_data_id: activity.id });
    expect(after?.map((e) => e.event_kind)).toContain('evidence.removed');
  });

  it('evidence:add rejects zero or two targets at the Zod boundary', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(() =>
      evidence['evidence:add']?.({ filename: 'x.pdf', mimeType: 'application/pdf', bytes }),
    ).toThrow(ZodError);
    expect(() =>
      evidence['evidence:add']?.({
        activity_data_id: 'a',
        answer_id: 'b',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        bytes,
      }),
    ).toThrow(ZodError);
  });

  it('evidence:add rejects non-Uint8Array bytes with a legible error', () => {
    expect(() =>
      evidence['evidence:add']?.({
        activity_data_id: activity.id,
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
        bytes: 'not-bytes' as any,
      }),
    ).toThrow(/bytes must be a Uint8Array/);
  });

  it('lineage:get and audit:list-by-record validate their refs', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
      lineage['lineage:get']?.({ entity: 'nope' as any, id: 'x' }),
    ).toThrow(ZodError);
    expect(() => audit['audit:list-by-record']?.({})).toThrow(ZodError);
  });
});
