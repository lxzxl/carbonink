import { invoke } from '../ipc.js';

export const answerApi = {
  generate: (question_id: string) => invoke('answer:generate', { question_id }),

  save: (input: { question_id: string; value: string; unit: string | null; finalize: boolean }) =>
    invoke('answer:save', input),

  unfinalize: (question_id: string) => invoke('answer:unfinalize', { question_id }),

  listByQuestionnaire: (questionnaire_id: string) =>
    invoke('answer:list-by-questionnaire', { questionnaire_id }),

  generateAllUnanswered: (questionnaire_id: string) =>
    invoke('answer:generate-all-unanswered', { questionnaire_id }),

  exportToXlsx: (input: { questionnaire_id: string }) => invoke('answer:export-to-xlsx', input),
};
