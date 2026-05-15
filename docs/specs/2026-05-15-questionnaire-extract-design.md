# Questionnaire Extraction (Phase 2.2a) Design

**Date:** 2026-05-15
**Sub-project:** Phase 2.2a — first slice of Phase 2 main (questionnaire side)
**Predecessor:** Auto-classify doc_type sub-project (`6074653` → `0183657` on `main`)
**Successor:** Phase 2.2b (auto-answer generation + review UI), Phase 2.2c (Excel write-back)

## Goal

User uploads a `.xlsx` CDP-style supplier questionnaire → system creates a `Customer` + `Questionnaire` row → LLM extracts questions from the Excel grid (question text + target answer cell + sheet) → questions land in the existing `question` table → user lands on a per-questionnaire detail page that lists extracted questions.

**No answer generation. No export. No customer CRUD.** Pure upload-and-extract pipeline that leaves the system in `status = 'mapping'` ready for Phase 2.2b to pick up.

## Non-goals

- Auto-answer numerical questions (Phase 2.2b).
- Auto-mapping of questions to inventory rows (Phase 2.2b).
- Question signature reuse across customers (deferred — Phase 2.2.x or later).
- LLM classification of question kind (`numerical` / `categorical` / `narrative`). v1 hard-codes `'numerical'` for every extracted question — matches user's stated scope (numerical-only).
- Customer CRUD UI (just a name field on the new-questionnaire wizard; we create-or-get Customer by name).
- Multiple sheets in one questionnaire treated as separate questionnaires (sheets are aggregated into one questionnaire's question list).
- PDF or Web questionnaires (only `.xlsx` for v1).
- Narrative_bank / company_profile (Phase 2.2.x).
- Cross-questionnaire question reuse / templates / matching by signature.

## Current state (audited)

- **Schemas already exist** (`migrations/005_questionnaire.sql`, shipped in phase-1a):
  - `customer (id, name, notes)`
  - `questionnaire (id, customer_id, document_id, template_kind, reporting_year, status, due_date, created_at)`
  - `question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required)`
  - `question_mapping`, `answer` — used in 2.2b/c, not touched in 2.2a
- **No Excel library installed.** Will add `exceljs`.
- **`document:upload` IPC** is mime-type-agnostic at the SQL level but the renderer's `DocumentsUpload` filters to `application/pdf`. We do NOT modify the inventory document upload; instead, the questionnaire flow has its own upload handler reusing the underlying `document` table.
- **Routes:** existing renderer routes are dashboard, sources, activities, documents, settings (drawer). No `/questionnaires` yet.

## Architecture

```
┌─ Renderer ────────────────────────────────────────────────────────────────┐
│  /questionnaires  ← new nav item                                          │
│  ├─ List: table of {customer, year, status, due_date}                     │
│  └─ "+ New questionnaire" → /questionnaires/new wizard                    │
│                                                                           │
│  /questionnaires/new                                                      │
│  ├─ Customer name (free text)                                             │
│  ├─ Reporting year (number)                                               │
│  ├─ Due date (date, optional)                                             │
│  └─ Upload .xlsx                                                          │
│      ↓                                                                    │
│      IPC: questionnaire:create(customer_name, year, due_date, file_bytes) │
│                                                                           │
│  /questionnaires/$id                                                      │
│  ├─ Read-only header: customer, year, status, document filename           │
│  └─ Question list table: {row, question_text, kind, expected_unit}        │
│      → 2.2b will replace this with an answer-review UI                    │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ IPC
                                  ▼
┌─ Main ────────────────────────────────────────────────────────────────────┐
│  QuestionnaireService.createFromUpload({                                  │
│    customer_name, reporting_year, due_date, file_bytes                    │
│  }):                                                                      │
│    1. document = documentService.upload(file_bytes, filename, .xlsx mime) │
│    2. customer = customerService.createOrGetByName(customer_name)         │
│    3. q = INSERT INTO questionnaire (status='parsing')                    │
│    4. cells = ExcelParser.parse(file_bytes) → [{sheet, row, col, value}]  │
│    5. questions = LLMClient.extractQuestions(cells)                       │
│       → [{ raw_text, normalized_text, expected_unit, answer_cell_ref }]   │
│    6. INSERT INTO question (questionnaire_id=q, ...) × N                  │
│    7. UPDATE questionnaire SET status='mapping'                           │
│    Return: { questionnaire, question_count }                              │
│                                                                           │
│  Read-side IPC:                                                           │
│    questionnaire:list → [Questionnaire + customer.name]                   │
│    questionnaire:get-by-id → { questionnaire, questions[], document }     │
└───────────────────────────────────────────────────────────────────────────┘
```

The pipeline is synchronous (single IPC call returns when the questionnaire is fully parsed and questions are stored). User sees a "正在解析问卷…" loading state during the call. Typical Excel parse + LLM extract is ~3-8s — acceptable for a one-time upload.

## Component design

### `exceljs` integration

`pnpm add exceljs` adds the dep. Used by:
- `ExcelParser.parse(bytes: Buffer)` (read-side) — for 2.2a + 2.2b
- `ExcelWriter` (write-side) — Phase 2.2c

`ExcelParser` exposes:

```ts
export type CellLocation = { sheet: string; row: number; col: number };
export type CellValue = string | number | null;

export type ParsedCell = CellLocation & {
  value: CellValue;
  ref: string;  // e.g. "Sheet1!B5"
};

export class ExcelParser {
  /**
   * Parse a .xlsx buffer into a flat list of non-empty cells across all
   * sheets. Drops empty cells and obviously-blank rows. Preserves cell
   * coordinates so downstream can write answers back later.
   */
  static async parse(bytes: Buffer): Promise<ParsedCell[]>;
}
```

Performance note: a real CDP questionnaire is 200-500 rows × 5-10 cols = ~2000 cells max. We don't paginate or stream — load fully, return the flat list.

### `LLMClient.extractQuestions`

New method on `LLMClient`:

```ts
async extractQuestions(
  config: ProviderConfig,
  cells: ParsedCell[],
): Promise<{
  questions: Array<{
    raw_text: string;            // Verbatim from question cell.
    normalized_text: string;     // Trimmed, deduplicated whitespace.
    answer_cell_ref: string | null;  // e.g. "Sheet1!B5"; null if not detected.
    expected_unit: string | null;    // e.g. "kWh", "tCO2e"; null if not stated.
    sheet: string;
    question_row: number;        // For UI display + sort order.
  }>;
}>;
```

Prompt strategy: pass the cells grouped by sheet + row, ask the LLM to identify question/answer pairs. The model returns the question text + which cell its answer should go in. Bounded by zod schema with max items (e.g. 200).

For an Excel like:
```
Row 5: A5="Q1: Total electricity consumed (kWh)?"  B5=""  C5="kWh"
Row 6: A6="Q2: Total natural gas (m³)?"            B6=""  C6="m³"
```

The model returns:
```json
{
  "questions": [
    { "raw_text": "Q1: Total electricity consumed (kWh)?", "normalized_text": "Total electricity consumed", "answer_cell_ref": "Sheet1!B5", "expected_unit": "kWh", "sheet": "Sheet1", "question_row": 5 },
    { "raw_text": "Q2: Total natural gas (m³)?", "normalized_text": "Total natural gas", "answer_cell_ref": "Sheet1!B6", "expected_unit": "m³", "sheet": "Sheet1", "question_row": 6 }
  ]
}
```

### Mime type expansion

The document table currently accepts any mime; we just need to update the renderer-side allowlist on the new questionnaire upload component to accept `.xlsx`:

```ts
const QUESTIONNAIRE_ACCEPT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
```

The existing `documents/` flow stays PDF-only (different UX, different stage registry). Questionnaire flow is parallel.

### `CustomerService`

Small new service:

```ts
export class CustomerService {
  constructor(deps: { db: Database });
  /** Find an existing customer with this exact name OR create a new one. */
  createOrGetByName(name: string): Customer;
  list(): Customer[];
  getById(id: string): Customer | null;
}
```

No update / delete in 2.2a. Customer rows are append-only at the v1 horizon.

### `QuestionnaireService`

```ts
export class QuestionnaireService {
  constructor(deps: {
    db: Database;
    documentService: DocumentService;
    customerService: CustomerService;
    llmClient: LLMClient;
    config: ProviderConfig;
  });

  async createFromUpload(input: {
    customer_name: string;
    reporting_year: number;
    due_date: string | null;
    file_bytes: Uint8Array;
    filename: string;
  }): Promise<{ questionnaire: Questionnaire; question_count: number }>;

  list(): Array<Questionnaire & { customer_name: string }>;
  getById(id: string): {
    questionnaire: Questionnaire;
    customer: Customer;
    document: Document;
    questions: Question[];
  } | null;
}
```

`createFromUpload` orchestrates the pipeline. The whole call runs inside a transaction so a parse failure half-way doesn't leave a dangling `questionnaire` row.

### IPC channels

New entries in `IpcTypeMap`:

```ts
'questionnaire:create': (input: {
  customer_name: string;
  reporting_year: number;
  due_date: string | null;
  file_bytes: Uint8Array;
  filename: string;
}) => Promise<{ questionnaire_id: string; question_count: number }>;
'questionnaire:list': () => Array<Questionnaire & { customer_name: string }>;
'questionnaire:get-by-id': (input: { id: string }) => /* shape from service */;
```

Handler in `src/main/ipc/handlers/questionnaire.ts` (new file). Allowlist `questionnaire:*` in preload.

### Renderer routes

Three new routes (file-based TanStack Router):

1. `src/renderer/routes/questionnaires.tsx` — list page
   - Table: 客户 / 报告年度 / 状态 / 题目数 / 截止日期 / 创建时间
   - "+ 新建问卷" button → navigate to `/questionnaires/new`
   - Empty state: "还没有问卷"
2. `src/renderer/routes/questionnaires.new.tsx` — wizard page
   - Form: customer name (text) / reporting year (number, default current year) / due date (date, optional)
   - File input (single .xlsx)
   - "上传并解析" button → fires `questionnaire:create` IPC
   - Loading state during call → "正在解析问卷…"
   - On success → navigate to `/questionnaires/$id`
3. `src/renderer/routes/questionnaires_.$id.tsx` — detail page
   - Header: customer name, year, status, filename, "返回问卷列表" link
   - Question table: row, question text, kind, expected unit
   - Footer: "Phase 2.2b 将在此处生成答案" placeholder note

The sidebar gets a new entry "Questionnaires" / "问卷".

### Database changes

NONE for 2.2a. The schemas already in migration 005 cover everything we need. `question_signature` gets the sha256 of `normalized_text` (we'll revisit when we add cross-customer reuse).

### i18n keys

New keys (en + zh-CN):

- `nav_questionnaires` → "Questionnaires" / "问卷"
- `questionnaires_empty` → "No questionnaires yet" / "还没有问卷"
- `questionnaires_new_button` → "+ New questionnaire" / "+ 新建问卷"
- `questionnaires_table_customer` → "Customer" / "客户"
- `questionnaires_table_year` → "Reporting year" / "报告年度"
- `questionnaires_table_status` → "Status" / "状态"
- `questionnaires_table_questions` → "Questions" / "题目数"
- `questionnaires_table_due` → "Due date" / "截止日期"
- `questionnaires_wizard_title` → "New questionnaire" / "新建问卷"
- `questionnaires_wizard_customer` → "Customer name" / "客户名称"
- `questionnaires_wizard_year` → "Reporting year" / "报告年度"
- `questionnaires_wizard_due` → "Due date (optional)" / "截止日期（可选）"
- `questionnaires_wizard_upload` → "Upload .xlsx and parse" / "上传 Excel 并解析"
- `questionnaires_wizard_parsing` → "Parsing questionnaire…" / "正在解析问卷…"
- `questionnaires_wizard_failed` → "Parsing failed" / "解析失败"
- `questionnaires_detail_question` → "Question" / "题目"
- `questionnaires_detail_kind` → "Type" / "题型"
- `questionnaires_detail_unit` → "Unit" / "单位"
- `questionnaires_detail_answer_pending` → "Phase 2.2b will generate answers here." / "Phase 2.2b 将在此处生成答案。"
- `questionnaires_status_parsing` → "Parsing" / "解析中"
- `questionnaires_status_mapping` → "Mapping" / "映射中"
- `questionnaires_status_answering` → "Answering" / "答题中"
- `questionnaires_status_exported` → "Exported" / "已导出"

### Tests

- `tests/main/excel-parser.test.ts` — parses a known .xlsx fixture into the flat-cells list (use `exceljs` to write a small fixture in setup OR commit a small fixture file).
- `tests/main/services/customer-service.test.ts` — createOrGetByName: new name creates, existing name returns the same row.
- `tests/main/services/questionnaire-service.test.ts` — `createFromUpload` happy path (mock LLM): 3 questions extracted, 1 questionnaire row, 1 customer row, 3 question rows, status transitions.
- `tests/main/llm/llm-client-extract-questions.test.ts` — schema validation, prompt content includes sheet/row info.
- `tests/main/ipc/questionnaire-handlers.test.ts` — zod validation on inputs.
- Renderer tests: `tests/renderer/questionnaires-list.test.tsx` + `tests/renderer/questionnaires-new.test.tsx` (smoke renders only).

Expected new tests: ~15. Total target: ~459.

### Tasks (rough plan, drives the implementation plan)

1. Install `exceljs` + `ExcelParser` + tests
2. `LLMClient.extractQuestions` + tests
3. `CustomerService` + tests
4. `QuestionnaireService.createFromUpload` + tests
5. `QuestionnaireService.list` + `getById` + tests
6. IPC channels + renderer API client
7. `/questionnaires` list route
8. `/questionnaires/new` wizard route
9. `/questionnaires/$id` detail route
10. Sidebar entry + i18n keys
11. Sweep (format + lint)

~11 tasks, similar size to the auto-classify sub-project.

## Risk + safety net

| Risk | Caught by |
|---|---|
| LLM extracts garbage / non-question cells as questions | The model output is bounded by zod; review page lets user discard the entire questionnaire. Phase 2.2b is when wrong questions would actually hurt — at that point the user reviews each answer. |
| Empty Excel / malformed file | `ExcelParser` throws; `QuestionnaireService.createFromUpload` wraps in try/catch, rolls back the transaction, throws a user-facing error to IPC. |
| Multi-sheet questionnaires with section headers vs questions | LLM is responsible for distinguishing. The prompt explicitly says "ignore section headers, table-of-contents rows, anything without a clear answer cell". |
| `.xlsx` upload mime mismatch (some browsers send `application/octet-stream`) | Renderer accepts both `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` AND any file with a `.xlsx` extension. |
| Large Excel (>1MB) | Per-renderer-transfer Uint8Array works for files up to ~20MB without electron IPC issues. Real CDP questionnaires are <500KB. Defer streaming to Phase 2.2+. |
| `question_signature` collisions across questionnaires from different customers | v1 just uses sha256(normalized_text). Collisions are fine — the unique index is on `(questionnaire_id, position)`, not signature. Cross-customer reuse logic comes later (Phase 2.2.x). |

## Expected end state

- `pnpm add exceljs` adds the dep.
- New tables touched: 0. New rows in existing tables: customer + questionnaire + question.
- New IPC channels: 3 (`questionnaire:create`, `questionnaire:list`, `questionnaire:get-by-id`).
- New routes: 3 (`/questionnaires`, `/questionnaires/new`, `/questionnaires/$id`).
- New sidebar entry.
- ~20 new i18n keys × 2 locales.
- ~15 new vitest tests. Target: ~459 total.
- typecheck + lint clean.

After this lands: user can upload an Excel questionnaire, see the extracted questions in a read-only review page, and is set up for Phase 2.2b's answer-generation flow.

## Out-of-scope follow-ups for later sub-projects

- **Phase 2.2b**: auto-answer numerical questions + answer review UI + state machine `mapping → answering`.
- **Phase 2.2c**: Excel write-back + export button + state `answering → exported`.
- **Phase 2.3+**: question_kind classification (numerical/categorical/narrative split), narrative_bank + company_profile, question_mapping reuse, multi-customer template reuse, PDF/Web questionnaire formats, batch questionnaire processing.
