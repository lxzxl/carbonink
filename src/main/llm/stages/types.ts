import type { z } from 'zod';

/**
 * A Stage describes one structured-extraction task the AI pipeline can run
 * against a document: it bundles the user-facing identity (`id` / `version` /
 * `description`), the input modality, a zod schema that both *constrains*
 * the model and *parses* its response, and a prompt template.
 *
 * Stages are pure data — no side effects, no state. The `ExtractionService`
 * looks one up by `id`, feeds the document text through `buildPrompt`, and
 * hands `schema` to the LLM client. This makes stages trivial to unit test
 * (schema parse + prompt content checks) and lets us version them without
 * touching the orchestrator.
 *
 * `T` is the zod-inferred shape returned by a successful extraction. The
 * registry stores `Stage<unknown>` to allow heterogeneous stages in one map,
 * but each call site re-narrows via `chinaUtilityStage`'s explicit type.
 */
export type Stage<T = unknown> = {
  /**
   * Stable identifier including a version suffix (e.g. `china_utility.v1`).
   * Persisted to `extraction.prompt_version` so the cache survives prompt
   * tweaks: bumping to `v2` invalidates every prior `v1` cache entry.
   */
  id: string;
  /** Semver — for changelog display only; the cache key uses `id`. */
  version: string;
  description: string;
  /**
   * Modality of the input string passed to `buildPrompt`. Phase 1b is
   * text-only (`pdf_text`); `image` / `json` are reserved for Phase 1c+.
   */
  inputType: 'pdf_text' | 'image' | 'json';
  schema: z.ZodType<T>;
  buildPrompt: (input: string) => string;
};
