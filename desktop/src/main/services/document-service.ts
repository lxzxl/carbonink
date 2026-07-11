import { createHash } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';

/**
 * Phase 1b only accepts PDFs. Future stages (Phase 1c+) will likely add
 * `image/png` / `image/jpeg` once the UI can route per-mime-type to image
 * stages. Centralized as a constant so the rejection error message and the
 * `if`-guard can't drift.
 */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  // Phase 2.2a — questionnaire side accepts .xlsx CDP-style files.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * Evidence attachments (migration 018) accept a wider set than the
 * extraction pipeline: images are legitimate audit evidence (meter photos,
 * screenshots of internal ledgers) even though no extraction stage can
 * process them. Kept separate from {@link ALLOWED_MIME_TYPES} so widening
 * evidence never accidentally lets images into the extraction entry points.
 */
const EVIDENCE_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/**
 * Soft cap for evidence uploads. Extraction uploads stay ungated (the
 * pipeline already bounds them in practice); evidence files are kept
 * out-of-band forever, so an explicit cap prevents a stray screen
 * recording from bloating the uploads dir.
 */
const EVIDENCE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Pick a filesystem extension from a user-supplied filename. We use the
 * *last* `.foo` segment (lowercased) so `bill.zh-CN.PDF` lands as `.pdf`.
 * Falls back to `.bin` for filenames with no extension — better than no
 * suffix at all (some OSes refuse to preview extensionless files).
 *
 * We intentionally do *not* derive the extension from `mimeType`: a PDF
 * uploaded as `report.pdf` should stay `.pdf` on disk even if a future
 * mime allowlist permits e.g. `application/octet-stream`.
 */
function pickExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '.bin';
  return `.${filename.slice(dot + 1).toLowerCase()}`;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Content-addressed file storage + a `document` table row per unique upload.
 *
 * Storage layout: `<uploadsDir>/<sha[0:2]>/<sha>.<ext>`. The two-char prefix
 * keeps any single directory bounded (matters once a user accumulates
 * thousands of bills — most filesystems hate flat dirs at that scale) while
 * staying trivially derivable from the sha256.
 *
 * Dedupe is by sha256: re-uploading the same bytes (identical Buffer)
 * returns the existing row and skips the second write. This is the
 * cheapest layer of idempotency — `ExtractionService` adds a second layer
 * over `(document, stage, model)` so re-running the same stage on the same
 * doc is also free.
 */
export class DocumentService {
  constructor(
    private readonly ctx: ServiceContext & {
      /**
       * Absolute base path for the content-addressed file store. Production
       * wires this to `app.getPath('userData') + '/uploads'`; tests pass a
       * fresh `mkdtempSync` directory and clean it up in `afterEach`.
       */
      uploadsDir: string;
    },
  ) {}

  /**
   * Compute sha256, write the bytes to `<uploadsDir>/<sha[0:2]>/<sha>.<ext>`,
   * and insert a `document` row. If a row already exists for this sha256,
   * we return it (mostly) untouched — no second filesystem write, no second
   * db row.
   *
   * `purpose` selects the mime allowlist and the initial `doc_type`:
   * - `'extraction'` (default): {@link ALLOWED_MIME_TYPES}, `doc_type` NULL
   *   (ClassificationService fills it in later). If the dedupe hit is a row
   *   previously uploaded as evidence, its `doc_type = 'evidence'` tag is
   *   cleared so the doc becomes visible in the /documents workspace again —
   *   the evidence_attachment links are unaffected (they key on document_id).
   * - `'evidence'`: {@link EVIDENCE_MIME_TYPES} (adds images), 50MB cap,
   *   `doc_type = 'evidence'` on fresh inserts. A dedupe hit onto an
   *   extraction doc keeps its classified doc_type — a document can back
   *   both roles at once.
   *
   * Throws if `mimeType` is not in the selected allowlist. The error
   * message names the rejected mime so the IPC layer can surface it.
   */
  uploadFile(
    input: { filename: string; mimeType: string; bytes: Buffer },
    opts: { purpose?: 'extraction' | 'evidence' } = {},
  ): Document {
    const purpose = opts.purpose ?? 'extraction';
    const allowed = purpose === 'evidence' ? EVIDENCE_MIME_TYPES : ALLOWED_MIME_TYPES;
    if (!allowed.has(input.mimeType)) {
      throw new Error(
        `Unsupported mimeType: ${input.mimeType}. Accepted: ${[...allowed].join(', ')}.`,
      );
    }
    if (purpose === 'evidence' && input.bytes.length > EVIDENCE_MAX_BYTES) {
      throw new Error(
        `Evidence file too large: ${input.bytes.length} bytes (max ${EVIDENCE_MAX_BYTES}).`,
      );
    }

    const sha = sha256Hex(input.bytes);

    // Dedupe BEFORE writing: if the same content already exists, skip the
    // disk write entirely. We trust the sha256 index (UNIQUE in migration
    // 003) — two distinct Buffers with the same sha256 would be a
    // cryptographic collision, far outside our threat model.
    const existing = this.findBySha(sha);
    if (existing) {
      if (purpose === 'extraction' && existing.doc_type === 'evidence') {
        // Re-uploaded through an extraction entry point: un-hide it from the
        // /documents workspace (listAll filters 'evidence') and let
        // classification assign a real type.
        this.updateDocType(existing.id, null);
        return this.getById(existing.id) ?? existing;
      }
      return existing;
    }

    const ext = pickExt(input.filename);
    const dir = join(this.ctx.uploadsDir, sha.slice(0, 2));
    const absPath = join(dir, `${sha}${ext}`);

    // `recursive: true` is idempotent and creates parent dirs in one call.
    mkdirSync(dir, { recursive: true });
    writeFileSync(absPath, input.bytes);

    const id = newId();
    const ts = this.ctx.now();
    this.ctx.db
      .prepare(
        `INSERT INTO document
           (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by, doc_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        sha,
        input.filename,
        input.mimeType,
        input.bytes.length,
        absPath,
        ts,
        purpose === 'evidence' ? 'evidence' : null,
      );

    const row = this.getById(id);
    if (!row) {
      // Should never happen — we just inserted it. Better an explicit throw
      // than letting downstream code see `null` and fail confusingly.
      throw new Error(`DocumentService.uploadFile: row vanished after insert (id=${id})`);
    }
    return row;
  }

  getById(id: string): Document | null {
    const row = this.ctx.db.prepare('SELECT * FROM document WHERE id = ?').get(id) as
      | Document
      | undefined;
    return row ?? null;
  }

  /**
   * Write `doc_type` back to the document row. Called by ClassificationService
   * after a successful LLM classification to cache the result so future calls
   * skip classification entirely. Pass `null` to clear a previously-set type.
   */
  updateDocType(documentId: string, docType: string | null): void {
    this.ctx.db.prepare(`UPDATE document SET doc_type = ? WHERE id = ?`).run(docType, documentId);
  }

  /**
   * Most recent uploads first. Default cap of 100 matches the Phase 1b UI
   * which paginates beyond that — callers that want everything can pass a
   * very large limit. We sort by `uploaded_at` (the table's ISO8601 timestamp
   * column) since the schema does not carry a separate `created_at`.
   *
   * Evidence-only uploads (`doc_type = 'evidence'`, migration-018 feature)
   * are excluded: the /documents workspace is the extraction pipeline's
   * inbox, and evidence files are browsed from the record they're attached
   * to (lineage panel), not here.
   */
  listAll(limit = 100): Document[] {
    return this.ctx.db
      .prepare(
        `SELECT * FROM document
          WHERE doc_type IS NULL OR doc_type != 'evidence'
          ORDER BY uploaded_at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as Document[];
  }

  /**
   * Hard delete: removes the sqlite row and the on-disk file (if present).
   *
   * Phase 1b limitation: the `extraction.document_id` FK in migration 003
   * has no `ON DELETE` clause, which sqlite treats as `NO ACTION` — the
   * DELETE will fail with `SQLITE_CONSTRAINT_FOREIGNKEY` when any extraction
   * still references this document. That's the right behavior for now (a
   * confirmed extraction is real user data; silently cascading would lose
   * it), but Phase 1c+ will probably want either ON DELETE CASCADE for
   * unconfirmed rows or a soft-delete flag once real users start uploading
   * and pruning docs.
   */
  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) return;

    // Let the FK violation propagate untouched — better-sqlite3 surfaces
    // it as a thrown `SqliteError`. Doing the DELETE first means we never
    // remove the file when the row delete fails (FK-protected → file
    // stays, matches what's still in the table).
    this.ctx.db.prepare('DELETE FROM document WHERE id = ?').run(id);

    try {
      unlinkSync(existing.storage_path);
    } catch (err) {
      // Tolerate ENOENT (file already gone): the row was the source of
      // truth, so a missing file just means cleanup raced or someone
      // wiped <userData>/uploads/ manually. Re-throw anything else.
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
        throw err;
      }
    }
  }

  private findBySha(sha: string): Document | null {
    const row = this.ctx.db.prepare('SELECT * FROM document WHERE sha256 = ?').get(sha) as
      | Document
      | undefined;
    return row ?? null;
  }
}
