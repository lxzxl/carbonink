# Questionnaire PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Export PDF" button on `/questionnaires/$id` that produces a sheet-grouped Q&A PDF (cover + TOC + per-sheet sections). Reuses the hidden BrowserWindow + `printToPDF` infrastructure pattern from sub-project 1 (ISO 14064-1 report).

**Architecture:** New `QuestionnairePdfDataService` (pure read assembling questions grouped by sheet). New `<QuestionnairePdfPreview>` React component. New `/print-render` route in the renderer with a payload-kind discriminator — `'inventory_report' | 'questionnaire_pdf'` — so both PDF exports share the same hidden-window plumbing. New `ReportExportService.renderQuestionnairePdf` parallels `renderReportPdf`. One IPC channel `questionnaire:export-pdf`.

**Tech Stack:** TypeScript strict, React 18, Electron 41 `BrowserWindow.printToPDF`, TanStack Query, better-sqlite3, vitest, paraglide i18n.

**Spec:** `docs/specs/2026-05-20-questionnaire-pdf-export-design.md` (commit `627bfc8`).

**Baseline:** 605 tests on `main`. Target after this sub-project: ~610 tests.

**Sub-project context:** This is sub-project 4 of 4 in Phase 3. **After this lands, Phase 3 is fully done** — the long-arc `/goal 完成所有phase功能` is satisfied.

**Critical finding from recon:** The `/print-render` route was REFERENCED by sub-project 1 (ISO 14064-1 report) but NEVER CREATED. The URL is wired in `src/main/ipc/setup.ts`, but no React route file exists at `src/renderer/routes/print-render.tsx`. As a result, the ISO 14064-1 PDF export is currently non-functional. This sub-project CREATES that route, with a payload-kind discriminator from the start, fixing the ISO export as a side-benefit.

**Recurring environmental hazard:** better-sqlite3 ABI flip. If 184+ tests fail with `NODE_MODULE_VERSION 145`:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
```

Environmental, not a regression.

**Discipline reminder for implementers:** Before final commit on each task, `git status` must show clean working tree (only `.claude/` untracked). `git add -A && git restore --staged .claude` before committing.

---

## Task 1: `QuestionnairePdfDataService` + types + tests

**Files:**
- Create: `src/main/services/questionnaire-pdf-data-service.ts`
- Modify: `src/shared/types.ts` — add `QuestionnairePdfData`
- Create: `tests/main/services/questionnaire-pdf-data-service.test.ts`

Pure read-side query layer. Assembles the questionnaire payload grouped by sheet, with questions sorted by cell position within each sheet. Null-position questions bucket into a synthetic "Unspecified" sheet.

- [ ] **Step 1: Add `QuestionnairePdfData` type**

In `src/shared/types.ts`, add (near other questionnaire-related types):

```ts
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
  sheets: Array<{
    sheet_name: string;
    questions: Array<{
      id: string;
      position: string | null;
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
      } | null;
    }>;
  }>;
  language: 'zh-CN' | 'en';
};
```

- [ ] **Step 2: Write the failing service tests**

Create `tests/main/services/questionnaire-pdf-data-service.test.ts`:

```ts
import { QuestionnairePdfDataService } from '@main/services/questionnaire-pdf-data-service';
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function seedQuestionnaire(db: Database.Database) {
  // Org / site / customer / document / questionnaire / 4 questions / 2 answers
  db.prepare(
    `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
     VALUES ('org-1', '测试', 'CN', 'operational_control', '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO customer (id, name, notes) VALUES ('cust-1', 'Acme Corp', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO document (id, filename, mime_type, storage_path, sha256, byte_size, doc_type, uploaded_at)
     VALUES ('doc-1', 'cdp.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       '/tmp/cdp.xlsx', 'aabb', 1024, 'questionnaire', '2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO questionnaire (id, customer_id, document_id, template_kind, reporting_year,
       status, due_date, created_at)
     VALUES ('qn-1', 'cust-1', 'doc-1', NULL, 2025, 'answering', '2025-12-31', '2025-06-01')`,
  ).run();
  // 4 questions: 2 in Sheet1 (B5 then A3 — out-of-order to test sort),
  // 1 in Sheet2 (C2), 1 with position=null.
  db.prepare(
    `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
       normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required)
     VALUES
     ('q-1', 'qn-1', 'sig-1', 'v1', '总员工人数', 'Total employees', 'count of employees',
       'numerical', '人', 'Sheet1!B5', 1),
     ('q-2', 'qn-1', 'sig-2', 'v1', '公司行业', 'Company industry', NULL,
       'categorical', NULL, 'Sheet1!A3', 1),
     ('q-3', 'qn-1', 'sig-3', 'v1', '业务概述', 'Business overview', NULL,
       'narrative', NULL, 'Sheet2!C2', 0),
     ('q-4', 'qn-1', 'sig-4', 'v1', '杂项问题', 'Misc question', NULL,
       'categorical', NULL, NULL, 0)`,
  ).run();
  // 2 answers (q-1 finalized, q-2 draft). q-3 and q-4 have no answer.
  db.prepare(
    `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
     VALUES
     ('a-1', 'q-1', '320', '人', 'manual', NULL, '2026-05-01T00:00:00Z'),
     ('a-2', 'q-2', 'Manufacturing', NULL, 'ai_suggested', '{"hint": "from doc"}', NULL)`,
  ).run();
}

describe('QuestionnairePdfDataService.assemble', () => {
  it('groups questions by sheet and sorts by cell position within each sheet', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedQuestionnaire(db);
    const svc = new QuestionnairePdfDataService({ db });
    const data = svc.assemble({ questionnaire_id: 'qn-1', language: 'zh-CN' });

    expect(data.customer.name).toBe('Acme Corp');
    expect(data.questionnaire.reporting_year).toBe(2025);
    expect(data.document.filename).toBe('cdp.xlsx');
    // Two real sheets + one "Unspecified" synthetic sheet at the end
    expect(data.sheets.map((s) => s.sheet_name)).toEqual([
      'Sheet1',
      'Sheet2',
      '未指定',
    ]);
    // Sheet1 has q-2 (A3) before q-1 (B5)
    expect(data.sheets[0].questions.map((q) => q.id)).toEqual(['q-2', 'q-1']);
    // Sheet2 has just q-3
    expect(data.sheets[1].questions.map((q) => q.id)).toEqual(['q-3']);
    // Unspecified has q-4
    expect(data.sheets[2].questions.map((q) => q.id)).toEqual(['q-4']);
  });

  it('uses "Unspecified" sheet name in English when language is en', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedQuestionnaire(db);
    const svc = new QuestionnairePdfDataService({ db });
    const data = svc.assemble({ questionnaire_id: 'qn-1', language: 'en' });
    const names = data.sheets.map((s) => s.sheet_name);
    expect(names).toContain('Unspecified');
    expect(names).not.toContain('未指定');
  });

  it('attaches answer rows to questions; null when no answer', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedQuestionnaire(db);
    const svc = new QuestionnairePdfDataService({ db });
    const data = svc.assemble({ questionnaire_id: 'qn-1', language: 'zh-CN' });
    const allQuestions = data.sheets.flatMap((s) => s.questions);

    const q1 = allQuestions.find((q) => q.id === 'q-1')!;
    expect(q1.answer).not.toBeNull();
    expect(q1.answer!.value).toBe('320');
    expect(q1.answer!.finalized_at).toBe('2026-05-01T00:00:00Z');

    const q2 = allQuestions.find((q) => q.id === 'q-2')!;
    expect(q2.answer).not.toBeNull();
    expect(q2.answer!.value).toBe('Manufacturing');
    expect(q2.answer!.finalized_at).toBeNull(); // draft

    const q3 = allQuestions.find((q) => q.id === 'q-3')!;
    expect(q3.answer).toBeNull();

    const q4 = allQuestions.find((q) => q.id === 'q-4')!;
    expect(q4.answer).toBeNull();
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/questionnaire-pdf-data-service.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@main/services/questionnaire-pdf-data-service'`.

- [ ] **Step 4: Implement the service**

Create `src/main/services/questionnaire-pdf-data-service.ts`:

```ts
import type Database from 'better-sqlite3';
import type { QuestionnairePdfData } from '@shared/types.js';

export interface QuestionnairePdfDataDeps {
  db: Database.Database;
}

interface QuestionRow {
  id: string;
  position: string | null;
  raw_text: string;
  normalized_text: string;
  parsed_intent: string | null;
  question_kind: 'numerical' | 'categorical' | 'narrative';
  expected_unit: string | null;
}

interface AnswerRow {
  question_id: string;
  value: string;
  unit: string | null;
  finalized_at: string | null;
  source_summary: string | null;
}

/**
 * Parse an Excel cell address like 'B5' into a sortable tuple (rowNumber, columnIndex).
 * Returns null when the address is malformed.
 */
function parseCellAddress(addr: string): { row: number; col: number } | null {
  const m = addr.match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const letters = m[1].toUpperCase();
  const row = Number(m[2]);
  // Convert 'A'→1, 'B'→2, ..., 'Z'→26, 'AA'→27, ...
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row, col };
}

/** Parse 'Sheet1!B5' into { sheet: 'Sheet1', addr: 'B5' }; null on malformed. */
function parsePosition(position: string): { sheet: string; addr: string } | null {
  const idx = position.indexOf('!');
  if (idx <= 0 || idx === position.length - 1) return null;
  return { sheet: position.slice(0, idx), addr: position.slice(idx + 1) };
}

export class QuestionnairePdfDataService {
  constructor(private deps: QuestionnairePdfDataDeps) {}

  assemble(input: {
    questionnaire_id: string;
    language: 'zh-CN' | 'en';
  }): QuestionnairePdfData {
    const questionnaireRow = this.deps.db
      .prepare(
        `SELECT id, customer_id, document_id, template_kind, reporting_year, status, due_date, created_at
           FROM questionnaire WHERE id = ?`,
      )
      .get(input.questionnaire_id) as
      | undefined
      | {
          id: string;
          customer_id: string;
          document_id: string;
          template_kind: string | null;
          reporting_year: number;
          status: 'parsing' | 'mapping' | 'answering' | 'exported';
          due_date: string | null;
          created_at: string;
        };
    if (!questionnaireRow) {
      throw new Error(`questionnaire not found: ${input.questionnaire_id}`);
    }

    const customerRow = this.deps.db
      .prepare(`SELECT id, name FROM customer WHERE id = ?`)
      .get(questionnaireRow.customer_id) as { id: string; name: string };

    const documentRow = this.deps.db
      .prepare(`SELECT id, filename FROM document WHERE id = ?`)
      .get(questionnaireRow.document_id) as { id: string; filename: string };

    const questionRows = this.deps.db
      .prepare(
        `SELECT id, position, raw_text, normalized_text, parsed_intent, question_kind, expected_unit
           FROM question WHERE questionnaire_id = ?`,
      )
      .all(input.questionnaire_id) as QuestionRow[];

    const answerRows = this.deps.db
      .prepare(
        `SELECT question_id, value, unit, finalized_at, source_summary
           FROM answer WHERE question_id IN (${questionRows.map(() => '?').join(', ') || `''`})`,
      )
      .all(...questionRows.map((q) => q.id)) as AnswerRow[];
    const answerByQid = new Map(answerRows.map((a) => [a.question_id, a]));

    // Group by sheet, sort within sheet, preserve sheet first-seen order.
    const sheetOrder: string[] = [];
    const sheetGroups = new Map<string, QuestionRow[]>();
    const unspecifiedKey = '__unspecified__';
    for (const q of questionRows) {
      let key: string;
      if (q.position == null) {
        key = unspecifiedKey;
      } else {
        const parsed = parsePosition(q.position);
        key = parsed ? parsed.sheet : unspecifiedKey;
      }
      if (!sheetGroups.has(key)) {
        sheetOrder.push(key);
        sheetGroups.set(key, []);
      }
      sheetGroups.get(key)!.push(q);
    }

    // Sort each sheet's questions by cell address (row asc, col asc).
    for (const [key, list] of sheetGroups) {
      list.sort((a, b) => {
        if (key === unspecifiedKey) return 0;
        const ap = a.position ? parseCellAddress(parsePosition(a.position)?.addr ?? '') : null;
        const bp = b.position ? parseCellAddress(parsePosition(b.position)?.addr ?? '') : null;
        if (!ap && !bp) return 0;
        if (!ap) return 1;
        if (!bp) return -1;
        if (ap.row !== bp.row) return ap.row - bp.row;
        return ap.col - bp.col;
      });
    }

    // Ensure unspecified bucket comes last.
    const realSheets = sheetOrder.filter((k) => k !== unspecifiedKey);
    const hasUnspecified = sheetOrder.includes(unspecifiedKey);

    const unspecifiedLabel = input.language === 'zh-CN' ? '未指定' : 'Unspecified';
    const sheets = realSheets.map((sheetName) => ({
      sheet_name: sheetName,
      questions: sheetGroups.get(sheetName)!.map((q) => ({
        id: q.id,
        position: q.position,
        raw_text: q.raw_text,
        normalized_text: q.normalized_text,
        parsed_intent: q.parsed_intent,
        question_kind: q.question_kind,
        expected_unit: q.expected_unit,
        answer: this.mapAnswer(answerByQid.get(q.id)),
      })),
    }));
    if (hasUnspecified) {
      sheets.push({
        sheet_name: unspecifiedLabel,
        questions: sheetGroups.get(unspecifiedKey)!.map((q) => ({
          id: q.id,
          position: q.position,
          raw_text: q.raw_text,
          normalized_text: q.normalized_text,
          parsed_intent: q.parsed_intent,
          question_kind: q.question_kind,
          expected_unit: q.expected_unit,
          answer: this.mapAnswer(answerByQid.get(q.id)),
        })),
      });
    }

    return {
      customer: { name: customerRow.name },
      questionnaire: {
        id: questionnaireRow.id,
        reporting_year: questionnaireRow.reporting_year,
        due_date: questionnaireRow.due_date,
        created_at: questionnaireRow.created_at,
        status: questionnaireRow.status,
      },
      document: { filename: documentRow.filename },
      sheets,
      language: input.language,
    };
  }

  private mapAnswer(row: AnswerRow | undefined): QuestionnairePdfData['sheets'][number]['questions'][number]['answer'] {
    if (!row) return null;
    return {
      value: row.value,
      unit: row.unit,
      finalized_at: row.finalized_at,
      source_summary: row.source_summary,
    };
  }
}
```

- [ ] **Step 5: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/services/questionnaire-pdf-data-service.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 3/3 new tests pass; ~608 total (605 + 3).

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(questionnaire): QuestionnairePdfDataService — sheet-grouped Q&A assembly"
git log --oneline -3
git branch --show-current
```

---

## Task 2: IPC channel + handler + bridge allowlist

**Files:**
- Modify: `src/main/ipc/types.ts`
- Modify: `src/main/ipc/handlers/questionnaire.ts` (or create — confirm via `ls src/main/ipc/handlers/`)
- Modify: `src/main/ipc/context.ts` — add `questionnairePdfDataService`
- Modify: `src/main/ipc/setup.ts` — register the handler
- Modify: `src/preload/bridge.ts` — allowlist `questionnaire:export-pdf`
- Modify: `tests/preload/bridge.test.ts` — allowlist assertion
- Create: `tests/main/ipc/questionnaire-export-pdf-handler.test.ts`
- Modify: `src/renderer/lib/api/questionnaire.ts` — add `exportPdf`

The handler shape mirrors `report:export-pdf` (sub-project 1, in `src/main/ipc/handlers/report.ts`).

- [ ] **Step 1: Extend IpcTypeMap**

Edit `src/main/ipc/types.ts`. In the questionnaire domain section, add:

```ts
  'questionnaire:export-pdf': (input: {
    questionnaire_id: string;
    language: 'zh-CN' | 'en';
  }) => Promise<
    | { canceled: true }
    | { ok: true; path: string }
    | { ok: false; error: string }
  >;
```

- [ ] **Step 2: Write the failing handler test**

Recon: `cat src/main/ipc/handlers/questionnaire.ts` to understand the existing test mock pattern (vi.mock factories for `electron`, `node:fs/promises`).

Create `tests/main/ipc/questionnaire-export-pdf-handler.test.ts`:

```ts
import { questionnaireHandlers } from '@main/ipc/handlers/questionnaire';
import type { IpcContext } from '@main/ipc/context';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn() },
}));
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}));
vi.mock('@main/services/report-export-service', () => ({
  renderQuestionnairePdf: vi.fn(),
  // Keep other exports too if the file is shared by sub-project 1 — at minimum:
  renderReportPdf: vi.fn(),
  writeAppendixXlsx: vi.fn(),
  slugifyOrgName: () => 'acme-corp',
  defaultExportFilename: () => 'acme-corp-iso-14064-1-2025-en.pdf',
}));

import { dialog } from 'electron';
import * as fs from 'node:fs/promises';
import { renderQuestionnairePdf } from '@main/services/report-export-service';

function makeCtx() {
  return {
    questionnairePdfDataService: {
      assemble: vi.fn().mockReturnValue({
        customer: { name: 'Acme' },
        questionnaire: { id: 'qn-1', reporting_year: 2025, due_date: null, created_at: '2025-01-01', status: 'answering' },
        document: { filename: 'cdp.xlsx' },
        sheets: [],
        language: 'zh-CN',
      }),
    },
    printRenderUrl: 'http://localhost:5173/print-render',
  } as unknown as IpcContext;
}

describe('questionnaire:export-pdf handler', () => {
  it('writes PDF to disk on save dialog confirm', async () => {
    const ctx = makeCtx();
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.pdf',
    } as never);
    vi.mocked(renderQuestionnairePdf).mockResolvedValue(Buffer.from('pdfdata'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const handlers = questionnaireHandlers(ctx);
    const result = await handlers['questionnaire:export-pdf']!({
      questionnaire_id: 'qn-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ ok: true, path: '/tmp/out.pdf' });
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.pdf', expect.any(Buffer));
  });

  it('returns canceled when user cancels save dialog', async () => {
    const ctx = makeCtx();
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    } as never);
    const handlers = questionnaireHandlers(ctx);
    const result = await handlers['questionnaire:export-pdf']!({
      questionnaire_id: 'qn-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ canceled: true });
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/ipc/questionnaire-export-pdf-handler.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — handler doesn't exist OR `renderQuestionnairePdf` not exported.

- [ ] **Step 4: Implement the handler**

Open `src/main/ipc/handlers/questionnaire.ts`. Add the handler entry inside `questionnaireHandlers(ctx)`:

```ts
import { dialog } from 'electron';
import * as fs from 'node:fs/promises';
import { renderQuestionnairePdf } from '@main/services/report-export-service';
import { z } from 'zod';

const exportPdfInput = z.object({
  questionnaire_id: z.string().min(1),
  language: z.enum(['zh-CN', 'en']),
});

// Inside the existing handlers map:
    'questionnaire:export-pdf': async (rawInput) => {
      const input = exportPdfInput.parse(rawInput);
      const data = ctx.questionnairePdfDataService.assemble({
        questionnaire_id: input.questionnaire_id,
        language: input.language,
      });

      const slug = (data.customer.name || 'questionnaire')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'questionnaire';
      const defaultPath = `${slug}-questionnaire-${data.questionnaire.reporting_year}-${input.language}.pdf`;

      const result = await dialog.showSaveDialog({
        title: 'Export questionnaire (PDF)',
        defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true as const };
      }
      try {
        const buf = await renderQuestionnairePdf(
          { data, language: input.language },
          { printRenderUrl: ctx.printRenderUrl },
        );
        await fs.writeFile(result.filePath, buf);
        return { ok: true as const, path: result.filePath };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    },
```

If the handlers file doesn't already import `dialog`, `fs`, etc., add them at the top.

- [ ] **Step 5: Wire `questionnairePdfDataService` into context**

Edit `src/main/ipc/context.ts`. Add:

```ts
import { QuestionnairePdfDataService } from '@main/services/questionnaire-pdf-data-service';

// In IpcContext interface:
  questionnairePdfDataService: QuestionnairePdfDataService;

// In the construction site (near reportDataService instantiation):
  const questionnairePdfDataService = new QuestionnairePdfDataService({ db });
// And add to the returned context object.
```

- [ ] **Step 6: Allowlist + renderer client**

Edit `src/preload/bridge.ts`. In the questionnaire domain section of `allowedChannels`, add:

```ts
  'questionnaire:export-pdf',
```

Edit `tests/preload/bridge.test.ts`. Extend the allowlist assertion's questionnaire-domain group with the new channel.

Edit `src/renderer/lib/api/questionnaire.ts` (find via `grep -n "questionnaire:" src/renderer/lib/api/`). Add:

```ts
  exportPdf: (input: { questionnaire_id: string; language: 'zh-CN' | 'en' }) =>
    invoke('questionnaire:export-pdf', input),
```

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/ipc/questionnaire-export-pdf-handler.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run tests/preload/bridge.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean (note: `renderQuestionnairePdf` is currently mocked but doesn't exist in `report-export-service.ts` yet — Task 4 adds it. If typecheck fails on the import, defer the wiring lines that reference it until Task 4. Or stub `renderQuestionnairePdf` in `report-export-service.ts` now as `throw new Error('Implemented in Task 4')` so typecheck passes and the test stays meaningful.); 2/2 handler tests pass; ~610 total.

Concrete recommendation: add the stub now:

```ts
// At the bottom of src/main/services/report-export-service.ts, before the closing of the file
export async function renderQuestionnairePdf(
  args: { data: import('@shared/types.js').QuestionnairePdfData; language: 'zh-CN' | 'en' },
  deps: { printRenderUrl: string },
): Promise<Buffer> {
  throw new Error('renderQuestionnairePdf not yet implemented — see Task 4');
}
```

Task 4 replaces the stub body with the real implementation.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ipc): questionnaire:export-pdf channel + handler (renderer stub)"
git log --oneline -3
git branch --show-current
```

---

## Task 3: `QuestionnairePdfPreview` component + sections + print CSS

**Files:**
- Create: `src/renderer/components/questionnaire-pdf/QuestionnairePdfPreview.tsx`
- Create: `src/renderer/components/questionnaire-pdf/sections/CoverPage.tsx`
- Create: `src/renderer/components/questionnaire-pdf/sections/TableOfContents.tsx`
- Create: `src/renderer/components/questionnaire-pdf/sections/SheetSection.tsx`
- Create: `src/renderer/components/questionnaire-pdf/sections/QuestionAnswerRow.tsx`
- Create: `src/renderer/styles/questionnaire-pdf.css`
- Create: `tests/renderer/questionnaire-pdf-preview.test.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json` (7 PDF-render-related i18n keys; the dialog keys come in Task 4)

- [ ] **Step 1: Add PDF-render i18n keys**

Add to `messages/en.json` + `messages/zh-CN.json`:

```
questionnaire_pdf_cover_generated_at  "Generated"                       /  "生成时间"
questionnaire_pdf_cover_due_date      "Due date"                        /  "截止日期"
questionnaire_pdf_toc_heading         "Table of contents"               /  "目录"
questionnaire_pdf_unanswered          "(Unanswered)"                    /  "(未答)"
questionnaire_pdf_draft               "DRAFT"                           /  "草稿"
questionnaire_pdf_finalized           "Finalized"                       /  "已定稿"
questionnaire_pdf_source_summary      "Source"                          /  "来源"
```

Recompile paraglide:

```bash
cd /Users/lxz/ws/personal/carbonbook
npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
```

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/questionnaire-pdf-preview.test.tsx`:

```tsx
import { QuestionnairePdfPreview } from '@renderer/components/questionnaire-pdf/QuestionnairePdfPreview';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QuestionnairePdfData } from '@shared/types';

const data: QuestionnairePdfData = {
  customer: { name: 'Acme Corp' },
  questionnaire: {
    id: 'qn-1',
    reporting_year: 2025,
    due_date: '2025-12-31',
    created_at: '2025-06-01T00:00:00Z',
    status: 'answering',
  },
  document: { filename: 'cdp.xlsx' },
  sheets: [
    {
      sheet_name: 'Sheet1',
      questions: [
        {
          id: 'q-1',
          position: 'Sheet1!B5',
          raw_text: 'Total employees',
          normalized_text: 'total employees',
          parsed_intent: null,
          question_kind: 'numerical',
          expected_unit: '人',
          answer: { value: '320', unit: '人', finalized_at: '2026-05-01T00:00:00Z', source_summary: null },
        },
        {
          id: 'q-2',
          position: 'Sheet1!C3',
          raw_text: 'Company industry',
          normalized_text: 'company industry',
          parsed_intent: 'pick a category',
          question_kind: 'categorical',
          expected_unit: null,
          answer: { value: 'Manufacturing', unit: null, finalized_at: null, source_summary: null }, // draft
        },
        {
          id: 'q-3',
          position: 'Sheet1!D2',
          raw_text: 'Notes',
          normalized_text: 'notes',
          parsed_intent: null,
          question_kind: 'narrative',
          expected_unit: null,
          answer: null, // unanswered
        },
      ],
    },
  ],
  language: 'en',
};

describe('<QuestionnairePdfPreview>', () => {
  it('renders cover page + sheet section with questions', () => {
    render(<QuestionnairePdfPreview data={data} />);
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByText(/Sheet1/)).toBeTruthy();
    expect(screen.getByText(/Total employees/)).toBeTruthy();
    expect(screen.getByText(/320/)).toBeTruthy();
  });

  it('renders DRAFT badge for un-finalized answers and Unanswered for null answers', () => {
    render(<QuestionnairePdfPreview data={data} />);
    expect(screen.getByText(/DRAFT|草稿/)).toBeTruthy();
    expect(screen.getByText(/Unanswered|未答/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/questionnaire-pdf-preview.test.tsx --pool=threads 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the print CSS**

Create `src/renderer/styles/questionnaire-pdf.css`:

```css
.qpdf {
  font-family: system-ui, -apple-system, sans-serif;
  color: #111;
  max-width: 760px;
  margin: 0 auto;
  padding: 1rem;
}
.qpdf__cover {
  text-align: center;
  padding: 4rem 0 2rem 0;
  border-bottom: 1px solid #ddd;
  margin-bottom: 2rem;
}
.qpdf__cover h1 { font-size: 1.6rem; margin: 0 0 0.5rem; }
.qpdf__cover h2 { font-size: 1.1rem; margin: 0.25rem 0; font-weight: normal; color: #444; }
.qpdf__toc { margin: 1.5rem 0 2rem 0; }
.qpdf__toc h2 { font-size: 1rem; }
.qpdf__toc ol { padding-left: 1.4rem; }
.qpdf__sheet { margin-top: 2rem; page-break-before: always; }
.qpdf__sheet:first-of-type { page-break-before: auto; }
.qpdf__sheet h2 { font-size: 1.2rem; margin: 0 0 0.75rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
.qpdf__qa { margin: 0.6rem 0 0.9rem; page-break-inside: avoid; }
.qpdf__qa-q { font-weight: 600; font-size: 0.95rem; }
.qpdf__qa-intent { color: #666; font-style: italic; font-size: 0.8rem; margin-top: 0.1rem; }
.qpdf__qa-a { margin-top: 0.3rem; font-size: 0.9rem; }
.qpdf__qa-badge {
  display: inline-block;
  font-size: 0.7rem;
  padding: 0.05rem 0.4rem;
  border-radius: 0.2rem;
  margin-left: 0.4rem;
  vertical-align: middle;
}
.qpdf__qa-badge--draft { background: #fee; color: #c00; border: 1px solid #ecb; }
.qpdf__qa-badge--final { background: #efe; color: #060; border: 1px solid #cdc; }
.qpdf__qa-unanswered { font-style: italic; color: #888; }
.qpdf__qa-source { color: #666; font-style: italic; font-size: 0.78rem; margin-top: 0.15rem; }

@media print {
  .qpdf { padding: 0; max-width: none; }
  @page { size: A4; margin: 18mm 16mm; }
  @page :first { margin-top: 0; }
}
```

- [ ] **Step 5: Implement the components**

Create `src/renderer/components/questionnaire-pdf/sections/CoverPage.tsx`:

```tsx
import * as m from '@renderer/paraglide/messages';
import type { QuestionnairePdfData } from '@shared/types';

export function CoverPage({ data }: { data: QuestionnairePdfData }) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  return (
    <section className="qpdf__cover">
      <h1>{data.customer.name}</h1>
      <h2>{data.questionnaire.reporting_year} · {data.document.filename}</h2>
      {data.questionnaire.due_date && (
        <p>{m.questionnaire_pdf_cover_due_date()}: {data.questionnaire.due_date}</p>
      )}
      <p>{m.questionnaire_pdf_cover_generated_at()}: {generatedAt}</p>
    </section>
  );
}
```

Create `src/renderer/components/questionnaire-pdf/sections/TableOfContents.tsx`:

```tsx
import * as m from '@renderer/paraglide/messages';
import type { QuestionnairePdfData } from '@shared/types';

export function TableOfContents({ data }: { data: QuestionnairePdfData }) {
  if (data.sheets.length <= 1) return null;
  return (
    <nav className="qpdf__toc">
      <h2>{m.questionnaire_pdf_toc_heading()}</h2>
      <ol>
        {data.sheets.map((s) => (
          <li key={s.sheet_name}>{s.sheet_name}</li>
        ))}
      </ol>
    </nav>
  );
}
```

Create `src/renderer/components/questionnaire-pdf/sections/QuestionAnswerRow.tsx`:

```tsx
import * as m from '@renderer/paraglide/messages';
import type { QuestionnairePdfData } from '@shared/types';

type Question = QuestionnairePdfData['sheets'][number]['questions'][number];

export function QuestionAnswerRow({ question, index }: { question: Question; index: number }) {
  return (
    <div className="qpdf__qa">
      <div className="qpdf__qa-q">Q{index + 1}. {question.raw_text}</div>
      {question.parsed_intent && <div className="qpdf__qa-intent">{question.parsed_intent}</div>}
      <AnswerBlock question={question} />
    </div>
  );
}

function AnswerBlock({ question }: { question: Question }) {
  const a = question.answer;
  if (a == null) {
    return <div className="qpdf__qa-a qpdf__qa-unanswered">{m.questionnaire_pdf_unanswered()}</div>;
  }
  const unit = a.unit ? ` ${a.unit}` : '';
  const badge = a.finalized_at == null
    ? <span className="qpdf__qa-badge qpdf__qa-badge--draft">{m.questionnaire_pdf_draft()}</span>
    : <span className="qpdf__qa-badge qpdf__qa-badge--final">{m.questionnaire_pdf_finalized()}</span>;
  return (
    <div className="qpdf__qa-a">
      {a.value}{unit}{badge}
      {a.source_summary && (
        <div className="qpdf__qa-source">{m.questionnaire_pdf_source_summary()}: {a.source_summary}</div>
      )}
    </div>
  );
}
```

Create `src/renderer/components/questionnaire-pdf/sections/SheetSection.tsx`:

```tsx
import type { QuestionnairePdfData } from '@shared/types';
import { QuestionAnswerRow } from './QuestionAnswerRow';

export function SheetSection({
  sheet,
}: { sheet: QuestionnairePdfData['sheets'][number] }) {
  return (
    <section className="qpdf__sheet">
      <h2>{sheet.sheet_name}</h2>
      {sheet.questions.map((q, i) => (
        <QuestionAnswerRow key={q.id} question={q} index={i} />
      ))}
    </section>
  );
}
```

Create `src/renderer/components/questionnaire-pdf/QuestionnairePdfPreview.tsx`:

```tsx
import '@renderer/styles/questionnaire-pdf.css';
import type { QuestionnairePdfData } from '@shared/types';
import { CoverPage } from './sections/CoverPage';
import { SheetSection } from './sections/SheetSection';
import { TableOfContents } from './sections/TableOfContents';

export interface QuestionnairePdfPreviewProps {
  data: QuestionnairePdfData;
}

export function QuestionnairePdfPreview({ data }: QuestionnairePdfPreviewProps) {
  return (
    <div className="qpdf">
      <CoverPage data={data} />
      <TableOfContents data={data} />
      {data.sheets.map((sheet) => (
        <SheetSection key={sheet.sheet_name} sheet={sheet} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/questionnaire-pdf-preview.test.tsx --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 component tests pass; ~612 total.

- [ ] **Step 7: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ui): QuestionnairePdfPreview component + sections + print CSS"
git log --oneline -3
git branch --show-current
```

---

## Task 4: `/print-render` route + `renderQuestionnairePdf` + questionnaire button

**Files:**
- Create: `src/renderer/routes/print-render.tsx` — NEW ROUTE (didn't exist; see plan header note)
- Modify: `src/main/services/report-export-service.ts` — implement `renderQuestionnairePdf` (replace the stub from Task 2)
- Modify: `src/renderer/routes/questionnaires_.$id.tsx` — add "Export PDF" button + language picker modal
- Modify: `messages/en.json`, `messages/zh-CN.json` — add the dialog i18n keys

This task creates the `/print-render` route from scratch (which BOTH the ISO 14064-1 report from sub-project 1 AND this questionnaire PDF rely on; sub-project 1 set up the URL but never created the React side, so its PDF export is currently broken — this task fixes both).

- [ ] **Step 1: Add the dialog i18n keys**

Add to `messages/en.json` + `messages/zh-CN.json`:

```
questionnaire_export_pdf_button             "Export PDF"                                  /  "导出 PDF"
questionnaire_export_pdf_dialog_heading     "Export questionnaire as PDF"                 /  "导出问卷为 PDF"
questionnaire_export_pdf_dialog_subheading  "Pick the export language."                   /  "选择导出语言。"
questionnaire_export_pdf_lang_label         "Language"                                    /  "语言"
questionnaire_export_pdf_lang_zh            "Chinese (zh-CN)"                             /  "中文 (zh-CN)"
questionnaire_export_pdf_lang_en            "English"                                     /  "英语"
questionnaire_export_pdf_cancel             "Cancel"                                      /  "取消"
questionnaire_export_pdf_confirm            "Export"                                      /  "导出"
questionnaire_export_pdf_pending            "Generating PDF..."                           /  "正在生成 PDF..."
questionnaire_export_pdf_success            "Exported PDF → {path}"                       /  "已导出 PDF → {path}"
questionnaire_export_pdf_failed             "PDF export failed: {message}"                /  "PDF 导出失败: {message}"
```

Recompile paraglide.

- [ ] **Step 2: Create the `/print-render` route**

Create `src/renderer/routes/print-render.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ReportPreview } from '@renderer/components/report/ReportPreview';
import { QuestionnairePdfPreview } from '@renderer/components/questionnaire-pdf/QuestionnairePdfPreview';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ReportNarrative } from '@main/llm/report-narrative';
import type { QuestionnairePdfData } from '@shared/types';

export const Route = createFileRoute('/print-render')({ component: PrintRender });

type InventoryReportPayload = {
  kind: 'inventory_report';
  data: InventoryReportData;
  narrative: ReportNarrative;
  language: 'zh-CN' | 'en';
};
type QuestionnairePdfPayload = {
  kind: 'questionnaire_pdf';
  data: QuestionnairePdfData;
};
type PrintPayload = InventoryReportPayload | QuestionnairePdfPayload;

declare global {
  interface Window {
    __REPORT_PAYLOAD__?: PrintPayload;
  }
}

function PrintRender() {
  const [payload, setPayload] = useState<PrintPayload | null>(null);

  useEffect(() => {
    // Wait for main process to inject window.__REPORT_PAYLOAD__ via executeJavaScript.
    // Poll briefly (the injection is typically synchronous before loadURL resolves, but
    // be defensive).
    let attempts = 0;
    const tick = () => {
      if (window.__REPORT_PAYLOAD__) {
        setPayload(window.__REPORT_PAYLOAD__);
        return;
      }
      attempts++;
      if (attempts < 50) setTimeout(tick, 50); // up to 2.5s
    };
    tick();
  }, []);

  useEffect(() => {
    if (!payload) return;
    // Signal main that DOM is stable: wait for fonts + a frame, then set title=READY.
    const signal = async () => {
      if (typeof document.fonts?.ready?.then === 'function') {
        await document.fonts.ready;
      }
      requestAnimationFrame(() => {
        document.title = 'READY';
      });
    };
    void signal();
  }, [payload]);

  if (!payload) return <div>Loading payload…</div>;

  if (payload.kind === 'inventory_report') {
    return (
      <ReportPreview
        data={payload.data}
        narrative={payload.narrative}
        printMode={true}
      />
    );
  }
  if (payload.kind === 'questionnaire_pdf') {
    return <QuestionnairePdfPreview data={payload.data} />;
  }
  return <div>Unknown payload kind</div>;
}
```

- [ ] **Step 3: Update existing `renderReportPdf` to inject the kind discriminator**

Open `src/main/services/report-export-service.ts`. Find the `renderReportPdf` function. Its current `executeJavaScript` call sets `window.__REPORT_PAYLOAD__` without a `kind` field. Update:

```ts
// Inside renderReportPdf, replace the executeJavaScript line:
    await win.webContents.executeJavaScript(
      `window.__REPORT_PAYLOAD__ = ${JSON.stringify({
        kind: 'inventory_report',
        data: args.data,
        narrative: args.narrative,
        language: args.language,
      })};`,
    );
```

- [ ] **Step 4: Implement `renderQuestionnairePdf`**

In `src/main/services/report-export-service.ts`, REPLACE the Task-2 stub `renderQuestionnairePdf` body with a real implementation that mirrors `renderReportPdf`:

```ts
export async function renderQuestionnairePdf(
  args: { data: import('@shared/types.js').QuestionnairePdfData; language: 'zh-CN' | 'en' },
  deps: ExportPdfDeps,
): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await win.loadURL(deps.printRenderUrl);
    await win.webContents.executeJavaScript(
      `window.__REPORT_PAYLOAD__ = ${JSON.stringify({
        kind: 'questionnaire_pdf',
        data: args.data,
      })};`,
    );
    await waitForTitle(win.webContents, 'READY', 30_000);
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.71, bottom: 0.71, left: 0.63, right: 0.63 }, // ~18/16mm
    });
    return buf;
  } finally {
    win.close();
  }
}
```

(`waitForTitle` and `ExportPdfDeps` already exist in the file from sub-project 1.)

- [ ] **Step 5: Add the "Export PDF" button + language-picker modal**

Open `src/renderer/routes/questionnaires_.$id.tsx`. Find where the existing "Export Excel" button is rendered. Add right after it:

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import { toast } from '@renderer/components/toast';
import * as m from '@renderer/paraglide/messages';

// Near the existing exportToExcel mutation:
const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
const [pdfLanguage, setPdfLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
const exportPdf = useMutation({
  mutationFn: () =>
    questionnaireApi.exportPdf({ questionnaire_id: id, language: pdfLanguage }),
  onSuccess: (result) => {
    if ('canceled' in result && result.canceled) return;
    if ('ok' in result && result.ok) {
      toast.success(m.questionnaire_export_pdf_success({ path: result.path }));
    } else if ('ok' in result && !result.ok) {
      toast.error(m.questionnaire_export_pdf_failed({ message: result.error }));
    }
    setPdfDialogOpen(false);
  },
  onError: (e) =>
    toast.error(m.questionnaire_export_pdf_failed({ message: (e as Error).message })),
});

// In the JSX, near the existing "Export Excel" button:
<button type="button" onClick={() => setPdfDialogOpen(true)}>
  {m.questionnaire_export_pdf_button()}
</button>

// Add modal at the bottom of the component return:
{pdfDialogOpen && (
  <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/30 flex items-center justify-center">
    <div className="bg-white rounded p-6 w-80 space-y-3">
      <h2 className="text-lg font-semibold">{m.questionnaire_export_pdf_dialog_heading()}</h2>
      <p className="text-sm text-muted-foreground">{m.questionnaire_export_pdf_dialog_subheading()}</p>
      <label className="block text-sm">
        {m.questionnaire_export_pdf_lang_label()}
        <select
          value={pdfLanguage}
          onChange={(e) => setPdfLanguage(e.target.value as 'zh-CN' | 'en')}
          className="block mt-1 border rounded px-2 py-1 w-full"
        >
          <option value="zh-CN">{m.questionnaire_export_pdf_lang_zh()}</option>
          <option value="en">{m.questionnaire_export_pdf_lang_en()}</option>
        </select>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => setPdfDialogOpen(false)} className="rounded border px-3 py-1 text-sm">
          {m.questionnaire_export_pdf_cancel()}
        </button>
        <button
          type="button"
          onClick={() => exportPdf.mutate()}
          disabled={exportPdf.isPending}
          className="rounded bg-black text-white px-3 py-1 text-sm"
        >
          {exportPdf.isPending ? m.questionnaire_export_pdf_pending() : m.questionnaire_export_pdf_confirm()}
        </button>
      </div>
    </div>
  </div>
)}
```

Adapt the styling to match the existing modal patterns in the codebase if any exist; otherwise the inline classes above are fine.

- [ ] **Step 6: routeTree regeneration**

`src/renderer/routeTree.gen.ts` auto-regenerates when the new `print-render.tsx` route is added and `pnpm typecheck` (or `pnpm dev`) runs. If typecheck complains about a stale route tree, run `pnpm dev` briefly to regenerate, then kill it.

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; ~612 tests still passing.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ui): /print-render route + renderQuestionnairePdf + Export PDF button"
git log --oneline -3
git branch --show-current
```

---

## Task 5: Sweep + verification

- [ ] **Step 1: Full suite + typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -8
pnpm typecheck
```

Expected: ~612 tests passing, typecheck clean.

If 184+ failures with `NODE_MODULE_VERSION 145`:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
pnpm vitest run --pool=threads 2>&1 | tail -8
```

- [ ] **Step 2: format + biome (autofix touched files)**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -10
```

Pre-existing biome errors (4 unrelated files) will remain. Don't touch them.

- [ ] **Step 3: Re-run tests after autofix**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -6
```

- [ ] **Step 4: Final commit + history**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "chore: biome sweep for questionnaire PDF export + Phase 3 completion" || true
git log --oneline -10
git branch --show-current
```

---

## Closeout

Phase 3 sub-project 4 (final) lands on `main`:

- `QuestionnairePdfDataService.assemble` — pure read assembling sheet-grouped Q&A data.
- `questionnaire:export-pdf` IPC channel.
- `<QuestionnairePdfPreview>` component + 4 section subcomponents + print CSS.
- `/print-render` route (NEW — sub-project 1's ISO 14064-1 PDF export now also works).
- `renderQuestionnairePdf` in ReportExportService — parallels `renderReportPdf`.
- "Export PDF" button + language-picker modal on `/questionnaires/$id`.
- ~18 new i18n keys.
- ~7 new tests (605 → ~612).

**Phase 3 is now FULLY COMPLETE.** The long-arc `/goal 完成所有phase功能` is satisfied:

| Sub-project | Tests | Commits |
|---|---|---|
| 1: ISO 14064-1 inventory report | +27 | 12 |
| 2: EF rebind UI | +15 | 8 |
| 3: audit_event UI | +10 | 7 |
| 4: questionnaire PDF export | +7 | 7 |
| **Total** | **+59** | **34** |

**Manual smoke deferred** to consolidated phase-3 tag-time verification:

- Open `/questionnaires/$id` for an answered questionnaire, click "Export PDF", confirm save, open the PDF and verify cover + sections + Q&A rendering.
- Verify the ISO 14064-1 PDF export from sub-project 1 ALSO now works (previously broken because `/print-render` didn't exist).

**Next phase (if/when started):** Phase 4 candidates are not yet defined. They'd be brainstormed separately.
