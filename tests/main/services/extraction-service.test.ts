import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import type { LLMClient } from '@main/llm/llm-client';
import type { ChinaUtilityExtraction } from '@main/llm/stages/china-utility';
import { DocumentService } from '@main/services/document-service';
import { ExtractionService } from '@main/services/extraction-service';
import type { SettingsService } from '@main/services/settings-service';
import type { Document, ProviderConfig } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Canonical extraction object the fake LLMClient returns. Matches the
 * `chinaUtilityExtraction` schema so any downstream consumer that re-validates
 * it would also pass.
 */
const FAKE_EXTRACTION: ChinaUtilityExtraction = {
  doc_type: 'china_utility',
  supplier_name: '国家电网上海市浦东供电公司',
  account_no: '1234567890',
  amount_kwh: 412.5,
  amount_yuan: 235.8,
  period_start: '2025-01-01',
  period_end: '2025-01-31',
  confidence: 'high',
};

const FAKE_PROVIDER_CONFIG: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey',
};

/**
 * Test harness: real DocumentService + sqlite, fake settings/LLM/PDF parser.
 * The fake LLM client returns FAKE_EXTRACTION unconditionally so any caching
 * regression jumps out as a `toHaveBeenCalledTimes(>1)` failure.
 */
function setupHarness(opts: { providerConfigured?: boolean } = {}) {
  const providerConfigured = opts.providerConfigured ?? true;

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const uploadsDir = mkdtempSync(join(tmpdir(), 'ext-test-'));
  const now = () => '2026-05-11T00:00:00.000Z';

  const documentService = new DocumentService({ db, now, uploadsDir });

  const settingsService = {
    getProviderConfigWithKey: vi.fn(() =>
      providerConfigured ? { config: FAKE_PROVIDER_CONFIG, apiKey: 'sk-fake' } : null,
    ),
  } as unknown as SettingsService;

  const llmClient = {
    extract: vi.fn(async () => FAKE_EXTRACTION),
  } as unknown as LLMClient;

  // DI'd I/O: bypass real fs + pdf-parse entirely. The harness only needs
  // a deterministic "this is the PDF text" string to feed buildPrompt with.
  const readFile = vi.fn(() => Buffer.from('fake-pdf-bytes'));
  const parsePdf = vi.fn(async () => ({ text: 'FAKE_PDF_TEXT_TOKEN' }));

  const extractionService = new ExtractionService({
    db,
    now,
    documentService,
    settingsService,
    llmClient,
    readFile,
    parsePdf,
  });

  return {
    db,
    uploadsDir,
    documentService,
    settingsService,
    llmClient,
    readFile,
    parsePdf,
    extractionService,
    cleanup() {
      db.close();
      rmSync(uploadsDir, { recursive: true, force: true });
    },
  };
}

function uploadFakePdf(documentService: DocumentService): Document {
  return documentService.uploadFile({
    filename: 'bill.pdf',
    mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.4 bill content'),
  });
}

describe('ExtractionService', () => {
  let h: ReturnType<typeof setupHarness>;

  beforeEach(() => {
    h = setupHarness();
  });
  afterEach(() => {
    h.cleanup();
  });

  it('run inserts an extraction row with status=review_needed and parsed_json matching the LLM result', async () => {
    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.document_id).toBe(doc.id);
    expect(ext.llm_provider).toBe('openai');
    expect(ext.llm_model).toBe('gpt-4o-mini');
    expect(ext.prompt_version).toBe('china_utility.v1');
    expect(ext.created_at).toBe('2026-05-11T00:00:00.000Z');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(FAKE_EXTRACTION);

    // Sanity: LLM was actually called and prompt included the PDF text.
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    const [, , prompt] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(prompt).toContain('FAKE_PDF_TEXT_TOKEN');
  });

  it('run is cached by (doc, stage, provider, model) — second call returns the same row and skips the LLM', async () => {
    const doc = uploadFakePdf(h.documentService);

    const first = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    const second = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    expect(second.id).toBe(first.id);
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    expect(h.parsePdf).toHaveBeenCalledTimes(1);

    const count = h.db.prepare('SELECT COUNT(*) AS c FROM extraction').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('run throws when the AI provider is not configured', async () => {
    h.cleanup();
    h = setupHarness({ providerConfigured: false });
    const doc = uploadFakePdf(h.documentService);

    await expect(
      h.extractionService.run({ document_id: doc.id, stage_id: 'china_utility.v1' }),
    ).rejects.toThrow(/AI provider not configured/);
    expect(h.llmClient.extract).not.toHaveBeenCalled();
  });

  it('run throws when the document is not found', async () => {
    await expect(
      h.extractionService.run({
        document_id: '01J0000000000000000000NOPE',
        stage_id: 'china_utility.v1',
      }),
    ).rejects.toThrow(/Document not found/);
    expect(h.llmClient.extract).not.toHaveBeenCalled();
  });

  it('run throws when the stage id is unknown', async () => {
    const doc = uploadFakePdf(h.documentService);
    await expect(
      h.extractionService.run({ document_id: doc.id, stage_id: 'unknown.v1' }),
    ).rejects.toThrow(/Stage not found/);
    expect(h.llmClient.extract).not.toHaveBeenCalled();
  });

  it('confirm transitions status review_needed → parsed and stamps reviewed_by_user_at', async () => {
    const doc = uploadFakePdf(h.documentService);
    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    h.extractionService.confirm(ext.id);

    const after = h.extractionService.getById(ext.id);
    expect(after?.status).toBe('parsed');
    expect(after?.reviewed_by_user_at).toBe('2026-05-11T00:00:00.000Z');
    // parsed_json should still be present — required by the schema CHECK
    // for status=parsed.
    expect(after?.parsed_json).not.toBeNull();
  });

  it('confirm throws when the extraction is missing or not in review_needed', () => {
    expect(() => h.extractionService.confirm('does-not-exist')).toThrow(/not confirmable/);
  });

  it('discard transitions status review_needed → rejected and clears parsed_json', async () => {
    const doc = uploadFakePdf(h.documentService);
    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    h.extractionService.discard(ext.id);

    const after = h.extractionService.getById(ext.id);
    expect(after?.status).toBe('rejected');
    expect(after?.parsed_json).toBeNull();
    // raw_response stays for forensics — the CHECK accepts rejected rows
    // with raw_response non-null OR error_json non-null.
    expect(after?.raw_response).not.toBeNull();
    expect(after?.reviewed_by_user_at).toBe('2026-05-11T00:00:00.000Z');
  });

  it('listPendingReview filters by status and respects limit', async () => {
    const doc = uploadFakePdf(h.documentService);
    const a = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    // Second doc → second extraction so we have two pending rows.
    const doc2 = h.documentService.uploadFile({
      filename: 'bill2.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 doc 2'),
    });
    const b = await h.extractionService.run({
      document_id: doc2.id,
      stage_id: 'china_utility.v1',
    });

    // Confirm one → it should drop off the pending list.
    h.extractionService.confirm(a.id);

    const pending = h.extractionService.listPendingReview();
    expect(pending.map((p) => p.id)).toEqual([b.id]);

    expect(h.extractionService.listPendingReview(0).length).toBe(0);
  });

  it('listByDocument returns only rows for the given document_id', async () => {
    const docA = uploadFakePdf(h.documentService);
    const docB = h.documentService.uploadFile({
      filename: 'other.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 doc B'),
    });

    const a = await h.extractionService.run({
      document_id: docA.id,
      stage_id: 'china_utility.v1',
    });
    const b = await h.extractionService.run({
      document_id: docB.id,
      stage_id: 'china_utility.v1',
    });

    const aList = h.extractionService.listByDocument(docA.id);
    const bList = h.extractionService.listByDocument(docB.id);
    expect(aList.map((x) => x.id)).toEqual([a.id]);
    expect(bList.map((x) => x.id)).toEqual([b.id]);
  });

  it('getById returns null for a missing id', () => {
    expect(h.extractionService.getById('01J0000000000000000000ZZZ')).toBeNull();
  });
});
