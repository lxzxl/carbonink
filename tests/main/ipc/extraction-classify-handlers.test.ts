import { describe, expect, it, vi } from 'vitest';
import { extractionHandlers } from '@main/ipc/handlers/extraction';

function makeCtx() {
  return {
    extractionService: { run: vi.fn(), discard: vi.fn(), listByDocument: vi.fn() },
    classificationService: {
      classifyAndRun: vi.fn().mockResolvedValue({ status: 'classify_failed' }),
    },
    documentService: { getById: vi.fn() },
  } as unknown as never;
}

describe('extraction:classify-and-run handler', () => {
  it('zod-rejects malformed input (missing document_id)', async () => {
    const ctx = makeCtx();
    const handlers = extractionHandlers(ctx);
    await expect((handlers['extraction:classify-and-run']!)({} as never)).rejects.toThrow();
  });

  it('zod-rejects empty document_id', async () => {
    const ctx = makeCtx();
    const handlers = extractionHandlers(ctx);
    await expect((handlers['extraction:classify-and-run']!)({ document_id: '' } as never)).rejects.toThrow();
  });

  it('delegates to classificationService.classifyAndRun on valid input', async () => {
    const ctx = makeCtx();
    const handlers = extractionHandlers(ctx);
    const r = await (handlers['extraction:classify-and-run']!)({ document_id: 'd-1' });
    expect((ctx as never as { classificationService: { classifyAndRun: ReturnType<typeof vi.fn> } }).classificationService.classifyAndRun).toHaveBeenCalledWith('d-1');
    expect(r).toEqual({ status: 'classify_failed' });
  });
});
