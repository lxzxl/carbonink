import { dialog } from 'electron';
import * as fs from 'node:fs/promises';
import { generateReportNarrative } from '@main/llm/report-narrative.js';
import {
  defaultExportFilename,
  renderReportPdf,
  writeAppendixXlsx,
} from '@main/services/report-export-service.js';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';
import { z } from 'zod';

const generateInput = z.object({
  report_id: z.string().min(1),
  reporting_period_id: z.string().min(1),
  language: z.enum(['zh-CN', 'en']),
});
const cancelInput = z.object({ report_id: z.string().min(1) });

export function reportHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const inflight = new Map<string, AbortController>();

  return {
    'report:generate': async (raw) => {
      const input = generateInput.parse(raw);
      const providerCfg = ctx.settingsService.getProviderConfigWithKey();
      if (!providerCfg) {
        return {
          canceled: false as const,
          error: { _tag: 'NoProvider' as const },
        };
      }

      const controller = new AbortController();
      inflight.set(input.report_id, controller);
      try {
        ctx.pushEvent('report:progress', {
          report_id: input.report_id,
          phase: 'assembling',
          sub_phase: null,
        });
        const data = ctx.reportDataService.assembleReportData({
          reporting_period_id: input.reporting_period_id,
          language: input.language,
        });

        ctx.pushEvent('report:progress', {
          report_id: input.report_id,
          phase: 'narrative',
          sub_phase: null,
        });
        const narrative = await generateReportNarrative({
          data,
          provider: ctx.llmNarrativeProvider,
          onProgress: (ev) => {
            ctx.pushEvent('report:progress', {
              report_id: input.report_id,
              phase: 'narrative',
              sub_phase: ev.sub_phase,
            });
          },
          abortSignal: controller.signal,
        });

        ctx.pushEvent('report:progress', {
          report_id: input.report_id,
          phase: 'finalizing',
          sub_phase: null,
        });
        return { canceled: false as const, data, narrative };
      } catch (err) {
        const e = err as { _tag?: string; message?: string; name?: string };
        if (controller.signal.aborted || e.name === 'AbortError' || e._tag === 'LlmNarrativeCanceled') {
          return { canceled: true as const };
        }
        if (e._tag === 'LlmNarrativeRefused') {
          return {
            canceled: false as const,
            error: { _tag: 'Refused' as const, message: e.message },
          };
        }
        return {
          canceled: false as const,
          error: { _tag: 'Refused' as const, message: e.message ?? String(err) },
        };
      } finally {
        inflight.delete(input.report_id);
      }
    },

    'report:cancel': (raw) => {
      const input = cancelInput.parse(raw);
      const controller = inflight.get(input.report_id);
      if (controller) {
        controller.abort();
      }
    },

    'report:export-pdf': async (raw) => {
      const input = raw as Parameters<IpcTypeMap['report:export-pdf']>[0];
      const result = await dialog.showSaveDialog({
        title: 'Export ISO 14064-1 report (PDF)',
        defaultPath: defaultExportFilename({
          data: input.data,
          language: input.language,
          kind: 'pdf',
        }),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true as const };
      try {
        const buf = await renderReportPdf(
          { data: input.data, narrative: input.narrative, language: input.language },
          { printRenderUrl: ctx.printRenderUrl },
        );
        await fs.writeFile(result.filePath, buf);
        return { ok: true as const, path: result.filePath };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    },

    'report:export-xlsx': async (raw) => {
      const input = raw as Parameters<IpcTypeMap['report:export-xlsx']>[0];
      const result = await dialog.showSaveDialog({
        title: 'Export ISO 14064-1 appendix (Excel)',
        defaultPath: defaultExportFilename({
          data: input.data,
          language: input.language,
          kind: 'xlsx',
        }),
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true as const };
      try {
        const buf = await writeAppendixXlsx({
          data: input.data,
          narrative: input.narrative,
          language: input.language,
        });
        await fs.writeFile(result.filePath, buf);
        return { ok: true as const, path: result.filePath };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    },
  };
}
