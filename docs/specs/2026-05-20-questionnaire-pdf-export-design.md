# Questionnaire PDF Export — Design

**Date:** 2026-05-20
**Status:** Approved (brainstorming complete; ready for plan)
**Sub-project:** Phase 3 / sub-project 4 of 4 (final)
**Prior shipped:** Phase 0/1/2 full + Phase 3 sub-projects 1-3. 605 vitest tests passing on `main`.

---

## 1. Goal

Add a "Export PDF" button on the questionnaire detail page (`/questionnaires/$id`) alongside the existing "Export Excel" button. Generates a sheet-grouped Q&A PDF: cover page → table of contents → one section per source Excel sheet → numbered Q&A list within each section. Reuses the hidden BrowserWindow + `printToPDF` infrastructure from sub-project 1.

**Problem:** the answered questionnaire currently exports as `.xlsx` (Phase 2.2c) which preserves the original cell layout but requires Excel to read. For sharing with non-technical stakeholders or printing for archival, a PDF is needed.

**Scope (v1):**

- "Export PDF" button on `/questionnaires/$id` (next to the existing Excel export button).
- Single-language per export (zh-CN or en — user picks via the same dialog flow as the ISO report).
- Sheet-grouped Q&A format:
  - Cover page: customer name, reporting year, due date (if set), generated date.
  - Table of contents: list of sheet names with page numbers.
  - Per-sheet section: H1 with sheet name + numbered Q&A list.
  - Each Q&A entry: question raw_text (primary), parsed_intent (small print, if present), then the answer block (value + unit + draft/unanswered marker + source_summary).
- Cell-position-aware ordering: within a sheet, questions sorted by their `position` field (which encodes `Sheet!Cell`).
- Finalized vs draft visual distinction: finalized → normal text + checkmark icon; draft → "DRAFT" badge + lighter text; unanswered → italicized "(未答 / Unanswered)" placeholder.
- Page numbers in footer; questionnaire title + generated date in header.

**Out of scope (v1):**

- High-fidelity Excel-to-PDF (preserving original cell layout, formatting, column widths). Defer indefinitely — extreme complexity for marginal value.
- Bilingual side-by-side PDF.
- Question-level images or attachments.
- User-selectable section ordering / question filtering.
- Export to `.docx` (DOCX is structurally different; separate sub-project if ever needed).
- "Rearrange" UI (e.g. drag-drop question order before export). The export uses the questionnaire's natural order from `position`.

---

## 2. Architecture

```
[Questionnaire detail page (/questionnaires/$id)]
                       │
                       ▼
[Language picker dialog (modal)] — user picks zh-CN or en
                       │
                       ▼
[<QuestionnairePdfPreview data={...} />] — invisible mount in hidden window
                       │
                       ▼
[Electron BrowserWindow (hidden, offscreen) + printToPDF]
                       │
                       ▼
[Native save dialog]
                       │
                       ▼
[PDF file on disk]
```

The renderer pipeline mirrors sub-project 1 (ISO 14064-1 report). One IPC channel `questionnaire:export-pdf`. Same hidden-window pattern. Different React component tree (sheet-grouped Q&A instead of inventory report).

### Component responsibilities

| File | Responsibility |
|---|---|
| `src/main/services/questionnaire-pdf-data-service.ts` | NEW. Pure read: assembles `QuestionnairePdfData` (customer + questionnaire + document + questions + answers, sorted by sheet then position). |
| `src/main/services/report-export-service.ts` | EXTEND. Add `renderQuestionnairePdf(args, deps)` paralleling `renderReportPdf` from sub-project 1. Same hidden-BrowserWindow + printToPDF flow with a different `printRenderUrl` path. |
| `src/main/ipc/handlers/questionnaire.ts` | EXTEND. Add `questionnaire:export-pdf` channel handler (save dialog → render → write file). |
| `src/main/ipc/types.ts` | Add `questionnaire:export-pdf` to IpcTypeMap. |
| `src/preload/bridge.ts` | Allowlist `questionnaire:export-pdf`. |
| `tests/preload/bridge.test.ts` | Extended allowlist assertion. |
| `src/renderer/lib/api/questionnaire.ts` | Add `exportPdf` method. |
| `src/renderer/components/questionnaire-pdf/QuestionnairePdfPreview.tsx` | NEW. Single React component used in the hidden window for printing. Renders cover + TOC + sections. |
| `src/renderer/components/questionnaire-pdf/sections/*.tsx` | NEW. Subcomponents: CoverPage, TableOfContents, SheetSection, QuestionAnswerRow. |
| `src/renderer/styles/questionnaire-pdf.css` | NEW. Print CSS with `@page` rules + page-break utilities. |
| `src/renderer/routes/questionnaires_.$id.tsx` | EXTEND. Add "Export PDF" button + language picker dialog. |
| `messages/en.json`, `messages/zh-CN.json` | ~12 new i18n keys. |

### Why a separate `QuestionnairePdfPreview` (vs reusing the inventory report's component)

The two PDFs render fundamentally different content — the inventory report is a Q&A-free narrative + tables, the questionnaire PDF is a hierarchical Q&A list. Shared layout primitives (CoverPage, table-of-contents, page-break utility) could be extracted to a `report-shared/` folder, but YAGNI for v1 — each PDF's structure is small enough to be self-contained, and extracting would create premature coupling.

### Why a separate `print-render` route

The existing `print-render` route from sub-project 1 reads `window.__REPORT_PAYLOAD__` and renders `<ReportPreview>`. For the questionnaire PDF, the renderer needs a similar entry point but a different React tree. Two clean options:

1. **One `print-render` route that dispatches based on payload shape** (e.g. payload has `kind: 'inventory_report' | 'questionnaire_pdf'`). Simpler infrastructure, one route to maintain.
2. **Two routes**: `/print-render/inventory-report` and `/print-render/questionnaire-pdf`.

**Pick option 1.** Add a `kind` discriminator to the payload; the existing print-render route reads it and conditionally renders the right component. Less duplication, fewer route files, same `loadURL` pattern in main.

---

## 3. API Contracts

```ts
// src/shared/types.ts — new type
export type QuestionnairePdfData = {
  customer: { name: string };
  questionnaire: {
    id: string;
    reporting_year: number;
    due_date: string | null;
    created_at: string;
    status: 'parsing' | 'mapping' | 'answering' | 'exported';
  };
  document: { filename: string };
  /** Sheets in their original Excel order; questions inside each sheet sorted
   *  by cell position (row asc, then column asc). */
  sheets: Array<{
    sheet_name: string;
    questions: Array<{
      id: string;
      position: string | null;        // e.g. 'Sheet1!B5'
      raw_text: string;
      normalized_text: string;
      parsed_intent: string | null;
      question_kind: 'numerical' | 'categorical' | 'narrative';
      expected_unit: string | null;
      answer: {
        value: string;
        unit: string | null;
        finalized_at: string | null;
        source_summary: string | null;
      } | null; // null = unanswered
    }>;
  }>;
  language: 'zh-CN' | 'en';
};

// src/main/ipc/types.ts — add to IpcTypeMap
'questionnaire:export-pdf': (input: {
  questionnaire_id: string;
  language: 'zh-CN' | 'en';
}) => Promise<
  | { canceled: true }
  | { ok: true; path: string }
  | { ok: false; error: string }
>;
```

The QuestionnairePdfDataService builds the `QuestionnairePdfData` by:
1. Querying `questionnaire` + `customer` + `document`.
2. Querying all `question` rows for the questionnaire.
3. Querying all `answer` rows for those questions.
4. Grouping questions by the sheet portion of `position` (the substring before `!`).
5. Sorting sheets in their natural file order (preserve insertion order from question.position; the parser populates positions in sheet-then-row order so a stable sort by first-seen-sheet works).
6. Within each sheet, sort questions by parsed cell address (row number, then column letter).

If a question has `position === null` (e.g. parser couldn't determine cell), bucket it into a synthetic "未指定 / Unspecified" sheet at the end.

---

## 4. UI Behavior

### Questionnaire detail page

The toolbar (currently has "Export Excel" + "Finalize all" buttons) grows an "Export PDF" button alongside "Export Excel":

```
[Generate all unanswered]  [Export Excel]  [Export PDF]  [Finalize answers]
```

Click on "Export PDF":
1. Modal dialog: "Choose export language" with radio (zh-CN / en) + Cancel / Export buttons.
2. On Export: triggers mutation `reportApi.exportPdf({ questionnaire_id, language })` (or rather `questionnaireApi.exportPdf(...)` — match existing naming).
3. Renderer shows spinner ("Generating PDF…") for the duration.
4. Save dialog opens; user picks path.
5. On save: toast "Exported PDF → <path>".
6. On cancel (save dialog): silent abort, no toast.
7. On error: toast with error message.

### Inside the PDF

- **Cover page**: large customer name + reporting year + due date (if set) + generated date. Right-aligned timestamp. Carbonbook logo / wordmark optional (skip if not already in the asset folder).
- **TOC**: bullet list of sheet names; if more than 1 sheet, page numbers (computed by `printToPDF`'s automatic pagination — see below).
- **Per-sheet sections**:
  - H1: sheet name.
  - For each question (numbered Q1, Q2, ...):
    - Question raw_text in bold.
    - If `parsed_intent` is non-null: italic small print below the raw_text.
    - Answer block:
      - If `answer` is null: italic "(未答 / Unanswered)" placeholder.
      - If `answer.finalized_at` is set: regular text "Answer: <value> [<unit>]" with optional small "✓ Finalized" badge.
      - If `answer.finalized_at` is null: regular text "Answer: <value> [<unit>]" with red "DRAFT" badge.
      - If `answer.source_summary` is non-null: italic small print "Source: <source_summary>" below the value.
- **Page footer**: questionnaire filename + page number (auto via Chromium).
- **Page header**: customer name (small grey).

### Page number computation in TOC

Chromium's `printToPDF` handles pagination automatically but **doesn't give per-section page numbers back**. Three options for the TOC:

1. **No page numbers in TOC** — just sheet names as a list. Simple. **Pick this for v1.**
2. **Use CSS counters with `target-counter()`** — but only modern Chromium supports it; need to verify it works under printToPDF.
3. **Render twice**: first pass gets section page numbers via `pageCount` callbacks; second pass renders TOC with those numbers. Overkill for v1.

If a user really needs page numbers in TOC, file a feedback issue and we revisit with option 2.

---

## 5. Error Handling

Same shape as the ISO 14064-1 PDF export from sub-project 1:

| Failure | Where | Behavior |
|---|---|---|
| User cancels save dialog | `dialog.showSaveDialog` returns `{ canceled: true }` | Silent abort |
| Hidden window fails to load | `loadURL` throws | Toast "PDF export failed: <message>"; hidden window closed in `finally` |
| `printToPDF` throws | Main try/catch | Toast with error |
| `fs.writeFile` throws | Main try/catch | Toast with error |
| Questionnaire not found | service throws | Toast "Questionnaire not found" |

The handler always returns a discriminated union; never throws across IPC.

The hidden BrowserWindow is closed in a `finally` block to prevent leaks.

---

## 6. Testing Strategy

### Unit (vitest) — target ~5 new tests

**`tests/main/services/questionnaire-pdf-data-service.test.ts`** — 3 tests:
1. Returns `QuestionnairePdfData` with sheets grouped + questions sorted by cell position.
2. Buckets `position === null` questions into "未指定 / Unspecified" sheet at the end.
3. Returns `answer: null` for questions without answers.

**`tests/main/ipc/questionnaire-handlers.test.ts`** — 1 new test (extending existing file):
4. `questionnaire:export-pdf` calls service + dialog + writes file in the happy path.

### Renderer (vitest + happy-dom) — target ~2 new tests

**`tests/renderer/questionnaire-pdf-preview.test.tsx`** — 2 tests:
5. Renders cover page + one sheet section with one Q&A entry.
6. Renders "DRAFT" badge for un-finalized answers and "(Unanswered)" for null-answer questions.

### Out of scope (deliberately)

- E2E spec — deferred to consolidated phase-3 tag-time smoke.
- Actual PDF byte content validation — `printToPDF` is an Electron API; tested manually.
- High-fidelity Excel-to-PDF visual comparison — out of v1 scope.

**Test count target:** 605 → ~610 (+5).

---

## 7. Dependencies

- No new top-level dependencies.
- Reuses: Electron `BrowserWindow.printToPDF` (already used by sub-project 1), `paraglide` i18n, TanStack Query, `dialog.showSaveDialog`.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Sheet sort order doesn't match user expectation (Excel preserves sheet insertion order; we'd need to honor it) | Use the `position` string parser to extract sheet names in first-seen order from the questions table — preserves the order the parser inserted them, which matches the original `.xlsx` sheet order |
| Questions without `position` (edge case from the parser) | Bucket into "未指定 / Unspecified" — never silently dropped |
| Very long questionnaires produce 100+ page PDFs | Chromium handles pagination; we add `.page-break-inside-avoid` to question rows to prevent mid-question splits |
| Print CSS doesn't render correctly in offscreen window | Already tested in sub-project 1; same plumbing should work; manual smoke at phase-3 tag time validates |
| `parsed_intent` is sometimes much longer than raw_text and dominates the page | CSS `max-height + overflow-hidden` truncates with ellipsis if absurdly long. Real-world parsed_intent values are usually 1-2 sentences. |

---

## 9. Acceptance

- `pnpm test` passes 610+ tests (605 baseline + ~5 new).
- `pnpm typecheck` clean.
- `biome check` no NEW errors.
- A user can:
  1. Open `/questionnaires/$id` for a questionnaire with at least one answered question.
  2. Click "Export PDF".
  3. Pick language (zh-CN or en).
  4. See spinner during render.
  5. See native save dialog.
  6. Save and open the PDF — see cover page, TOC, and one section per sheet with numbered Q&A entries.
  7. Verify draft answers show "DRAFT" badge.

---

## 10. Future v1.5+

- High-fidelity Excel-to-PDF (option b from brainstorm).
- Bilingual side-by-side PDF.
- Per-question images / attachments (when carbonbook supports document references on questions).
- Combine inventory report + questionnaire PDF into a single bundle export.
- TOC with real per-section page numbers via CSS `target-counter()`.
- "Rearrange before export" UI — let user reorder sections or skip questions.

---

## 11. Phase 3 Completion

This is sub-project 4 of 4. After this lands, **Phase 3 is fully complete** — the long-arc `/goal 完成所有phase功能` is satisfied. Phase 4 candidates (if/when started) would be brainstormed separately.
