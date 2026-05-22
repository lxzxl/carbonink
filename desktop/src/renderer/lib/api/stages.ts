import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the read-only `stages:*` IPC channel.
 *
 * Phase 1b ships a single stage (`china_utility.v1`); the registry exists
 * so the review UI can render a dropdown / pick the right stage per
 * document instead of hard-coding the id. Each entry's `id` is what gets
 * passed to `extractionApi.run({ stage_id })`.
 *
 * The schema + buildPrompt fields of a Stage are intentionally NOT
 * exposed across the IPC boundary — they're functions / zod objects and
 * not safely structured-cloneable.
 */
export const stagesApi = {
  list: () => invoke('stages:list'),
};
