import type { EfImportMapping } from '@shared/types.js';
import { invoke } from '../ipc.js';

/**
 * User EF library API (ROADMAP §8.1-④). `pickFile` / `saveTemplate` open
 * native dialogs in the main process; the renderer only ever sees parsed
 * previews and structured results, never file paths it chose itself.
 */
export const userEfLibraryApi = {
  pickFile: () => invoke('ef-library:pick-file'),
  revalidate: (input: { token: string; mapping: EfImportMapping }) =>
    invoke('ef-library:revalidate', input),
  import: (input: {
    token: string;
    name: string;
    version: string;
    allow_replace: boolean;
    mapping: EfImportMapping;
  }) => invoke('ef-library:import', input),
  discard: (input: { token: string }) => invoke('ef-library:discard', input),
  list: () => invoke('ef-library:list'),
  delete: (input: { id: string }) => invoke('ef-library:delete', input),
  saveTemplate: () => invoke('ef-library:save-template'),
};
