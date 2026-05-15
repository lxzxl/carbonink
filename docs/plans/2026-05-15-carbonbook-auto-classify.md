# Auto-Classify Doc Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the explicit stage dropdown on the upload page with lazy LLM-driven classification on review-page open. `doc_type` becomes a column on `document`. Upload no longer requires a configured LLM provider.

**Architecture:** Migration 012 adds `document.doc_type`. New `LLMClient.classifyDocument()` returns `{doc_type, confidence}`. New `ClassificationService.classifyAndRun(documentId)` either skips classification (already-classified doc) or calls the LLM + writes doc_type back + routes to the correct stage's extraction. New IPC `extraction:classify-and-run` triggered by the review page when no extraction exists. Manual `ManualStagePicker` component handles low-confidence cases AND a "switch stage and re-extract" override flow.

**Tech Stack:** SQLite (migration), AI SDK 6 + zod (LLM call), TanStack Query (renderer pipeline), paraglide i18n.

**Reference spec:** `docs/specs/2026-05-15-auto-classify-doc-type-design.md`

**Baseline:** `commit 0534c59` on `main`. 419 vitest tests passing. `phase-1d` tag points at `28c778e`.

**Discipline notes:**

- Confidence threshold for "classified vs unknown": **0.7**. Below this, `doc_type` stays NULL and the renderer prompts for manual pick.
- Stage IDs are the 5 currently-registered values: `china_utility.v1`, `fuel_receipt.v1`, `freight.v1`, `purchase.v1`, `travel.v1`. The zod enum in the classification schema must list these + `'unknown'`.
- Existing extractions are NOT touched. Migration 012 only adds a column to `document`; existing rows get `doc_type = NULL`.
- After every task: typecheck clean, `pnpm vitest run --pool=threads` green.
- Verify `git branch --show-current` returns `main` after each commit.
- Pre-existing hazard: `NODE_MODULE_VERSION 145` recovery:
  ```
  rm /Users/lxz/ws/personal/carbonbook/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && (cd /Users/lxz/ws/personal/carbonbook && pnpm rebuild better-sqlite3)
  ```

---

## Task 1: Migration 012 — `document.doc_type`

**Files:**
- Create: `src/main/db/migrations/012_document_doc_type.sql`
- Create: `tests/main/db/migrations/012_document_doc_type.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/db/migrations/012_document_doc_type.test.ts`:

```ts
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function setupDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('migration 012 — document.doc_type', () => {
  it('adds doc_type column (nullable, defaults to NULL)', () => {
    const db = setupDb();
    const cols = db.prepare(`PRAGMA table_info(document)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const docTypeCol = cols.find((c) => c.name === 'doc_type');
    expect(docTypeCol).toBeDefined();
    expect(docTypeCol?.type).toBe('TEXT');
    expect(docTypeCol?.notnull).toBe(0);
  });

  it('existing document rows have doc_type = NULL', () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
      VALUES ('doc-1', 'aa', 'a.pdf', 'application/pdf', 100, '/tmp/a.pdf', '2026-05-15T00:00:00Z')
    `).run();
    const row = db.prepare(`SELECT doc_type FROM document WHERE id = ?`).get('doc-1') as { doc_type: string | null };
    expect(row.doc_type).toBeNull();
  });

  it('creates partial index idx_document_doc_type on non-null doc_type', () => {
    const db = setupDb();
    const idx = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_document_doc_type'`).get() as { name: string; sql: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx?.sql).toContain('doc_type');
  });

  it('accepts a stage_id string in doc_type', () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, doc_type)
      VALUES ('doc-2', 'bb', 'b.pdf', 'application/pdf', 100, '/tmp/b.pdf', '2026-05-15T00:00:00Z', 'china_utility.v1')
    `).run();
    const row = db.prepare(`SELECT doc_type FROM document WHERE id = ?`).get('doc-2') as { doc_type: string };
    expect(row.doc_type).toBe('china_utility.v1');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migrations/012_document_doc_type.test.ts --pool=threads
```
Expected: FAIL ("no such column: doc_type" or migration 012 not found).

- [ ] **Step 3: Create the migration**

`src/main/db/migrations/012_document_doc_type.sql`:

```sql
-- Migration 012: doc_type as a property of document.
-- Set by the lazy classify-and-run pipeline on first review-page open.
-- NULL means "not yet classified" OR "LLM was unsure" (confidence < 0.7).
-- The renderer treats NULL identically in both cases: show "未分类" chip,
-- offer manual stage pick on review.

ALTER TABLE document ADD COLUMN doc_type TEXT;

-- Partial index for future filtering by stage in the documents list.
-- (No queries use this yet — Phase 2 may.)
CREATE INDEX idx_document_doc_type ON document(doc_type) WHERE doc_type IS NOT NULL;
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migrations/012_document_doc_type.test.ts --pool=threads
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Full suite + typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 423 tests passing (419 + 4 new).

- [ ] **Step 6: Update shared Document type**

In `src/shared/types.ts`, find the `Document` type (or its zod schema). Add `doc_type: string | null` to the type.

If `Document` is defined via zod, the schema needs:
```ts
doc_type: z.string().nullable(),
```

Then update any other place where Document rows are constructed (look for places that build a Document from a DB row — `documentService.ts`). The SELECT statements need to read the new column too.

- [ ] **Step 7: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/db/migrations/012_document_doc_type.sql tests/main/db/migrations/012_document_doc_type.test.ts src/shared/types.ts src/main/services/document-service.ts
git status
git commit -m "feat(db): migration 012 — document.doc_type column"
git branch --show-current
```

---

## Task 2: LLMClient.classifyDocument

**Files:**
- Modify: `src/main/llm/llm-client.ts` — add `classifyDocument()`
- Create: `tests/main/llm/llm-client-classify.test.ts`

- [ ] **Step 1: Inspect existing LLM methods**

Read `src/main/llm/llm-client.ts`. Verify:
- `LLMClient.extract()` is async, takes `(config, schema, prompt)`.
- `LLMClient.extractWithImages()` exists for vision-mode calls.
- `LLMClient.recommendEfs()` exists (EF Matcher v1 pattern) — use this as the closest reference.
- The `z` from 'zod' is already imported.

- [ ] **Step 2: Write the failing test**

Create `tests/main/llm/llm-client-classify.test.ts`:

```ts
import { LLMClient } from '@main/llm/llm-client';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const fakeConfig: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey',
};

describe('LLMClient.classifyDocument', () => {
  it('text-only path: returns the doc_type when LLM responds with a known stage', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      doc_type: 'fuel_receipt.v1',
      confidence: 0.92,
    } as unknown as never);

    const result = await client.classifyDocument(fakeConfig, '中国石化加油 0号柴油 45.6升 357.96元', []);

    expect(result.doc_type).toBe('fuel_receipt.v1');
    expect(result.confidence).toBe(0.92);
    expect(stub).toHaveBeenCalledTimes(1);
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    expect(prompt).toContain('中国石化');
  });

  it("returns doc_type=null when LLM responds with 'unknown'", async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    vi.spyOn(client, 'extract').mockResolvedValue({
      doc_type: 'unknown',
      confidence: 0.55,
    } as unknown as never);

    const result = await client.classifyDocument(fakeConfig, 'random text', []);
    expect(result.doc_type).toBeNull();
    expect(result.confidence).toBe(0.55);
  });

  it('vision fallback: when parsedText is empty AND images is non-empty, uses extractWithImages', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const textStub = vi.spyOn(client, 'extract');
    const visionStub = vi.spyOn(client, 'extractWithImages').mockResolvedValue({
      doc_type: 'travel.v1',
      confidence: 0.85,
    } as unknown as never);

    const result = await client.classifyDocument(fakeConfig, '', [Buffer.from('fake-png')]);

    expect(textStub).not.toHaveBeenCalled();
    expect(visionStub).toHaveBeenCalledTimes(1);
    expect(result.doc_type).toBe('travel.v1');
  });

  it('returns doc_type=null when neither text nor images are provided', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const result = await client.classifyDocument(fakeConfig, '', []);
    expect(result.doc_type).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client-classify.test.ts --pool=threads
```
Expected: FAIL ("classifyDocument is not a function").

- [ ] **Step 4: Implement**

Add to `LLMClient` class in `src/main/llm/llm-client.ts`, near `recommendEfs`:

```ts
  /**
   * Classify a document into one of the 5 supported stage types.
   *
   * Text-first: if `parsedText` is non-empty, uses cheap text-only mode.
   * Otherwise falls back to vision (if images are provided).
   *
   * Returns `doc_type: null` for the explicit 'unknown' enum value OR when
   * the input is empty (no text and no images). Caller applies its own
   * confidence threshold on top.
   */
  async classifyDocument(
    config: ProviderConfig,
    parsedText: string | null,
    images: Buffer[] = [],
  ): Promise<{ doc_type: string | null; confidence: number }> {
    const schema = z.object({
      doc_type: z.enum([
        'china_utility.v1',
        'fuel_receipt.v1',
        'freight.v1',
        'purchase.v1',
        'travel.v1',
        'unknown',
      ]),
      confidence: z.number().min(0).max(1),
    });

    const text = (parsedText ?? '').trim();
    if (!text && images.length === 0) {
      return { doc_type: null, confidence: 0 };
    }

    const prompt = `你是一名碳核算助理。请判断下面这份单据属于以下哪一类。如果不能确定（80% 以下），请返回 "unknown"。

类型清单：
- china_utility.v1: 中国电费缴费通知单 / 电网账单 (供电公司、户号、用电量 kWh、计费周期、应缴电费)
- fuel_receipt.v1: 加油发票 / 燃油票 (加油站、油品类型、升数、单价、车牌号)
- freight.v1: 货物运输发票 / 物流单 (承运方、运输方式、起运地、到达地、货物重量、运费)
- purchase.v1: 采购发票 / 增值税发票 (销售方、商品名称、数量、金额)
- travel.v1: 差旅票据 / 机票 / 高铁票 / 出租车票 (承运方、旅客、出发地、目的地、舱位)

<document>
${text || '(no parsed text — see attached images)'}
</document>

返回 JSON: { doc_type: <类型 ID 或 "unknown">, confidence: <0..1 的浮点数> }`;

    let result: { doc_type: string; confidence: number };
    if (text) {
      result = await this.extract(config, schema, prompt);
    } else {
      // Vision path — pass the images via extractWithImages.
      // Build a minimal VisionMessages structure that matches the existing
      // helper's expectations: a single text part with our prompt.
      const vision = { text: prompt };
      result = await this.extractWithImages(config, schema, vision as never, images);
    }

    return {
      doc_type: result.doc_type === 'unknown' ? null : result.doc_type,
      confidence: result.confidence,
    };
  }
```

Verify the `extractWithImages` signature matches what we're passing. If `VisionMessages` requires a richer structure (system + user parts), adapt accordingly — look at how `recommendEfs` or one of the stage's `buildVisionMessages` constructs it.

- [ ] **Step 5: Run test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client-classify.test.ts --pool=threads
```
Expected: PASS, 4 tests.

- [ ] **Step 6: typecheck + full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/llm/llm-client.ts tests/main/llm/llm-client-classify.test.ts
git commit -m "feat(llm): LLMClient.classifyDocument — 5-stage classifier with vision fallback"
git branch --show-current
```
Expected: 427 tests passing (423 + 4).

---

## Task 3: ClassificationService

**Files:**
- Create: `src/main/services/classification-service.ts`
- Create: `tests/main/services/classification-service.test.ts`
- Modify: `src/shared/types.ts` — add `ClassifyAndRunResult` type

- [ ] **Step 1: Add the result type**

In `src/shared/types.ts`:

```ts
export type ClassifyAndRunResult =
  | { status: 'classified'; extraction: Extraction; doc_type: string }
  | { status: 'classify_failed' };
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/services/classification-service.test.ts`:

```ts
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

const CONFIDENCE_THRESHOLD = 0.7;

function setup(opts: {
  document: { id: string; doc_type: string | null; storage_path: string; mime_type?: string };
  classifyResult?: { doc_type: string | null; confidence: number };
  classifyThrows?: Error;
  extractionRunResult?: Extraction;
}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const classify = opts.classifyThrows
    ? vi.fn().mockRejectedValue(opts.classifyThrows)
    : vi.fn().mockResolvedValue(opts.classifyResult ?? { doc_type: null, confidence: 0 });
  const run = vi.fn().mockResolvedValue(opts.extractionRunResult ?? { id: 'ext-1' });
  const docService = {
    getById: vi.fn().mockReturnValue(opts.document),
    updateDocType: vi.fn(),
  };
  return {
    svc: new ClassificationService({
      db,
      llmClient: { classifyDocument: classify, extractWithImages: vi.fn(), extract: vi.fn() } as never,
      extractionService: { run } as never,
      documentService: docService as never,
      config: FAKE_CONFIG,
      readFile: () => Buffer.from('fake-pdf'),
      parsePdf: vi.fn().mockResolvedValue({ text: 'sample text' }),
    }),
    classify,
    run,
    docService,
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
    if (r.status === 'classified') {
      expect(r.doc_type).toBe('fuel_receipt.v1');
    }
  });

  it('classifies + writes doc_type + runs extraction on high confidence', async () => {
    const { svc, docService, run } = setup({
      document: { id: 'd-2', doc_type: null, storage_path: '/tmp/b.pdf' },
      classifyResult: { doc_type: 'travel.v1', confidence: 0.91 },
      extractionRunResult: { id: 'ext-2' } as Extraction,
    });
    const r = await svc.classifyAndRun('d-2');
    expect(docService.updateDocType).toHaveBeenCalledWith('d-2', 'travel.v1');
    expect(run).toHaveBeenCalledWith({ document_id: 'd-2', stage_id: 'travel.v1' });
    expect(r.status).toBe('classified');
  });

  it('returns classify_failed when confidence < 0.7', async () => {
    const { svc, docService, run } = setup({
      document: { id: 'd-3', doc_type: null, storage_path: '/tmp/c.pdf' },
      classifyResult: { doc_type: 'purchase.v1', confidence: 0.55 },
    });
    const r = await svc.classifyAndRun('d-3');
    expect(docService.updateDocType).not.toHaveBeenCalled();
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
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/classification-service.test.ts --pool=threads
```
Expected: FAIL ("Cannot find module").

- [ ] **Step 4: Add `updateDocType` to DocumentService**

In `src/main/services/document-service.ts`, add a method:

```ts
updateDocType(documentId: string, docType: string | null): void {
  this.db.prepare(`UPDATE document SET doc_type = ? WHERE id = ?`).run(docType, documentId);
}
```

If there's a tests file for documentService, add a small test verifying this method updates the column.

- [ ] **Step 5: Implement the service**

Create `src/main/services/classification-service.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { LLMClient } from '@main/llm/llm-client';
import type { ClassifyAndRunResult, ProviderConfig } from '@shared/types';
import type { DocumentService } from './document-service';
import type { ExtractionService } from './extraction-service';

const CONFIDENCE_THRESHOLD = 0.7;

export class ClassificationService {
  constructor(
    private readonly deps: {
      db: Database;
      llmClient: LLMClient;
      extractionService: ExtractionService;
      documentService: DocumentService;
      config: ProviderConfig;
      readFile: (path: string) => Buffer;
      parsePdf: (buf: Buffer) => Promise<{ text: string }>;
      pdfToImages?: (buf: Buffer) => Promise<Buffer[]>;
    },
  ) {}

  async classifyAndRun(documentId: string): Promise<ClassifyAndRunResult> {
    const doc = this.deps.documentService.getById(documentId);
    if (!doc) {
      return { status: 'classify_failed' };
    }

    let docType: string | null = doc.doc_type;

    if (!docType) {
      // Need to classify.
      let parsedText = '';
      let images: Buffer[] = [];
      try {
        const buf = this.deps.readFile(doc.storage_path);
        const parsed = await this.deps.parsePdf(buf);
        parsedText = parsed.text ?? '';
        if (!parsedText.trim() && this.deps.pdfToImages) {
          images = await this.deps.pdfToImages(buf);
        }
      } catch (err) {
        console.warn('[classify] failed to read/parse PDF:', err instanceof Error ? err.message : err);
        return { status: 'classify_failed' };
      }

      let result: { doc_type: string | null; confidence: number };
      try {
        result = await this.deps.llmClient.classifyDocument(this.deps.config, parsedText, images);
      } catch (err) {
        console.warn('[classify] LLM call failed:', err instanceof Error ? err.message : err);
        return { status: 'classify_failed' };
      }

      if (!result.doc_type || result.confidence < CONFIDENCE_THRESHOLD) {
        return { status: 'classify_failed' };
      }

      docType = result.doc_type;
      this.deps.documentService.updateDocType(documentId, docType);
    }

    // doc_type is now set (either originally or from classification).
    const extraction = await this.deps.extractionService.run({
      document_id: documentId,
      stage_id: docType,
    });

    return { status: 'classified', extraction, doc_type: docType };
  }
}
```

If `pdfToImages` and `parsePdf` aren't currently exposed as dependencies in the existing services, refer to how `ExtractionService` uses them — we want consistency. The constructor signature may need adjustment based on what's idiomatic in the existing codebase.

- [ ] **Step 6: Run test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/classification-service.test.ts --pool=threads
```
Expected: PASS, 5 tests.

- [ ] **Step 7: typecheck + full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/classification-service.ts tests/main/services/classification-service.test.ts src/main/services/document-service.ts src/shared/types.ts
git commit -m "feat(classify): ClassificationService — lazy classify + auto-route to stage"
git branch --show-current
```
Expected: ~432 tests passing (427 + 5).

---

## Task 4: IPC channel `extraction:classify-and-run`

**Files:**
- Modify: `src/main/ipc/types.ts` — add channel entry
- Modify: `src/main/ipc/handlers/extraction.ts` — add handler
- Modify: `src/main/ipc/context.ts` — wire ClassificationService into ctx
- Modify: `src/main/ipc/setup.ts` — instantiate ClassificationService (use EfMatcherService bootstrap pattern as reference)
- Modify: `src/preload/bridge.ts` — allowlist the new channel
- Modify: `src/renderer/lib/api/extraction.ts` — add `classifyAndRun` method
- Modify: `tests/preload/bridge.test.ts` — add the new channel to the expected allowlist
- Create: `tests/main/ipc/extraction-classify-handlers.test.ts`

- [ ] **Step 1: Write the failing handler test**

Create `tests/main/ipc/extraction-classify-handlers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { extractionHandlers } from '@main/ipc/handlers/extraction';

function makeCtx() {
  return {
    extractionService: { run: vi.fn() },
    classificationService: {
      classifyAndRun: vi.fn().mockResolvedValue({ status: 'classify_failed' }),
    },
    documentService: { getById: vi.fn() },
  } as unknown as never;
}

describe('extraction:classify-and-run handler', () => {
  it('zod-rejects malformed input', async () => {
    const ctx = makeCtx();
    const handlers = extractionHandlers(ctx);
    await expect(handlers['extraction:classify-and-run']!({} as never)).rejects.toThrow();
  });

  it('delegates to classificationService.classifyAndRun on valid input', async () => {
    const ctx = makeCtx();
    const handlers = extractionHandlers(ctx);
    await handlers['extraction:classify-and-run']!({ document_id: 'd-1' });
    expect((ctx as never as { classificationService: { classifyAndRun: ReturnType<typeof vi.fn> } }).classificationService.classifyAndRun).toHaveBeenCalledWith('d-1');
  });
});
```

If `extractionHandlers` doesn't currently exist with that exact name, find the actual function in `src/main/ipc/handlers/extraction.ts` and adjust the import.

- [ ] **Step 2: Update IpcTypeMap**

In `src/main/ipc/types.ts`:

```ts
'extraction:classify-and-run': (input: { document_id: string }) => Promise<ClassifyAndRunResult>;
```

Import `ClassifyAndRunResult` from `@shared/types`.

- [ ] **Step 3: Add handler**

In `src/main/ipc/handlers/extraction.ts`, the handler map factory. Add:

```ts
'extraction:classify-and-run': async (input) => {
  const parsed = z.object({ document_id: z.string().min(1) }).parse(input);
  return ctx.classificationService.classifyAndRun(parsed.document_id);
},
```

- [ ] **Step 4: Add ClassificationService to IpcContext**

In `src/main/ipc/context.ts`:

```ts
classificationService: ClassificationService;
```

And in the `createIpcContext` function (or wherever services are instantiated for the context), add lazy instantiation following the same pattern as `efMatcherService`. The constructor needs all 6 deps; pull them from existing services + `readFile` from `node:fs`'s `readFileSync` + `parsePdf` from wherever extraction-service gets it.

- [ ] **Step 5: Whitelist preload**

In `src/preload/bridge.ts`, add `'extraction:classify-and-run'` to `allowedChannels`. Update `tests/preload/bridge.test.ts` to include it in whatever ordered allowlist assertion exists.

- [ ] **Step 6: Renderer API client**

In `src/renderer/lib/api/extraction.ts`, add:

```ts
classifyAndRun: (input: { document_id: string }) => invoke('extraction:classify-and-run', input),
```

- [ ] **Step 7: typecheck + tests**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/ipc/extraction-classify-handlers.test.ts --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: typecheck clean. Handler test passes (2 tests). Total ~434 (432 + 2).

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git status
git commit -m "feat(ipc): extraction:classify-and-run channel + renderer extractionApi.classifyAndRun"
git branch --show-current
```

---

## Task 5: DocumentsUpload — remove stage dropdown

**Files:**
- Modify: `src/renderer/components/DocumentsUpload.tsx` — remove the stage `<select>` and supporting state
- Modify: `src/renderer/components/DocumentsUpload.tsx` — remove `stage_id` from the `extraction:run` call (this whole call may go away — see below)

The current upload flow does TWO things on file change: `document:upload` then `extraction:run({document_id, stage_id})`. After this task, upload does ONLY `document:upload`. The classification + extraction is deferred to the review page (Task 7).

- [ ] **Step 1: Read DocumentsUpload.tsx to understand current structure**

The component has a stage `<select>` (id `documents-upload-stage`), a stage list fetched via `stagesApi.list()`, a `useState<string>` for selected stage, and an `onFileChange` handler that calls both `document:upload` and `extraction:run`.

- [ ] **Step 2: Remove the stage controls**

Delete:
- The `useState` line tracking `stageId`.
- The `stagesApi.list()` query (and the `useQuery` hook).
- The `<select id="documents-upload-stage">` JSX block + its `<label>`.
- The `onStageChange` handler.

In `onFileChange`, remove the `extractionApi.run({document_id, stage_id})` call. After `document:upload` succeeds, just refresh the document list query (`queryClient.invalidateQueries({queryKey: ['document:list']})`) and let the user navigate to the review page on their own.

The hint text changes: instead of "选择 stage 后拖入 PDF", just "拖入 PDF（或点击上传）".

- [ ] **Step 3: Run renderer tests**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
```

Some renderer tests may break because they exercise the old upload flow with stage selection. Update those tests to match the new flow (no stage select, no auto-extract on upload).

Specifically check `tests/renderer/documents.test.tsx` and any DocumentsUpload-specific test file.

- [ ] **Step 4: typecheck + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/renderer/components/DocumentsUpload.tsx tests/renderer/
git commit -m "feat(ui): DocumentsUpload — remove stage dropdown, defer to review-page classify"
git branch --show-current
```

---

## Task 6: Document list — doc_type chip

**Files:**
- Modify: `src/renderer/routes/documents.tsx` — show doc_type chip per row
- Create: `src/renderer/lib/stage-labels.ts` — helper mapping stage_id → user-facing label

- [ ] **Step 1: Stage label helper**

Create `src/renderer/lib/stage-labels.ts`:

```ts
import * as m from '@renderer/paraglide/messages';

const LABEL_MAP: Record<string, () => string> = {
  'china_utility.v1': () => '电费账单',
  'fuel_receipt.v1': () => '加油发票',
  'freight.v1': () => '货运发票',
  'purchase.v1': () => '采购发票',
  'travel.v1': () => '差旅票据',
};

export function stageLabel(stageId: string | null): string {
  if (!stageId) return m.documents_status_unclassified();
  const label = LABEL_MAP[stageId];
  return label ? label() : stageId;
}
```

These zh-CN strings can stay inline OR migrate to paraglide. For v1 keep inline (English labels are rarely used in this app); add `documents_status_unclassified` to the paraglide keys in Task 9.

- [ ] **Step 2: Render doc_type chip in document list rows**

In `src/renderer/routes/documents.tsx`, find the table that renders each document row. Add a column (or update an existing chip column) to render:

```tsx
<span className="rounded-full border px-2 py-0.5 text-xs">
  {stageLabel(doc.doc_type)}
</span>
```

If `Document` type doesn't currently include `doc_type` in the renderer, ensure the IPC payload from `document:list` carries it through (it should — Task 1 added it to the shared type).

- [ ] **Step 3: typecheck + tests**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```

Existing documents.test.tsx may need updating to assert the chip text.

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/lib/stage-labels.ts src/renderer/routes/documents.tsx tests/renderer/
git commit -m "feat(ui): document list shows doc_type chip per row"
git branch --show-current
```

---

## Task 7: Review page — lazy classify pipeline + 3 UI states

**Files:**
- Modify: `src/renderer/routes/documents_.$id.tsx` — add classify pipeline trigger + 3 states
- Create: `src/renderer/components/ManualStagePicker.tsx`
- Create: `tests/renderer/documents-review-classify.test.tsx`

- [ ] **Step 1: Inspect current review page**

Read `src/renderer/routes/documents_.$id.tsx`. The current flow: query extraction(s) for the document → render ExtractionReview if found → otherwise show "no extraction" message.

- [ ] **Step 2: Create ManualStagePicker**

`src/renderer/components/ManualStagePicker.tsx`:

```tsx
import { Button } from '@renderer/components/ui/button';
import { extractionApi } from '@renderer/lib/api/extraction';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const STAGES = [
  { id: 'china_utility.v1', label: '电费账单' },
  { id: 'fuel_receipt.v1', label: '加油发票' },
  { id: 'freight.v1', label: '货运发票' },
  { id: 'purchase.v1', label: '采购发票' },
  { id: 'travel.v1', label: '差旅票据' },
];

export function ManualStagePicker({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>('china_utility.v1');

  const mutation = useMutation({
    mutationFn: () =>
      extractionApi.run({ document_id: documentId, stage_id: selected }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extraction:list-by-document', documentId] });
    },
  });

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <p className="text-sm">{m.documents_review_classify_failed()}</p>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded border px-2 py-1 text-sm"
      >
        {STAGES.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? m.documents_review_extracting() : '确认重抽'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Update review page**

In `src/renderer/routes/documents_.$id.tsx`, restructure to:

```tsx
function ReviewRoute() {
  const { id: documentId } = Route.useParams();
  const queryClient = useQueryClient();

  const extQuery = useQuery({
    queryKey: ['extraction:list-by-document', documentId],
    queryFn: () => extractionApi.listByDocument({ document_id: documentId }),
  });

  // Lazy pipeline: if no extraction yet, fire classify-and-run.
  const classifyMutation = useMutation({
    mutationFn: () => extractionApi.classifyAndRun({ document_id: documentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extraction:list-by-document', documentId] });
    },
  });

  useEffect(() => {
    if (
      extQuery.data &&
      extQuery.data.length === 0 &&
      !classifyMutation.isPending &&
      !classifyMutation.data
    ) {
      classifyMutation.mutate();
    }
  }, [extQuery.data]);

  if (extQuery.isLoading) return <p>{m.loading()}</p>;
  if (classifyMutation.isPending) {
    return (
      <div className="rounded-md border bg-muted/30 p-4">
        <p className="text-sm">{m.documents_review_classifying()}</p>
      </div>
    );
  }
  if (classifyMutation.data?.status === 'classify_failed') {
    return <ManualStagePicker documentId={documentId} />;
  }

  // Existing extraction UI from here on (ExtractionReview + switch-stage button)
  // ...
}
```

The order of states matters. After classify succeeds, the extraction query is invalidated, refetches, and falls through to the existing ExtractionReview render path.

- [ ] **Step 4: Renderer tests**

Create `tests/renderer/documents-review-classify.test.tsx`. Mirror existing documents-review.test.tsx pattern but with mocked `extractionApi.classifyAndRun`. Three tests:

1. Classifying state renders "正在分析单据类型..." text.
2. classify_failed renders ManualStagePicker with the 5 options.
3. classified status → invalidates query → ExtractionReview eventually mounts.

- [ ] **Step 5: typecheck + tests**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/routes/documents_.$id.tsx src/renderer/components/ManualStagePicker.tsx tests/renderer/documents-review-classify.test.tsx
git commit -m "feat(ui): review page — lazy classify pipeline with 3 UI states"
git branch --show-current
```

---

## Task 8: Switch-stage override button

**Files:**
- Modify: `src/renderer/components/ExtractionReview.tsx` — add a small "切换类型重抽" button/link

- [ ] **Step 1: Add the override button**

In `ExtractionReview.tsx`, near the existing Confirm/Discard buttons (or in a less prominent spot like the bottom of the field block), add:

```tsx
<button
  type="button"
  onClick={() => setShowStagePicker(true)}
  className="text-xs text-muted-foreground underline"
>
  {m.documents_review_switch_stage()}
</button>
{showStagePicker && (
  <ManualStagePicker documentId={extraction.document_id} />
)}
```

When the user picks a new stage and clicks confirm:
1. The existing extraction is marked as `rejected` via `extractionApi.discard({id: extraction.id})`.
2. `extractionApi.run({document_id, stage_id: chosen})` fires.
3. Query invalidates; new extraction loads.

Update `ManualStagePicker.tsx` to take an optional `currentExtractionId?: string` prop; if set, discard it before running.

- [ ] **Step 2: typecheck + tests**

Add or update a renderer test that clicks "切换类型重抽" → picks a different stage → confirms the discard + run sequence.

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/ExtractionReview.tsx src/renderer/components/ManualStagePicker.tsx tests/renderer/
git commit -m "feat(ui): switch-stage override button on review page"
git branch --show-current
```

---

## Task 9: i18n + sweep

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

- [ ] **Step 1: Add 5 keys to both locales**

`messages/en.json`:
```json
"documents_review_classify_failed": "Could not identify document type. Please pick the stage manually.",
"documents_review_classifying": "Analyzing document type…",
"documents_review_extracting": "Extracting fields…",
"documents_review_switch_stage": "Switch stage and re-extract",
"documents_status_unclassified": "Not classified"
```

`messages/zh-CN.json`:
```json
"documents_review_classify_failed": "无法识别单据类型，请手动选择 stage。",
"documents_review_classifying": "正在分析单据类型…",
"documents_review_extracting": "正在抽取字段…",
"documents_review_switch_stage": "切换类型重抽",
"documents_status_unclassified": "未分类"
```

Both in alphabetical position among existing `documents_*` keys.

- [ ] **Step 2: typecheck (paraglide regenerates bindings)**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```

- [ ] **Step 3: Full suite + lint + format**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -8
pnpm format
pnpm lint --max-diagnostics=80 2>&1 | tail -10
```

Expected: ≥445 tests passing. 0 lint errors.

If format made changes:
```bash
git add -A
git diff --cached --stat
```

- [ ] **Step 4: Commit i18n + sweep**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): 5 keys for auto-classify pipeline UI"

# If format produced any changes:
git status
git add -A
git commit -m "chore: biome format pass for auto-classify"

git log --oneline -12
git branch --show-current
```

---

## Closeout

After this sub-project lands:

- Upload flow works without LLM provider configured.
- Document list shows per-row doc_type chip ("电费账单" / "加油发票" / etc, or "未分类").
- Opening a document with no extraction triggers lazy classify-and-run.
- Low-confidence classification surfaces ManualStagePicker (user picks 1 of 5 stages explicitly).
- Already-extracted documents still surface a "切换类型重抽" override for re-classification.
- ≥445 vitest tests passing. typecheck + lint clean.
- 5 new i18n keys × 2 locales.

**Phase 2 next moves (separate sub-projects):**

- Questionnaire side (CDP supplier questionnaires + auto-mapping + Excel export).
- MCP integration.
- Playwright E2E spec layer (revisit once the renderer ↔ TanStack Router friction is diagnosed).

**Manual smoke after this lands:**
- Upload all 5 fixtures back-to-back WITHOUT selecting any stage.
- Verify each gets the right `doc_type` chip on the document list.
- Open each → review page should auto-classify + auto-extract.
- Confirm flow remains unchanged.
