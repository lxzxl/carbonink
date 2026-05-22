import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { DocumentService } from '@main/services/document-service';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Tiny "PDF" bytes — content is never parsed in DocumentService; only its
 * sha256 + length matter. We use a Buffer literal so dedupe assertions
 * compare bytes, not file handles.
 */
const FAKE_PDF = Buffer.from('%PDF-1.4 fake test content');

describe('DocumentService', () => {
  let db: Database.Database;
  let uploadsDir: string;
  let service: DocumentService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
    service = new DocumentService({
      db,
      now: () => '2026-05-11T00:00:00.000Z',
      uploadsDir,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('uploadFile writes file + row, derives sha-prefixed path', () => {
    const doc = service.uploadFile({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF,
    });

    // Row sanity: sha256 + size + storage_path must agree with input.
    expect(doc.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.filename).toBe('bill.pdf');
    expect(doc.mime_type).toBe('application/pdf');
    expect(doc.size_bytes).toBe(FAKE_PDF.length);
    expect(doc.uploaded_at).toBe('2026-05-11T00:00:00.000Z');
    expect(doc.uploaded_by).toBeNull();

    // File on disk: `<uploadsDir>/<sha[0:2]>/<sha>.pdf`, bytes match.
    const expectedPath = join(uploadsDir, doc.sha256.slice(0, 2), `${doc.sha256}.pdf`);
    expect(doc.storage_path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath).equals(FAKE_PDF)).toBe(true);

    // Roundtrip via getById matches the inserted row.
    expect(service.getById(doc.id)).toEqual(doc);
  });

  it('uploadFile dedupes on sha256 — same Buffer twice returns the same row', () => {
    const first = service.uploadFile({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF,
    });
    const second = service.uploadFile({
      // Different filename intentionally — dedupe is by content, not name.
      filename: 'invoice-jan.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF,
    });

    expect(second.id).toBe(first.id);
    expect(second.filename).toBe('bill.pdf'); // original name preserved

    // Only one document row total.
    const count = db.prepare('SELECT COUNT(*) AS c FROM document').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('uploadFile rejects non-PDF mime types', () => {
    expect(() =>
      service.uploadFile({
        filename: 'photo.png',
        mimeType: 'image/png',
        bytes: Buffer.from('not a pdf'),
      }),
    ).toThrow(/Unsupported mimeType: image\/png/);

    // Defense: nothing should have been written.
    const count = db.prepare('SELECT COUNT(*) AS c FROM document').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('listAll orders by uploaded_at DESC (most recent first)', () => {
    // Inject distinct `now` per upload so timestamps are deterministic.
    const ts = ['2026-05-09T00:00:00.000Z', '2026-05-10T00:00:00.000Z', '2026-05-11T00:00:00.000Z'];
    let i = 0;
    const tsService = new DocumentService({
      db,
      now: () => ts[i++] as string,
      uploadsDir,
    });
    const a = tsService.uploadFile({
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('aaa'),
    });
    const b = tsService.uploadFile({
      filename: 'b.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('bbb'),
    });
    const c = tsService.uploadFile({
      filename: 'c.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('ccc'),
    });

    const list = tsService.listAll();
    expect(list.map((d) => d.id)).toEqual([c.id, b.id, a.id]);
  });

  it('listAll respects the limit argument', () => {
    for (let i = 0; i < 5; i++) {
      service.uploadFile({
        filename: `f${i}.pdf`,
        mimeType: 'application/pdf',
        bytes: Buffer.from(`content-${i}`),
      });
    }
    expect(service.listAll(3).length).toBe(3);
    expect(service.listAll().length).toBe(5);
  });

  it('getById returns null for a missing id', () => {
    expect(service.getById('01J0000000000000000000FAKE')).toBeNull();
  });

  it('delete removes the row and file when no extraction references it', () => {
    const doc = service.uploadFile({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF,
    });

    service.delete(doc.id);

    expect(service.getById(doc.id)).toBeNull();
    expect(existsSync(doc.storage_path)).toBe(false);
  });

  it('delete throws SQLITE_CONSTRAINT_FOREIGNKEY when an extraction references the doc', () => {
    const doc = service.uploadFile({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF,
    });

    // Manually insert an extraction row referencing this document, matching
    // the schema's CHECK constraints (status=pending => raw_response/parsed_json
    // are NULL).
    db.prepare(
      `INSERT INTO extraction
         (id, document_id, llm_provider, llm_model, prompt_version, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).run('ext-1', doc.id, 'openai', 'gpt-4o-mini', 'china_utility.v1', '2026-05-11T00:00:00.000Z');

    expect(() => service.delete(doc.id)).toThrow(/FOREIGN KEY/i);

    // Defense: the file must NOT be unlinked when the row delete fails.
    // Otherwise we'd have an extraction pointing at a row whose file is gone.
    expect(existsSync(doc.storage_path)).toBe(true);
    expect(service.getById(doc.id)).not.toBeNull();
  });

  it('delete is a no-op for a missing id', () => {
    expect(() => service.delete('01J0000000000000000000NOPE')).not.toThrow();
  });

  it('updateDocType writes doc_type to the document row', () => {
    const doc = service.uploadFile({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF,
    });
    // doc_type starts null (migration default).
    expect(service.getById(doc.id)?.doc_type).toBeNull();

    service.updateDocType(doc.id, 'fuel_receipt.v1');
    expect(service.getById(doc.id)?.doc_type).toBe('fuel_receipt.v1');

    // Can also be cleared back to null.
    service.updateDocType(doc.id, null);
    expect(service.getById(doc.id)?.doc_type).toBeNull();
  });
});
