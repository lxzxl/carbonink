# Questionnaire Extraction (Phase 2.2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Upload `.xlsx` CDP-style questionnaire → create Customer + Questionnaire → LLM extracts questions with cell refs → questions stored in `question` table → review page lists them.

**Architecture:** `exceljs` parses the file into a flat cell list; `LLMClient.extractQuestions(cells)` returns question records; `QuestionnaireService.createFromUpload` orchestrates document upload + customer create-or-get + questionnaire INSERT + question INSERT in a single transaction.

**Tech Stack:** TypeScript strict, better-sqlite3, exceljs, AI SDK 6 + zod, TanStack Router/Query, paraglide i18n.

**Reference spec:** `docs/specs/2026-05-15-questionnaire-extract-design.md`

**Baseline:** `commit 3368216` on `main`. 444 vitest tests passing.

**Discipline notes:**

- Schemas already exist (migration 005). Do NOT add a new migration.
- v1 hardcodes `question_kind = 'numerical'` for every extracted question (matches user scope decision).
- v1 uses sha256(normalized_text) as `question_signature` — collisions are fine; the unique index is on `(questionnaire_id, position)`.
- After each task: typecheck clean, `pnpm vitest run --pool=threads` green.
- Verify `git branch --show-current` returns `main` after each commit.
- Pre-existing hazard: `NODE_MODULE_VERSION 145` recovery:
  ```
  rm /Users/lxz/ws/personal/carbonbook/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && (cd /Users/lxz/ws/personal/carbonbook && pnpm rebuild better-sqlite3)
  ```

---

## Task 1: Install exceljs + ExcelParser

**Files:**
- Modify: `package.json` — add `exceljs` dep
- Create: `src/main/excel/parser.ts`
- Create: `tests/main/excel/parser.test.ts`

- [ ] **Step 1: Install**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm add exceljs
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/excel/parser.test.ts`:

```ts
import { ExcelParser } from '@main/excel/parser';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

async function buildXlsx(populate: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  populate(sheet);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('ExcelParser.parse', () => {
  it('returns non-empty cells across all sheets with sheet/row/col/value/ref', async () => {
    const bytes = await buildXlsx((s) => {
      s.getCell('A1').value = 'Question';
      s.getCell('B1').value = 'Answer';
      s.getCell('A2').value = 'Total electricity (kWh)';
      s.getCell('A3').value = 'Total natural gas (m³)';
    });
    const cells = await ExcelParser.parse(bytes);
    expect(cells.length).toBe(4);
    const a1 = cells.find((c) => c.ref === 'Sheet1!A1');
    expect(a1?.value).toBe('Question');
    expect(a1?.sheet).toBe('Sheet1');
    expect(a1?.row).toBe(1);
    expect(a1?.col).toBe(1);
  });

  it('skips empty cells', async () => {
    const bytes = await buildXlsx((s) => {
      s.getCell('A1').value = 'foo';
      s.getCell('C1').value = 'bar'; // skip B1
    });
    const cells = await ExcelParser.parse(bytes);
    expect(cells.map((c) => c.ref).sort()).toEqual(['Sheet1!A1', 'Sheet1!C1']);
  });

  it('coerces numeric and string values', async () => {
    const bytes = await buildXlsx((s) => {
      s.getCell('A1').value = 42;
      s.getCell('A2').value = 'hello';
    });
    const cells = await ExcelParser.parse(bytes);
    const a1 = cells.find((c) => c.ref === 'Sheet1!A1');
    const a2 = cells.find((c) => c.ref === 'Sheet1!A2');
    expect(a1?.value).toBe(42);
    expect(a2?.value).toBe('hello');
  });

  it('walks multiple sheets', async () => {
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet('Scope 1');
    s1.getCell('A1').value = 'fuel';
    const s2 = wb.addWorksheet('Scope 2');
    s2.getCell('A1').value = 'electricity';
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const cells = await ExcelParser.parse(bytes);
    expect(cells.map((c) => c.ref).sort()).toEqual(['Scope 1!A1', 'Scope 2!A1']);
  });
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/excel/parser.test.ts --pool=threads
```
Expected: FAIL ("Cannot find module").

- [ ] **Step 4: Implement**

Create `src/main/excel/parser.ts`:

```ts
import ExcelJS from 'exceljs';

export type ParsedCell = {
  sheet: string;
  row: number;
  col: number;
  value: string | number | null;
  ref: string; // e.g. "Sheet1!B5"
};

/**
 * Read-only Excel parser. Loads a .xlsx buffer fully into memory and
 * returns a flat list of non-empty cells across all sheets.
 *
 * Cell ref format: "<sheet name>!<column letter><row>", e.g. "Sheet1!B5".
 * Use the ref to write answers back later (Phase 2.2c).
 *
 * Performance: real CDP questionnaires are <500 KB / <2000 cells.
 * For larger files (10MB+) consider streaming; not needed for v1.
 */
export class ExcelParser {
  static async parse(bytes: Buffer): Promise<ParsedCell[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);

    const out: ParsedCell[] = [];
    wb.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          const raw = cell.value;
          if (raw === null || raw === undefined || raw === '') return;
          // Normalize to string | number. ExcelJS gives us rich types
          // (formula objects, rich text, dates); coerce to a primitive
          // for downstream simplicity.
          let value: string | number;
          if (typeof raw === 'string' || typeof raw === 'number') {
            value = raw;
          } else if (typeof raw === 'object' && raw !== null) {
            if ('result' in raw && (typeof raw.result === 'string' || typeof raw.result === 'number')) {
              value = raw.result;
            } else if ('richText' in raw && Array.isArray(raw.richText)) {
              value = raw.richText.map((r: { text: string }) => r.text).join('');
            } else if (raw instanceof Date) {
              value = raw.toISOString();
            } else {
              value = String(raw);
            }
          } else {
            value = String(raw);
          }
          out.push({
            sheet: sheet.name,
            row: cell.row as unknown as number,  // exceljs typing quirk
            col: cell.col as unknown as number,
            value,
            ref: `${sheet.name}!${cell.address}`,
          });
        });
      });
    });

    return out;
  }
}
```

Note: ExcelJS's `cell.row` and `cell.col` types are loose; cast as needed. The cell.address gives "B5"-style refs natively.

- [ ] **Step 5: Run test + verify pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/excel/parser.test.ts --pool=threads
```
Expected: PASS, 4 tests.

- [ ] **Step 6: typecheck + full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add package.json pnpm-lock.yaml src/main/excel/parser.ts tests/main/excel/parser.test.ts
git commit -m "feat(excel): ExcelParser — flat cell list with sheet/row/col/ref"
git branch --show-current
```
Expected: 448 tests passing (444 + 4).

---

## Task 2: LLMClient.extractQuestions

**Files:**
- Modify: `src/main/llm/llm-client.ts` — add `extractQuestions`
- Create: `tests/main/llm/llm-client-extract-questions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/llm/llm-client-extract-questions.test.ts`:

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

describe('LLMClient.extractQuestions', () => {
  it('passes cells through prompt and returns zod-validated questions', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      questions: [
        {
          raw_text: 'Q1: Total electricity (kWh)?',
          normalized_text: 'Total electricity',
          answer_cell_ref: 'Sheet1!B5',
          expected_unit: 'kWh',
          sheet: 'Sheet1',
          question_row: 5,
        },
      ],
    } as unknown as never);

    const cells = [
      { sheet: 'Sheet1', row: 5, col: 1, value: 'Q1: Total electricity (kWh)?', ref: 'Sheet1!A5' },
      { sheet: 'Sheet1', row: 5, col: 2, value: '', ref: 'Sheet1!B5' },
    ];
    const result = await client.extractQuestions(fakeConfig, cells as never);

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.normalized_text).toBe('Total electricity');
    expect(stub).toHaveBeenCalledTimes(1);
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    expect(prompt).toContain('Total electricity');
    expect(prompt).toContain('Sheet1');
  });

  it('returns empty list when no cells provided', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const result = await client.extractQuestions(fakeConfig, []);
    expect(result.questions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client-extract-questions.test.ts --pool=threads
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `LLMClient` class in `src/main/llm/llm-client.ts`, near `classifyDocument`:

```ts
  /**
   * Extract questions from a flat list of Excel cells. Used by Phase 2.2a's
   * questionnaire pipeline to find Q/A pairs in a CDP-style questionnaire.
   *
   * Returns an empty list if `cells` is empty (no LLM call fired). Caller
   * persists the returned records to the `question` table.
   *
   * The LLM is asked to:
   *   - ignore section headers / table-of-contents rows
   *   - identify the answer cell (typically next-column-to-question)
   *   - extract any expected_unit from the question wording
   */
  async extractQuestions(
    config: ProviderConfig,
    cells: ReadonlyArray<{ sheet: string; row: number; col: number; value: string | number | null; ref: string }>,
  ): Promise<{
    questions: Array<{
      raw_text: string;
      normalized_text: string;
      answer_cell_ref: string | null;
      expected_unit: string | null;
      sheet: string;
      question_row: number;
    }>;
  }> {
    if (cells.length === 0) return { questions: [] };

    const schema = z.object({
      questions: z
        .array(
          z.object({
            raw_text: z.string(),
            normalized_text: z.string(),
            answer_cell_ref: z.string().nullable(),
            expected_unit: z.string().nullable(),
            sheet: z.string(),
            question_row: z.number().int(),
          }),
        )
        .max(500),
    });

    // Group cells by (sheet, row) for compact prompt encoding.
    const bySheet = new Map<string, Map<number, typeof cells[number][]>>();
    for (const c of cells) {
      if (!bySheet.has(c.sheet)) bySheet.set(c.sheet, new Map());
      const sheetMap = bySheet.get(c.sheet)!;
      if (!sheetMap.has(c.row)) sheetMap.set(c.row, []);
      sheetMap.get(c.row)!.push(c);
    }

    let cellsText = '';
    for (const [sheetName, rowsMap] of bySheet) {
      cellsText += `\n=== Sheet "${sheetName}" ===\n`;
      const sortedRows = Array.from(rowsMap.keys()).sort((a, b) => a - b);
      for (const rowNum of sortedRows) {
        const rowCells = rowsMap.get(rowNum)!.sort((a, b) => a.col - b.col);
        const parts = rowCells.map((c) => `${c.ref}=${JSON.stringify(c.value)}`);
        cellsText += `Row ${rowNum}: ${parts.join(' | ')}\n`;
      }
    }

    const prompt = `你是一名碳核算助理。下面是一份 CDP 风格的供应商问卷 Excel 表所有非空单元格的清单。请识别出每道**问题**，并指出其**答案应该填入哪个单元格**。

规则：
- 忽略目录、章节标题、表头说明、纯空白行。
- 一道问题通常占一行：问题文本在某一列，紧邻的右侧空单元格就是答案位置。
- 如果一行有"题面 + 单位列 + 答案列"，那答案在最右边的空列。
- 题面应该是个真正可被回答的问题（含数字、范围、是非等可量化语义），而非说明性文字。
- 提取问题原文 (raw_text)，并给出规范化版本 (normalized_text，去标点、去前缀编号、单空格)。
- 如能从题面推断单位（kWh、tCO2e、m³、% 等），写入 expected_unit；否则 null。
- answer_cell_ref：填入答案的目标单元格 ref（同 sheet，紧挨题面的空单元格）；如果不能确定，置 null。
- 排除任何已经填了数字/答案的单元格（那是示例值或别人答过的）。

<cells>
${cellsText}
</cells>

返回 JSON: { questions: [{ raw_text, normalized_text, answer_cell_ref, expected_unit, sheet, question_row }] }`;

    return this.extract(config, schema, prompt);
  }
```

- [ ] **Step 4: Run test + verify pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/llm/llm-client-extract-questions.test.ts --pool=threads
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/llm/llm-client.ts tests/main/llm/llm-client-extract-questions.test.ts
git commit -m "feat(llm): LLMClient.extractQuestions — find Q/A cells in Excel questionnaires"
git branch --show-current
```
Expected: 450 tests passing (448 + 2).

---

## Task 3: CustomerService

**Files:**
- Create: `src/main/services/customer-service.ts`
- Create: `tests/main/services/customer-service.test.ts`
- Modify: `src/shared/types.ts` — export `Customer` if not already present

- [ ] **Step 1: Check Customer type**

In `src/shared/types.ts`, verify there's a `Customer` type. If not, add:
```ts
export type Customer = {
  id: string;
  name: string;
  notes: string | null;
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/services/customer-service.test.ts`:

```ts
import { runMigrations } from '@main/db/migrate';
import { CustomerService } from '@main/services/customer-service';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { db, svc: new CustomerService({ db }) };
}

describe('CustomerService', () => {
  it('createOrGetByName creates a new customer when none exists', () => {
    const { svc } = setup();
    const c = svc.createOrGetByName('Acme Corp');
    expect(c.id).toBeTruthy();
    expect(c.name).toBe('Acme Corp');
    expect(c.notes).toBeNull();
  });

  it('createOrGetByName returns the same row on subsequent calls with same name', () => {
    const { svc } = setup();
    const c1 = svc.createOrGetByName('Acme Corp');
    const c2 = svc.createOrGetByName('Acme Corp');
    expect(c2.id).toBe(c1.id);
  });

  it('createOrGetByName treats different names as different customers', () => {
    const { svc } = setup();
    const a = svc.createOrGetByName('Acme Corp');
    const b = svc.createOrGetByName('Globex');
    expect(a.id).not.toBe(b.id);
  });

  it('list returns all customers', () => {
    const { svc } = setup();
    svc.createOrGetByName('A');
    svc.createOrGetByName('B');
    const list = svc.list();
    expect(list.length).toBe(2);
  });

  it('getById returns the customer or null', () => {
    const { svc } = setup();
    const c = svc.createOrGetByName('X');
    expect(svc.getById(c.id)?.name).toBe('X');
    expect(svc.getById('no-such-id')).toBeNull();
  });
});
```

- [ ] **Step 3: Implement**

Create `src/main/services/customer-service.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { Customer } from '@shared/types';
import { randomUUID } from 'node:crypto';

export class CustomerService {
  constructor(private readonly deps: { db: Database }) {}

  createOrGetByName(name: string): Customer {
    const existing = this.deps.db
      .prepare(`SELECT id, name, notes FROM customer WHERE name = ?`)
      .get(name) as Customer | undefined;
    if (existing) return existing;
    const id = randomUUID();
    this.deps.db.prepare(`INSERT INTO customer (id, name, notes) VALUES (?, ?, NULL)`).run(id, name);
    return { id, name, notes: null };
  }

  list(): Customer[] {
    return this.deps.db.prepare(`SELECT id, name, notes FROM customer ORDER BY name`).all() as Customer[];
  }

  getById(id: string): Customer | null {
    const row = this.deps.db
      .prepare(`SELECT id, name, notes FROM customer WHERE id = ?`)
      .get(id) as Customer | undefined;
    return row ?? null;
  }
}
```

- [ ] **Step 4: Run test + full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/services/customer-service.test.ts --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/customer-service.ts tests/main/services/customer-service.test.ts src/shared/types.ts
git commit -m "feat(customer): CustomerService — createOrGetByName + list + getById"
git branch --show-current
```
Expected: 455 tests passing (450 + 5).

---

## Task 4: QuestionnaireService.createFromUpload

**Files:**
- Create: `src/main/services/questionnaire-service.ts`
- Create: `tests/main/services/questionnaire-service.test.ts`
- Modify: `src/shared/types.ts` — add `Questionnaire`, `Question` types if missing

- [ ] **Step 1: Add shared types**

In `src/shared/types.ts`:

```ts
export type Questionnaire = {
  id: string;
  customer_id: string;
  document_id: string;
  template_kind: string | null;
  reporting_year: number;
  status: 'parsing' | 'mapping' | 'answering' | 'exported';
  due_date: string | null;
  created_at: string;
};

export type Question = {
  id: string;
  questionnaire_id: string;
  question_signature: string;
  signature_version: string;
  normalized_text: string;
  raw_text: string;
  parsed_intent: string | null;
  question_kind: 'numerical' | 'categorical' | 'narrative';
  expected_unit: string | null;
  position: string | null;
  required: number;
};
```

(Position is the cell ref e.g. "Sheet1!B5"; storing as string is consistent with the schema's `position TEXT`.)

- [ ] **Step 2: Write the failing test**

Create `tests/main/services/questionnaire-service.test.ts`:

```ts
import { runMigrations } from '@main/db/migrate';
import { CustomerService } from '@main/services/customer-service';
import { QuestionnaireService } from '@main/services/questionnaire-service';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'fake',
} as never;

function setup(opts?: {
  llmQuestions?: Array<{
    raw_text: string;
    normalized_text: string;
    answer_cell_ref: string | null;
    expected_unit: string | null;
    sheet: string;
    question_row: number;
  }>;
  extractThrows?: Error;
}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const customerService = new CustomerService({ db });
  const documentService = {
    upload: vi.fn().mockReturnValue({ id: 'doc-1', sha256: 'aa', filename: 'q.xlsx' }),
  };
  const llmClient = {
    extractQuestions: opts?.extractThrows
      ? vi.fn().mockRejectedValue(opts.extractThrows)
      : vi.fn().mockResolvedValue({ questions: opts?.llmQuestions ?? [] }),
  };
  return {
    db,
    svc: new QuestionnaireService({
      db,
      documentService: documentService as never,
      customerService,
      llmClient: llmClient as never,
      config: FAKE_CONFIG,
      excelParse: vi.fn().mockResolvedValue([{ sheet: 'S', row: 1, col: 1, value: 'Q', ref: 'S!A1' }]),
      now: () => '2026-05-15T00:00:00Z',
    }),
    llmClient,
  };
}

describe('QuestionnaireService.createFromUpload', () => {
  it('happy path: creates customer + questionnaire + questions', async () => {
    const { svc, db } = setup({
      llmQuestions: [
        { raw_text: 'Q1', normalized_text: 'q1', answer_cell_ref: 'S!B1', expected_unit: 'kWh', sheet: 'S', question_row: 1 },
        { raw_text: 'Q2', normalized_text: 'q2', answer_cell_ref: 'S!B2', expected_unit: null, sheet: 'S', question_row: 2 },
      ],
    });
    const result = await svc.createFromUpload({
      customer_name: 'Acme',
      reporting_year: 2026,
      due_date: '2026-12-31',
      file_bytes: new Uint8Array([0]),
      filename: 'q.xlsx',
    });
    expect(result.question_count).toBe(2);
    const qRow = db.prepare(`SELECT * FROM questionnaire WHERE id = ?`).get(result.questionnaire_id) as { status: string };
    expect(qRow.status).toBe('mapping');
    const qs = db.prepare(`SELECT * FROM question WHERE questionnaire_id = ?`).all(result.questionnaire_id) as Array<{ raw_text: string; expected_unit: string | null; question_kind: string; position: string }>;
    expect(qs.length).toBe(2);
    expect(qs[0]?.question_kind).toBe('numerical');
    expect(qs[0]?.position).toBe('S!B1');
  });

  it('returns 0 questions when LLM returns empty array', async () => {
    const { svc } = setup({ llmQuestions: [] });
    const result = await svc.createFromUpload({
      customer_name: 'A',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'empty.xlsx',
    });
    expect(result.question_count).toBe(0);
  });

  it('reuses an existing customer when name matches', async () => {
    const { svc, db } = setup({ llmQuestions: [] });
    await svc.createFromUpload({ customer_name: 'A', reporting_year: 2026, due_date: null, file_bytes: new Uint8Array([0]), filename: 'a.xlsx' });
    await svc.createFromUpload({ customer_name: 'A', reporting_year: 2026, due_date: null, file_bytes: new Uint8Array([0]), filename: 'b.xlsx' });
    const customers = db.prepare(`SELECT COUNT(*) AS c FROM customer`).get() as { c: number };
    expect(customers.c).toBe(1);
  });

  it('rolls back when LLM extract throws (no half-baked questionnaire)', async () => {
    const { svc, db } = setup({ extractThrows: new Error('LLM down') });
    await expect(
      svc.createFromUpload({
        customer_name: 'A',
        reporting_year: 2026,
        due_date: null,
        file_bytes: new Uint8Array([0]),
        filename: 'q.xlsx',
      }),
    ).rejects.toThrow('LLM down');
    const qCount = db.prepare(`SELECT COUNT(*) AS c FROM questionnaire`).get() as { c: number };
    expect(qCount.c).toBe(0);
  });
});
```

- [ ] **Step 3: Implement service**

Create `src/main/services/questionnaire-service.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { LLMClient } from '@main/llm/llm-client';
import type { ProviderConfig } from '@shared/types';
import { createHash, randomUUID } from 'node:crypto';
import type { CustomerService } from './customer-service';
import type { DocumentService } from './document-service';

export class QuestionnaireService {
  constructor(
    private readonly deps: {
      db: Database;
      documentService: DocumentService;
      customerService: CustomerService;
      llmClient: LLMClient;
      config: ProviderConfig;
      excelParse: (bytes: Buffer) => Promise<Array<{
        sheet: string; row: number; col: number;
        value: string | number | null; ref: string;
      }>>;
      now?: () => string;
    },
  ) {}

  async createFromUpload(input: {
    customer_name: string;
    reporting_year: number;
    due_date: string | null;
    file_bytes: Uint8Array;
    filename: string;
  }): Promise<{ questionnaire_id: string; question_count: number }> {
    const now = (this.deps.now ?? (() => new Date().toISOString()))();
    const buf = Buffer.from(input.file_bytes);
    const cells = await this.deps.excelParse(buf);
    const llmResult = await this.deps.llmClient.extractQuestions(this.deps.config, cells);

    // Everything below is sync — wrap in a transaction so partial writes
    // don't leak. Note: the LLM call above must happen BEFORE the tx
    // (transactions hold a write lock).
    const customer = this.deps.customerService.createOrGetByName(input.customer_name);
    const document = this.deps.documentService.upload({
      filename: input.filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: input.file_bytes,
    });

    const questionnaireId = randomUUID();
    const tx = this.deps.db.transaction(() => {
      this.deps.db.prepare(`
        INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at)
        VALUES (?, ?, ?, ?, 'mapping', ?, ?)
      `).run(questionnaireId, customer.id, document.id, input.reporting_year, input.due_date, now);

      const insertQ = this.deps.db.prepare(`
        INSERT INTO question (
          id, questionnaire_id, question_signature, signature_version,
          normalized_text, raw_text, parsed_intent, question_kind,
          expected_unit, position, required
        ) VALUES (?, ?, ?, 'v1', ?, ?, NULL, 'numerical', ?, ?, 0)
      `);

      for (const q of llmResult.questions) {
        const sig = createHash('sha256').update(q.normalized_text).digest('hex');
        insertQ.run(
          randomUUID(),
          questionnaireId,
          sig,
          q.normalized_text,
          q.raw_text,
          q.expected_unit,
          q.answer_cell_ref,
        );
      }
    });
    tx();

    return { questionnaire_id: questionnaireId, question_count: llmResult.questions.length };
  }
}
```

Notes on transactions: the LLM call happens BEFORE the transaction starts. If the LLM throws, no DB writes occurred — natural rollback. Once inside `tx()`, any inner failure rolls back the entire customer/document/questionnaire/question write set.

Wait — `customer.createOrGetByName` and `documentService.upload` both write to the DB OUTSIDE the transaction in this design. That's a bug for the rollback test. Let me restructure: move both INSIDE the tx, OR keep them outside and accept that an LLM failure leaves an orphan customer.

For v1, simplest fix: do the customer + document writes inside `tx()`. The customer service can take a `db` arg or operate on the current connection (better-sqlite3 transactions are connection-scoped — using `db.prepare` inside `tx()` is fine because the tx wraps that prepared statement).

Refactor the implementation: do ALL DB writes inside `tx()`. Move the `customerService.createOrGetByName` and `documentService.upload` calls inside. The "rolls back" test then passes because LLM failure happens BEFORE the tx, so no rows are written at all.

Actually re-reading the test: the LLM call is BEFORE the tx in my code, so the test should pass as-is. The "rolls back when LLM extract throws" verifies `qCount === 0` after a thrown LLM call — but customer.createOrGetByName ALSO runs before the tx, so it would have written a row. Test fails on that. Let me re-arrange: LLM call FIRST, then ALL writes (customer + document + questionnaire + questions) inside one tx. That ensures atomicity.

Apply this ordering in the implementation.

- [ ] **Step 4: Run test + verify pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/services/questionnaire-service.test.ts --pool=threads
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/questionnaire-service.ts tests/main/services/questionnaire-service.test.ts src/shared/types.ts
git commit -m "feat(questionnaire): QuestionnaireService.createFromUpload — parse + extract + insert"
git branch --show-current
```
Expected: 459 tests passing (455 + 4).

---

## Task 5: QuestionnaireService.list + getById

**Files:**
- Modify: `src/main/services/questionnaire-service.ts` — add `list` + `getById` methods
- Modify: `tests/main/services/questionnaire-service.test.ts` — add tests

- [ ] **Step 1: Add the failing tests**

In the existing `questionnaire-service.test.ts`, add:

```ts
describe('QuestionnaireService.list', () => {
  it('returns questionnaires joined with customer name, ordered by created_at desc', async () => {
    const { svc, db } = setup({ llmQuestions: [] });
    await svc.createFromUpload({ customer_name: 'Acme', reporting_year: 2026, due_date: null, file_bytes: new Uint8Array([0]), filename: 'a.xlsx' });
    await svc.createFromUpload({ customer_name: 'Globex', reporting_year: 2026, due_date: null, file_bytes: new Uint8Array([0]), filename: 'b.xlsx' });
    const list = svc.list();
    expect(list.length).toBe(2);
    expect(list[0]?.customer_name).toBeTruthy();
  });
});

describe('QuestionnaireService.getById', () => {
  it('returns questionnaire + customer + document + questions', async () => {
    const { svc } = setup({
      llmQuestions: [
        { raw_text: 'Q1', normalized_text: 'q1', answer_cell_ref: 'S!B1', expected_unit: 'kWh', sheet: 'S', question_row: 1 },
      ],
    });
    const r = await svc.createFromUpload({ customer_name: 'Acme', reporting_year: 2026, due_date: null, file_bytes: new Uint8Array([0]), filename: 'q.xlsx' });
    const detail = svc.getById(r.questionnaire_id);
    expect(detail).not.toBeNull();
    expect(detail?.customer.name).toBe('Acme');
    expect(detail?.questions.length).toBe(1);
    expect(detail?.questions[0]?.normalized_text).toBe('q1');
  });

  it('getById returns null for unknown id', () => {
    const { svc } = setup({ llmQuestions: [] });
    expect(svc.getById('not-real')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

Append to `QuestionnaireService` class:

```ts
  list(): Array<Questionnaire & { customer_name: string; question_count: number }> {
    return this.deps.db.prepare(`
      SELECT q.*, c.name AS customer_name,
        (SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id) AS question_count
      FROM questionnaire q
      JOIN customer c ON c.id = q.customer_id
      ORDER BY q.created_at DESC
    `).all() as never;
  }

  getById(id: string): {
    questionnaire: Questionnaire;
    customer: Customer;
    document: Document;
    questions: Question[];
  } | null {
    const q = this.deps.db.prepare(`SELECT * FROM questionnaire WHERE id = ?`).get(id) as Questionnaire | undefined;
    if (!q) return null;
    const customer = this.deps.db.prepare(`SELECT id, name, notes FROM customer WHERE id = ?`).get(q.customer_id) as Customer;
    const document = this.deps.db.prepare(`SELECT * FROM document WHERE id = ?`).get(q.document_id) as Document;
    const questions = this.deps.db.prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position`).all(id) as Question[];
    return { questionnaire: q, customer, document, questions };
  }
```

Import the relevant types (`Questionnaire`, `Customer`, `Document`, `Question`) at the top.

- [ ] **Step 3: Run + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/services/questionnaire-service.test.ts --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/questionnaire-service.ts tests/main/services/questionnaire-service.test.ts
git commit -m "feat(questionnaire): QuestionnaireService.list + getById"
git branch --show-current
```
Expected: 462 tests passing (459 + 3).

---

## Task 6: IPC channels + renderer API client

**Files:**
- Modify: `src/main/ipc/types.ts` — add 3 channel entries
- Create: `src/main/ipc/handlers/questionnaire.ts`
- Modify: `src/main/ipc/context.ts` — instantiate QuestionnaireService + CustomerService
- Modify: `src/main/ipc/setup.ts` — register the handler set
- Modify: `src/preload/bridge.ts` — allowlist `questionnaire:*` channels
- Modify: `tests/preload/bridge.test.ts` — update allowlist assertion
- Create: `src/renderer/lib/api/questionnaire.ts`
- Create: `tests/main/ipc/questionnaire-handlers.test.ts`

- [ ] **Step 1: Failing handler test**

Create `tests/main/ipc/questionnaire-handlers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { questionnaireHandlers } from '@main/ipc/handlers/questionnaire';

function makeCtx() {
  return {
    questionnaireService: {
      createFromUpload: vi.fn().mockResolvedValue({ questionnaire_id: 'q-1', question_count: 5 }),
      list: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
    },
  } as unknown as never;
}

describe('questionnaire:* handlers', () => {
  it('questionnaire:create zod-rejects bad input', async () => {
    const handlers = questionnaireHandlers(makeCtx());
    await expect(handlers['questionnaire:create']!({} as never)).rejects.toThrow();
  });

  it('questionnaire:create delegates on valid input', async () => {
    const ctx = makeCtx();
    const handlers = questionnaireHandlers(ctx);
    const r = await handlers['questionnaire:create']!({
      customer_name: 'Acme',
      reporting_year: 2026,
      due_date: '2026-12-31',
      file_bytes: new Uint8Array([0, 1, 2]),
      filename: 'q.xlsx',
    });
    expect(r.questionnaire_id).toBe('q-1');
  });

  it('questionnaire:list delegates', () => {
    const ctx = makeCtx();
    const handlers = questionnaireHandlers(ctx);
    handlers['questionnaire:list']!(undefined as never);
    expect((ctx as never as { questionnaireService: { list: ReturnType<typeof vi.fn> } }).questionnaireService.list).toHaveBeenCalled();
  });

  it('questionnaire:get-by-id zod-rejects empty id', async () => {
    const handlers = questionnaireHandlers(makeCtx());
    expect(() => handlers['questionnaire:get-by-id']!({ id: '' } as never)).toThrow();
  });
});
```

- [ ] **Step 2: Implement handler**

Create `src/main/ipc/handlers/questionnaire.ts`:

```ts
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const createInput = z.object({
  customer_name: z.string().min(1),
  reporting_year: z.number().int().min(2020).max(2100),
  due_date: z.string().nullable(),
  file_bytes: z.instanceof(Uint8Array),
  filename: z.string().min(1),
});

const idInput = z.object({ id: z.string().min(1) });

export function questionnaireHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'questionnaire:create': async (input) => {
      const parsed = createInput.parse(input);
      return ctx.questionnaireService.createFromUpload(parsed);
    },
    'questionnaire:list': () => ctx.questionnaireService.list(),
    'questionnaire:get-by-id': (input) => {
      const parsed = idInput.parse(input);
      return ctx.questionnaireService.getById(parsed.id);
    },
  };
}
```

- [ ] **Step 3: Wire up everywhere**

In `src/main/ipc/types.ts`:

```ts
'questionnaire:create': (input: { customer_name: string; reporting_year: number; due_date: string | null; file_bytes: Uint8Array; filename: string }) => Promise<{ questionnaire_id: string; question_count: number }>;
'questionnaire:list': () => Array<Questionnaire & { customer_name: string; question_count: number }>;
'questionnaire:get-by-id': (input: { id: string }) => ReturnType<QuestionnaireService['getById']>;
```

In `src/main/ipc/context.ts`: add `customerService` + `questionnaireService` lazy getters. Constructor for QuestionnaireService needs `excelParse: ExcelParser.parse`.

In `src/main/ipc/setup.ts`: register `questionnaireHandlers(ctx)`.

In `src/preload/bridge.ts`: add the 3 channels to `allowedChannels`.

In `tests/preload/bridge.test.ts`: update the exact-list assertion.

- [ ] **Step 4: Renderer API**

Create `src/renderer/lib/api/questionnaire.ts`:

```ts
import { invoke } from './_invoke';  // or whatever the existing renderer-IPC wrapper is

export const questionnaireApi = {
  create: (input: { customer_name: string; reporting_year: number; due_date: string | null; file_bytes: Uint8Array; filename: string }) =>
    invoke('questionnaire:create', input),
  list: () => invoke('questionnaire:list'),
  getById: (input: { id: string }) => invoke('questionnaire:get-by-id', input),
};
```

Use whatever invoke-helper the existing renderer API clients use (look at `src/renderer/lib/api/extraction.ts` for the pattern).

- [ ] **Step 5: typecheck + tests + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/ipc/questionnaire-handlers.test.ts --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
git add -A
git commit -m "feat(ipc): questionnaire:create/list/get-by-id channels + renderer API"
git branch --show-current
```
Expected: 466 tests passing (462 + 4).

---

## Task 7: `/questionnaires` list route + sidebar entry

**Files:**
- Create: `src/renderer/routes/questionnaires.tsx`
- Modify: `src/renderer/components/Sidebar.tsx` — add Questionnaires link
- Modify: `messages/en.json` + `messages/zh-CN.json` — `nav_questionnaires` + list-page keys (see spec for full list)
- Create: `tests/renderer/questionnaires-list.test.tsx`

- [ ] **Step 1: Add i18n keys**

In both `messages/en.json` and `messages/zh-CN.json`, add (alphabetically among `nav_*` and `questionnaires_*`):

```json
"nav_questionnaires": "Questionnaires" / "问卷",
"questionnaires_empty": "No questionnaires yet" / "还没有问卷",
"questionnaires_new_button": "+ New questionnaire" / "+ 新建问卷",
"questionnaires_table_customer": "Customer" / "客户",
"questionnaires_table_year": "Reporting year" / "报告年度",
"questionnaires_table_status": "Status" / "状态",
"questionnaires_table_questions": "Questions" / "题目数",
"questionnaires_table_due": "Due date" / "截止日期",
"questionnaires_status_parsing": "Parsing" / "解析中",
"questionnaires_status_mapping": "Mapping" / "映射中",
"questionnaires_status_answering": "Answering" / "答题中",
"questionnaires_status_exported": "Exported" / "已导出"
```

- [ ] **Step 2: Add Sidebar entry**

In `src/renderer/components/Sidebar.tsx`, find the existing `<Link to="/documents">` block. Add a sibling `<Link to="/questionnaires">{m.nav_questionnaires()}</Link>` block. Match the existing styling.

- [ ] **Step 3: Create route**

`src/renderer/routes/questionnaires.tsx`:

```tsx
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/questionnaires')({
  component: QuestionnairesRoute,
});

function QuestionnairesRoute() {
  const q = useQuery({ queryKey: ['questionnaire:list'], queryFn: questionnaireApi.list });

  if (q.isLoading) return <p>{m.loading()}</p>;
  const list = q.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.nav_questionnaires()}</h1>
        <Link
          to="/questionnaires/new"
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          {m.questionnaires_new_button()}
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-muted-foreground">{m.questionnaires_empty()}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 text-left">{m.questionnaires_table_customer()}</th>
              <th className="text-left">{m.questionnaires_table_year()}</th>
              <th className="text-left">{m.questionnaires_table_status()}</th>
              <th className="text-left">{m.questionnaires_table_questions()}</th>
              <th className="text-left">{m.questionnaires_table_due()}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/30">
                <td className="py-2">
                  <Link to="/questionnaires/$id" params={{ id: r.id }} className="text-primary hover:underline">
                    {r.customer_name}
                  </Link>
                </td>
                <td>{r.reporting_year}</td>
                <td>{r.status}</td>
                <td>{r.question_count}</td>
                <td>{r.due_date ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Renderer test**

Create `tests/renderer/questionnaires-list.test.tsx`. Mirror `documents.test.tsx` pattern. Smoke test:
- Empty list → renders "还没有问卷".
- Non-empty list → renders customer names + question counts.

- [ ] **Step 5: typecheck + tests + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/renderer/questionnaires-list.test.tsx --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/renderer/routes/questionnaires.tsx src/renderer/components/Sidebar.tsx messages/en.json messages/zh-CN.json tests/renderer/
git commit -m "feat(ui): /questionnaires list route + sidebar entry"
git branch --show-current
```

---

## Task 8: `/questionnaires/new` wizard

**Files:**
- Create: `src/renderer/routes/questionnaires.new.tsx`
- Add wizard i18n keys to messages files (see spec)
- Create: `tests/renderer/questionnaires-new.test.tsx`

- [ ] **Step 1: Add wizard i18n keys**

```json
"questionnaires_wizard_title": "New questionnaire" / "新建问卷",
"questionnaires_wizard_customer": "Customer name" / "客户名称",
"questionnaires_wizard_year": "Reporting year" / "报告年度",
"questionnaires_wizard_due": "Due date (optional)" / "截止日期（可选）",
"questionnaires_wizard_upload": "Upload .xlsx and parse" / "上传 Excel 并解析",
"questionnaires_wizard_parsing": "Parsing questionnaire..." / "正在解析问卷..."
```

- [ ] **Step 2: Create route**

`src/renderer/routes/questionnaires.new.tsx`:

```tsx
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

export const Route = createFileRoute('/questionnaires/new')({
  component: NewQuestionnaireRoute,
});

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function NewQuestionnaireRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [dueDate, setDueDate] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('No file selected');
      if (!file.name.endsWith('.xlsx')) throw new Error('Only .xlsx is supported');
      const bytes = new Uint8Array(await file.arrayBuffer());
      return questionnaireApi.create({
        customer_name: customerName.trim(),
        reporting_year: year,
        due_date: dueDate || null,
        file_bytes: bytes,
        filename: file.name,
      });
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      toast.success(`Parsed: ${r.question_count} question(s)`);
      void navigate({ to: '/questionnaires/$id', params: { id: r.questionnaire_id } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const canSubmit = customerName.trim().length > 0 && !mutation.isPending;

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{m.questionnaires_wizard_title()}</h1>
      <div className="space-y-3">
        <Label>{m.questionnaires_wizard_customer()}</Label>
        <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        <Label>{m.questionnaires_wizard_year()}</Label>
        <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <Label>{m.questionnaires_wizard_due()}</Label>
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <Label>.xlsx</Label>
        <input type="file" accept={`${XLSX_MIME},.xlsx`} ref={fileRef} className="block text-sm" />
      </div>
      <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
        {mutation.isPending ? m.questionnaires_wizard_parsing() : m.questionnaires_wizard_upload()}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Renderer test**

Smoke test: render the wizard, verify the file input + customer input are present.

- [ ] **Step 4: typecheck + tests + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/renderer/routes/questionnaires.new.tsx messages/ tests/renderer/
git commit -m "feat(ui): /questionnaires/new wizard"
git branch --show-current
```

---

## Task 9: `/questionnaires/$id` detail route

**Files:**
- Create: `src/renderer/routes/questionnaires_.$id.tsx` (the `_.` prefix isolates the route param)
- Add detail i18n keys
- Create: `tests/renderer/questionnaires-detail.test.tsx`

- [ ] **Step 1: Add i18n keys**

```json
"questionnaires_detail_question": "Question" / "题目",
"questionnaires_detail_kind": "Type" / "题型",
"questionnaires_detail_unit": "Unit" / "单位",
"questionnaires_detail_position": "Cell" / "单元格",
"questionnaires_detail_answer_pending": "Phase 2.2b will generate answers here." / "Phase 2.2b 将在此处生成答案。"
```

- [ ] **Step 2: Route**

`src/renderer/routes/questionnaires_.$id.tsx`:

```tsx
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/questionnaires/$id')({
  component: QuestionnaireDetailRoute,
});

function QuestionnaireDetailRoute() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ['questionnaire:get-by-id', id],
    queryFn: () => questionnaireApi.getById({ id }),
  });
  if (q.isLoading) return <p>{m.loading()}</p>;
  if (!q.data) return <p>Not found</p>;
  const { questionnaire, customer, document, questions } = q.data;

  return (
    <div className="space-y-6">
      <Link to="/questionnaires" className="text-sm text-primary hover:underline">
        ← {m.nav_questionnaires()}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{customer.name}</h1>
        <p className="text-sm text-muted-foreground">
          {questionnaire.reporting_year} · {questionnaire.status} · {document.filename}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="py-2 text-left">{m.questionnaires_detail_question()}</th>
            <th className="text-left">{m.questionnaires_detail_kind()}</th>
            <th className="text-left">{m.questionnaires_detail_unit()}</th>
            <th className="text-left">{m.questionnaires_detail_position()}</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => (
            <tr key={q.id} className="border-b">
              <td className="py-2">{q.raw_text}</td>
              <td>{q.question_kind}</td>
              <td>{q.expected_unit ?? '—'}</td>
              <td className="font-mono text-xs">{q.position ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground italic">{m.questionnaires_detail_answer_pending()}</p>
    </div>
  );
}
```

- [ ] **Step 3: Renderer test**

Render with a mocked questionnaire (3 questions). Assert customer name + 3 rows + the placeholder text.

- [ ] **Step 4: typecheck + tests + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/renderer/routes/questionnaires_.\$id.tsx messages/ tests/renderer/
git commit -m "feat(ui): /questionnaires/\$id detail route"
git branch --show-current
```

---

## Task 10: Final sweep

**Files:** none — verification only.

- [ ] **Step 1: Full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Expected: ≥459 tests passing.

- [ ] **Step 2: typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```

- [ ] **Step 3: format + lint**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format
pnpm exec biome check --write 2>&1 | tail -5
pnpm lint --max-diagnostics=80 2>&1 | tail -5
```

Expected: 0 errors, only pre-existing `noNonNullAssertion` warnings.

- [ ] **Step 4: Commit any format/lint sweep**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A
git status
git commit -m "chore: biome sweep for Phase 2.2a"
git log --oneline -12
git branch --show-current
```

---

## Closeout

Phase 2.2a lands on `main`. After this:

- User uploads a CDP-style .xlsx → sees extracted questions on a read-only detail page.
- `questionnaire` rows are in status `mapping` waiting for Phase 2.2b's answer-generation pipeline.
- Sidebar has a new "Questionnaires" entry.

**Next sub-project: Phase 2.2b** — auto-answer numerical questions + answer review UI. The review page replaces the static question list with editable answer cards backed by `answer` table rows.
