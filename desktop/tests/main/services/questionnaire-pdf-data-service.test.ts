import { runMigrations } from '@main/db/migrate';
import { QuestionnairePdfDataService } from '@main/services/questionnaire-pdf-data-service';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function seedQuestionnaire(db: Database.Database) {
  // Org / site / customer / document / questionnaire / 4 questions / 2 answers
  db.prepare(
    `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
     VALUES ('org-1', '测试', 'CN', 'operational_control', '2026-01-01', '2026-01-01')`,
  ).run();
  db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cust-1', 'Acme Corp', NULL)`).run();
  db.prepare(
    `INSERT INTO document (id, filename, mime_type, storage_path, sha256, size_bytes, doc_type, uploaded_at)
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
    expect(data.sheets.map((s) => s.sheet_name)).toEqual(['Sheet1', 'Sheet2', '未指定']);
    // Sheet1 has q-2 (A3) before q-1 (B5)
    expect(data.sheets[0]!.questions.map((q) => q.id)).toEqual(['q-2', 'q-1']);
    // Sheet2 has just q-3
    expect(data.sheets[1]!.questions.map((q) => q.id)).toEqual(['q-3']);
    // Unspecified has q-4
    expect(data.sheets[2]!.questions.map((q) => q.id)).toEqual(['q-4']);
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
