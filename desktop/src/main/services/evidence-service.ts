import type { EvidenceAttachmentWithDocument, EvidenceTargetRef } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';
import type { DocumentService } from './document-service.js';

/**
 * Generic evidence attachments (migration 018): hang a supporting file off
 * an `activity_data` row or an `answer` so a third-party verifier can see
 * the paper trail behind any number.
 *
 * Files ride the existing content-addressed `document` store
 * (DocumentService, purpose 'evidence'); this service owns only the link
 * rows plus their audit_event trail. Attach/remove are allowed even on
 * finalized records — freezing locks the value and its EF binding, while
 * evidence edits stay legal because every one leaves an append-only
 * `evidence.attached` / `evidence.removed` audit row (no silent history).
 * Removal deletes the link only; the document row + file stay (the same
 * bytes may back other attachments or an extraction).
 */
export class EvidenceService {
  private readonly db: ServiceContext['db'];
  private readonly now: () => string;
  private readonly documentService: DocumentService;

  constructor(ctx: ServiceContext & { documentService: DocumentService }) {
    this.db = ctx.db;
    this.now = ctx.now;
    this.documentService = ctx.documentService;
  }

  /**
   * Upload (or dedupe onto) the file and link it to the target record in one
   * transaction, with an `evidence.attached` audit event. The audit payload
   * carries ids/hashes only — never the note's free text (payload
   * discipline: no user content in audit_event).
   */
  add(input: {
    target: EvidenceTargetRef;
    file: { filename: string; mimeType: string; bytes: Buffer };
    note?: string;
  }): EvidenceAttachmentWithDocument {
    this.assertTargetExists(input.target);

    const tx = this.db.transaction((): EvidenceAttachmentWithDocument => {
      const doc = this.documentService.uploadFile(input.file, { purpose: 'evidence' });
      const id = newId();
      const ts = this.now();
      const activityId = 'activity_data_id' in input.target ? input.target.activity_data_id : null;
      const answerId = 'answer_id' in input.target ? input.target.answer_id : null;

      this.db
        .prepare(
          `INSERT INTO evidence_attachment
             (id, activity_data_id, answer_id, document_id, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, activityId, answerId, doc.id, input.note ?? null, ts);

      this.writeAudit('evidence.attached', ts, {
        attachment_id: id,
        ...(activityId !== null ? { activity_id: activityId } : {}),
        ...(answerId !== null ? { answer_id: answerId } : {}),
        document_id: doc.id,
        sha256: doc.sha256,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
      });

      const row = this.getById(id);
      if (!row) throw new Error(`EvidenceService.add: row vanished after insert (id=${id})`);
      return row;
    });

    return tx();
  }

  /** All attachments on one record, newest first, with document metadata. */
  list(target: EvidenceTargetRef): EvidenceAttachmentWithDocument[] {
    const [column, value] =
      'activity_data_id' in target
        ? ['activity_data_id', target.activity_data_id]
        : ['answer_id', target.answer_id];
    return this.db
      .prepare(
        `${EVIDENCE_SELECT}
          WHERE ea.${column} = ?
          ORDER BY ea.created_at DESC, ea.id DESC`,
      )
      .all(value) as EvidenceAttachmentWithDocument[];
  }

  /**
   * Delete the link row (never the document) and write `evidence.removed`.
   * Removing an already-gone attachment is a no-op — idempotent so a
   * double-click in the renderer can't produce a scary error.
   */
  remove(id: string): void {
    const existing = this.getById(id);
    if (!existing) return;

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM evidence_attachment WHERE id = ?').run(id);
      this.writeAudit('evidence.removed', this.now(), {
        attachment_id: id,
        ...(existing.activity_data_id !== null ? { activity_id: existing.activity_data_id } : {}),
        ...(existing.answer_id !== null ? { answer_id: existing.answer_id } : {}),
        document_id: existing.document_id,
        sha256: existing.sha256,
      });
    });
    tx();
  }

  getById(id: string): EvidenceAttachmentWithDocument | null {
    const row = this.db.prepare(`${EVIDENCE_SELECT} WHERE ea.id = ?`).get(id) as
      | EvidenceAttachmentWithDocument
      | undefined;
    return row ?? null;
  }

  /**
   * Friendly existence check so a bad id surfaces as a readable message
   * instead of the FK violation the sanitize wrapper would blank out.
   */
  private assertTargetExists(target: EvidenceTargetRef): void {
    if ('activity_data_id' in target) {
      const hit = this.db
        .prepare('SELECT 1 FROM activity_data WHERE id = ?')
        .get(target.activity_data_id);
      if (!hit) throw new Error(`activity_data not found: ${target.activity_data_id}`);
    } else {
      const hit = this.db.prepare('SELECT 1 FROM answer WHERE id = ?').get(target.answer_id);
      if (!hit) throw new Error(`answer not found: ${target.answer_id}`);
    }
  }

  private writeAudit(kind: string, ts: string, payload: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)')
      .run(newId(), kind, JSON.stringify(payload), ts);
  }
}

const EVIDENCE_SELECT = `
  SELECT ea.id, ea.activity_data_id, ea.answer_id, ea.document_id, ea.note, ea.created_at,
         d.filename, d.mime_type, d.size_bytes, d.sha256
    FROM evidence_attachment ea
    JOIN document d ON d.id = ea.document_id`;
