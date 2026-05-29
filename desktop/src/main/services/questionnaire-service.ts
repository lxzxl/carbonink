import { createHash, randomUUID } from 'node:crypto';
import { runAiObject } from '@main/llm/run-ai.js';
import type { Customer, Document, ProviderConfigV2, Question, Questionnaire } from '@shared/types';
import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import type { CredentialService } from './credential-service.js';
import type { CustomerService } from './customer-service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type CellInput = ReadonlyArray<{
  sheet: string;
  row: number;
  col: number;
  value: string | number | null;
  ref: string;
}>;

/**
 * Schema + prompt for the LLM question-extraction step. Lives in the
 * service so the AiClient stays a thin conduit — services own their
 * prompts.
 *
 * The model must return question_kind ∈ {numerical, categorical,
 * narrative} so we can size schema + UI affordances downstream
 * (numerical questions get a unit field; narrative questions get a
 * wider input area). Unknown / borderline kinds collapse to
 * categorical per the prompt's tie-breaker rule.
 */
const extractQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        raw_text: z.string(),
        normalized_text: z.string(),
        answer_cell_ref: z.string().nullable(),
        expected_unit: z.string().nullable(),
        sheet: z.string(),
        question_row: z.number().int(),
        question_kind: z.enum(['numerical', 'categorical', 'narrative']),
      }),
    )
    .max(500),
});

function buildExtractQuestionsPrompt(cells: CellInput): string {
  // Group cells by (sheet, row) for compact prompt encoding — matches the
  // shape the model is fastest to parse (one row per logical question).
  const bySheet = new Map<string, Map<number, CellInput[number][]>>();
  for (const c of cells) {
    if (!bySheet.has(c.sheet)) bySheet.set(c.sheet, new Map());
    const sheetMap = bySheet.get(c.sheet);
    if (!sheetMap) continue;
    if (!sheetMap.has(c.row)) sheetMap.set(c.row, []);
    sheetMap.get(c.row)?.push(c);
  }

  let cellsText = '';
  for (const [sheetName, rowsMap] of bySheet) {
    cellsText += `\n=== Sheet "${sheetName}" ===\n`;
    const sortedRows = Array.from(rowsMap.keys()).sort((a, b) => a - b);
    for (const rowNum of sortedRows) {
      const rowCells = (rowsMap.get(rowNum) ?? []).sort((a, b) => a.col - b.col);
      const parts = rowCells.map((c) => `${c.ref}=${JSON.stringify(c.value)}`);
      cellsText += `Row ${rowNum}: ${parts.join(' | ')}\n`;
    }
  }

  return `你是一名碳核算助理。下面是一份 CDP 风格的供应商问卷 Excel 表所有非空单元格的清单。请识别出每道**问题**，并指出其**答案应该填入哪个单元格**。

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

对每道题判断 question_kind：
- numerical：要求填数字 + 单位（如"年度用电量(kWh)"、"员工总人数"）
- categorical：要求短词答案（如"是否签署 SBTi 承诺"、"主要行业分类"、"报告期开始日期 (YYYY-MM-DD)"）
- narrative：要求 1-3 句叙述（如"请描述贵公司气候转型计划"、"说明可持续发展战略"）
判断不准则降级为 categorical。

返回 JSON: { questions: [{ raw_text, normalized_text, answer_cell_ref, expected_unit, sheet, question_row, question_kind }] }`;
}

/**
 * Minimal interface for the document storage dependency. Matches the real
 * DocumentService.uploadFile signature so production wiring can pass the
 * real service in without an adapter. Tests inject a vi.fn() mock that
 * returns a Document-shaped row without writing to disk; the transaction
 * below upserts the row into the test DB via INSERT OR IGNORE so the
 * questionnaire FK resolves.
 */
export interface DocumentUploadService {
  uploadFile(input: { filename: string; mimeType: string; bytes: Buffer }): Document;
}

/**
 * Orchestrates uploading + parsing a CDP-style Excel questionnaire.
 *
 * Pipeline:
 *   1. Parse Excel → flat cell list (via injected excelParse).
 *   2. LLM extracts questions from the cell list (BEFORE any DB writes,
 *      so a throw here cleanly rolls back to baseline).
 *   3. db.transaction(() => {
 *        customer = customerService.createOrGetByName(...)
 *        document = documentService.upload(...)
 *        INSERT INTO questionnaire (status='mapping')
 *        INSERT INTO question × N
 *      })
 *
 * v1 hardcodes question_kind='numerical'. Phase 2.3+ adds LLM
 * classification across the three kinds.
 */
export class QuestionnaireService {
  constructor(
    private readonly deps: {
      db: Database;
      documentService: DocumentUploadService;
      customerService: CustomerService;
      /**
       * Credential store consulted by the AiClient layer for the
       * provider API key. Threaded through here (rather than read once
       * at construction) because `runAiObject` rebuilds the layer per
       * call — provider config can change mid-session via Settings.
       */
      credentials: CredentialService;
      config: ProviderConfigV2;
      excelParse: (bytes: Buffer) => Promise<
        Array<{
          sheet: string;
          row: number;
          col: number;
          value: string | number | null;
          ref: string;
        }>
      >;
      now?: () => string;
    },
  ) {}

  async createFromUpload(input: {
    customer_name: string;
    reporting_year: number;
    due_date: string | null;
    file_bytes: Uint8Array;
    filename: string;
  }): Promise<{ questionnaire_id: string; question_count: number; reused_count: number }> {
    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    const buf = Buffer.from(input.file_bytes);

    // Steps 1-2: Excel parse + LLM extract. Both happen BEFORE any DB
    // write so a failure here is a clean rollback to baseline.
    const cells = await this.deps.excelParse(buf);
    // Empty Excel → don't burn a model call (no questions to extract).
    const llmResult =
      cells.length === 0
        ? { questions: [] }
        : await runAiObject(this.deps.config, this.deps.credentials, {
            schema: extractQuestionsSchema,
            prompt: buildExtractQuestionsPrompt(cells),
          });

    const questionnaireId = randomUUID();
    const createdAt = nowFn();

    // Captures the reuse count from inside the transaction so the outer
    // scope can return it without closing over a mutable let in the fn body.
    let reusedCount = 0;

    // Step 3: all writes inside one transaction — customer, document,
    // questionnaire, and question rows all commit or all roll back together.
    const tx = this.deps.db.transaction(() => {
      const customer: Customer = this.deps.customerService.createOrGetByName(input.customer_name);
      const document: Document = this.deps.documentService.uploadFile({
        filename: input.filename,
        mimeType: XLSX_MIME,
        bytes: buf,
      });

      // Ensure the document row exists in the local DB so the questionnaire FK
      // resolves. In production the real DocumentService.uploadFile inserts the
      // row itself; in tests the injected mock returns a plain object without
      // writing to the DB, so we upsert here to keep FK enforcement happy.
      this.deps.db
        .prepare(
          `INSERT OR IGNORE INTO document
             (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by, doc_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          document.id,
          document.sha256,
          document.filename,
          document.mime_type,
          document.size_bytes,
          document.storage_path,
          document.uploaded_at,
          document.uploaded_by,
          document.doc_type,
        );

      this.deps.db
        .prepare(
          `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at)
           VALUES (?, ?, ?, ?, 'mapping', ?, ?)`,
        )
        .run(
          questionnaireId,
          customer.id,
          document.id,
          input.reporting_year,
          input.due_date,
          createdAt,
        );

      const insertQ = this.deps.db.prepare(
        `INSERT INTO question (
           id, questionnaire_id, question_signature, signature_version,
           normalized_text, raw_text, parsed_intent, question_kind,
           expected_unit, position, required
         ) VALUES (?, ?, ?, 'v1', ?, ?, NULL, ?, ?, ?, 0)`,
      );

      const insertedQuestions: Array<{ id: string; signature: string }> = [];

      for (const q of llmResult.questions) {
        const sig = createHash('sha256').update(q.normalized_text).digest('hex');
        const qid = randomUUID();
        insertQ.run(
          qid,
          questionnaireId,
          sig,
          q.normalized_text,
          q.raw_text,
          q.question_kind,
          q.expected_unit,
          q.answer_cell_ref,
        );
        insertedQuestions.push({ id: qid, signature: sig });
      }

      // Reuse lookup: for each newly-inserted question, find the most recent
      // finalized answer from the same customer's prior questionnaires where
      // the question_signature matches, then pre-populate a draft answer row
      // with source_kind='reused'.
      const findPrev = this.deps.db.prepare(`
        SELECT a.value, a.unit, a.source_summary
          FROM answer a
          JOIN question pq ON pq.id = a.question_id
          JOIN questionnaire pqn ON pqn.id = pq.questionnaire_id
         WHERE pqn.customer_id = ?
           AND pq.question_signature = ?
           AND pqn.id != ?
           AND a.finalized_at IS NOT NULL
         ORDER BY pqn.created_at DESC
         LIMIT 1
      `);

      const insertReused = this.deps.db.prepare(`
        INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
        VALUES (?, ?, ?, ?, 'reused', ?, NULL)
      `);

      let count = 0;
      for (const { id: qid, signature } of insertedQuestions) {
        const prev = findPrev.get(customer.id, signature, questionnaireId) as
          | { value: string; unit: string | null; source_summary: string | null }
          | undefined;
        if (!prev) continue;
        insertReused.run(randomUUID(), qid, prev.value, prev.unit, prev.source_summary);
        count++;
      }
      reusedCount = count;
    });

    tx();

    return {
      questionnaire_id: questionnaireId,
      question_count: llmResult.questions.length,
      reused_count: reusedCount,
    };
  }

  list(): Array<Questionnaire & { customer_name: string; question_count: number }> {
    return this.deps.db
      .prepare(`
        SELECT q.*,
               c.name AS customer_name,
               (SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id) AS question_count
        FROM questionnaire q
        JOIN customer c ON c.id = q.customer_id
        ORDER BY q.created_at DESC, q.id DESC
      `)
      .all() as Array<Questionnaire & { customer_name: string; question_count: number }>;
  }

  /**
   * "确认全部答案" / Finalize answers. Stamps `finalized_at` on every still-draft
   * answer in this questionnaire — the bulk form of the per-answer finalize — so
   * the action matches its label. (It previously only flipped the status flag and
   * touched no answers, which made "确认全部答案" a no-op on the answers it named.)
   *
   * The status advances to 'finalized' (已定稿) — a real done-state in the
   * 草稿 → 已定稿 → 已导出 lifecycle — but never *regresses* an already-`exported`
   * questionnaire (the `status != 'exported'` guard). Idempotent: re-running only
   * stamps answers that are still drafts.
   */
  finalizeAnswering(id: string): void {
    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    const tx = this.deps.db.transaction(() => {
      this.deps.db
        .prepare(
          `UPDATE answer SET finalized_at = ?
             WHERE finalized_at IS NULL
               AND question_id IN (SELECT id FROM question WHERE questionnaire_id = ?)`,
        )
        .run(nowFn(), id);
      this.deps.db
        .prepare(
          `UPDATE questionnaire SET status = 'finalized' WHERE id = ? AND status != 'exported'`,
        )
        .run(id);
    });
    tx();
  }

  markExported(id: string): void {
    this.deps.db.prepare(`UPDATE questionnaire SET status = 'exported' WHERE id = ?`).run(id);
  }

  listQuestions(questionnaireId: string): Question[] {
    return this.deps.db
      .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position, id`)
      .all(questionnaireId) as Question[];
  }

  /**
   * Compact summary used by the answer-generation agent's
   * `read_questionnaire_context` tool. Returns customer name + reporting year +
   * question count without the full questionnaire/customer/document/questions
   * payload that {@link getById} would yield — keeps the tool's return shape
   * tight in the agent's context window.
   *
   * Returns `null` when the questionnaire id doesn't exist (the tool surfaces
   * this as an error result the model can react to).
   */
  /**
   * Quick lookup: is the questionnaire owning this question an inbound
   * (supplier-disclosure) row or outbound (customer-facing) row? Returns
   * null when the question doesn't exist. Used by the answer:generate
   * IPC handler to refuse auto-generation on inbound rows — those answers
   * come from the supplier via the import-filled flow, not from our LLM.
   */
  getQuestionDirection(questionId: string): 'inbound' | 'outbound' | null {
    const row = this.deps.db
      .prepare(
        `SELECT q.direction FROM questionnaire q
           JOIN question qu ON qu.questionnaire_id = q.id
          WHERE qu.id = ?`,
      )
      .get(questionId) as { direction: 'inbound' | 'outbound' } | undefined;
    return row?.direction ?? null;
  }

  getContext(questionnaireId: string): {
    customer_name: string;
    reporting_year: number;
    question_count: number;
  } | null {
    const row = this.deps.db
      .prepare(
        `SELECT c.name AS customer_name,
                q.reporting_year,
                (SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id) AS question_count
           FROM questionnaire q
           JOIN customer c ON c.id = q.customer_id
          WHERE q.id = ?`,
      )
      .get(questionnaireId) as
      | { customer_name: string; reporting_year: number; question_count: number }
      | undefined;
    return row ?? null;
  }

  getById(id: string): {
    questionnaire: Questionnaire;
    customer: Customer;
    document: Document;
    questions: Question[];
  } | null {
    const questionnaire = this.deps.db
      .prepare(`SELECT * FROM questionnaire WHERE id = ?`)
      .get(id) as Questionnaire | undefined;
    if (!questionnaire) return null;

    const customer = this.deps.db
      .prepare(`SELECT id, name, notes FROM customer WHERE id = ?`)
      .get(questionnaire.customer_id) as Customer;

    const document = this.deps.db
      .prepare(`SELECT * FROM document WHERE id = ?`)
      .get(questionnaire.document_id) as Document;

    const questions = this.deps.db
      .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position, id`)
      .all(id) as Question[];

    return { questionnaire, customer, document, questions };
  }
}
