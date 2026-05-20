import { invoke } from '../ipc.js';

export const reportApi = {
  generate: (input: { report_id: string; reporting_period_id: string; language: 'zh-CN' | 'en' }) =>
    invoke('report:generate', input),
  cancel: (input: { report_id: string }) => invoke('report:cancel', input),
  exportPdf: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-pdf', input as never),
  exportXlsx: (input: { data: unknown; narrative: unknown; language: 'zh-CN' | 'en' }) =>
    invoke('report:export-xlsx', input as never),
};
