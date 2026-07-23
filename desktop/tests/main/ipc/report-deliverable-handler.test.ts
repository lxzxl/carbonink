/**
 * Wiring tests for `report:export-deliverable`
 * (spec 2026-07-23-client-deliverable-bundle). The bundle internals are
 * covered in `tests/main/services/deliverable-export-service.test.ts`;
 * here the render + bundle seams are mocked and only the handler's glue
 * is asserted: dialog default filename, per-kind render arguments, entry
 * names, pass-through of period/activities, and the 3-arm result shape.
 */
import { reportHandlers } from '@main/ipc/handlers/report';
import { buildDeliverableBundle } from '@main/services/deliverable-export-service';
import { renderReportPdf, writeAppendixXlsx } from '@main/services/report-export-service';
import { dialog } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn() },
}));

// Keep the pure filename helpers real; mock only the Electron-dependent
// PDF render and the xlsx writer.
vi.mock('@main/services/report-export-service', async (importOriginal) => {
  const real = await importOriginal<typeof import('@main/services/report-export-service')>();
  return {
    ...real,
    renderReportPdf: vi.fn(),
    writeAppendixXlsx: vi.fn(),
  };
});

vi.mock('@main/services/deliverable-export-service', () => ({
  buildDeliverableBundle: vi.fn(),
}));

const DATA = {
  org: { id: 'org-1', name_en: 'Acme Co', name_zh: null },
  period: { id: 'per-1', year: 2025, granularity: 'annual' },
  activities: [
    { id: 'act-1', source_name: 'Grid meter' },
    { id: 'act-2', source_name: 'Boiler' },
  ],
} as never;

const NARRATIVE = {} as never;

function makeCtx() {
  return { db: { fake: 'db' }, printRenderUrl: 'http://localhost/print' };
}

beforeEach(() => {
  vi.mocked(dialog.showSaveDialog).mockReset();
  vi.mocked(renderReportPdf).mockReset().mockResolvedValue(Buffer.from('pdf-bytes'));
  vi.mocked(writeAppendixXlsx).mockReset().mockResolvedValue(Buffer.from('xlsx-bytes'));
  vi.mocked(buildDeliverableBundle)
    .mockReset()
    .mockResolvedValue({ evidenceTotal: 3, evidenceMissing: 1 });
});

describe('report:export-deliverable', () => {
  it('returns canceled without rendering when the save dialog is dismissed', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    } as never);
    const handlers = reportHandlers(makeCtx() as never);

    const result = await handlers['report:export-deliverable']?.({
      data: DATA,
      narrative: NARRATIVE,
      language: 'zh-CN',
      kind: 'iso',
    });

    expect(result).toEqual({ canceled: true });
    expect(renderReportPdf).not.toHaveBeenCalled();
    expect(buildDeliverableBundle).not.toHaveBeenCalled();
  });

  it('iso kind: renders ISO artifacts and streams them into the bundle', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.zip',
    } as never);
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);

    const result = await handlers['report:export-deliverable']?.({
      data: DATA,
      narrative: NARRATIVE,
      language: 'zh-CN',
      kind: 'iso',
    });

    const dialogArgs = vi.mocked(dialog.showSaveDialog).mock.calls[0]?.[0] as {
      defaultPath?: string;
    };
    expect(dialogArgs.defaultPath).toBe('acme-co-iso-14064-1-2025-zh-CN-deliverable.zip');

    // ISO path: no kind override on either renderer.
    expect(vi.mocked(renderReportPdf).mock.calls[0]?.[0]).not.toHaveProperty('kind');
    expect(vi.mocked(writeAppendixXlsx).mock.calls[0]?.[0]).not.toHaveProperty('kind');

    const bundleArgs = vi.mocked(buildDeliverableBundle).mock.calls[0]?.[0];
    expect(bundleArgs).toMatchObject({
      db: ctx.db,
      periodId: 'per-1',
      activities: [
        { id: 'act-1', source_name: 'Grid meter' },
        { id: 'act-2', source_name: 'Boiler' },
      ],
      outPath: '/tmp/out.zip',
    });
    expect(bundleArgs?.reportPdf.name).toBe('acme-co-iso-14064-1-2025-zh-CN.pdf');
    expect(bundleArgs?.appendixXlsx.name).toBe('acme-co-iso-14064-1-2025-zh-CN-appendix.xlsx');

    expect(result).toEqual({
      ok: true,
      path: '/tmp/out.zip',
      evidence_count: 3,
      missing_count: 1,
    });
  });

  it('tcfd kind: passes the TCFD render kinds and tcfd filenames', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.zip',
    } as never);
    const handlers = reportHandlers(makeCtx() as never);

    await handlers['report:export-deliverable']?.({
      data: DATA,
      narrative: NARRATIVE,
      language: 'en',
      kind: 'tcfd',
    });

    const dialogArgs = vi.mocked(dialog.showSaveDialog).mock.calls[0]?.[0] as {
      defaultPath?: string;
    };
    expect(dialogArgs.defaultPath).toBe('acme-co-tcfd-2025-en-deliverable.zip');
    expect(vi.mocked(renderReportPdf).mock.calls[0]?.[0]).toMatchObject({ kind: 'tcfd_report' });
    expect(vi.mocked(writeAppendixXlsx).mock.calls[0]?.[0]).toMatchObject({ kind: 'tcfd' });

    const bundleArgs = vi.mocked(buildDeliverableBundle).mock.calls[0]?.[0];
    expect(bundleArgs?.reportPdf.name).toBe('acme-co-tcfd-2025-en.pdf');
    expect(bundleArgs?.appendixXlsx.name).toBe('acme-co-tcfd-2025-en-appendix.xlsx');
  });

  it('maps bundle failures to the error arm', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.zip',
    } as never);
    vi.mocked(buildDeliverableBundle).mockRejectedValue(new Error('disk full'));
    const handlers = reportHandlers(makeCtx() as never);

    const result = await handlers['report:export-deliverable']?.({
      data: DATA,
      narrative: NARRATIVE,
      language: 'zh-CN',
      kind: 'iso',
    });

    expect(result).toEqual({ ok: false, error: 'disk full' });
  });
});
