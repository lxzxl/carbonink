import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { documentHandlers } from '@main/ipc/handlers/document';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * IPC glue test for the document + stages channels. We let the real
 * `DocumentService` run against an in-memory sqlite + a temp uploadsDir
 * (writes are cheap and dedupe is the most interesting handler property to
 * verify end-to-end). `stages:list` reads the in-memory registry — no DI
 * needed.
 */
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('document IPC handlers', () => {
  let db: Database.Database;
  let uploadsDir: string;
  let handlers: ReturnType<typeof documentHandlers>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    uploadsDir = mkdtempSync(join(tmpdir(), 'doc-ipc-test-'));
    const ctx = createIpcContext({ db, now: () => '2026-05-11T00:00:00.000Z' }, { uploadsDir });
    handlers = documentHandlers(ctx);
  });

  afterEach(() => {
    db.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('document:upload writes a row + dedupes on sha256', () => {
    const a = handlers['document:upload']?.({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF_BYTES,
    });
    expect(a?.id).toBeTruthy();
    expect(a?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a?.filename).toBe('bill.pdf');

    // Same bytes via a fresh Uint8Array → same row.
    const b = handlers['document:upload']?.({
      filename: 'bill-copy.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(FAKE_PDF_BYTES),
    });
    expect(b?.id).toBe(a?.id);
  });

  it('document:upload rejects non-Uint8Array bytes (defense in depth)', () => {
    expect(() =>
      handlers['document:upload']?.({
        filename: 'bill.pdf',
        mimeType: 'application/pdf',
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
        bytes: 'not bytes' as any,
      }),
    ).toThrow(/bytes must be a Uint8Array/);
  });

  it('document:list returns documents most-recent-first', () => {
    const ts = ['2026-05-09T00:00:00.000Z', '2026-05-10T00:00:00.000Z', '2026-05-11T00:00:00.000Z'];
    let i = 0;
    // Replace the handler bundle with one that bumps `now` per call so the
    // ordering assertion isn't flapping on identical timestamps.
    const ctx = createIpcContext({ db, now: () => ts[i++] as string }, { uploadsDir });
    const h = documentHandlers(ctx);
    const a = h['document:upload']?.({
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    const b = h['document:upload']?.({
      filename: 'b.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([2]),
    });
    const c = h['document:upload']?.({
      filename: 'c.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([3]),
    });
    const list = h['document:list']?.();
    expect(list?.map((d) => d.id)).toEqual([c?.id, b?.id, a?.id]);
  });

  it('document:get-by-id returns the row or null', () => {
    const doc = handlers['document:upload']?.({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: FAKE_PDF_BYTES,
    });
    expect(handlers['document:get-by-id']?.({ id: doc?.id ?? '' })?.id).toBe(doc?.id);
    expect(handlers['document:get-by-id']?.({ id: '01J0000000000000000000NOPE' })).toBeNull();
  });

  it('document:read-bytes returns the on-disk PDF bytes for the requested id', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const doc = handlers['document:upload']?.({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes,
    });
    const read = handlers['document:read-bytes']?.({ id: doc?.id ?? '' });
    expect(read).toBeInstanceOf(Uint8Array);
    expect(Array.from(read ?? new Uint8Array())).toEqual(Array.from(bytes));
  });

  it('document:read-bytes throws when the document id is unknown', () => {
    expect(() => handlers['document:read-bytes']?.({ id: '01J0000000000000000000NOPE' })).toThrow(
      /Document not found/,
    );
  });

  it('stages:list exposes the registered stage(s) without leaking schema/buildPrompt', () => {
    const stages = handlers['stages:list']?.();
    expect(stages?.length).toBeGreaterThanOrEqual(1);
    const cu = stages?.find((s) => s.id === 'china_utility.v1');
    expect(cu).toBeDefined();
    expect(cu).toEqual({
      id: 'china_utility.v1',
      version: expect.any(String),
      description: expect.any(String),
    });
    // Make sure the response is plain-JSON serializable (no functions /
    // schema objects sneaking into the IPC payload).
    expect(() => JSON.stringify(stages)).not.toThrow();
  });
});
