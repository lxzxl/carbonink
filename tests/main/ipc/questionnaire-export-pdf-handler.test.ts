import type { IpcContext } from '@main/ipc/context';
import { questionnaireHandlers } from '@main/ipc/handlers/questionnaire';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn() },
}));
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}));
vi.mock('@main/services/report-export-service', () => ({
  renderQuestionnairePdf: vi.fn(),
  // Keep other exports too if the file is shared by sub-project 1 — at minimum:
  renderReportPdf: vi.fn(),
  writeAppendixXlsx: vi.fn(),
  slugifyOrgName: () => 'acme-corp',
  defaultExportFilename: () => 'acme-corp-iso-14064-1-2025-en.pdf',
}));

import * as fs from 'node:fs/promises';
import { renderQuestionnairePdf } from '@main/services/report-export-service';
import { dialog } from 'electron';

function makeCtx() {
  return {
    questionnairePdfDataService: {
      assemble: vi.fn().mockReturnValue({
        customer: { name: 'Acme' },
        questionnaire: {
          id: 'qn-1',
          reporting_year: 2025,
          due_date: null,
          created_at: '2025-01-01',
          status: 'answering',
        },
        document: { filename: 'cdp.xlsx' },
        sheets: [],
        language: 'zh-CN',
      }),
    },
    printRenderUrl: 'http://localhost:5173/print-render',
  } as unknown as IpcContext;
}

describe('questionnaire:export-pdf handler', () => {
  it('writes PDF to disk on save dialog confirm', async () => {
    const ctx = makeCtx();
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.pdf',
    } as never);
    vi.mocked(renderQuestionnairePdf).mockResolvedValue(Buffer.from('pdfdata'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const handlers = questionnaireHandlers(ctx);
    const result = await handlers['questionnaire:export-pdf']!({
      questionnaire_id: 'qn-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ ok: true, path: '/tmp/out.pdf' });
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.pdf', expect.any(Buffer));
  });

  it('returns canceled when user cancels save dialog', async () => {
    const ctx = makeCtx();
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    } as never);
    const handlers = questionnaireHandlers(ctx);
    const result = await handlers['questionnaire:export-pdf']!({
      questionnaire_id: 'qn-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ canceled: true });
  });
});
