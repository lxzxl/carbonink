import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `ef:recommend` IPC channel.
 *
 * EfMatcher = LLM-assisted emission factor recommendation pipeline.
 * Given an extraction + emission source, returns a ranked list of candidates
 * with 0–3 LLM-selected recommendations and a full BM25-ranked list.
 */
export const efMatcherApi = {
  recommend: (input: Parameters<typeof invoke<'ef:recommend'>>[1]) =>
    invoke('ef:recommend', input),
};
