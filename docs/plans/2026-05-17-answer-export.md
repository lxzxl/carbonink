# Phase 2.2c: Answer Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user export a filled-in .xlsx of the questionnaire — answers written into the original cells, AI-suggested/manual-not-finalized answers marked with a "draft" cell comment, native save dialog, status flips to `'exported'`.

**Architecture:** Pure transform `writeAnswers(bytes, cells)` in `src/main/excel/answer-writer.ts` (no FS / no Electron). IPC handler in `answer.ts` orchestrates DB reads + dialog + FS + status transition. Plain Promise — no Effect (documents "when NOT to Effect"). Reuses existing `exceljs` setup.

**Tech Stack:** `exceljs` (existing, `wb.xlsx.load + writeBuffer`), Electron `dialog.showSaveDialog`, `node:fs/promises`.

**Spec:** `docs/specs/2026-05-17-answer-export-design.md`

**Baseline:** 510 tests on `main` after Effect Step 3 (`790e89a`). Target after 2.2c: ~514-515 tests.

---

## Task 1: `writeAnswers` pure transform + 3 unit tests

**Files:**
- Create: `src/main/excel/answer-writer.ts`
- Create: `tests/main/excel/answer-writer.test.ts`

This task ships ONE pure function. No DB, no FS, no Electron. Buffer in, buffer out. Three unit tests verify the three observable behaviors.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/excel/answer-writer.test.ts`:

```ts
import { writeAnswers } from '@main/excel/answer-writer';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

async function buildFixture(cells: { sheet: string; address: string; value: string | number }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheets = new Map<string, ExcelJS.Worksheet>();
  for (const c of cells) {
    let sheet = sheets.get(c.sheet);
    if (!sheet) {
      sheet = wb.addWorksheet(c.sheet);
      sheets.set(c.sheet, sheet);
    }
    sheet.getCell(c.address).value = c.value;
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function readCell(buffer: Buffer, sheet: string, address: string): Promise<{ value: unknown; note: unknown }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const cell = wb.getWorksheet(sheet)!.getCell(address);
  return { value: cell.value, note: cell.note };
}

describe('writeAnswers', () => {
  it('writes a numeric value into the indicated cell', async () => {
    const original = await buildFixture([{ sheet: 'Sheet1', address: 'A1', value: 'Header' }]);
    const result = await writeAnswers(original, [
      { ref: 'Sheet1!B5', value: '14820', isDraft: false },
    ]);
    const cell = await readCell(result.buffer, 'Sheet1', 'B5');
    expect(cell.value).toBe(14820);
    expect(cell.note).toBeFalsy();
    expect(result.written).toBe(1);
    expect(result.drafts).toBe(0);
  });

  it('attaches a "draft" comment when isDraft=true', async () => {
    const original = await buildFixture([{ sheet: 'Sheet1', address: 'A1', value: 'Header' }]);
    const result = await writeAnswers(original, [
      { ref: 'Sheet1!C3', value: 'Beijing', isDraft: true },
    ]);
    const cell = await readCell(result.buffer, 'Sheet1', 'C3');
    expect(cell.value).toBe('Beijing');
    expect(cell.note).toBe('draft');
    expect(result.drafts).toBe(1);
  });

  it('silently skips malformed refs and missing sheets', async () => {
    const original = await buildFixture([{ sheet: 'Sheet1', address: 'A1', value: 'Header' }]);
    const result = await writeAnswers(original, [
      { ref: 'NoSuchSheet!B5', value: 'x', isDraft: false },
      { ref: 'bad-ref', value: 'y', isDraft: false },
      { ref: 'Sheet1!D1', value: '42', isDraft: false },
    ]);
    expect(result.written).toBe(1); // only the valid one
    const cell = await readCell(result.buffer, 'Sheet1', 'D1');
    expect(cell.value).toBe(42);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/excel/answer-writer.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@main/excel/answer-writer'`.

- [ ] **Step 3: Implement**

Create `src/main/excel/answer-writer.ts`:

```ts
import ExcelJS from 'exceljs';

export interface AnswerCell {
  ref: string;
  value: string;
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
  // ExcelJS expects ArrayBuffer; Buffer works at runtime via the structural overlap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(originalBytes as any);

  let written = 0;
  let drafts = 0;

  for (const cell of cells) {
    const [sheetName, address] = cell.ref.split('!');
    if (!sheetName || !address) continue;
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) continue;
    const xlCell = sheet.getCell(address);

    const numeric = Number(cell.value);
    const isNumber = Number.isFinite(numeric) && cell.value.trim() !== '';
    xlCell.value = isNumber ? numeric : cell.value;

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

**Implementation notes:**
- The `as any` cast on `wb.xlsx.load(originalBytes)` is intentional — ExcelJS's type definition is overly strict; Buffer works at runtime. The parser at `src/main/excel/parser.ts` uses the same workaround.
- The numeric-coercion test (`Number.isFinite(numeric) && trim() !== ''`) is necessary because `Number('')` is `0` and `Number('  ')` is `0` — we DON'T want to coerce empty strings to zero.
- Sheet name lookup is **case-sensitive** in exceljs. `question.position` is generated by the parser which preserves the original sheet name casing, so this should match.

- [ ] **Step 4: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -5
pnpm vitest run tests/main/excel/answer-writer.test.ts --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean, 3/3 tests pass.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/excel/answer-writer.ts tests/main/excel/answer-writer.test.ts
git commit -m "feat(excel): writeAnswers — pure transform writing answers back into .xlsx"
git branch --show-current
```

Expected: 513 tests passing (510 + 3), branch `main`.

---

## Task 2: IPC channel + handler + renderer client + service hook

**Files:**
- Modify: `src/main/services/questionnaire-service.ts` — add `markExported(id)` and a `listQuestions(questionnaireId)` if not already there
- Modify: `src/main/ipc/types.ts` — add `answer:export-to-xlsx` channel
- Modify: `src/main/ipc/handlers/answer.ts` — new handler orchestrating DB + dialog + FS
- Modify: `src/preload/bridge.ts` — allowlist
- Modify: `tests/preload/bridge.test.ts` — allowlist assertion
- Modify: `src/renderer/lib/api/answer.ts` — `exportToXlsx`
- Modify: `tests/main/ipc/answer-handlers.test.ts` — 1 test for the handler with mocked dialog/fs/services
- Possibly modify: `tests/main/services/questionnaire-service.test.ts` — 1 test for `markExported`

- [ ] **Step 0: Reconnaissance**

Read these to understand existing shapes:
```
src/main/services/questionnaire-service.ts   (finalizeAnswering is the precedent for markExported)
src/main/services/document-service.ts        (getById; storage_path field)
src/main/ipc/context.ts                       (where dialog access happens — likely already imports from electron)
src/main/ipc/handlers/answer.ts               (existing 4 answer:* handlers; reuse qidInput zod schema)
tests/main/ipc/answer-handlers.test.ts        (makeCtx pattern, FAKE_ANSWER, vi.mock factory)
src/main/db/migrations/005_questionnaire.sql  (status CHECK enum already has 'exported')
```

Specifically check:
- Does `QuestionnaireService` have `listQuestions(questionnaireId)` already? If yes, reuse. If not, add it (it's the query that returns all rows from `question` table for a questionnaire — should already exist for the questionnaire detail route).
- Where does the IPC handler get `dialog` from? Electron's `dialog` is imported from `'electron'`. We need to import it inside the handler (or pass it through `IpcContext` as a mockable slot — choose whichever the codebase already uses).
- The existing handler test stubs `answerLayer` and `providerConfig` on `makeCtx`. For T2 we additionally need stubs for `questionnaireService.getById/markExported/listQuestions`, `documentService.getById`, and a stubbed `dialog.showSaveDialog` + `fs.readFile/writeFile`.

- [ ] **Step 1: Add `markExported` (and `listQuestions` if missing) to `QuestionnaireService`**

```ts
markExported(id: string): void {
  this.deps.db.prepare(`UPDATE questionnaire SET status = 'exported' WHERE id = ?`).run(id);
}
```

If `listQuestions` doesn't exist, add (mirror existing methods):

```ts
listQuestions(questionnaireId: string): Question[] {
  return this.deps.db
    .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position`)
    .all(questionnaireId) as Question[];
}
```

Add a small service-level test if practical:

```ts
it('markExported sets status to exported', () => {
  // seed questionnaire in mapping or answering state, call markExported, assert status='exported'
});
```

- [ ] **Step 2: Add IpcTypeMap entry**

```ts
'answer:export-to-xlsx': (input: { questionnaire_id: string }) => Promise<
  | { canceled: true }
  | { canceled: false; path: string; written: number; drafts: number }
>;
```

- [ ] **Step 3: Write the failing handler test**

Append to `tests/main/ipc/answer-handlers.test.ts`. The test needs to mock:
- Electron `dialog` module
- `node:fs/promises`
- The service methods (`questionnaireService.getById`, `documentService.getById`, `questionnaireService.listQuestions`, `questionnaireService.markExported`)
- `answerSvc.listByQuestionnaire` (already mocked from earlier tasks)
- `writeAnswers` (mocked at module level — easiest)

Add module mocks at top of file (alongside existing `vi.mock('@main/services/answer-generation', ...)`):

```ts
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock('@main/excel/answer-writer', () => ({
  writeAnswers: vi.fn(),
}));
```

Then add the test:

```ts
import { dialog } from 'electron';
import * as fs from 'node:fs/promises';
import { writeAnswers } from '@main/excel/answer-writer';

it('answer:export-to-xlsx writes the buffer and marks exported', async () => {
  const ctx = makeCtx();
  // Stub service methods on the ctx
  const questionnaireService = {
    getById: vi.fn().mockReturnValue({ id: 'qn-1', document_id: 'doc-1', status: 'answering' }),
    listQuestions: vi.fn().mockReturnValue([
      { id: 'q-1', position: 'Sheet1!B5' },
      { id: 'q-2', position: 'Sheet1!C3' },
    ]),
    markExported: vi.fn(),
  };
  const documentService = {
    getById: vi.fn().mockReturnValue({ id: 'doc-1', filename: 'cdp.xlsx', storage_path: '/tmp/cdp.xlsx' }),
  };
  Object.assign(ctx, { questionnaireService, documentService });

  vi.mocked(answerSvc.listByQuestionnaire).mockReturnValue(
    Effect.succeed([
      { question_id: 'q-1', value: '14820', finalized_at: '2026-01-01' },
      { question_id: 'q-2', value: 'Beijing', finalized_at: null },
    ]) as never,
  );
  vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('originalbytes'));
  vi.mocked(writeAnswers).mockResolvedValue({
    buffer: Buffer.from('outbytes'),
    written: 2,
    drafts: 1,
  });
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({
    canceled: false,
    filePath: '/tmp/out.xlsx',
  } as never);
  vi.mocked(fs.writeFile).mockResolvedValue(undefined);

  const handlers = answerHandlers(ctx);
  const result = await handlers['answer:export-to-xlsx']!({ questionnaire_id: 'qn-1' });

  expect(result).toEqual({
    canceled: false,
    path: '/tmp/out.xlsx',
    written: 2,
    drafts: 1,
  });
  expect(writeAnswers).toHaveBeenCalledWith(
    expect.any(Buffer),
    [
      { ref: 'Sheet1!B5', value: '14820', isDraft: false },
      { ref: 'Sheet1!C3', value: 'Beijing', isDraft: true },
    ],
  );
  expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.xlsx', expect.any(Buffer));
  expect(questionnaireService.markExported).toHaveBeenCalledWith('qn-1');
});

it('answer:export-to-xlsx returns { canceled: true } when user cancels the dialog', async () => {
  const ctx = makeCtx();
  Object.assign(ctx, {
    questionnaireService: {
      getById: vi.fn().mockReturnValue({ id: 'qn-1', document_id: 'doc-1' }),
      listQuestions: vi.fn().mockReturnValue([]),
      markExported: vi.fn(),
    },
    documentService: {
      getById: vi.fn().mockReturnValue({ id: 'doc-1', filename: 'x.xlsx', storage_path: '/tmp/x.xlsx' }),
    },
  });
  vi.mocked(answerSvc.listByQuestionnaire).mockReturnValue(Effect.succeed([]) as never);
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never);

  const handlers = answerHandlers(ctx);
  const result = await handlers['answer:export-to-xlsx']!({ questionnaire_id: 'qn-1' });

  expect(result).toEqual({ canceled: true });
  expect(ctx.questionnaireService.markExported).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/ipc/answer-handlers.test.ts --pool=threads 2>&1 | tail -15
```

Expected: 2 new tests fail (handler doesn't exist).

- [ ] **Step 5: Implement handler**

Open `src/main/ipc/handlers/answer.ts`. Add imports:

```ts
import { dialog } from 'electron';
import * as fs from 'node:fs/promises';
import { writeAnswers, type AnswerCell } from '@main/excel/answer-writer';
```

Add the handler entry inside `answerHandlers(ctx)`:

```ts
    'answer:export-to-xlsx': async (input) => {
      const parsed = qidInput.parse(input);

      const questionnaire = ctx.questionnaireService.getById(parsed.questionnaire_id);
      if (!questionnaire) throw new Error('Questionnaire not found');
      const document = ctx.documentService.getById(questionnaire.document_id);
      if (!document) throw new Error('Document not found');

      const answers = await Effect.runPromise(
        answerSvc
          .listByQuestionnaire(parsed.questionnaire_id)
          .pipe(Effect.provide(ctx.answerLayer)),
      );
      const questions = ctx.questionnaireService.listQuestions(parsed.questionnaire_id);
      const questionById = new Map(questions.map((q) => [q.id, q]));

      const cells: AnswerCell[] = answers.flatMap((a) => {
        const q = questionById.get(a.question_id);
        if (!q?.position) return [];
        return [{ ref: q.position, value: a.value, isDraft: a.finalized_at == null }];
      });

      const defaultName = document.filename.replace(/\.xlsx$/i, '') + '_filled.xlsx';
      const dialogResult = await dialog.showSaveDialog({
        title: 'Export answered questionnaire',
        defaultPath: defaultName,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { canceled: true as const };
      }

      const originalBytes = await fs.readFile(document.storage_path);
      const { buffer, written, drafts } = await writeAnswers(originalBytes, cells);
      await fs.writeFile(dialogResult.filePath, buffer);

      ctx.questionnaireService.markExported(parsed.questionnaire_id);

      return {
        canceled: false as const,
        path: dialogResult.filePath,
        written,
        drafts,
      };
    },
```

**Important:** the `IpcContext` type needs to expose `questionnaireService` and `documentService` if they aren't already. Read `context.ts` — they almost certainly are (existing handlers use them). If only used via the older lazy-getter pattern, ensure the field is on the type.

- [ ] **Step 6: Allowlist + renderer client + bridge test**

a) `src/preload/bridge.ts` — add `'answer:export-to-xlsx'` to allowlist.

b) `tests/preload/bridge.test.ts` — update allowlist assertion.

c) `src/renderer/lib/api/answer.ts`:

```ts
  exportToXlsx: (input: { questionnaire_id: string }) =>
    invoke('answer:export-to-xlsx', input),
```

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean, ~515 tests passing (513 + 2 handler tests, +/- the service-level markExported test).

Failure modes:
- `electron` mocking issues: if `vi.mock('electron', ...)` doesn't intercept, the test environment is fine because `electron` isn't actually loaded outside of E2E. If you see import errors, ensure the mock factory matches all the exports the file uses.
- `fs/promises` mocking: same — `vi.mock('node:fs/promises', ...)` should intercept.
- TypeScript narrowing on the discriminated union return: the type `{ canceled: true } | { canceled: false; path; written; drafts }` should narrow on `result.canceled`. If TS won't narrow, add explicit type annotations.
- ABI flip recovery: `rm /Users/lxz/ws/personal/carbonbook/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && pnpm rebuild better-sqlite3` then retry.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add -A
git commit -m "feat(ipc): answer:export-to-xlsx channel — read-modify-write + save dialog + markExported"
git branch --show-current
```

---

## Task 3: "Export to Excel" button + i18n + smoke test

**Files:**
- Modify: `src/renderer/routes/questionnaires.$id.tsx`
- Modify: `messages/en.json` + `messages/zh-CN.json` — 3 i18n keys (export-canceled is unused per spec; skip)
- Modify: `tests/renderer/questionnaires-detail.test.tsx` — add 1 smoke test + extend the `answerApi` mock

- [ ] **Step 1: Add i18n keys**

`messages/en.json` + `messages/zh-CN.json` (alphabetically near other `answer_*` keys):

```
answer_export_button     "Export to Excel"                                            / "导出 Excel"
answer_export_running    "Exporting…"                                                 / "导出中…"
answer_export_done       "{written} answers written ({drafts} drafts)."               / "已写入 {written} 条答案（其中 {drafts} 条草稿）。"
```

If your paraglide setup needs manual compile, run `npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide` per the T4 of Step 3.

- [ ] **Step 2: Add mutation + button to route**

In `src/renderer/routes/questionnaires.$id.tsx`, near the existing `generateAll` and `finalizeMutation`:

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

Place the button NEXT TO the existing buttons. Suggested order in the toolbar: `[Generate all unanswered] [Export to Excel] [Finalize answers]` — left-to-right matches the user's mental workflow (generate → export → finalize), though the buttons aren't strictly sequential.

- [ ] **Step 3: Extend the renderer test mock + add smoke test**

`tests/renderer/questionnaires-detail.test.tsx`:

Update the `answerApi` mock to include `exportToXlsx`:

```ts
vi.mock('@renderer/lib/api/answer', () => ({
  answerApi: {
    generate: vi.fn(),
    save: vi.fn(),
    listByQuestionnaire: vi.fn().mockResolvedValue([]),
    generateAllUnanswered: vi.fn(),
    exportToXlsx: vi.fn(),
  },
}));
```

Append a smoke test:

```ts
it('renders Export to Excel button', async () => {
  vi.mocked(questionnaireApi.getById).mockResolvedValue({
    questionnaire: FAKE_QUESTIONNAIRE,
    customer: FAKE_CUSTOMER,
    document: FAKE_DOCUMENT,
    questions: FAKE_QUESTIONS,
  });
  render(buildHarness());
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /export to excel|导出 excel/i })).toBeTruthy();
  });
});
```

- [ ] **Step 4: Verify + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/questionnaires-detail.test.tsx --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -5
git add -A
git commit -m "feat(ui): Export to Excel button on questionnaire detail page"
git branch --show-current
```

Expected: ~516 tests passing.

---

## Task 4: Sweep + verification

- [ ] **Step 1: Full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```

- [ ] **Step 2: typecheck + format + lint**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -3
```

- [ ] **Step 3: Final commit + history**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A
git commit -m "chore: biome sweep for Phase 2.2c" || true
git log --oneline -12
git branch --show-current
```

---

## Closeout

Phase 2.2c lands on `main`:

- `writeAnswers(bytes, cells)` — pure transform, 3 unit tests.
- `answer:export-to-xlsx` IPC + handler with native save dialog + draft annotations.
- "Export to Excel" button on detail page.
- Status transitions to `'exported'` on successful save.
- ~516 tests, typecheck + lint clean.

**The Phase 1+2 questionnaire feature loop is complete:**
upload → parse → extract → review → generate (single / bulk) → save → finalize → **export**

The recipient gets back THEIR original .xlsx with answers filled in, draft cells marked with native Excel comments.

**Three takeaways from this sub-project:**

1. **"When NOT to use Effect."** Single-shot, no concurrency, no retry, no orchestration that spans multiple async branches → plain Promise is simpler, faster to read, easier to test. Effect for complex orchestration; Promise for single-shot side effects.
2. **Pure transform + thin handler is the cleanest IPC pattern.** The handler does I/O (DB, dialog, FS); the transform is pure. Tests are easier because the transform can be checked with synthetic inputs.
3. **Read-modify-write preserves user trust.** Recipients of CDP questionnaires expect their formatting back. exceljs's `wb.xlsx.load + writeBuffer` is byte-faithful except for cells we touch — the right tradeoff for v1.

**Next sub-projects (not in this plan):**
- Polish: real-world CDP file edge cases will surface; revisit the excel-library trigger doc.
- EF Matcher v1 (sub-project from the long-arc plan).
