import type {
  BatchExtractionFailure,
  BatchExtractionProgress,
  BatchExtractionStartResult,
  ClassifyAndRunResult,
} from '@shared/types.js';

/** Parallel classify/extract calls per batch — small on purpose (provider rate limits). */
const CONCURRENCY = 2;
/** Failure rows carried on the wire; the count keeps the full total. */
const MAX_REPORTED_FAILURES = 50;

interface ClassificationRunner {
  classifyAndRun(documentId: string): Promise<ClassifyAndRunResult>;
}

interface DocumentLookup {
  getById(id: string): { id: string; filename: string } | null;
}

type BatchState = {
  progress: BatchExtractionProgress;
  queue: string[];
  canceled: boolean;
};

/**
 * Batch extraction queue (spec 2026-07-22, ROADMAP §8.1-① follow-up).
 *
 * Wraps the existing per-document `classifyAndRun` in a small in-memory
 * worker pool: manual trigger, concurrency 2, one progress push per
 * completed document, single batch at a time. The queue owns no DB state —
 * every completed document leaves a real `extraction` row (or the
 * classify_failed nothing), so a crashed/restarted batch is resumed by
 * simply pressing the button again for whatever is still unextracted.
 * Confirmation stays per-document human review; this service never
 * touches `review_needed → parsed`.
 */
export class BatchExtractionService {
  private state: BatchState | null = null;

  constructor(
    private readonly deps: {
      classificationService: ClassificationRunner;
      documentService: DocumentLookup;
      pushProgress: (progress: BatchExtractionProgress) => void;
    },
  ) {}

  /** Snapshot of the current (or last finished) batch; null before any run. */
  status(): BatchExtractionProgress | null {
    return this.state ? this.snapshot() : null;
  }

  /**
   * Stop dequeuing; in-flight documents finish and are counted. Returns
   * false when nothing is running (idempotent, safe to double-cancel).
   */
  cancel(): boolean {
    if (!this.state?.progress.running) return false;
    this.state.canceled = true;
    this.state.queue.length = 0;
    return true;
  }

  /**
   * Kick off a batch over the given document ids (deduped). Returns
   * immediately — progress rides `pushProgress`. The returned promise on
   * the internal drain is intentionally not exposed: IPC callers get the
   * start acknowledgment, tests can await `waitForIdle`.
   */
  start(documentIds: string[]): BatchExtractionStartResult {
    if (this.state?.progress.running) {
      return { ok: false, error: { _tag: 'BatchAlreadyRunning' } };
    }
    const ids = [...new Set(documentIds)];
    if (ids.length === 0) {
      return { ok: false, error: { _tag: 'NothingToRun' } };
    }

    this.state = {
      queue: [...ids],
      canceled: false,
      progress: {
        total: ids.length,
        done: 0,
        ok_count: 0,
        failed_count: 0,
        running: true,
        canceled: false,
        current_document_ids: [],
        failed: [],
      },
    };

    this.drainPromise = this.drain(this.state);
    return { ok: true, total: ids.length };
  }

  /** Test seam: resolves when the current batch fully settles. */
  async waitForIdle(): Promise<void> {
    await this.drainPromise;
  }

  private drainPromise: Promise<void> = Promise.resolve();

  private async drain(state: BatchState): Promise<void> {
    const workers = Array.from({ length: Math.min(CONCURRENCY, state.queue.length) }, () =>
      this.worker(state),
    );
    await Promise.all(workers);
    state.progress.running = false;
    state.progress.canceled = state.canceled;
    this.emit(state);
  }

  private async worker(state: BatchState): Promise<void> {
    for (;;) {
      const id = state.queue.shift();
      if (id === undefined || state.canceled) return;
      state.progress.current_document_ids.push(id);
      this.emit(state);

      let failure: Omit<BatchExtractionFailure, 'filename'> | null = null;
      try {
        const result = await this.deps.classificationService.classifyAndRun(id);
        if (result.status !== 'classified') {
          failure = { document_id: id, reason: 'classify_failed' };
        }
      } catch (err) {
        failure = {
          document_id: id,
          reason: 'error',
          ...(err instanceof Error ? { detail: err.message.slice(0, 200) } : {}),
        };
      }

      state.progress.current_document_ids = state.progress.current_document_ids.filter(
        (current) => current !== id,
      );
      state.progress.done += 1;
      if (failure) {
        state.progress.failed_count += 1;
        if (state.progress.failed.length < MAX_REPORTED_FAILURES) {
          state.progress.failed.push({
            ...failure,
            filename: this.deps.documentService.getById(id)?.filename ?? id,
          });
        }
      } else {
        state.progress.ok_count += 1;
      }
      this.emit(state);
    }
  }

  /**
   * Push a defensive clone — the renderer (and tests) must never share the
   * mutable internal snapshot across events.
   */
  private emit(state: BatchState): void {
    this.deps.pushProgress(this.snapshotOf(state));
  }

  private snapshot(): BatchExtractionProgress {
    // status() callers get the same clone semantics as push events.
    return this.snapshotOf(this.state as BatchState);
  }

  private snapshotOf(state: BatchState): BatchExtractionProgress {
    return {
      ...state.progress,
      current_document_ids: [...state.progress.current_document_ids],
      failed: state.progress.failed.map((f) => ({ ...f })),
    };
  }
}
