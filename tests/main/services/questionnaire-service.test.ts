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
    uploadFile: vi.fn().mockImplementation((input) => ({
      id: 'doc-1',
      sha256: 'aabb',
      filename: input.filename,
      mime_type: input.mimeType,
      size_bytes: input.bytes.length,
      storage_path: '/tmp/doc-1.xlsx',
      uploaded_at: '2026-05-15T00:00:00Z',
      uploaded_by: null,
      doc_type: null,
    })),
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
      excelParse: vi
        .fn()
        .mockResolvedValue([{ sheet: 'S', row: 1, col: 1, value: 'Q', ref: 'S!A1' }]),
      now: () => '2026-05-15T00:00:00Z',
    }),
    llmClient,
    documentService,
  };
}

describe('QuestionnaireService.createFromUpload', () => {
  it('happy path: creates customer + questionnaire + questions, status=mapping', async () => {
    const { svc, db } = setup({
      llmQuestions: [
        {
          raw_text: 'Q1',
          normalized_text: 'q1',
          answer_cell_ref: 'S!B1',
          expected_unit: 'kWh',
          sheet: 'S',
          question_row: 1,
        },
        {
          raw_text: 'Q2',
          normalized_text: 'q2',
          answer_cell_ref: 'S!B2',
          expected_unit: null,
          sheet: 'S',
          question_row: 2,
        },
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
    const qRow = db
      .prepare(`SELECT * FROM questionnaire WHERE id = ?`)
      .get(result.questionnaire_id) as {
      status: string;
      due_date: string | null;
      reporting_year: number;
    };
    expect(qRow.status).toBe('mapping');
    expect(qRow.due_date).toBe('2026-12-31');
    expect(qRow.reporting_year).toBe(2026);
    const qs = db
      .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position`)
      .all(result.questionnaire_id) as Array<{
      raw_text: string;
      expected_unit: string | null;
      question_kind: string;
      position: string | null;
    }>;
    expect(qs.length).toBe(2);
    expect(qs.every((q) => q.question_kind === 'numerical')).toBe(true);
    expect(qs[0]?.position).toBe('S!B1');
    expect(qs[0]?.expected_unit).toBe('kWh');
  });

  it('returns 0 questions when LLM returns empty array', async () => {
    const { svc, db } = setup({ llmQuestions: [] });
    const result = await svc.createFromUpload({
      customer_name: 'A',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'empty.xlsx',
    });
    expect(result.question_count).toBe(0);
    const qCount = db.prepare(`SELECT COUNT(*) AS c FROM questionnaire`).get() as { c: number };
    expect(qCount.c).toBe(1);
  });

  it('reuses an existing customer when name matches', async () => {
    const { svc, db } = setup({ llmQuestions: [] });
    await svc.createFromUpload({
      customer_name: 'A',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'a.xlsx',
    });
    await svc.createFromUpload({
      customer_name: 'A',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'b.xlsx',
    });
    const customers = db.prepare(`SELECT COUNT(*) AS c FROM customer`).get() as { c: number };
    expect(customers.c).toBe(1);
    const qCount = db.prepare(`SELECT COUNT(*) AS c FROM questionnaire`).get() as { c: number };
    expect(qCount.c).toBe(2);
  });

  it('rolls back fully when LLM extract throws (no half-baked rows)', async () => {
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
    const customers = db.prepare(`SELECT COUNT(*) AS c FROM customer`).get() as { c: number };
    expect(customers.c).toBe(0);
    const qnaires = db.prepare(`SELECT COUNT(*) AS c FROM questionnaire`).get() as { c: number };
    expect(qnaires.c).toBe(0);
  });
});

describe('QuestionnaireService.list', () => {
  it('returns questionnaires joined with customer_name + question_count, newest first', async () => {
    const { svc, db } = setup({
      llmQuestions: [
        {
          raw_text: 'Q',
          normalized_text: 'q',
          answer_cell_ref: 'S!B1',
          expected_unit: 'kWh',
          sheet: 'S',
          question_row: 1,
        },
      ],
    });
    await svc.createFromUpload({
      customer_name: 'Acme',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'a.xlsx',
    });
    await svc.createFromUpload({
      customer_name: 'Globex',
      reporting_year: 2025,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'b.xlsx',
    });
    const list = svc.list();
    expect(list.length).toBe(2);
    // Both rows should carry customer_name and question_count
    for (const r of list) {
      expect(r.customer_name).toBeTruthy();
      expect(typeof r.question_count).toBe('number');
    }
    // Each row got 1 question from llmQuestions
    expect(list.every((r) => r.question_count === 1)).toBe(true);
    void db; // silence unused
  });

  it('returns empty list when no questionnaires exist', () => {
    const { svc } = setup({ llmQuestions: [] });
    expect(svc.list()).toEqual([]);
  });
});

describe('QuestionnaireService.getById', () => {
  it('returns questionnaire + customer + document + questions', async () => {
    const { svc } = setup({
      llmQuestions: [
        {
          raw_text: 'Q1',
          normalized_text: 'q1',
          answer_cell_ref: 'S!B1',
          expected_unit: 'kWh',
          sheet: 'S',
          question_row: 1,
        },
      ],
    });
    const r = await svc.createFromUpload({
      customer_name: 'Acme',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'q.xlsx',
    });
    const detail = svc.getById(r.questionnaire_id);
    expect(detail).not.toBeNull();
    expect(detail?.customer.name).toBe('Acme');
    expect(detail?.questions.length).toBe(1);
    expect(detail?.questions[0]?.normalized_text).toBe('q1');
    expect(detail?.questionnaire.status).toBe('mapping');
  });

  it('getById returns null for unknown id', () => {
    const { svc } = setup({ llmQuestions: [] });
    expect(svc.getById('not-real')).toBeNull();
  });
});
