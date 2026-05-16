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
  };
}
