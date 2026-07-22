import { BatchExtractionService } from '@main/services/batch-extraction-service';
import type { BatchExtractionProgress, ClassifyAndRunResult } from '@shared/types';
import { describe, expect, it } from 'vitest';

type Deferred = {
  promise: Promise<ClassifyAndRunResult>;
  resolve: (r: ClassifyAndRunResult) => void;
  reject: (e: Error) => void;
};

function deferred(): Deferred {
  let resolve!: (r: ClassifyAndRunResult) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<ClassifyAndRunResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CLASSIFIED: ClassifyAndRunResult = {
  status: 'classified',
  doc_type: 'fuel_receipt.v1',
  extraction: {} as never,
};

/** Controllable harness: each doc id gets a deferred; tracks concurrency. */
function makeHarness() {
  const deferredById = new Map<string, Deferred>();
  const events: BatchExtractionProgress[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const svc = new BatchExtractionService({
    classificationService: {
      classifyAndRun: (id: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const d = deferred();
        deferredById.set(id, d);
        return d.promise.finally(() => {
          inFlight -= 1;
        });
      },
    },
    documentService: {
      getById: (id: string) => ({ id, filename: `${id}.pdf` }),
    },
    pushProgress: (p) => events.push(p),
  });

  /** Wait until the worker loop has parked id's deferred. */
  const settle = async (id: string, outcome: 'ok' | 'classify_failed' | 'throw') => {
    // Yield the microtask queue so the worker reaches the await.
    await Promise.resolve();
    const d = deferredById.get(id);
    if (!d) throw new Error(`doc ${id} was never started`);
    if (outcome === 'ok') d.resolve(CLASSIFIED);
    else if (outcome === 'classify_failed') d.resolve({ status: 'classify_failed' });
    else d.reject(new Error(`boom for ${id}`));
    await Promise.resolve();
  };

  return { svc, events, settle, maxInFlight: () => maxInFlight, deferredById };
}

describe('BatchExtractionService', () => {
  it('runs every doc with concurrency capped at 2 and reports final counts', async () => {
    const h = makeHarness();
    const start = h.svc.start(['a', 'b', 'c', 'd']);
    expect(start).toEqual({ ok: true, total: 4 });

    await h.settle('a', 'ok');
    await h.settle('b', 'ok');
    await h.settle('c', 'ok');
    await h.settle('d', 'ok');
    await h.svc.waitForIdle();

    expect(h.maxInFlight()).toBe(2);
    const final = h.events.at(-1);
    expect(final).toMatchObject({
      total: 4,
      done: 4,
      ok_count: 4,
      failed_count: 0,
      running: false,
      canceled: false,
      current_document_ids: [],
    });
  });

  it('aggregates classify_failed and thrown errors with filenames', async () => {
    const h = makeHarness();
    h.svc.start(['a', 'b', 'c']);
    await h.settle('a', 'classify_failed');
    await h.settle('b', 'throw');
    await h.settle('c', 'ok');
    await h.svc.waitForIdle();

    const final = h.events.at(-1);
    expect(final).toMatchObject({ done: 3, ok_count: 1, failed_count: 2 });
    expect(final?.failed).toEqual([
      { document_id: 'a', filename: 'a.pdf', reason: 'classify_failed' },
      { document_id: 'b', filename: 'b.pdf', reason: 'error', detail: 'boom for b' },
    ]);
  });

  it('cancel drops the queue, lets in-flight docs finish, marks canceled', async () => {
    const h = makeHarness();
    h.svc.start(['a', 'b', 'c', 'd', 'e']);
    await Promise.resolve();
    expect(h.svc.cancel()).toBe(true);
    await h.settle('a', 'ok');
    await h.settle('b', 'ok');
    await h.svc.waitForIdle();

    const final = h.events.at(-1);
    expect(final).toMatchObject({
      total: 5,
      done: 2,
      ok_count: 2,
      running: false,
      canceled: true,
    });
    // c/d/e were never started.
    expect(h.deferredById.has('c')).toBe(false);
    expect(h.svc.cancel()).toBe(false);
  });

  it('enforces one batch at a time, allows a new one after idle', async () => {
    const h = makeHarness();
    h.svc.start(['a']);
    expect(h.svc.start(['b'])).toEqual({ ok: false, error: { _tag: 'BatchAlreadyRunning' } });
    await h.settle('a', 'ok');
    await h.svc.waitForIdle();
    expect(h.svc.start(['b'])).toEqual({ ok: true, total: 1 });
    await h.settle('b', 'ok');
    await h.svc.waitForIdle();
  });

  it('rejects empty input and dedupes ids', async () => {
    const h = makeHarness();
    expect(h.svc.start([])).toEqual({ ok: false, error: { _tag: 'NothingToRun' } });
    expect(h.svc.start(['a', 'a', 'a'])).toEqual({ ok: true, total: 1 });
    await h.settle('a', 'ok');
    await h.svc.waitForIdle();
    expect(h.events.at(-1)?.total).toBe(1);
  });

  it('status() is null before any run and a defensive snapshot after', async () => {
    const h = makeHarness();
    expect(h.svc.status()).toBeNull();
    h.svc.start(['a']);
    const before = h.svc.status();
    expect(before).toMatchObject({ running: true, total: 1 });
    // Mutating the snapshot must not leak into the service.
    before?.current_document_ids.push('tampered');
    await h.settle('a', 'ok');
    await h.svc.waitForIdle();
    expect(h.svc.status()).toMatchObject({ running: false, done: 1, ok_count: 1 });
    expect(h.events.at(-1)?.current_document_ids).toEqual([]);
  });
});
