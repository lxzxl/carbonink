import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `extraction:*` IPC channels.
 *
 * Phase 1b — the AI extraction pipeline. `run` is the only call that
 * actually goes to a remote LLM provider; everything else is local sqlite
 * I/O. `run`'s return Promise resolves to the inserted `Extraction` row
 * with status `'review_needed'`, ready for the review UI to display
 * + the user to `confirm` / `discard`.
 *
 * `confirm` transitions `review_needed → parsed` and stamps
 * `reviewed_by_user_at`; `discard` transitions `→ rejected` and clears
 * `parsed_json` to satisfy the migration-003 CHECK constraint.
 */
export const extractionApi = {
  classifyAndRun: (input: { document_id: string }) => invoke('extraction:classify-and-run', input),
  // Batch extraction queue (spec 2026-07-22): run acknowledges instantly,
  // progress rides the extraction:batch-progress push channel.
  batchRun: (input: { document_ids: string[] }) => invoke('extraction:batch-run', input),
  batchCancel: () => invoke('extraction:batch-cancel'),
  batchStatus: () => invoke('extraction:batch-status'),
  run: (input: { document_id: string; stage_id: string }) => invoke('extraction:run', input),
  listPending: () => invoke('extraction:list-pending'),
  listByDocument: (input: { document_id: string }) => invoke('extraction:list-by-document', input),
  listStatuses: () => invoke('extraction:list-statuses'),
  getById: (input: { id: string }) => invoke('extraction:get-by-id', input),
  confirm: (input: { id: string }) => invoke('extraction:confirm', input),
  discard: (input: { id: string }) => invoke('extraction:discard', input),
};
