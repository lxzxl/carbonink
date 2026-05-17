# Phase 2.2c: Answer Export — Design

**Date:** 2026-05-17
**Phase:** 2.2c
**Status:** Approved by user 2026-05-17; ready for plan.
**Predecessor:** Effect Step 3 (`790e89a`) — `generateAllUnanswered` available for reuse.
**Successor:** TBD — Phase 1+2 feature loop is complete after this.

## Why

The questionnaire flow today is: upload → parse → extract → review → generate → save → finalize. Phase 2.2c closes the loop by **writing answers back into the original .xlsx and letting the user save it**. After 2.2c lands, the user can hand the .xlsx back to whoever asked for it filled in.

Two real constraints shape the design:

1. **CDP supplier questionnaires arrive with branding, conditional formatting, named ranges, hidden sheets, validation rules.** The recipient expects to receive THEIR file back with cells filled in — not a stripped-down copy. So we **read-modify-write the original buffer** rather than generating a new .xlsx from scratch. exceljs's `wb.xlsx.load()` + `wb.xlsx.writeBuffer()` preserves the input format byte-for-byte except for cells we touch.
2. **The user often hasn't finalized every answer.** AI-suggested answers and edited-but-not-finalized answers should still go to the recipient, but **clearly marked as "draft"** so the recipient knows what's been human-reviewed. exceljs's `cell.note` property writes a native Excel comment that shows up as a yellow-corner indicator + popup on hover.

## Scope

**In scope:**
- New module `src/main/excel/answer-writer.ts` exporting a **pure** function `writeAnswers(originalBytes, cellValueMap) → { buffer, written, drafts }`. No DB access, no FS, no Electron — pure transform.
- New IPC channel `answer:export-to-xlsx` that orchestrates: read questionnaire + answers + original document bytes → call `writeAnswers` → `dialog.showSaveDialog` → write buffer to chosen path → set `questionnaire.status = 'exported'`.
- New "Export to Excel" button on `/questionnaires/$id` detail route.
- 4 i18n keys.
- Test surface: pure-function tests (3) + 1 handler test (with mocked dialog/fs) + 1 button smoke test.

**Out of scope:**
- Auto-generate empty answers before export. User clicks "Generate all unanswered" first if they want that. Two buttons, two intentional clicks.
- Custom filename templates. Default name = `<original-filename>_filled.xlsx`. User can rename in the dialog.
- Diff view "what was changed".
- Re-export idempotency tracking (timestamp the export, log a history row). For v1, re-export just overwrites — status stays 'exported'.
- Multi-format export (CSV, JSON, PDF). Excel only.
- Effect TS for this service. **Single-shot, no concurrency, no retry → plain Promise.** Knowing when NOT to use Effect is part of the toolkit.

## Design

### Pure transform: `writeAnswers`

```ts
// src/main/excel/answer-writer.ts
import ExcelJS from 'exceljs';

export interface AnswerCell {
  /** Cell ref from question.position, e.g. "Sheet1!B5". */
  ref: string;
  /** Display value. Numeric-looking strings written as numbers; else text. */
  value: string;
  /** When true, attach a "draft" comment to the cell. */
  isDraft: boolean;
}

export interface WriteResult {
  buffer: Buffer;
  written: number;
  drafts: number;
}

export async function writeAnswers(
  originalBytes: Buffer | ArrayBuffer,
  cells: readonly AnswerCell[],
): Promise<WriteResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(originalBytes as ArrayBuffer);

  let written = 0;
  let drafts = 0;

  for (const cell of cells) {
    const [sheetName, address] = cell.ref.split('!');
    if (!sheetName || !address) continue;
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) continue;
    const xlCell = sheet.getCell(address);

    const numeric = Number(cell.value);
    xlCell.value = Number.isFinite(numeric) && cell.value.trim() !== '' ? numeric : cell.value;

    if (cell.isDraft) {
      xlCell.note = 'draft';
      drafts++;
    }
    written++;
  }

  const out = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(out as ArrayBuffer), written, drafts };
}
```

**Why pure?** Three reasons:
1. **Testable** — pass a buffer in, get a buffer out, no FS / dialog / Electron stub needed. The 3 unit tests check (a) one answer written, (b) draft comment attached, (c) bad cell ref ignored.
2. **Composable** — bulk export of multiple questionnaires, dry-run preview, export-to-temp-for-diff all reuse this function without modification.
3. **Reasoning** — no hidden state. Given the same inputs, same outputs. The IPC handler glues the pure function to side-effecty environment (DB, FS, dialog).

**Why numeric-coercion?** `Answer.value` is always `string` in our DB (the type from migration 005). But CDP questionnaires expect numeric cells to BE numbers — losing numeric typing breaks downstream SUM formulas and conditional formatting that test `=ISNUMBER(B5)`. `Number(cell.value)` + `Number.isFinite(...)` correctly handles `"14820"` → `14820`, `"3.14"` → `3.14`, but leaves `"Beijing"` and `""` as strings. Edge case: `"007"` becomes `7` (loses leading zero) — acceptable trade-off; if the recipient expects literal "007" they would have used a text-format cell which exceljs preserves (the cell's `numFmt` stays; only the underlying value changes).

**Why `getWorksheet(name)` and not by index?** `question.position` was generated by the parser using sheet name. If we used index, renaming a sheet in the original .xlsx would silently misalign — name-based lookup fails loudly (returns `undefined`, we skip).

**Silent-skip semantics:** If the sheet doesn't exist (renamed) or the cell ref is malformed, we skip rather than error. Rationale: better to write 49/50 answers than to fail the whole export because one question's position became stale. The return type's `written` count surfaces the discrepancy to the UI.

### IPC handler: orchestration

```ts
// src/main/ipc/handlers/answer.ts (extended)
'answer:export-to-xlsx': async (input) => {
  const parsed = qidInput.parse(input);

  // 1. Gather inputs from DB.
  const questionnaire = ctx.questionnaireService.getById(parsed.questionnaire_id);
  if (!questionnaire) throw new Error('Questionnaire not found');
  const document = ctx.documentService.getById(questionnaire.document_id);
  if (!document) throw new Error('Document not found');
  const answers = await Effect.runPromise(
    answerSvc.listByQuestionnaire(parsed.questionnaire_id).pipe(Effect.provide(ctx.answerLayer)),
  );
  const questions = ctx.questionnaireService.listQuestions(parsed.questionnaire_id);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  // 2. Build cell-value map.
  const cells: AnswerCell[] = answers
    .map((a) => {
      const q = questionById.get(a.question_id);
      if (!q?.position) return null;
      return { ref: q.position, value: a.value, isDraft: a.finalized_at == null };
    })
    .filter((c): c is AnswerCell => c != null);

  // 3. Save dialog.
  const defaultName = document.filename.replace(/\.xlsx$/i, '') + '_filled.xlsx';
  const result = await dialog.showSaveDialog({
    title: 'Export answered questionnaire',
    defaultPath: defaultName,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true as const };
  }

  // 4. Read + transform + write.
  const originalBytes = await fs.readFile(document.storage_path);
  const { buffer, written, drafts } = await writeAnswers(originalBytes, cells);
  await fs.writeFile(result.filePath, buffer);

  // 5. Status transition.
  ctx.questionnaireService.markExported(parsed.questionnaire_id);

  return { canceled: false as const, path: result.filePath, written, drafts };
},
```

**Why orchestration in the handler, not a new service class?** The orchestration touches **4 services + 2 OS APIs (dialog, fs)** — extracting it into a service would just wrap the existing services. The handler IS the orchestration boundary, and Effect Step 1-3 already established this pattern. Single-responsibility: handler does IPC-bound work, pure function does transformation.

**Why a `markExported` method on QuestionnaireService instead of inline SQL?** Same reason `finalizeAnswering` exists — keeps SQL inside the service layer. Even though it's a one-liner, the service is the keeper of the status-machine.

### Save dialog UX

- Default filename: `<original-basename>_filled.xlsx`. If user uploaded `cdp_supplier_2025.xlsx`, default save is `cdp_supplier_2025_filled.xlsx`.
- File filter: `.xlsx` only.
- Save dialog opens at the user's last-used location (Electron default behavior).

### Status transition

`mapping → answering → exported` is one-way. Re-exporting from `exported` state is allowed (overwrites), status stays `exported`. We don't currently have an "un-export" workflow; if user needs to re-finalize an answer, they edit it (flips source_kind to 'manual') and re-export. The button is always visible regardless of status.

### Renderer

```tsx
const exportToExcel = useMutation({
  mutationFn: () => answerApi.exportToXlsx({ questionnaire_id: id }),
  onSuccess: (result) => {
    if (result.canceled) return;
    toast.success(m.answer_export_done({ written: result.written, drafts: result.drafts }));
    queryClient.invalidateQueries({ queryKey: ['questionnaire:get-by-id', id] });
  },
  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
});

<Button onClick={() => exportToExcel.mutate()} disabled={exportToExcel.isPending}>
  {exportToExcel.isPending ? m.answer_export_running() : m.answer_export_button()}
</Button>
```

### i18n keys

- `answer_export_button` — "Export to Excel" / "导出 Excel"
- `answer_export_running` — "Exporting…" / "导出中…"
- `answer_export_done` — "{written} answers written ({drafts} drafts)." / "已写入 {written} 条答案（其中 {drafts} 条草稿）。"
- `answer_export_canceled` — "Export canceled." / "已取消导出。" *(only if we surface cancellation as a toast — currently we don't; result.canceled returns silently)*

## Decision points

| Decision | Choice | Why |
|---|---|---|
| Pure transform vs inline | Pure `writeAnswers(bytes, cells)` | Testable + composable; no FS/Electron in service |
| Library | `exceljs` (current) | Per `2026-05-15-excel-library-tradeoffs.md` — stay until trigger fires |
| Numeric coercion | `Number(v)` + `isFinite` | Excel formulas need numeric typing; minor edge cases (leading zeros) acceptable |
| Cell lookup | by sheet **name** | Index-based silently misaligns on rename; name-based fails loudly |
| Malformed/missing cell | Silent skip | Better partial export than total failure |
| Auto-fill empties first | User does Generate All separately | One button = one explicit action |
| Save UX | `dialog.showSaveDialog` | Most flexible; default filename pre-filled |
| Draft annotation | `cell.note = 'draft'` | exceljs native; native Excel comment; visible to recipient |
| Status transition | `mapping → answering → exported`, one-way | Matches existing finalize pattern |
| Effect TS | **Not used** | Single-shot, no orchestration → plain Promise; documents the "when NOT to Effect" lesson |
| New service class? | No — handler orchestrates | Single-responsibility; handler is already the orchestration boundary |

## Risk + rollback

**Risk 1 — `wb.xlsx.load` rejects on malformed/encrypted input.** Mitigation: the original .xlsx was already loaded successfully during upload (parser ran), so if disk corruption hasn't occurred, load will succeed. If it doesn't, the error bubbles to renderer toast.

**Risk 2 — exceljs format-preservation has edge cases.** Cells with rich text formatting (multiple fonts in one cell), shared formulas, or array formulas may have subtle issues. We've tested with synthetic .xlsx in T1 unit tests; real CDP files will tell us in production. Mitigation: the `2026-05-15-excel-library-tradeoffs.md` trigger #2 ("real bug blocks a feature on a customer's real CDP file when we ship 2.2c") fires; we switch to `excelize-wasm` per that doc's migration path.

**Risk 3 — large workbooks.** A 5MB+ .xlsx loaded fully into memory is fine on a desktop; the `wb.xlsx.load()` is synchronous-ish (returns Promise but holds the workbook in memory). For 50MB+ files, exceljs may stutter. Not a v1 concern.

**Risk 4 — file-write fails after dialog accepts** (disk full, permission). The buffer is in memory; `fs.writeFile` rejects, handler throws, renderer toasts. No partial state — status stays at previous value because `markExported` only runs after successful write.

**Rollback:** Four commits (one per task). Revert all four and the export feature disappears; no data migration; no schema change.

## Closeout criteria

- `writeAnswers(bytes, cells)` exists in `src/main/excel/answer-writer.ts` with 3 unit tests.
- `answer:export-to-xlsx` IPC channel + handler + renderer client.
- "Export to Excel" button on detail route.
- 4 i18n keys.
- Status transitions to `'exported'` on successful save.
- 510 → ~514-515 tests passing.
- `pnpm typecheck` clean.
- Full questionnaire feature loop is now closed: upload → parse → extract → review → generate → save → finalize → **export**.

## What this unlocks

After 2.2c lands, **Phase 1 + 2 functional loop is feature-complete** for the questionnaire use case. The remaining gaps are:

- Polish, error UX, edge cases (real-world CDP files surface bugs)
- Performance optimization (only if needed; current data sizes are well under any bottleneck)
- EF Matcher v1 (sub-project 5 — from the long-arc plan; separate concern, separate spec)

Nothing else **architectural** is blocking the user from using the feature end-to-end. Good place to tag a release.
