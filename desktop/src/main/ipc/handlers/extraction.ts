import type { Extraction } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';
import { withUndo } from '../undo-wrapper.js';

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
    'extraction:classify-and-run': async (input) => {
      const parsed = z.object({ document_id: z.string().min(1) }).parse(input);
      return ctx.classificationService.classifyAndRun(parsed.document_id);
    },
    // Batch extraction queue (spec 2026-07-22). `batch-run` acknowledges
    // immediately; progress rides the extraction:batch-progress push channel.
    'extraction:batch-run': (input) => {
      const parsed = z
        .object({ document_ids: z.array(z.string().min(1)).max(500) })
        .parse(input);
      return ctx.batchExtractionService.start(parsed.document_ids);
    },
    'extraction:batch-cancel': () => ({ ok: ctx.batchExtractionService.cancel() }),
    'extraction:batch-status': () => ctx.batchExtractionService.status(),
    'extraction:run': (input) => {
      const parsed = runInput.parse(input);
      return svc.run(parsed);
    },
    'extraction:list-pending': () => svc.listPendingReview(),
    'extraction:list-by-document': (input) =>
      svc.listByDocument(docIdInput.parse(input).document_id),
    'extraction:list-statuses': () => svc.getStatusByDocument(),
    'extraction:get-by-id': (input) => svc.getById(idInput.parse(input).id),
    // confirm / discard are wrapped with `withUndo`. Each captures the
    // pre-state extraction row (status + parsed_json + reviewed_by_user_at)
    // so the inverse can restore it byte-for-byte. The undo checks that
    // the current state matches what we transitioned to (parsed for
    // confirm, rejected for discard) before flipping back — guards
    // against the "state drift" edge case noted in the spec.
    //
    // NOTE: the downstream activity_data row that ExtractionReview's
    // ActivityForm typically creates after confirm is *not* deleted by
    // this undo. That activity is its own undoable (activity:create
    // already wrapped in Task 3) — they live on the same stack, so
    // pressing ⌘Z twice rolls back both.
    'extraction:confirm': withUndo<{ id: string }, void, Extraction | null>(
      ctx.undoManager,
      'extraction:confirm',
      'confirm extraction',
      (input) => svc.getById(idInput.parse(input).id),
      (snapshot) => ({
        undo: () => {
          if (!snapshot) return;
          const cur = svc.getById(snapshot.id);
          if (cur?.status !== 'parsed') return; // state drift — bail silently
          ctx.db
            .prepare(
              `UPDATE extraction
                 SET status = 'review_needed', reviewed_by_user_at = NULL
               WHERE id = ?`,
            )
            .run(snapshot.id);
        },
        redo: () => {
          if (!snapshot) return;
          svc.confirm(snapshot.id);
        },
      }),
      (input) => {
        svc.confirm(idInput.parse(input).id);
      },
    ),
    'extraction:discard': withUndo<{ id: string }, void, Extraction | null>(
      ctx.undoManager,
      'extraction:discard',
      'discard extraction',
      (input) => svc.getById(idInput.parse(input).id),
      (snapshot) => ({
        undo: () => {
          if (!snapshot) return;
          const cur = svc.getById(snapshot.id);
          if (cur?.status !== 'rejected') return;
          // Restore parsed_json + status. raw_response stays where it
          // is (discard preserved it for forensics, so undo doesn't
          // need to touch it).
          ctx.db
            .prepare(
              `UPDATE extraction
                 SET status = 'review_needed',
                     parsed_json = ?,
                     reviewed_by_user_at = NULL
               WHERE id = ?`,
            )
            .run(snapshot.parsed_json, snapshot.id);
        },
        redo: () => {
          if (!snapshot) return;
          svc.discard(snapshot.id);
        },
      }),
      (input) => {
        svc.discard(idInput.parse(input).id);
      },
    ),
  };
}
