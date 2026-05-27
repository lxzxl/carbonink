import type { z } from 'zod';

/**
 * Text + image parts of a single user-turn message handed to a vision
 * LLM. `ExtractionService` appends the actual image content after
 * `userText` when calling `runAiObject` with `images:`; the stage
 * supplies the instruction copy (field rules, output format) but
 * doesn't know how many pages the PDF rendered to.
 *
 * `system` is optional — most stages can fold their instructions into
 * the user turn since pi-ai handles either equivalently across providers.
 * Reserved for stages that benefit from a separate "you are an X" framing.
 */
export type VisionMessages = {
  /** Optional system-turn instruction. */
  system?: string;
  /** User-turn text portion. Images are appended after this by the caller. */
  userText: string;
};

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
 *
 * **Vision support (Phase 1c)**: a stage opts in by implementing the
 * optional `buildVisionMessages()` method. Presence of the method is
 * what `ExtractionService` checks — `inputType` continues to describe
 * what `buildPrompt` accepts, not whether vision is available.
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
   * Modality of the input string passed to `buildPrompt`. Phase 1b text
   * extraction uses `pdf_text`. Phase 1c **does not** introduce a
   * `pdf_image` value here — vision support is opted into by
   * implementing `buildVisionMessages`. Reserved literals stay for
   * future non-PDF input types (Excel/JSON).
   */
  inputType: 'pdf_text';
  schema: z.ZodType<T>;
  buildPrompt: (input: string) => string;
  /**
   * Phase 1c — image-input path. Optional: stages that don't define
   * this don't support vision fallback, and `ExtractionService` throws
   * `StageDoesNotSupportVisionError` when forced down the vision branch.
   *
   * Returns the text portion of the multipart user message; the caller
   * appends one image part per rendered PDF page (in document order)
   * before handing to `runAiObject` with `images:`.
   */
  buildVisionMessages?: () => VisionMessages;
};
