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
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(['application/pdf']);

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
   * we return it untouched — no second filesystem write, no second db row.
   *
   * Throws if `mimeType` is not in {@link ALLOWED_MIME_TYPES}. The error
   * message names the rejected mime so the IPC layer can surface it.
   */
  uploadFile(input: { filename: string; mimeType: string; bytes: Buffer }): Document {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new Error(
        `Unsupported mimeType: ${input.mimeType}. Phase 1b only accepts application/pdf.`,
      );
    }

    const sha = sha256Hex(input.bytes);

    // Dedupe BEFORE writing: if the same content already exists, skip the
    // disk write entirely. We trust the sha256 index (UNIQUE in migration
    // 003) — two distinct Buffers with the same sha256 would be a
    // cryptographic collision, far outside our threat model.
    const existing = this.findBySha(sha);
    if (existing) return existing;

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
           (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, sha, input.filename, input.mimeType, input.bytes.length, absPath, ts);

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
    this.ctx.db
      .prepare(`UPDATE document SET doc_type = ? WHERE id = ?`)
      .run(docType, documentId);
  }

  /**
   * Most recent uploads first. Default cap of 100 matches the Phase 1b UI
   * which paginates beyond that — callers that want everything can pass a
   * very large limit. We sort by `uploaded_at` (the table's ISO8601 timestamp
   * column) since the schema does not carry a separate `created_at`.
   */
  listAll(limit = 100): Document[] {
    return this.ctx.db
      .prepare('SELECT * FROM document ORDER BY uploaded_at DESC, id DESC LIMIT ?')
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
