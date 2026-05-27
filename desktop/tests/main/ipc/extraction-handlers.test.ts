import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { documentHandlers } from '@main/ipc/handlers/document';
import { extractionHandlers } from '@main/ipc/handlers/extraction';
import { runAiObject } from '@main/llm/run-ai';
import type { ChinaUtilityExtraction } from '@main/llm/stages/china-utility';
import type { CredentialService } from '@main/services/credential-service';
import { ExtractionService } from '@main/services/extraction-service';
import type { ProviderConfigV2 } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/llm/run-ai', () => ({
  runAiObject: vi.fn(),
}));

function fakeCredentials(): CredentialService {
  return {
    get: vi.fn(() => 'sk-fake'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

/**
 * IPC glue test for `extraction:*`. We let DocumentService run for real
 * (so uploads round-trip through the real path) but inject a hand-built
 * ExtractionService with a fake LLMClient + fake settings + stub
 * readFile/parsePdf. That keeps the test entirely off the network and
 * off pdf.js while still exercising the IPC handlers + cache logic.
 */
const FAKE_EXTRACTION: ChinaUtilityExtraction = {
  doc_type: 'china_utility',
  supplier_name: '国家电网',
  account_no: '1234567890',
  amount_kwh: 100,
  amount_yuan: 60.5,
  period_start: '2025-01-01',
  period_end: '2025-01-31',
  confidence: 'high',
};

const FAKE_PROVIDER_CONFIG: ProviderConfigV2 = {
  provider: 'openai',
  model: 'gpt-4o-mini',
};

describe('extraction IPC handlers', () => {
  let db: Database.Database;
  let uploadsDir: string;
  let runAiMock: ReturnType<typeof vi.mocked<typeof runAiObject>>;
  let docHandlers: ReturnType<typeof documentHandlers>;
  let handlers: ReturnType<typeof extractionHandlers>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    uploadsDir = mkdtempSync(join(tmpdir(), 'ext-ipc-test-'));
    const now = () => '2026-05-11T00:00:00.000Z';

    // Bootstrap a base context (this gives us a real DocumentService wired
    // to the same db + uploadsDir).
    const baseCtx = createIpcContext({ db, now }, { uploadsDir });

    // Hand-build ExtractionService with fake collaborators so the test
    // never touches Electron / safeStorage / pdfjs / OpenAI. The LLM
    // round-trip is mocked at `runAiObject` (the AiClient boundary
    // helper) so the service constructor only needs `credentials`.
    vi.mocked(runAiObject).mockReset();
    vi.mocked(runAiObject).mockResolvedValue(FAKE_EXTRACTION);
    runAiMock = vi.mocked(runAiObject);
    const fakeSettings = {
      getProviderConfigWithKey: () => ({ config: FAKE_PROVIDER_CONFIG, apiKey: 'sk-fake' }),
    };

    const extractionService = new ExtractionService({
      db,
      now,
      documentService: baseCtx.documentService,
      // biome-ignore lint/suspicious/noExplicitAny: minimal SettingsService stand-in
      settingsService: fakeSettings as any,
      credentials: fakeCredentials(),
      readFile: () => Buffer.from('FAKE_PDF_BYTES'),
      parsePdf: async () => ({ text: 'FAKE_PDF_TEXT' }),
    });

    const ctxWithExt = createIpcContext(
      { db, now },
      { uploadsDir, documentService: baseCtx.documentService, extractionService },
    );
    docHandlers = documentHandlers(ctxWithExt);
    handlers = extractionHandlers(ctxWithExt);
  });

  afterEach(() => {
    db.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  function uploadDoc() {
    const doc = docHandlers['document:upload']?.({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
    if (!doc) throw new Error('upload returned undefined');
    return doc;
  }

  it('extraction:run inserts a row with status=review_needed and parsed_json matching the LLM result', async () => {
    const doc = uploadDoc();
    const ext = await handlers['extraction:run']?.({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    expect(ext?.status).toBe('review_needed');
    expect(ext?.document_id).toBe(doc.id);
    expect(ext?.llm_provider).toBe('openai');
    expect(ext?.prompt_version).toBe('china_utility.v1');
    expect(JSON.parse(ext?.parsed_json ?? '')).toEqual(FAKE_EXTRACTION);
    expect(runAiMock).toHaveBeenCalledTimes(1);
  });

  it('extraction:run hits cache on a second call (no second LLM round-trip)', async () => {
    const doc = uploadDoc();
    const first = await handlers['extraction:run']?.({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    const second = await handlers['extraction:run']?.({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    expect(second?.id).toBe(first?.id);
    expect(runAiMock).toHaveBeenCalledTimes(1);
  });

  it('extraction:list-pending shows newly-run extractions and excludes confirmed/discarded', async () => {
    const doc = uploadDoc();
    const ext = await handlers['extraction:run']?.({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    expect(handlers['extraction:list-pending']?.().map((p) => p.id)).toEqual([ext?.id]);

    handlers['extraction:confirm']?.({ id: ext?.id ?? '' });
    expect(handlers['extraction:list-pending']?.()).toEqual([]);
  });

  it('extraction:list-by-document filters to one document', async () => {
    const doc = uploadDoc();
    const ext = await handlers['extraction:run']?.({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    const list = handlers['extraction:list-by-document']?.({ document_id: doc.id });
    expect(list?.map((e) => e.id)).toEqual([ext?.id]);
    // Wrong document id → empty list.
    expect(handlers['extraction:list-by-document']?.({ document_id: 'nope' })).toEqual([]);
  });

  it('extraction:get-by-id round-trips; extraction:discard clears parsed_json + sets rejected', async () => {
    const doc = uploadDoc();
    const ext = await handlers['extraction:run']?.({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });
    expect(handlers['extraction:get-by-id']?.({ id: ext?.id ?? '' })?.id).toBe(ext?.id);

    handlers['extraction:discard']?.({ id: ext?.id ?? '' });
    const after = handlers['extraction:get-by-id']?.({ id: ext?.id ?? '' });
    expect(after?.status).toBe('rejected');
    expect(after?.parsed_json).toBeNull();
  });
});
