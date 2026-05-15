import { runMigrations } from '@main/db/migrate';
import { ClassificationService } from '@main/services/classification-service';
import type { Extraction } from '@shared/types';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'fake',
} as never;

type DocRow = { id: string; doc_type: string | null; storage_path: string; mime_type?: string };

function setup(opts: {
  document: DocRow | null;
  classifyResult?: { doc_type: string | null; confidence: number };
  classifyThrows?: Error;
  parsePdfThrows?: Error;
  extractionRunResult?: Extraction;
}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const classify = opts.classifyThrows
    ? vi.fn().mockRejectedValue(opts.classifyThrows)
    : vi.fn().mockResolvedValue(opts.classifyResult ?? { doc_type: null, confidence: 0 });
  const run = vi.fn().mockResolvedValue(opts.extractionRunResult ?? ({ id: 'ext-1' } as Extraction));
  const updateDocType = vi.fn();
  const docService = {
    getById: vi.fn().mockReturnValue(opts.document),
    updateDocType,
  };
  return {
    svc: new ClassificationService({
      db,
      llmClient: { classifyDocument: classify, extractWithImages: vi.fn(), extract: vi.fn() } as never,
      extractionService: { run } as never,
      documentService: docService as never,
      config: FAKE_CONFIG,
      readFile: () => Buffer.from('fake-pdf'),
      parsePdf: opts.parsePdfThrows
        ? vi.fn().mockRejectedValue(opts.parsePdfThrows)
        : vi.fn().mockResolvedValue({ text: 'sample text' }),
    }),
    classify,
    run,
    updateDocType,
  };
}

describe('ClassificationService.classifyAndRun', () => {
  it('skips classification when document.doc_type is already set', async () => {
    const { svc, classify, run } = setup({
      document: { id: 'd-1', doc_type: 'fuel_receipt.v1', storage_path: '/tmp/a.pdf' },
      extractionRunResult: { id: 'ext-1' } as Extraction,
    });
    const r = await svc.classifyAndRun('d-1');
    expect(classify).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith({ document_id: 'd-1', stage_id: 'fuel_receipt.v1' });
    expect(r.status).toBe('classified');
    if (r.status === 'classified') expect(r.doc_type).toBe('fuel_receipt.v1');
  });

  it('classifies + writes doc_type + runs extraction on high confidence', async () => {
    const { svc, updateDocType, run } = setup({
      document: { id: 'd-2', doc_type: null, storage_path: '/tmp/b.pdf' },
      classifyResult: { doc_type: 'travel.v1', confidence: 0.91 },
      extractionRunResult: { id: 'ext-2' } as Extraction,
    });
    const r = await svc.classifyAndRun('d-2');
    expect(updateDocType).toHaveBeenCalledWith('d-2', 'travel.v1');
    expect(run).toHaveBeenCalledWith({ document_id: 'd-2', stage_id: 'travel.v1' });
    expect(r.status).toBe('classified');
  });

  it('returns classify_failed when confidence < 0.7', async () => {
    const { svc, updateDocType, run } = setup({
      document: { id: 'd-3', doc_type: null, storage_path: '/tmp/c.pdf' },
      classifyResult: { doc_type: 'purchase.v1', confidence: 0.55 },
    });
    const r = await svc.classifyAndRun('d-3');
    expect(updateDocType).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(r.status).toBe('classify_failed');
  });

  it('returns classify_failed when LLM returns doc_type=null', async () => {
    const { svc, run } = setup({
      document: { id: 'd-4', doc_type: null, storage_path: '/tmp/d.pdf' },
      classifyResult: { doc_type: null, confidence: 0.3 },
    });
    const r = await svc.classifyAndRun('d-4');
    expect(run).not.toHaveBeenCalled();
    expect(r.status).toBe('classify_failed');
  });

  it('returns classify_failed when LLM throws', async () => {
    const { svc, run } = setup({
      document: { id: 'd-5', doc_type: null, storage_path: '/tmp/e.pdf' },
      classifyThrows: new Error('LLM down'),
    });
    const r = await svc.classifyAndRun('d-5');
    expect(run).not.toHaveBeenCalled();
    expect(r.status).toBe('classify_failed');
  });

  it('returns classify_failed when document does not exist', async () => {
    const { svc, run } = setup({ document: null });
    const r = await svc.classifyAndRun('does-not-exist');
    expect(run).not.toHaveBeenCalled();
    expect(r.status).toBe('classify_failed');
  });

  it('returns classify_failed when PDF parsing throws', async () => {
    const { svc, classify } = setup({
      document: { id: 'd-7', doc_type: null, storage_path: '/tmp/g.pdf' },
      parsePdfThrows: new Error('corrupt PDF'),
    });
    const r = await svc.classifyAndRun('d-7');
    expect(classify).not.toHaveBeenCalled();
    expect(r.status).toBe('classify_failed');
  });
});
