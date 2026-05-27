import { createHash } from 'node:crypto';
import { runMigrations } from '@main/db/migrate';
import { runAiObject } from '@main/llm/run-ai';
import type { CredentialService } from '@main/services/credential-service';
import { CustomerService } from '@main/services/customer-service';
import { QuestionnaireService } from '@main/services/questionnaire-service';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/llm/run-ai', () => ({
  runAiObject: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(runAiObject).mockReset();
});

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
} as never;

function fakeCredentials(): CredentialService {
  return {
    get: vi.fn(() => 'sk-fake'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

function setup(opts?: {
  llmQuestions?: Array<{
    raw_text: string;
    normalized_text: string;
    answer_cell_ref: string | null;
    expected_unit: string | null;
    sheet: string;
    question_row: number;
    question_kind: 'numerical' | 'categorical' | 'narrative';
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
  if (opts?.extractThrows) {
    vi.mocked(runAiObject).mockRejectedValue(opts.extractThrows);
  } else {
    vi.mocked(runAiObject).mockResolvedValue({ questions: opts?.llmQuestions ?? [] });
  }
  return {
    db,
    svc: new QuestionnaireService({
      db,
      documentService: documentService as never,
      customerService,
      credentials: fakeCredentials(),
      config: FAKE_CONFIG,
      excelParse: vi
        .fn()
        .mockResolvedValue([{ sheet: 'S', row: 1, col: 1, value: 'Q', ref: 'S!A1' }]),
      now: () => '2026-05-15T00:00:00Z',
    }),
    runAi: vi.mocked(runAiObject),
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
          question_kind: 'numerical',
        },
        {
          raw_text: 'Q2',
          normalized_text: 'q2',
          answer_cell_ref: 'S!B2',
          expected_unit: null,
          sheet: 'S',
          question_row: 2,
          question_kind: 'narrative',
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
    expect(qs[0]?.question_kind).toBe('numerical');
    expect(qs[1]?.question_kind).toBe('narrative');
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
          question_kind: 'numerical',
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

describe('QuestionnaireService.markExported', () => {
  it('transitions status to exported', async () => {
    const { svc, db } = setup({ llmQuestions: [] });
    const r = await svc.createFromUpload({
      customer_name: 'Acme',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'q.xlsx',
    });
    svc.finalizeAnswering(r.questionnaire_id);
    svc.markExported(r.questionnaire_id);
    const row = db
      .prepare(`SELECT status FROM questionnaire WHERE id = ?`)
      .get(r.questionnaire_id) as { status: string };
    expect(row.status).toBe('exported');
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
          question_kind: 'categorical',
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

describe('QuestionnaireService.createFromUpload — reuse from prior questionnaires', () => {
  // Helper: compute the same SHA-256 signature that the service uses.
  function sig(normalizedText: string): string {
    return createHash('sha256').update(normalizedText).digest('hex');
  }

  it('reuses finalized answers from same customer prior questionnaire', async () => {
    // Use a counter so each call to now() returns a later timestamp,
    // ensuring the first questionnaire sorts before the second.
    let nowIndex = 0;
    const timestamps = ['2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'];
    // svc here would be the harness-built service; the actual service used in
    // this test is `sequentialSvc` constructed below with a custom `now()`.
    // We still call setup() to prime the same module-level vi.mock state.
    const { db } = setup({
      llmQuestions: [
        {
          raw_text: 'Q: Total energy consumption?',
          normalized_text: 'total energy consumption',
          answer_cell_ref: 'S!B1',
          expected_unit: 'kWh',
          sheet: 'S',
          question_row: 1,
          question_kind: 'numerical',
        },
      ],
    });

    // Override now to return advancing timestamps.
    // We re-create with a custom now that sequences.
    const db2 = new Database(':memory:');
    runMigrations(db2);
    const { svc: sequentialSvc } = (() => {
      const customerService = new CustomerService({ db: db2 });
      let reuseDocCount = 0;
      const documentService = {
        uploadFile: vi
          .fn()
          .mockImplementation((input: { filename: string; mimeType: string; bytes: Buffer }) => {
            const n = ++reuseDocCount;
            return {
              id: `doc-reuse-${n}`,
              sha256: `sha256-reuse-${n}`,
              filename: input.filename,
              mime_type: input.mimeType,
              size_bytes: input.bytes.length,
              storage_path: `/tmp/doc-reuse-${n}.xlsx`,
              uploaded_at: '2026-01-01T00:00:00Z',
              uploaded_by: null,
              doc_type: null,
            };
          }),
      };
      vi.mocked(runAiObject).mockResolvedValue({
        questions: [
          {
            raw_text: 'Q: Total energy consumption?',
            normalized_text: 'total energy consumption',
            answer_cell_ref: 'S!B1',
            expected_unit: 'kWh',
            sheet: 'S',
            question_row: 1,
            question_kind: 'numerical' as const,
          },
        ],
      });
      return {
        svc: new QuestionnaireService({
          db: db2,
          documentService: documentService as never,
          customerService,
          credentials: fakeCredentials(),
          config: FAKE_CONFIG,
          excelParse: vi
            .fn()
            .mockResolvedValue([{ sheet: 'S', row: 1, col: 1, value: 'Q', ref: 'S!A1' }]),
          now: () => timestamps[nowIndex++] ?? '2026-12-01T00:00:00Z',
        }),
      };
    })();

    void db; // silence unused — using db2 instead

    // First upload: creates questionnaire qn-1 for customer "Acme"
    const r1 = await sequentialSvc.createFromUpload({
      customer_name: 'Acme',
      reporting_year: 2025,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'q2025.xlsx',
    });
    expect(r1.question_count).toBe(1);

    // Seed a finalized answer for qn-1's question
    const q1 = db2
      .prepare(`SELECT id FROM question WHERE questionnaire_id = ?`)
      .get(r1.questionnaire_id) as { id: string };
    db2
      .prepare(
        `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
         VALUES ('ans-seed-1', ?, 'abc', 'kWh', 'manual', NULL, '2026-01-02T00:00:00Z')`,
      )
      .run(q1.id);

    // Second upload: same customer, matching normalized_text → same signature
    const r2 = await sequentialSvc.createFromUpload({
      customer_name: 'Acme',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'q2026.xlsx',
    });

    expect(r2.reused_count).toBe(1);

    // Verify the pre-filled answer row
    const q2 = db2
      .prepare(`SELECT id FROM question WHERE questionnaire_id = ?`)
      .get(r2.questionnaire_id) as { id: string };
    const reusedAnswer = db2.prepare(`SELECT * FROM answer WHERE question_id = ?`).get(q2.id) as {
      source_kind: string;
      value: string;
      unit: string | null;
      finalized_at: string | null;
    };
    expect(reusedAnswer).not.toBeNull();
    expect(reusedAnswer.source_kind).toBe('reused');
    expect(reusedAnswer.value).toBe('abc');
    expect(reusedAnswer.unit).toBe('kWh');
    expect(reusedAnswer.finalized_at).toBeNull();
  });

  it('does not reuse drafts (finalized_at IS NULL)', async () => {
    const db2 = new Database(':memory:');
    runMigrations(db2);
    const llmQuestions = [
      {
        raw_text: 'GHG emissions?',
        normalized_text: 'ghg emissions total',
        answer_cell_ref: 'S!B1',
        expected_unit: 'tCO2e',
        sheet: 'S',
        question_row: 1,
        question_kind: 'numerical' as const,
      },
    ];
    const customerService = new CustomerService({ db: db2 });
    let draftDocCount = 0;
    const documentService = {
      uploadFile: vi
        .fn()
        .mockImplementation((input: { filename: string; mimeType: string; bytes: Buffer }) => {
          const n = ++draftDocCount;
          return {
            id: `doc-draft-${n}`,
            sha256: `sha256-draft-${n}`,
            filename: input.filename,
            mime_type: input.mimeType,
            size_bytes: input.bytes.length,
            storage_path: `/tmp/doc-draft-${n}.xlsx`,
            uploaded_at: '2026-01-01T00:00:00Z',
            uploaded_by: null,
            doc_type: null,
          };
        }),
    };
    let callCount = 0;
    vi.mocked(runAiObject).mockImplementation(async () => {
      callCount++;
      return { questions: llmQuestions };
    });
    let nowIdx = 0;
    const svc2 = new QuestionnaireService({
      db: db2,
      documentService: documentService as never,
      customerService,
      credentials: fakeCredentials(),
      config: FAKE_CONFIG,
      excelParse: vi
        .fn()
        .mockResolvedValue([{ sheet: 'S', row: 1, col: 1, value: 'Q', ref: 'S!A1' }]),
      now: () => (nowIdx++ === 0 ? '2026-01-01T00:00:00Z' : '2026-06-01T00:00:00Z'),
    });

    // First questionnaire
    const r1 = await svc2.createFromUpload({
      customer_name: 'Beta',
      reporting_year: 2025,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'q2025.xlsx',
    });

    // Seed a DRAFT answer (finalized_at IS NULL) — should NOT be reused
    const q1 = db2
      .prepare(`SELECT id FROM question WHERE questionnaire_id = ?`)
      .get(r1.questionnaire_id) as { id: string };
    db2
      .prepare(
        `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
         VALUES ('ans-draft-1', ?, '999', 'tCO2e', 'manual', NULL, NULL)`,
      )
      .run(q1.id);

    // Second questionnaire — same normalized_text, same customer
    const r2 = await svc2.createFromUpload({
      customer_name: 'Beta',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'q2026.xlsx',
    });

    expect(r2.reused_count).toBe(0);

    // No answer row should have been inserted for the new question
    const q2 = db2
      .prepare(`SELECT id FROM question WHERE questionnaire_id = ?`)
      .get(r2.questionnaire_id) as { id: string };
    const answerRow = db2.prepare(`SELECT id FROM answer WHERE question_id = ?`).get(q2.id);
    expect(answerRow).toBeUndefined();

    void callCount; // silence unused
  });

  it('does not reuse across different customers', async () => {
    const normalizedText = 'water consumption total';
    const db2 = new Database(':memory:');
    runMigrations(db2);
    const customerService = new CustomerService({ db: db2 });
    let docCallCount = 0;
    const documentService = {
      uploadFile: vi
        .fn()
        .mockImplementation((input: { filename: string; mimeType: string; bytes: Buffer }) => {
          const n = ++docCallCount;
          return {
            id: `doc-cross-${n}`,
            sha256: `sha256-cross-${n}`,
            filename: input.filename,
            mime_type: input.mimeType,
            size_bytes: input.bytes.length,
            storage_path: `/tmp/doc-cross-${n}.xlsx`,
            uploaded_at: '2026-01-01T00:00:00Z',
            uploaded_by: null,
            doc_type: null,
          };
        }),
    };
    vi.mocked(runAiObject).mockResolvedValue({
      questions: [
        {
          raw_text: 'Water usage?',
          normalized_text: normalizedText,
          answer_cell_ref: 'S!B1',
          expected_unit: 'm3',
          sheet: 'S',
          question_row: 1,
          question_kind: 'numerical' as const,
        },
      ],
    });
    let nowIdx = 0;
    const svc2 = new QuestionnaireService({
      db: db2,
      documentService: documentService as never,
      customerService,
      credentials: fakeCredentials(),
      config: FAKE_CONFIG,
      excelParse: vi
        .fn()
        .mockResolvedValue([{ sheet: 'S', row: 1, col: 1, value: 'Q', ref: 'S!A1' }]),
      now: () => (nowIdx++ === 0 ? '2026-01-01T00:00:00Z' : '2026-06-01T00:00:00Z'),
    });

    // Customer A: first questionnaire with a finalized answer
    const r1 = await svc2.createFromUpload({
      customer_name: 'CustomerA',
      reporting_year: 2025,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'qa.xlsx',
    });
    const q1 = db2
      .prepare(`SELECT id FROM question WHERE questionnaire_id = ?`)
      .get(r1.questionnaire_id) as { id: string };
    db2
      .prepare(
        `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
         VALUES ('ans-cross-1', ?, '5000', 'm3', 'manual', NULL, '2026-01-02T00:00:00Z')`,
      )
      .run(q1.id);

    // Verify signatures match — sanity check
    const q1Row = db2
      .prepare(`SELECT question_signature FROM question WHERE id = ?`)
      .get(q1.id) as { question_signature: string };
    expect(q1Row.question_signature).toBe(sig(normalizedText));

    // Customer B: different name → different customer_id → should NOT get reused answer
    const r2 = await svc2.createFromUpload({
      customer_name: 'CustomerB',
      reporting_year: 2026,
      due_date: null,
      file_bytes: new Uint8Array([0]),
      filename: 'qb.xlsx',
    });

    expect(r2.reused_count).toBe(0);

    const q2 = db2
      .prepare(`SELECT id FROM question WHERE questionnaire_id = ?`)
      .get(r2.questionnaire_id) as { id: string };
    const answerRow = db2.prepare(`SELECT id FROM answer WHERE question_id = ?`).get(q2.id);
    expect(answerRow).toBeUndefined();
  });
});
