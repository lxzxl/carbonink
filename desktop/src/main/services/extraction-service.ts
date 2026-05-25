import { readFileSync } from 'node:fs';
import type { IpcPushTypeMap } from '@main/ipc/types.js';
import type { LLMClient } from '@main/llm/llm-client.js';
import { pdfToImages as pdfToImagesDefault } from '@main/llm/pdf-to-images.js';
import { getStage } from '@main/llm/stages/registry.js';
import { assertVisionCapable } from '@main/llm/vision-capability.js';
import type { Extraction, ExtractionStatus } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';
import type { DocumentService } from './document-service.js';
import type { SettingsService } from './settings-service.js';

/**
 * Phase 1b sentinel — was thrown when `pdf-parse` returned essentially
 * no text from the uploaded PDF (image-only scan). **Phase 1c retired
 * the throw**: `ExtractionService.run()` now catches the empty-text
 * case inline and routes to the vision LLM branch. The class is kept
 * as exported API surface so any future "force text only" code path
 * or alternative orchestrator can re-use the sentinel; the message
 * body assumes that future caller will still need to tell the user
 * something useful. Today the sanitize layer's whitelist entry is
 * defensive (no live path reaches it).
 */
export class PdfNotReadableError extends Error {
  constructor(public readonly filename: string) {
    super(
      `Couldn't read text from "${filename}" and the vision fallback wasn't available. ` +
        `Try switching to a multimodal model in Settings (gpt-4o / claude-sonnet-4-5 / ` +
        `deepseek-vl), or re-export the PDF with OCR enabled.`,
    );
    this.name = 'PdfNotReadableError';
  }
}

/**
 * Thrown when `ExtractionService.run()` switches to the vision branch
 * (because pdf-parse couldn't read the PDF) but the chosen stage
 * doesn't implement `buildVisionMessages`. Currently china_utility.v1
 * is the only stage with vision support; this exists for defensive
 * coding so adding a text-only future stage (e.g. an Excel parser)
 * fails with a clear message instead of a generic crash.
 *
 * Whitelisted by the IPC sanitize layer so the user sees a toast
 * with the stage id rather than a correlation id.
 */
export class StageDoesNotSupportVisionError extends Error {
  constructor(public readonly stageId: string) {
    super(
      `Stage "${stageId}" does not support image input yet. Upload a text-layer ` +
        `PDF or wait for a future version that adds vision support to this stage.`,
    );
    this.name = 'StageDoesNotSupportVisionError';
  }
}

export { VisionUnsupportedError } from '@main/llm/vision-capability.js';

/**
 * Injected pdf-parse adapter shape. We DI this so tests can pass a stub
 * that returns canned text — the real `pdf-parse` package eagerly loads
 * fixture files on first import which makes it awkward to invoke under
 * vitest. Production wires this to a thin wrapper around the v2 `PDFParse`
 * class (see `parsePdfDefault` below).
 */
export type ParsePdf = (bytes: Buffer) => Promise<{ text: string }>;

/**
 * Injected PDF-to-images adapter shape. DI'd so tests can supply a
 * lightweight stub returning canned PNG buffers without touching
 * pdfjs-dist or canvas. Production wires the real `pdfToImages` from
 * `@main/llm/pdf-to-images`.
 */
export type PdfToImages = (bytes: Buffer) => Promise<Buffer[]>;

/**
 * Production default for `parsePdf`. Imported lazily so test runs that
 * provide their own DI'd parser never load `pdf-parse` (it transitively
 * pulls in `pdfjs-dist`, which is large).
 */
async function parsePdfDefault(bytes: Buffer): Promise<{ text: string }> {
  // Dynamic import keeps `pdf-parse` out of the test bundle when callers
  // provide their own `parsePdf`. The class-based v2 API differs from the
  // v1 `pdfParse(bytes)` callable export.
  const mod = await import('pdf-parse');
  const parser = new mod.PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return { text: result.text };
  } finally {
    // Releases the underlying pdf.js document handle. Skipping this leaks
    // a worker port per call in long-running main-process sessions.
    await parser.destroy();
  }
}

/**
 * Orchestrates the AI-extraction pipeline: document → PDF text → LLM →
 * `extraction` row. The interesting moving parts are:
 *
 * 1. **Cache key**: `(document_id, prompt_version, llm_provider, llm_model)`.
 *    Migration 003 enforces this as a UNIQUE constraint; we additionally
 *    SELECT first so a cache hit avoids the LLM call entirely (the unique
 *    index alone wouldn't — INSERT would throw, but we'd already have paid
 *    for the model round-trip).
 *
 * 2. **Status transitions**: insert lands at `review_needed`. `confirm()`
 *    promotes to `parsed`; `discard()` drops to `rejected` and NULLs out
 *    `parsed_json` to satisfy the schema's CHECK constraint.
 *
 * 3. **Dependency injection for I/O**: `readFile` and `parsePdf` are
 *    overridable so tests can supply fake text without going near the
 *    filesystem or pdf.js. Production defaults wire to `node:fs` /
 *    `pdf-parse`.
 *
 * `prompt_version` doubles as the stage identifier on disk: every cache
 * key is `(doc, stage.id, provider, model)` because we store `stage.id`
 * (e.g. `china_utility.v1`) in `prompt_version`. Bumping the stage to v2
 * naturally invalidates v1 caches without any explicit migration.
 */
export class ExtractionService {
  private readonly readFile: (path: string) => Buffer;
  private readonly parsePdf: ParsePdf;
  private readonly pdfToImages: PdfToImages;
  private readonly emitProgress?: <C extends keyof IpcPushTypeMap>(
    channel: C,
    payload: IpcPushTypeMap[C],
  ) => void;

  constructor(
    private readonly ctx: ServiceContext & {
      documentService: DocumentService;
      settingsService: SettingsService;
      llmClient: LLMClient;
      /** DI override for `node:fs.readFileSync`. Defaults to readFileSync. */
      readFile?: (path: string) => Buffer;
      /** DI override for PDF parsing. Defaults to `pdf-parse`. */
      parsePdf?: ParsePdf;
      /** DI override for PDF→PNG rendering. Defaults to `@main/llm/pdf-to-images`. */
      pdfToImages?: PdfToImages;
      /**
       * Main→renderer push emitter for `extraction:progress` events.
       * Optional: tests usually omit this, production wires the real
       * one from `createProgressEmitter(getMainWindow)`.
       */
      emitProgress?: <C extends keyof IpcPushTypeMap>(
        channel: C,
        payload: IpcPushTypeMap[C],
      ) => void;
    },
  ) {
    this.readFile = ctx.readFile ?? readFileSync;
    this.parsePdf = ctx.parsePdf ?? parsePdfDefault;
    this.pdfToImages = ctx.pdfToImages ?? pdfToImagesDefault;
    if (ctx.emitProgress) this.emitProgress = ctx.emitProgress;
  }

  async run(input: { document_id: string; stage_id: string }): Promise<Extraction> {
    const doc = this.ctx.documentService.getById(input.document_id);
    if (!doc) throw new Error(`Document not found: ${input.document_id}`);

    const stage = getStage(input.stage_id);
    if (!stage) throw new Error(`Stage not found: ${input.stage_id}`);

    const providerConfig = this.ctx.settingsService.getProviderConfigWithKey();
    if (!providerConfig) {
      throw new Error('AI provider not configured. Open Settings to set up.');
    }

    // Cache check: same (document, stage, provider, model) → return existing
    // row, don't burn another LLM round-trip. SELECT-first (not relying on
    // the UNIQUE index throwing) so the LLM call is genuinely skipped.
    // `findCached` deliberately excludes `status='rejected'` rows so a user
    // who discards a bad extraction can re-trigger the LLM here.
    const cached = this.findCached(
      doc.id,
      stage.id,
      providerConfig.config.provider,
      providerConfig.config.model,
    );
    if (cached) return cached;

    // The schema's UNIQUE (document_id, prompt_version, llm_provider, llm_model)
    // constraint doesn't filter by status, so a previously-rejected row at the
    // same key would still block the upcoming INSERT. Drop any matching
    // rejected row now — the discard was a soft-delete that kept the raw
    // response around for ad-hoc forensics, but once the user explicitly
    // retries, that snapshot has served its purpose.
    this.ctx.db
      .prepare(
        `DELETE FROM extraction
           WHERE document_id = ? AND prompt_version = ? AND llm_provider = ? AND llm_model = ?
             AND status = 'rejected'`,
      )
      .run(doc.id, stage.id, providerConfig.config.provider, providerConfig.config.model);

    // Read + parse the PDF. The DI'd `readFile` lets tests provide bytes
    // without writing a real file; `parsePdf` lets them skip pdf.js entirely.
    const bytes = this.readFile(doc.storage_path);
    const pdf = await this.parsePdf(bytes);
    const pdfText = pdf.text;

    // Branch: text path (>=10 chars of extracted text) vs vision path.
    // The threshold of 10 chars reliably distinguishes text-layer PDFs
    // from image-only scans — see the original `PdfNotReadableError`
    // comment in Phase 1b. The vision branch handles every case the
    // text branch can't, throwing typed errors that the renderer
    // surfaces as actionable toasts:
    //   - VisionUnsupportedError: chosen model can't take images
    //   - StageDoesNotSupportVisionError: stage didn't opt into vision
    //   - SchemaMismatchError: model output didn't match schema
    let result: unknown;
    if (pdfText.trim().length >= 10) {
      const prompt = stage.buildPrompt(pdfText);
      result = await this.ctx.llmClient.extract(providerConfig.config, stage.schema, prompt);
    } else {
      // Vision path. Validate prerequisites first so we don't burn
      // 5-10s rendering PDF pages only to find out the model can't
      // accept them.
      assertVisionCapable(providerConfig.config);
      if (!stage.buildVisionMessages) {
        throw new StageDoesNotSupportVisionError(stage.id);
      }

      // Best-effort UX hint: flip the renderer's spinner text from
      // "正在抽取…" to "正在识别图像（需要更长时间）…" so the user
      // knows why this run is slower. No-op if the renderer is closed.
      this.emitProgress?.('extraction:progress', {
        document_id: doc.id,
        phase: 'vision',
      });

      const images = await this.pdfToImages(bytes);
      const vision = stage.buildVisionMessages();
      result = await this.ctx.llmClient.extractWithImages(
        providerConfig.config,
        stage.schema,
        vision,
        images,
      );
    }

    // Migration 003's CHECK constraint requires raw_response + parsed_json
    // both NOT NULL when status is `review_needed`. We don't get a separate
    // "raw text" out of AI SDK's `generateObject` (it already parsed),
    // so we serialize the parsed object into both slots for Phase 1b. A
    // future refactor could capture the unprocessed model reply.
    const parsedJson = JSON.stringify(result);
    const id = newId();
    const ts = this.ctx.now();
    this.ctx.db
      .prepare(
        `INSERT INTO extraction
           (id, document_id, llm_provider, llm_model, prompt_version,
            raw_response, parsed_json, error_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'review_needed', ?)`,
      )
      .run(
        id,
        doc.id,
        providerConfig.config.provider,
        providerConfig.config.model,
        stage.id,
        parsedJson,
        parsedJson,
        ts,
      );

    const row = this.getById(id);
    if (!row) {
      throw new Error(`ExtractionService.run: row vanished after insert (id=${id})`);
    }
    return row;
  }

  getById(id: string): Extraction | null {
    const row = this.ctx.db.prepare('SELECT * FROM extraction WHERE id = ?').get(id) as
      | Extraction
      | undefined;
    return row ?? null;
  }

  listByDocument(documentId: string): Extraction[] {
    return this.ctx.db
      .prepare('SELECT * FROM extraction WHERE document_id = ? ORDER BY created_at DESC, id DESC')
      .all(documentId) as Extraction[];
  }

  listPendingReview(limit = 100): Extraction[] {
    return this.ctx.db
      .prepare(
        `SELECT * FROM extraction WHERE status = 'review_needed'
         ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .all(limit) as Extraction[];
  }

  /**
   * Mark the extraction confirmed by the user. Transitions
   * `review_needed` → `parsed`. `raw_response` and `parsed_json` are kept
   * intact (CHECK constraint requires both NOT NULL for `parsed`).
   *
   * `reviewed_by_user_at` is stamped with `ctx.now()` so we have an audit
   * trail of when the user accepted the extraction.
   */
  confirm(id: string): void {
    const result = this.ctx.db
      .prepare(
        `UPDATE extraction
           SET status = 'parsed', reviewed_by_user_at = ?
         WHERE id = ? AND status = 'review_needed'`,
      )
      .run(this.ctx.now(), id);
    if (result.changes === 0) {
      throw new Error(`extraction not confirmable: ${id} (missing or not in review_needed)`);
    }
  }

  /**
   * Reject the extraction. Transitions `review_needed` → `rejected`. The
   * schema's CHECK requires `parsed_json` NULL for `rejected` rows (and
   * `raw_response` OR `error_json` non-null), so we clear `parsed_json`
   * while keeping `raw_response` for forensics.
   *
   * Idempotent: a row that is already `rejected` is a no-op (no throw, no
   * state change). The "switch stage and re-extract" flow on a document
   * whose only extraction is already rejected used to hit this path and
   * surface a confusing "not discardable" error — see commit message for
   * the regression that motivated the change.
   *
   * Still throws when the row is missing or in `parsed`/`pending` —
   * discarding a confirmed activity would silently orphan the
   * downstream activity_data row, and a pending row's CHECK constraint
   * forbids the rejected target shape (raw_response IS NULL).
   */
  discard(id: string): void {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`extraction not discardable: ${id} (missing)`);
    }
    if (existing.status === 'rejected') return; // idempotent no-op
    if (existing.status !== 'review_needed') {
      throw new Error(
        `extraction not discardable: ${id} (status=${existing.status}, expected review_needed)`,
      );
    }
    this.ctx.db
      .prepare(
        `UPDATE extraction
           SET status = 'rejected', parsed_json = NULL, reviewed_by_user_at = ?
         WHERE id = ?`,
      )
      .run(this.ctx.now(), id);
  }

  private findCached(
    documentId: string,
    promptVersion: string,
    provider: string,
    model: string,
  ): Extraction | null {
    // Skipping rejected rows is what makes the discard → retry loop possible:
    // a rejected extraction is treated as a soft-delete, so re-running with
    // the same (doc, stage, provider, model) tuple bypasses the cache and
    // actually calls the LLM again. The matching `DELETE ... status='rejected'`
    // in `run()` then clears the way for the fresh INSERT past the UNIQUE
    // constraint.
    const row = this.ctx.db
      .prepare(
        `SELECT * FROM extraction
         WHERE document_id = ? AND prompt_version = ? AND llm_provider = ? AND llm_model = ?
           AND status != 'rejected'`,
      )
      .get(documentId, promptVersion, provider, model) as Extraction | undefined;
    return row ?? null;
  }

  /**
   * Returns one summary row per document that has at least one extraction.
   * Documents with no extractions are omitted (caller treats missing keys
   * as "no extractions yet"). Used by the /documents list to render a
   * per-row status chip without N+1'ing into `listByDocument`.
   *
   * Output shape:
   * - `active_status`: status of the most-recent NON-rejected extraction,
   *   or `null` if every extraction for the doc is rejected.
   * - `has_rejected`: true if the doc has any rejected row in history. The
   *   detail page uses this to show a "previous extraction discarded —
   *   re-run?" hint when `active_status` is null.
   *
   * Implementation: single SELECT with a correlated subquery for the latest
   * non-rejected status (cheaper than two passes when there are few docs;
   * the table is small in Phase 1b — premature index work would be wasted).
   */
  getStatusByDocument(): Array<{
    document_id: string;
    active_status: ExtractionStatus | null;
    has_rejected: boolean;
  }> {
    // `inner` is a SQLite reserved word (INNER JOIN), so we use `latest`
    // as the subquery alias. The subquery picks the most-recent non-rejected
    // status; the outer MAX() detects whether any rejected row exists. One
    // pass over the table, indexed on document_id by the implicit rowid.
    const rows = this.ctx.db
      .prepare(
        `SELECT
           e.document_id AS document_id,
           (
             SELECT latest.status FROM extraction AS latest
             WHERE latest.document_id = e.document_id AND latest.status != 'rejected'
             ORDER BY latest.created_at DESC, latest.id DESC
             LIMIT 1
           ) AS active_status,
           MAX(CASE WHEN e.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_flag
         FROM extraction AS e
         GROUP BY e.document_id`,
      )
      .all() as Array<{
      document_id: string;
      active_status: ExtractionStatus | null;
      rejected_flag: number;
    }>;
    return rows.map((r) => ({
      document_id: r.document_id,
      active_status: r.active_status,
      has_rejected: r.rejected_flag === 1,
    }));
  }
}
