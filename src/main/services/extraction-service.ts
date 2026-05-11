import { readFileSync } from 'node:fs';
import type { LLMClient } from '@main/llm/llm-client.js';
import { getStage } from '@main/llm/stages/registry.js';
import type { Extraction } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';
import type { DocumentService } from './document-service.js';
import type { SettingsService } from './settings-service.js';

/**
 * Injected pdf-parse adapter shape. We DI this so tests can pass a stub
 * that returns canned text — the real `pdf-parse` package eagerly loads
 * fixture files on first import which makes it awkward to invoke under
 * vitest. Production wires this to a thin wrapper around the v2 `PDFParse`
 * class (see `parsePdfDefault` below).
 */
export type ParsePdf = (bytes: Buffer) => Promise<{ text: string }>;

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

  constructor(
    private readonly ctx: ServiceContext & {
      documentService: DocumentService;
      settingsService: SettingsService;
      llmClient: LLMClient;
      /** DI override for `node:fs.readFileSync`. Defaults to readFileSync. */
      readFile?: (path: string) => Buffer;
      /** DI override for PDF parsing. Defaults to `pdf-parse`. */
      parsePdf?: ParsePdf;
    },
  ) {
    this.readFile = ctx.readFile ?? readFileSync;
    this.parsePdf = ctx.parsePdf ?? parsePdfDefault;
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
    const cached = this.findCached(
      doc.id,
      stage.id,
      providerConfig.config.provider,
      providerConfig.config.model,
    );
    if (cached) return cached;

    // Read + parse the PDF. The DI'd `readFile` lets tests provide bytes
    // without writing a real file; `parsePdf` lets them skip pdf.js entirely.
    const bytes = this.readFile(doc.storage_path);
    const pdf = await this.parsePdf(bytes);
    const pdfText = pdf.text;

    const prompt = stage.buildPrompt(pdfText);
    const result = await this.ctx.llmClient.extract(providerConfig.config, stage.schema, prompt);

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
   */
  discard(id: string): void {
    const result = this.ctx.db
      .prepare(
        `UPDATE extraction
           SET status = 'rejected', parsed_json = NULL, reviewed_by_user_at = ?
         WHERE id = ? AND status = 'review_needed'`,
      )
      .run(this.ctx.now(), id);
    if (result.changes === 0) {
      throw new Error(`extraction not discardable: ${id} (missing or not in review_needed)`);
    }
  }

  private findCached(
    documentId: string,
    promptVersion: string,
    provider: string,
    model: string,
  ): Extraction | null {
    const row = this.ctx.db
      .prepare(
        `SELECT * FROM extraction
         WHERE document_id = ? AND prompt_version = ? AND llm_provider = ? AND llm_model = ?`,
      )
      .get(documentId, promptVersion, provider, model) as Extraction | undefined;
    return row ?? null;
  }
}
