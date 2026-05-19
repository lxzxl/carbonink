import { createHash, randomUUID } from 'node:crypto';
import type { LLMClient } from '@main/llm/llm-client';
import type { Customer, Document, ProviderConfig, Question, Questionnaire } from '@shared/types';
import type { Database } from 'better-sqlite3';
import type { CustomerService } from './customer-service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
      llmClient: Pick<LLMClient, 'extractQuestions'>;
      config: ProviderConfig;
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
    const llmResult = await this.deps.llmClient.extractQuestions(this.deps.config, cells);

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

  finalizeAnswering(id: string): void {
    this.deps.db.prepare(`UPDATE questionnaire SET status = 'answering' WHERE id = ?`).run(id);
  }

  markExported(id: string): void {
    this.deps.db.prepare(`UPDATE questionnaire SET status = 'exported' WHERE id = ?`).run(id);
  }

  listQuestions(questionnaireId: string): Question[] {
    return this.deps.db
      .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position, id`)
      .all(questionnaireId) as Question[];
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
