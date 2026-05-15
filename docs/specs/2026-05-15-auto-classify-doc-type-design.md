# Auto-Classify Doc Type Design

**Date:** 2026-05-15
**Sub-project:** Phase 2 sub-project 1 — closes the most painful Phase 1 UX gap
**Predecessor:** `phase-1d` tag (`28c778e`)
**Successor:** Phase 2 broader (questionnaire + MCP)

## Goal

Replace the explicit "pick stage before upload" dropdown with **lazy LLM-driven classification on review-page open**. `doc_type` becomes a property of `document` (NULL until classified). Upload never needs an LLM provider. When the user opens a document with no extraction, the renderer triggers a classify-then-extract pipeline; the result is cached on the document row so subsequent opens are instant.

## Non-goals

- Classifying during upload (deferred per user decision — upload must work without LLM provider configured).
- Reclassifying existing extractions (`phase-1d` docs keep their current `prompt_version`; if user wants to re-extract they use the manual "switch stage" button).
- Multi-stage classification (one stage per document; a PDF with mixed invoices is out of scope).
- Confidence-based reranking of extracted fields.
- Showing classification reasoning to the user (we surface confidence/result, not the LLM's free-text explanation).

## Architecture

```
┌─ Upload flow (UNCHANGED for the renderer side) ────────────────────────┐
│  User drags PDF → document:upload IPC → file written to disk           │
│  → document row inserted with doc_type=NULL                            │
│  → renderer's document list refreshes, row shows "未分类" chip         │
└─────────────────────────────────────────────────────────────────────────┘

┌─ Review page mount (NEW pipeline) ─────────────────────────────────────┐
│  User clicks document row → /documents/<id>                            │
│                                                                        │
│  Renderer fires useQuery(['extraction:list-by-document', id])          │
│   ├─ If extraction exists for this doc → render it (current flow)      │
│   └─ If none → fire 'extraction:classify-and-run' IPC                  │
│                                                                        │
│  IPC handler:                                                          │
│    1. Read document.doc_type                                           │
│    2. If null: call LLMClient.classifyDocument(parsed_text, images?)   │
│       → returns { doc_type, confidence }                               │
│       → if confidence < 0.7 → leave doc_type=null, return              │
│         { status: 'classify_failed' }                                  │
│       → else write doc_type to document row                            │
│    3. If doc_type set: route to that stage's extraction (existing      │
│       extraction-service.run logic). Return extraction row.            │
│                                                                        │
│  Renderer states:                                                      │
│    "正在分析单据类型…"  (classify in flight)                            │
│    "正在抽取字段…"      (extract in flight)                            │
│    "无法识别类型 — 请手动选择 stage" (classify_failed; render picker)  │
│    "抽取完成"            (normal review UI mounts)                     │
└─────────────────────────────────────────────────────────────────────────┘

┌─ Manual override (NEW button on review page) ──────────────────────────┐
│  "切换类型重抽" button on the review page when an extraction exists.   │
│  Click → opens stage picker → on confirm:                              │
│    1. Mark existing extraction as 'rejected'                           │
│    2. Update document.doc_type to chosen stage                         │
│    3. Fire extraction:run({document_id, stage_id}) — existing channel  │
│    4. Page re-renders with the new extraction                          │
└─────────────────────────────────────────────────────────────────────────┘
```

The upload flow becomes provider-independent: a user with no LLM key can still upload, archive, view, and delete documents. Classification + extraction are the only operations gated on a configured provider.

## Component design

### Migration 012 — `document.doc_type`

`src/main/db/migrations/012_document_doc_type.sql`:

```sql
-- Migration 012: doc_type as a property of document.
-- Set by the lazy classify-and-run pipeline on first review-page open.
-- NULL means "not yet classified" or "LLM was unsure".

ALTER TABLE document ADD COLUMN doc_type TEXT;

-- Optional index for future filtering by stage in the documents list.
-- (No queries use this yet — Phase 2 may.)
CREATE INDEX idx_document_doc_type ON document(doc_type) WHERE doc_type IS NOT NULL;
```

We do NOT add a `doc_type_confidence` column. The threshold check happens in-process; we only persist the final classification (or null). If a future feature needs confidence history, it goes on a separate `document_classification_log` table — not bolted onto `document`.

### LLMClient.classifyDocument

`src/main/llm/llm-client.ts` — new method:

```ts
async classifyDocument(
  config: ProviderConfig,
  parsedText: string | null,
  images: Buffer[] = [],
): Promise<{
  doc_type: string | null;  // 'china_utility.v1' | 'fuel_receipt.v1' | ... | null
  confidence: number;       // 0..1
}>;
```

The schema-constrained zod output is something like:

```ts
const ClassificationSchema = z.object({
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
```

The system prompt lists the 5 stages with one-line descriptions and tells the model to return `'unknown'` if it's not at least 80% sure. The 0.7 threshold check happens AFTER the call (defensive — even if the model says `'china_utility.v1'` with 0.5 confidence, we override to null).

Text-first: if `parsedText` is non-empty, the call uses text-only mode (cheap, fast). If `parsedText` is empty AND `images.length > 0`, use vision. Matches Phase 1c's OCR fallback pattern.

The 6-value enum (5 stages + 'unknown') normalizes to either a registered stage id or null at the service boundary.

### ClassificationService

`src/main/services/classification-service.ts` — new service:

```ts
export type ClassifyAndRunResult =
  | { status: 'classified'; extraction: Extraction; doc_type: string }
  | { status: 'classify_failed' };  // doc_type stays null; renderer prompts manual pick

export class ClassificationService {
  constructor(deps: {
    db: Database;
    llmClient: LLMClient;
    extractionService: ExtractionService;
    documentService: DocumentService;
    config: ProviderConfig;
  });

  async classifyAndRun(documentId: string): Promise<ClassifyAndRunResult>;
}
```

Steps:

1. `documentService.getById(documentId)` — get document row.
2. If `document.doc_type` is non-null: skip classification, jump to step 5.
3. Read the file (`readFile(storage_path)`), parse PDF text (existing `parsePdf` util), maybe convert to images (existing `pdfToImages`).
4. Call `llmClient.classifyDocument(...)`. If confidence < 0.7 OR `doc_type === null`: return `{ status: 'classify_failed' }`. Otherwise:
   - `UPDATE document SET doc_type = ? WHERE id = ?`
5. Call `extractionService.run({ document_id, stage_id: document.doc_type })`. Return `{ status: 'classified', extraction, doc_type }`.

### IPC: `extraction:classify-and-run`

`src/main/ipc/handlers/extraction.ts` — new channel:

```ts
'extraction:classify-and-run': (input: { document_id: string }) => Promise<ClassifyAndRunResult>;
```

The existing `extraction:run` (with explicit `stage_id`) stays. It's used by the manual override flow.

### Renderer changes

**DocumentsUpload.tsx**:

- Remove the `<select id="documents-upload-stage">` element entirely.
- Remove the `stageId` state. Upload action no longer passes `stage_id`.
- The hint text updates: was "选择 stage 后拖入 PDF" → now just "拖入 PDF (或点击选择)".

**Document list (in `routes/documents.tsx`)**:

- Each row's status chip now shows two states:
  - `doc_type === null` AND no extraction → "未分类"
  - `doc_type === null` AND extraction exists → display existing extraction status (legacy docs from `phase-1d` will fall here)
  - `doc_type === '<stage_id>'` → show stage's user-facing label (e.g. "电费账单" / "差旅票据")
- No new query — `doc_type` comes back as part of the existing `document:list` IPC payload after we add it to the Document type.

**Review page (`routes/documents_.$id.tsx`)**:

Current behavior: query existing extraction → render `ExtractionReview` or "no extraction yet" message.

New behavior:

```tsx
const ext = useQuery(['extraction:list-by-document', documentId]);

// On mount, if no extraction exists, trigger the lazy pipeline.
const classifyMutation = useMutation(extractionApi.classifyAndRun);
useEffect(() => {
  if (ext.data && ext.data.length === 0 && !classifyMutation.isPending && !classifyMutation.isError) {
    classifyMutation.mutate({ document_id: documentId });
  }
}, [ext.data]);

if (classifyMutation.isPending) {
  return <ClassifyPendingState />;  // "正在分析单据类型…"
}
if (classifyMutation.data?.status === 'classify_failed') {
  return <ManualStagePicker documentId={documentId} />;
}
// ... existing flow
```

**ManualStagePicker** is a new component: a select with the 5 stages + a "确认重抽" button → fires `extraction:run({document_id, stage_id})` directly.

**Switch-stage button**: on the existing review page (when an extraction is showing), add a small link or button "切换类型重抽". Click opens the same `ManualStagePicker`, but on confirm it first marks the current extraction as `rejected` (via the existing `extraction:discard` channel?) before kicking off the new one.

### i18n keys

5 new keys × 2 locales:

| Key | English | 简体中文 |
|---|---|---|
| `documents_status_unclassified` | "Not classified" | "未分类" |
| `documents_review_classifying` | "Analyzing document type…" | "正在分析单据类型…" |
| `documents_review_extracting` | "Extracting fields…" | "正在抽取字段…" |
| `documents_review_classify_failed` | "Could not identify document type. Please pick the stage manually." | "无法识别单据类型，请手动选择 stage。" |
| `documents_review_switch_stage` | "Switch stage and re-extract" | "切换类型重抽" |

Plus stage user-facing labels (we have these in the stage definitions already; just reference them).

### Tests

- `tests/main/db/migrations/012_doc_type.test.ts` — migration adds column + index; existing rows have `doc_type = NULL`.
- `tests/main/llm/llm-client-classify.test.ts` — schema validation, prompt content includes stage list, returns null on `'unknown'` enum value.
- `tests/main/services/classification-service.test.ts` —
  - happy path (high confidence → doc_type written, extraction returned)
  - low confidence (returns classify_failed, doc_type stays null)
  - already-classified document (skip classification, just run extraction)
  - LLM throws (treat as classify_failed)
  - unknown enum (return classify_failed)
- `tests/main/ipc/extraction-classify-handlers.test.ts` — zod validation, delegation.
- Renderer tests (in `tests/renderer/`):
  - `documents-upload.test.tsx` (if exists; otherwise verify via documents-review.test.tsx) — upload no longer sends stage_id.
  - `documents-review.test.tsx` — new specs for the classify pipeline UI states.

Expected new tests: ~20.

## Risk + safety net

| Risk | Caught by |
|---|---|
| Migration breaks existing docs | Migration test verifies existing rows get `doc_type = NULL` (no constraint violation). |
| LLM hallucinated stage id | Zod enum constrains to 6 valid values. |
| Classification + extraction double-counts API cost | The pipeline calls classify ONCE per document (cached on `doc_type`), then routes to extraction. Total per first-open: 2 calls. Subsequent opens: 0 (cached). |
| User has no provider configured | Renderer query returns ProviderNotConfiguredError; renderer renders "未配置 AI provider" empty state with a Settings link. Upload itself unaffected. |
| Existing phase-1d docs (no `doc_type`) → all show "未分类" on the list | This is expected legacy state. Opening them triggers the classify pipeline normally. No data migration needed beyond the schema change. |
| Stage list drift (e.g. Phase 2 adds a 6th stage) | Both the enum in `ClassificationSchema` and the stage descriptions in the prompt need to be regenerated from `stageRegistry`. Add a unit test asserting the enum values match `Array.from(stageRegistry.keys())`. |

## Expected end state

- `document` table gains `doc_type` column.
- `LLMClient.classifyDocument()` exists with zod-constrained output.
- `ClassificationService.classifyAndRun()` orchestrates the lazy pipeline.
- New IPC channel `extraction:classify-and-run`.
- DocumentsUpload UI: no stage dropdown.
- Document list: rows show stage-specific labels OR "未分类".
- Review page: handles the classify pipeline + the switch-stage override.
- ~20 new tests, ~440 total vitest suite.
- 5 new i18n keys × 2 locales.
- Manual smoke walks the same 5 fixtures without selecting any stage — system auto-classifies each.

## Out-of-scope (Phase 2.x or later)

- A background classification job that runs immediately on upload (the "async" option). Defer until users complain about review-page latency.
- Confidence indicator in the doc list (e.g., a dim chip for low-confidence auto-classifications). Defer — current design has only "classified vs not".
- Per-stage confidence calibration (each stage may need a different threshold). v1 uses a single 0.7 threshold.
- Batch reclassification of existing extractions when a stage prompt changes. Manual override is enough for v1.
- Showing the LLM's classification reasoning to the user. Defer — chip is enough.
- A `document_classification_log` audit table for tracking reclassification history.
