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
  const letters = m[1]!.toUpperCase();
  const row = Number(m[2]!);
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
      .get(questionnaireRow.customer_id) as { id: string; name: string } | undefined;
    if (!customerRow) {
      throw new Error(`customer not found: ${questionnaireRow.customer_id}`);
    }

    const documentRow = this.deps.db
      .prepare(`SELECT id, filename FROM document WHERE id = ?`)
      .get(questionnaireRow.document_id) as { id: string; filename: string } | undefined;
    if (!documentRow) {
      throw new Error(`document not found: ${questionnaireRow.document_id}`);
    }

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
