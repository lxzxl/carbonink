import { runMigrations } from '@main/db/migrate';
import { createIpcContext, type IpcContext } from '@main/ipc/context';
import { extractionHandlers } from '@main/ipc/handlers/extraction';
import type { ClassificationService } from '@main/services/classification-service';
import type { BatchExtractionProgress } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => import('../../stubs/electron'));

let db: Database.Database;
let ctx: IpcContext;
let handlers: ReturnType<typeof extractionHandlers>;
let events: Array<[string, BatchExtractionProgress]>;
let classifyAndRun: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  events = [];
  classifyAndRun = vi.fn();
  ctx = createIpcContext(
    { db, now: () => '2026-07-22T00:00:00.000Z' },
    {
      classificationService: { classifyAndRun } as unknown as ClassificationService,
      progressEmitter: (channel, payload) => {
        events.push([channel, payload as BatchExtractionProgress]);
      },
    },
  );
  handlers = extractionHandlers(ctx);
});

afterEach(() => db.close());

describe('extraction:batch-* handler glue', () => {
  it('runs a batch through the real service and pushes progress', async () => {
    classifyAndRun.mockResolvedValue({ status: 'classified', doc_type: 'x', extraction: {} });
    const started = handlers['extraction:batch-run']?.({ document_ids: ['d1', 'd2'] });
    expect(started).toEqual({ ok: true, total: 2 });

    await ctx.batchExtractionService.waitForIdle();
    expect(classifyAndRun).toHaveBeenCalledTimes(2);

    const status = handlers['extraction:batch-status']?.();
    expect(status).toMatchObject({ done: 2, ok_count: 2, running: false });

    const batchEvents = events.filter(([channel]) => channel === 'extraction:batch-progress');
    expect(batchEvents.length).toBeGreaterThan(0);
    expect(batchEvents.at(-1)?.[1]).toMatchObject({ running: false, done: 2 });
  });

  it('rejects malformed input at the zod boundary', () => {
    expect(() =>
      handlers['extraction:batch-run']?.({ document_ids: 'nope' as unknown as string[] }),
    ).toThrow();
    expect(() => handlers['extraction:batch-run']?.({ document_ids: [''] })).toThrow();
  });

  it('cancel is a safe no-op when idle; status null before any run', () => {
    expect(handlers['extraction:batch-status']?.()).toBeNull();
    expect(handlers['extraction:batch-cancel']?.()).toEqual({ ok: false });
  });
});
