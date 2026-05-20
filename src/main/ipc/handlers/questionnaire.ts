import * as fs from 'node:fs/promises';
import { renderQuestionnairePdf } from '@main/services/report-export-service';
import { dialog } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const createInput = z.object({
  customer_name: z.string().min(1),
  reporting_year: z.number().int().min(2020).max(2100),
  due_date: z.string().nullable(),
  file_bytes: z.instanceof(Uint8Array),
  filename: z.string().min(1),
});

const idInput = z.object({ id: z.string().min(1) });

const exportPdfInput = z.object({
  questionnaire_id: z.string().min(1),
  language: z.enum(['zh-CN', 'en']),
});

/**
 * IPC handlers for the questionnaire pipeline. Mirrors the ef-matcher
 * handler shape: zod-parse the input, delegate to the service, return the
 * service's value verbatim.
 *
 * Channels:
 *   - questionnaire:create  → QuestionnaireService.createFromUpload
 *   - questionnaire:list    → QuestionnaireService.list
 *   - questionnaire:get-by-id → QuestionnaireService.getById
 */
export function questionnaireHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'questionnaire:create': async (input) => {
      const parsed = createInput.parse(input);
      return ctx.questionnaireService.createFromUpload(parsed);
    },
    'questionnaire:list': () => ctx.questionnaireService.list(),
    'questionnaire:get-by-id': (input) => {
      const parsed = idInput.parse(input);
      return ctx.questionnaireService.getById(parsed.id);
    },
    'questionnaire:finalize': (input) => {
      const parsed = idInput.parse(input);
      return ctx.questionnaireService.finalizeAnswering(parsed.id);
    },
    'questionnaire:export-pdf': async (rawInput) => {
      const input = exportPdfInput.parse(rawInput);
      const data = ctx.questionnairePdfDataService.assemble({
        questionnaire_id: input.questionnaire_id,
        language: input.language,
      });

      const slug =
        (data.customer.name || 'questionnaire')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'questionnaire';
      const defaultPath = `${slug}-questionnaire-${data.questionnaire.reporting_year}-${input.language}.pdf`;

      const result = await dialog.showSaveDialog({
        title: 'Export questionnaire (PDF)',
        defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true as const };
      }
      try {
        const buf = await renderQuestionnairePdf({ data }, { printRenderUrl: ctx.printRenderUrl });
        await fs.writeFile(result.filePath, buf);
        return { ok: true as const, path: result.filePath };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    },
  };
}
