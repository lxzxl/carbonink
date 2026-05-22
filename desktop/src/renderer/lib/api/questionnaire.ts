import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the questionnaire IPC channels.
 *
 * Questionnaire pipeline: upload an Excel questionnaire, extract questions
 * via LLM, store customer + document + questionnaire + question rows.
 */
export const questionnaireApi = {
  create: (input: {
    customer_name: string;
    reporting_year: number;
    due_date: string | null;
    file_bytes: Uint8Array;
    filename: string;
  }) => invoke('questionnaire:create', input),

  list: () => invoke('questionnaire:list'),

  getById: (input: { id: string }) => invoke('questionnaire:get-by-id', input),

  finalize: (input: { id: string }) => invoke('questionnaire:finalize', input),

  exportPdf: (input: { questionnaire_id: string; language: 'zh-CN' | 'en' }) =>
    invoke('questionnaire:export-pdf', input),
};
