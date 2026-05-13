import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import type { LLMClient } from '@main/llm/llm-client';
import type { ChinaUtilityExtraction } from '@main/llm/stages/china-utility';
import { registerStage } from '@main/llm/stages/registry';
import type { Stage } from '@main/llm/stages/types';
import { VisionUnsupportedError } from '@main/llm/vision-capability';
import { DocumentService } from '@main/services/document-service';
import {
  ExtractionService,
  StageDoesNotSupportVisionError,
} from '@main/services/extraction-service';
import type { SettingsService } from '@main/services/settings-service';
import type { Document, ProviderConfig } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

  it('after discard, run() bypasses the cache, drops the rejected row, and calls the LLM again', async () => {
    // Regression test for the "retry after discard" UX. Before the fix the
    // cache lookup returned the rejected row, so the button silently did
    // nothing; even if you bypassed the cache, the UNIQUE constraint on
    // (doc, stage, provider, model) would block the INSERT.
    const doc = uploadFakePdf(h.documentService);
    const first = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    h.extractionService.discard(first.id);
    expect(h.extractionService.getById(first.id)?.status).toBe('rejected');

    const retried = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    // Brand-new row, not the discarded one — confirms the cache skipped.
    expect(retried.id).not.toBe(first.id);
    expect(retried.status).toBe('review_needed');
    // LLM hit twice (once for `first`, once for `retried`). PDF parsed
    // twice as well — there's no separate dedupe for PDF text.
    expect(h.llmClient.extract).toHaveBeenCalledTimes(2);
    // The rejected row should be gone: re-extract intentionally drops the
    // soft-deleted row to make room past the UNIQUE constraint, and we
    // don't currently keep a longer audit trail (Phase 1c can revisit).
    expect(h.extractionService.getById(first.id)).toBeNull();
    // Exactly one row left in the table — the fresh one.
    const rows = h.db
      .prepare('SELECT COUNT(*) AS c FROM extraction WHERE document_id = ?')
      .get(doc.id) as { c: number };
    expect(rows.c).toBe(1);
  });

  it('getStatusByDocument summarizes (active_status, has_rejected) per doc', async () => {
    // Three docs, each in a different state, plus a doc with no extraction
    // at all (which the method should OMIT from the result — caller treats
    // missing keys as "no extractions yet").
    const docFresh = uploadFakePdf(h.documentService);
    const docConfirmed = h.documentService.uploadFile({
      filename: 'confirmed.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 doc confirmed'),
    });
    const docDiscarded = h.documentService.uploadFile({
      filename: 'discarded.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 doc discarded'),
    });
    const docNoExtraction = h.documentService.uploadFile({
      filename: 'empty.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 doc empty'),
    });

    const fresh = await h.extractionService.run({
      document_id: docFresh.id,
      stage_id: 'china_utility.v1',
    });
    const confirmed = await h.extractionService.run({
      document_id: docConfirmed.id,
      stage_id: 'china_utility.v1',
    });
    h.extractionService.confirm(confirmed.id);
    const willDiscard = await h.extractionService.run({
      document_id: docDiscarded.id,
      stage_id: 'china_utility.v1',
    });
    h.extractionService.discard(willDiscard.id);

    const statuses = h.extractionService.getStatusByDocument();
    const byDocId = new Map(statuses.map((s) => [s.document_id, s]));

    expect(byDocId.get(docFresh.id)).toEqual({
      document_id: docFresh.id,
      active_status: 'review_needed',
      has_rejected: false,
    });
    expect(byDocId.get(docConfirmed.id)).toEqual({
      document_id: docConfirmed.id,
      active_status: 'parsed',
      has_rejected: false,
    });
    // Only-rejected doc: active is null (no non-rejected rows), has_rejected true.
    expect(byDocId.get(docDiscarded.id)).toEqual({
      document_id: docDiscarded.id,
      active_status: null,
      has_rejected: true,
    });
    // Doc with no extraction rows should be absent from the response.
    expect(byDocId.has(docNoExtraction.id)).toBe(false);

    // Silence "unused variable" — `fresh` is asserted via byDocId above
    // but TS would warn without an explicit reference.
    expect(fresh.status).toBe('review_needed');
  });

  it('getStatusByDocument: a fresh re-run after discard surfaces as active without has_rejected', async () => {
    // After the user retries, the prior rejected row is deleted (see the
    // "run() drops the rejected row" test), so has_rejected flips back to
    // false. The chip should show "Needs review", not "Discarded".
    const doc = uploadFakePdf(h.documentService);
    const first = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    h.extractionService.discard(first.id);
    await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    const statuses = h.extractionService.getStatusByDocument();
    const entry = statuses.find((s) => s.document_id === doc.id);
    expect(entry).toEqual({
      document_id: doc.id,
      active_status: 'review_needed',
      has_rejected: false,
    });
  });

  it('falls back to the vision path when pdf-parse returns empty text', async () => {
    h.cleanup();
    h = setupHarness();

    const parsePdfSpy = vi.fn(async () => ({ text: '   ' }));
    const pdfToImagesSpy = vi.fn(async () => [Buffer.from([0x89, 0x50, 0x4e, 0x47])]);
    const extractWithImagesSpy = vi.fn().mockResolvedValue(FAKE_EXTRACTION);
    const llmClient = {
      extract: vi.fn(),
      extractWithImages: extractWithImagesSpy,
    } as unknown as LLMClient;
    const emitProgressSpy = vi.fn();

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-11T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient,
      readFile: () => Buffer.from('pdf-bytes'),
      parsePdf: parsePdfSpy,
      pdfToImages: pdfToImagesSpy,
      emitProgress: emitProgressSpy,
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(FAKE_EXTRACTION);
    expect(pdfToImagesSpy).toHaveBeenCalledTimes(1);
    expect(extractWithImagesSpy).toHaveBeenCalledTimes(1);
    expect(llmClient.extract).not.toHaveBeenCalled();
    expect(emitProgressSpy).toHaveBeenCalledWith('extraction:progress', {
      document_id: doc.id,
      phase: 'vision',
    });
  });

  it("throws VisionUnsupportedError when vision is needed but the model can't take images", async () => {
    h.cleanup();
    h = setupHarness();

    h.settingsService = {
      getProviderConfigWithKey: vi.fn(() => ({
        config: {
          provider: 'deepseek' as const,
          model: 'deepseek-chat',
          apiKeyKeyref: 'llm.deepseek.apikey' as const,
        },
        apiKey: 'sk-fake',
      })),
    } as unknown as SettingsService;

    const pdfToImagesSpy = vi.fn(async () => [Buffer.from([0x89])]);
    const extractWithImagesSpy = vi.fn();
    const llmClient = {
      extract: vi.fn(),
      extractWithImages: extractWithImagesSpy,
    } as unknown as LLMClient;

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-11T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient,
      readFile: () => Buffer.from('pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: '   ' })),
      pdfToImages: pdfToImagesSpy,
    });

    const doc = uploadFakePdf(h.documentService);

    await expect(
      h.extractionService.run({ document_id: doc.id, stage_id: 'china_utility.v1' }),
    ).rejects.toBeInstanceOf(VisionUnsupportedError);
    expect(pdfToImagesSpy).not.toHaveBeenCalled();
    expect(extractWithImagesSpy).not.toHaveBeenCalled();
    const count = h.db.prepare('SELECT COUNT(*) AS c FROM extraction').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('throws StageDoesNotSupportVisionError when the stage has no buildVisionMessages', async () => {
    h.cleanup();
    h = setupHarness();

    const textOnlyStageId = 'text_only_stage.test.v1';
    const textOnlyStage: Stage<{ ok: boolean }> = {
      id: textOnlyStageId,
      version: '0.0.0',
      description: 'test',
      inputType: 'pdf_text',
      schema: z.object({ ok: z.boolean() }),
      buildPrompt: () => 'noop',
    };
    registerStage(textOnlyStage);

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-11T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: {
        extract: vi.fn(),
        extractWithImages: vi.fn(),
      } as unknown as LLMClient,
      readFile: () => Buffer.from('pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: '   ' })),
      pdfToImages: vi.fn(async () => [Buffer.from([0x89])]),
    });

    const doc = uploadFakePdf(h.documentService);

    await expect(
      h.extractionService.run({ document_id: doc.id, stage_id: textOnlyStageId }),
    ).rejects.toBeInstanceOf(StageDoesNotSupportVisionError);
  });

  it('run() routes fuel_receipt.v1 through the same pipeline (stage lookup + INSERT)', async () => {
    // Mirror the FAKE_EXTRACTION pattern but for fuel_receipt.v1's shape.
    const fuelExtraction = {
      doc_type: 'fuel_receipt' as const,
      supplier_name: '中国石化北京加油站',
      fuel_type: '92#汽油',
      fuel_category: 'gasoline' as const,
      volume_l: 38.5,
      unit_price_yuan: 7.85,
      amount_yuan: 302.23,
      occurred_at: '2026-04-15',
      license_plate: '京A12345',
      confidence: 'high' as const,
    };

    // Override the harness's LLM client to return the fuel-shaped object
    // when the orchestrator calls extract() with the fuel schema. We
    // verify the right stage_id was threaded through to the row.
    h.cleanup();
    h = setupHarness();
    h.llmClient = {
      extract: vi.fn().mockResolvedValue(fuelExtraction),
      extractWithImages: vi.fn(),
    } as unknown as LLMClient;

    // Re-build ExtractionService with the new llmClient (the harness's
    // setupHarness binds it at construction time).
    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-13T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: h.llmClient,
      readFile: () => Buffer.from('fuel-pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: 'FAKE_FUEL_TEXT' })),
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'fuel_receipt.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.prompt_version).toBe('fuel_receipt.v1');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(fuelExtraction);
    // The LLM client got called with the fuel_receipt schema (we passed
    // it through; the orchestrator should pick the right stage).
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    const [, schema] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    // Schema instance check: importing fuelReceiptExtraction at the test
    // top would create a cyclical require pattern in some setups; we
    // sanity-check by parsing the fuel extraction through the schema
    // captured at the call site.
    expect(() =>
      (schema as { parse: (x: unknown) => unknown }).parse(fuelExtraction),
    ).not.toThrow();
  });

  it('run() routes freight.v1 through the same pipeline (stage lookup + INSERT)', async () => {
    // Mirror the fuel_receipt smoke pattern for freight.v1.
    const freightOutput = {
      doc_type: 'freight' as const,
      supplier_name: '顺丰速运',
      mode: 'road' as const,
      vehicle_class: '冷链车',
      weight_kg: 1250,
      volume_m3: 4.5,
      distance_km: null,
      origin: '广州市番禺区',
      destination: '上海市浦东新区',
      tracking_no: 'SF1234567890',
      amount_yuan: 2680,
      occurred_at: '2026-05-08',
      confidence: 'high' as const,
    };

    h.cleanup();
    h = setupHarness();
    h.llmClient = {
      extract: vi.fn().mockResolvedValue(freightOutput),
      extractWithImages: vi.fn(),
    } as unknown as LLMClient;

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-13T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: h.llmClient,
      readFile: () => Buffer.from('freight-pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: 'FAKE_FREIGHT_TEXT' })),
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'freight.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.prompt_version).toBe('freight.v1');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(freightOutput);
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    // Schema captured at the call site can parse the freight output —
    // proves the orchestrator passed freight.v1's schema, not another
    // stage's. Mirrors the technique used for fuel_receipt smoke.
    const [, schema] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect(() => (schema as { parse: (x: unknown) => unknown }).parse(freightOutput)).not.toThrow();
  });

  it('run() routes purchase.v1 through the same pipeline (stage lookup + INSERT)', async () => {
    const purchaseOutput = {
      doc_type: 'purchase' as const,
      supplier_name: '宝山钢铁股份有限公司',
      item_description: '热轧钢板 5mm / 冷轧钢板 3mm',
      category: 'raw_material' as const,
      quantity_kg: 7500,
      amount_yuan: 48650,
      occurred_at: '2026-04-22',
      invoice_no: '12345678',
      confidence: 'medium' as const,
    };

    h.cleanup();
    h = setupHarness();
    h.llmClient = {
      extract: vi.fn().mockResolvedValue(purchaseOutput),
      extractWithImages: vi.fn(),
    } as unknown as LLMClient;

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-13T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: h.llmClient,
      readFile: () => Buffer.from('purchase-pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: 'FAKE_PURCHASE_TEXT' })),
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'purchase.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.prompt_version).toBe('purchase.v1');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(purchaseOutput);
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    // Schema captured at the call site can parse the purchase output —
    // proves the orchestrator passed purchase.v1's schema, not another
    // stage's. Mirrors the technique used for fuel_receipt / freight smokes.
    const [, schema] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect(() => (schema as { parse: (x: unknown) => unknown }).parse(purchaseOutput)).not.toThrow();
  });
});
