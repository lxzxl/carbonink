import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const runInput = z.object({
  document_id: z.string().min(1),
  stage_id: z.string().min(1),
});
const docIdInput = z.object({ document_id: z.string().min(1) });
const idInput = z.object({ id: z.string().min(1) });

/**
 * Phase 1b extraction IPC handlers.
 *
 * `extraction:run` is the only async channel: it reads the PDF from disk,
 * calls the configured LLM provider, and inserts the resulting `extraction`
 * row. The `sanitize` wrapper in `setup.ts` already `await`s handler
 * results before rethrowing/returning, so the Promise propagates cleanly
 * across the IPC boundary.
 *
 * Status transitions (`confirm` / `discard`) live as separate channels
 * rather than a single `update-status` parameterized one — the explicit
 * names match the user-facing actions and keep the renderer side from
 * having to import the literal `'parsed' | 'rejected'` strings.
 */
export function extractionHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const svc = ctx.extractionService;
  return {
    'extraction:run': (input) => {
      const parsed = runInput.parse(input);
      return svc.run(parsed);
    },
    'extraction:list-pending': () => svc.listPendingReview(),
    'extraction:list-by-document': (input) =>
      svc.listByDocument(docIdInput.parse(input).document_id),
    'extraction:get-by-id': (input) => svc.getById(idInput.parse(input).id),
    'extraction:confirm': (input) => {
      svc.confirm(idInput.parse(input).id);
    },
    'extraction:discard': (input) => {
      svc.discard(idInput.parse(input).id);
    },
  };
}
