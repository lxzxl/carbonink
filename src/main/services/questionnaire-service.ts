import type { Database } from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { LLMClient } from '@main/llm/llm-client';
import type { Customer, Document, ProviderConfig } from '@shared/types';
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
  }): Promise<{ questionnaire_id: string; question_count: number }> {
    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    const buf = Buffer.from(input.file_bytes);

    // Steps 1-2: Excel parse + LLM extract. Both happen BEFORE any DB
    // write so a failure here is a clean rollback to baseline.
    const cells = await this.deps.excelParse(buf);
    const llmResult = await this.deps.llmClient.extractQuestions(this.deps.config, cells);

    const questionnaireId = randomUUID();
    const createdAt = nowFn();

    // Step 3: all writes inside one transaction — customer, document,
    // questionnaire, and question rows all commit or all roll back together.
    const tx = this.deps.db.transaction(() => {
      const customer: Customer = this.deps.customerService.createOrGetByName(
        input.customer_name,
      );
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
         ) VALUES (?, ?, ?, 'v1', ?, ?, NULL, 'numerical', ?, ?, 0)`,
      );

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

    return {
      questionnaire_id: questionnaireId,
      question_count: llmResult.questions.length,
    };
  }
}
