import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, type SafeStorageLike } from '@main/credentials/safe-storage';
import { closeAppDb, openAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';
import { runAiObject } from '@main/llm/run-ai';
import type { ChinaUtilityExtraction } from '@main/llm/stages/china-utility';
import { CredentialService } from '@main/services/credential-service';
import { DocumentService } from '@main/services/document-service';
import { ExtractionService } from '@main/services/extraction-service';
import { SettingsService } from '@main/services/settings-service';
import type { ProviderConfig } from '@shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/llm/run-ai', () => ({
  runAiObject: vi.fn(),
}));

/**
 * Phase 1b Task 17 — integration smoke for the full main-side extraction pipeline.
 *
 * Wires real DocumentService + SettingsService + CredentialService +
 * ExtractionService against an in-memory sqlite db with all migrations applied
 * and a tmpdir upload root. The only mocks are the LLMClient (no real network
 * calls) and the pdf-parse step (injected via ExtractionService's DI parameter,
 * sidestepping pdf-parse's eager fixture loading). The credential layer uses
 * a fake safeStorage that "encrypts" by prefixing `enc:` — enough to verify
 * the encrypted-blob round-trip path without depending on the OS keychain.
 *
 * Scenarios:
 *   1. Upload PDF → extraction.run creates a `review_needed` row whose
 *      `parsed_json` matches the mocked LLM result.
 *   2. Re-run the same (document, stage, provider, model) → cache hit; the
 *      LLM mock is still called exactly once, pdf-parse still parsed once.
 *   3. extraction.confirm transitions the row to `parsed` and stamps
 *      `reviewed_by_user_at`.
 */

const FAKE_EXTRACTION: ChinaUtilityExtraction = {
  doc_type: 'china_utility',
  supplier_name: '国家电网上海市浦东供电公司',
  account_no: '1234567890',
  amount_kwh: 1234.5,
  amount_yuan: 567.89,
  period_start: '2025-09-01',
  period_end: '2025-09-30',
  confidence: 'high',
};

const PROVIDER_CONFIG: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey',
};

/**
 * Fake `safeStorage` that reversibly "encrypts" via an `enc:` prefix. Good
 * enough to exercise the CredentialStore round-trip; never touches Electron.
 */
function makeFakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf-8').replace(/^enc:/, ''),
  };
}

function setupHarness() {
  // The connection module is a process-wide singleton — close any previous
  // handle (e.g. from a prior test file) before opening the in-memory db.
  closeAppDb();
  const db = openAppDb(':memory:');
  runMigrations(db);

  const uploadsDir = mkdtempSync(join(tmpdir(), 'extraction-pipeline-test-'));

  // In-memory blob backing store: stand-in for `<userData>/credentials/*.bin`.
  // Driving the real CredentialStore + CredentialService keeps the
  // SettingsService → CredentialService → CredentialStore wiring honest.
  const blobs = new Map<string, Buffer>();
  const credentialStore = new CredentialStore({
    safeStorage: makeFakeSafeStorage(),
    readBlob: (key) => blobs.get(key) ?? null,
    writeBlob: (key, blob) => {
      blobs.set(key, blob);
    },
    platform: 'darwin',
  });
  const credentialService = new CredentialService({
    store: credentialStore,
    deleteBlob: (key: string) => {
      blobs.delete(key);
    },
    isAvailable: () => true,
  });

  const now = () => '2026-05-12T12:00:00.000Z';

  const documentService = new DocumentService({ db, now, uploadsDir });
  const settingsService = new SettingsService({ db, now, credentials: credentialService });

  // Pre-populate setting + credential as if the user had completed the
  // Settings drawer flow. Going through saveProviderConfig (rather than a
  // direct INSERT) ensures the credential blob is written to the same
  // backing store that getProviderConfigWithKey() will read from.
  settingsService.saveProviderConfig(PROVIDER_CONFIG, 'sk-test-integration-9999');

  // The AiClient round-trip is mocked at the runAiObject Promise
  // boundary helper. ExtractionService gets a real CredentialService
  // (production-shaped) so we still exercise the keychain round-trip
  // even though the LLM never executes.
  vi.mocked(runAiObject).mockReset();
  vi.mocked(runAiObject).mockResolvedValue(FAKE_EXTRACTION);

  // DI'd parsePdf so the pipeline never loads pdf-parse (which eagerly reads
  // bundled fixture PDFs on import). We don't override `readFile` here —
  // DocumentService just wrote a real file we want ExtractionService to read.
  const parsePdf = vi.fn(async () => ({
    text: '国家电网上海市浦东供电公司 电费单 用电量: 1234.5 kWh 应收合计: 567.89 元',
  }));

  const extractionService = new ExtractionService({
    db,
    now,
    documentService,
    settingsService,
    credentials: credentialService,
    parsePdf,
  });

  return {
    db,
    uploadsDir,
    blobs,
    credentialService,
    documentService,
    settingsService,
    runAi: vi.mocked(runAiObject),
    parsePdf,
    extractionService,
  };
}

describe('extraction pipeline integration', () => {
  let h: ReturnType<typeof setupHarness>;

  beforeEach(() => {
    h = setupHarness();
  });

  afterEach(() => {
    closeAppDb();
    rmSync(h.uploadsDir, { recursive: true, force: true });
  });

  it('runs the upload → extract → confirm flow end-to-end with caching', async () => {
    // 1. Upload a (small) fake PDF. The %PDF-1.4 header is realistic enough
    //    for DocumentService's mime check (it just trusts the caller's
    //    `mimeType` arg), and the bytes get sha256'd + persisted under
    //    <uploadsDir>/<sha[0:2]>/<sha>.pdf.
    const document = h.documentService.uploadFile({
      filename: 'shanghai-utility-2025-09.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4\nfake utility bill content for integration test'),
    });
    expect(document.id).toBeTruthy();
    expect(document.mime_type).toBe('application/pdf');

    // Sanity: settings round-trip — getProviderConfigWithKey resolves the
    // stored config + the plaintext key the test set via saveProviderConfig.
    const resolved = h.settingsService.getProviderConfigWithKey();
    expect(resolved).toEqual({
      config: PROVIDER_CONFIG,
      apiKey: 'sk-test-integration-9999',
    });

    // 2. First extraction run — LLM mock invoked once, row inserted as
    //    `review_needed`, parsed_json matches FAKE_EXTRACTION verbatim.
    const first = await h.extractionService.run({
      document_id: document.id,
      stage_id: 'china_utility.v1',
    });

    expect(first.status).toBe('review_needed');
    expect(first.document_id).toBe(document.id);
    expect(first.llm_provider).toBe('openai');
    expect(first.llm_model).toBe('gpt-4o-mini');
    expect(first.prompt_version).toBe('china_utility.v1');
    expect(JSON.parse(first.parsed_json ?? '')).toEqual(FAKE_EXTRACTION);
    expect(h.runAi).toHaveBeenCalledTimes(1);
    expect(h.parsePdf).toHaveBeenCalledTimes(1);

    // 3. Re-run with the same (doc, stage, provider, model) tuple → cache
    //    hit: same row id back, no extra LLM call, no extra pdf parse, the
    //    extraction table still has exactly one row.
    const second = await h.extractionService.run({
      document_id: document.id,
      stage_id: 'china_utility.v1',
    });
    expect(second.id).toBe(first.id);
    expect(h.runAi).toHaveBeenCalledTimes(1);
    expect(h.parsePdf).toHaveBeenCalledTimes(1);
    const rowCount = h.db.prepare('SELECT COUNT(*) AS c FROM extraction').get() as { c: number };
    expect(rowCount.c).toBe(1);

    // 4. Confirm → status flips to `parsed`, reviewed_by_user_at is stamped.
    h.extractionService.confirm(first.id);
    const confirmed = h.extractionService.getById(first.id);
    expect(confirmed?.status).toBe('parsed');
    expect(confirmed?.reviewed_by_user_at).toBe('2026-05-12T12:00:00.000Z');
    expect(confirmed?.parsed_json).not.toBeNull();
  });
});
