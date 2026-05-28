import { invoke } from '../ipc.js';

/**
 * Renderer-side wrappers for the inbound (supplier-disclosure) questionnaire
 * pipeline. Pairs with `desktop/src/main/ipc/handlers/inbound-questionnaire.ts`.
 *
 * All four operations are mutations modulo the parser parts: createDraft +
 * exportXlsx + ingest write to the DB; importPreview both writes (tentative
 * answer rows) and reads (the resulting preview shape).
 */
export const inboundQuestionnaireApi = {
  createDraft: (input: {
    supplier_id: string;
    reporting_period_id: string;
    template_kind: 'cat1_supplier_disclosure';
    included_question_positions: string[];
  }) => invoke('questionnaire:inbound-create-draft', input),

  exportXlsx: (input: { questionnaire_id: string }) =>
    invoke('questionnaire:inbound-export-xlsx', input),

  importPreview: (input: { questionnaire_id: string }) =>
    invoke('questionnaire:inbound-import-preview', input),

  /** Re-read preview from already-imported tentative answers (no file dialog). */
  getPreview: (input: { questionnaire_id: string }) =>
    invoke('questionnaire:inbound-get-preview', input),

  ingest: (input: {
    questionnaire_id: string;
    accepted_question_ids: string[];
    tier1_purchased_quantity?: number;
    tier_override?: import('@shared/types').Tier;
  }) => invoke('questionnaire:inbound-ingest', input),

  /** Delete a disclosure + its questions/answers (+ ingested activity rows). */
  delete: (input: { questionnaire_id: string }) => invoke('questionnaire:inbound-delete', input),
};
