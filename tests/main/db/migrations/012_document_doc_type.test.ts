import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('migration 012 — document.doc_type', () => {
  it('adds doc_type column (nullable, defaults to NULL)', () => {
    const db = setupDb();
    const cols = db.prepare(`PRAGMA table_info(document)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const docTypeCol = cols.find((c) => c.name === 'doc_type');
    expect(docTypeCol).toBeDefined();
    expect(docTypeCol?.type).toBe('TEXT');
    expect(docTypeCol?.notnull).toBe(0);
  });

  it('existing document rows have doc_type = NULL', () => {
    const db = setupDb();
    db.prepare(
      `
      INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
      VALUES ('doc-1', 'aa', 'a.pdf', 'application/pdf', 100, '/tmp/a.pdf', '2026-05-15T00:00:00Z')
    `,
    ).run();
    const row = db.prepare(`SELECT doc_type FROM document WHERE id = ?`).get('doc-1') as {
      doc_type: string | null;
    };
    expect(row.doc_type).toBeNull();
  });

  it('creates partial index idx_document_doc_type on non-null doc_type', () => {
    const db = setupDb();
    const idx = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_document_doc_type'`)
      .get() as { name: string; sql: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx?.sql).toContain('doc_type');
  });

  it('accepts a stage_id string in doc_type', () => {
    const db = setupDb();
    db.prepare(
      `
      INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, doc_type)
      VALUES ('doc-2', 'bb', 'b.pdf', 'application/pdf', 100, '/tmp/b.pdf', '2026-05-15T00:00:00Z', 'china_utility.v1')
    `,
    ).run();
    const row = db.prepare(`SELECT doc_type FROM document WHERE id = ?`).get('doc-2') as {
      doc_type: string;
    };
    expect(row.doc_type).toBe('china_utility.v1');
  });
});
