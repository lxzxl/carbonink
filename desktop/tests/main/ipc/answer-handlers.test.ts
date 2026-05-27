import * as fs from 'node:fs/promises';
import { writeAnswers } from '@main/excel/answer-writer';
import { answerHandlers } from '@main/ipc/handlers/answer';
import * as answerSvc from '@main/services/answer-generation/index';
import { Effect, Either, Layer } from 'effect';
import { dialog } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/services/answer-generation/index', async () => {
  const actual = await vi.importActual<typeof import('@main/services/answer-generation/index')>(
    '@main/services/answer-generation/index',
  );
  return {
    ...actual,
    generate: vi.fn(),
    save: vi.fn(),
    listByQuestionnaire: vi.fn(),
    generateAllUnanswered: vi.fn(),
  };
});

vi.mock('electron', () => ({
  dialog: { showSaveDialog: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@main/excel/answer-writer', () => ({
  writeAnswers: vi.fn(),
}));

const fakeAnswer = {
  id: 'ans-1',
  question_id: 'q-1',
  value: '42',
  unit: 'tCO2e',
  source_kind: 'ai_suggested' as const,
  source_calculation_snapshot_id: null,
  source_activity_data_id: null,
  source_company_profile_key: null,
  source_narrative_bank_id: null,
  source_summary: null,
  finalized_at: null,
};

function makeCtx() {
  return {
    answerLayer: Layer.empty,
    providerConfig: { provider: 'openai' as const, model: 'gpt-4o', apiKey: 'test-key' },
    // Minimum stub of questionnaireService — the inbound-guard in
    // answer:generate calls `getQuestionDirection`. Returning null
    // (= "not an inbound question") makes the existing outbound tests
    // pass through unchanged.
    questionnaireService: {
      getQuestionDirection: () => null,
    },
  } as never;
}

describe('answer:* handlers', () => {
  afterEach(() => vi.clearAllMocks());

  it('answer:generate calls answerSvc.generate and resolves the answer', async () => {
    vi.mocked(answerSvc.generate).mockReturnValue(Effect.succeed(fakeAnswer) as never);
    const handlers = answerHandlers(makeCtx());
    const result = await handlers['answer:generate']!({ question_id: 'q-1' });
    expect(result).toEqual(fakeAnswer);
    expect(answerSvc.generate).toHaveBeenCalledTimes(1);
    expect(answerSvc.generate).toHaveBeenCalledWith('q-1', expect.any(Object));
  });

  it('answer:save calls answerSvc.save and resolves the updated answer', async () => {
    vi.mocked(answerSvc.save).mockReturnValue(Effect.succeed(fakeAnswer) as never);
    const handlers = answerHandlers(makeCtx());
    const input = { question_id: 'q-1', value: '42', unit: 'tCO2e', finalize: true };
    const result = await handlers['answer:save']!(input);
    expect(result).toEqual(fakeAnswer);
    expect(answerSvc.save).toHaveBeenCalledWith(input);
  });

  it('answer:list-by-questionnaire calls answerSvc.listByQuestionnaire and resolves the list', async () => {
    vi.mocked(answerSvc.listByQuestionnaire).mockReturnValue(Effect.succeed([fakeAnswer]) as never);
    const handlers = answerHandlers(makeCtx());
    const result = await handlers['answer:list-by-questionnaire']!({ questionnaire_id: 'qs-1' });
    expect(result).toEqual([fakeAnswer]);
    expect(answerSvc.listByQuestionnaire).toHaveBeenCalledWith('qs-1');
  });

  it('answer:generate throws when providerConfig is null', async () => {
    const ctx = {
      answerLayer: Layer.empty,
      providerConfig: null,
      questionnaireService: { getQuestionDirection: () => null },
    } as never;
    const handlers = answerHandlers(ctx);
    await expect(handlers['answer:generate']!({ question_id: 'q-1' })).rejects.toThrow(
      'AI provider not configured',
    );
  });

  it('answer:generate-all-unanswered returns serialized results', async () => {
    const fakeError = { _tag: 'LLMCallFailed', cause: new Error('boom') };
    vi.mocked(answerSvc.generateAllUnanswered).mockReturnValue(
      Effect.succeed([Either.right(fakeAnswer), Either.left(fakeError as never)] as never) as never,
    );
    const handlers = answerHandlers(makeCtx());
    const result = await handlers['answer:generate-all-unanswered']!({
      questionnaire_id: 'qn-1',
    });
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ ok: true, result: { value: fakeAnswer } });
    expect(result[1]).toMatchObject({ ok: false, result: { error: { _tag: 'LLMCallFailed' } } });
  });

  it('answer:export-to-xlsx happy path returns path + counts and calls markExported', async () => {
    const fakeQuestionnaire = {
      questionnaire: { id: 'qn-1', document_id: 'doc-1', status: 'answering' },
      customer: { id: 'cust-1', name: 'Acme' },
      document: { id: 'doc-1', filename: 'q.xlsx', storage_path: '/data/q.xlsx' },
      questions: [
        { id: 'q-1', position: 'S!B1' },
        { id: 'q-2', position: 'S!B2' },
      ],
    };
    const fakeAnswers = [
      { ...fakeAnswer, id: 'ans-1', question_id: 'q-1', value: '100', finalized_at: '2026-01-01' },
      { ...fakeAnswer, id: 'ans-2', question_id: 'q-2', value: '200', finalized_at: null },
    ];
    const fakeBuffer = Buffer.from('fake xlsx');
    const fakeWriteResult = { buffer: fakeBuffer, written: 2, drafts: 1 };

    const markExported = vi.fn();
    const getById = vi.fn().mockReturnValue(fakeQuestionnaire);
    const listQuestions = vi.fn().mockReturnValue(fakeQuestionnaire.questions);
    const documentGetById = vi.fn().mockReturnValue(fakeQuestionnaire.document);

    vi.mocked(answerSvc.listByQuestionnaire).mockReturnValue(Effect.succeed(fakeAnswers) as never);
    vi.mocked(fs.readFile).mockResolvedValue(fakeBuffer as never);
    vi.mocked(writeAnswers).mockResolvedValue(fakeWriteResult);
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.xlsx',
    } as never);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const ctx = Object.assign(makeCtx(), {
      questionnaireService: { getById, listQuestions, markExported },
      documentService: { getById: documentGetById },
    });

    const handlers = answerHandlers(ctx);
    const result = await handlers['answer:export-to-xlsx']!({ questionnaire_id: 'qn-1' });

    expect(result).toEqual({ canceled: false, path: '/tmp/out.xlsx', written: 2, drafts: 1 });
    expect(markExported).toHaveBeenCalledWith('qn-1');
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.xlsx', fakeBuffer);
    expect(writeAnswers).toHaveBeenCalledWith(
      fakeBuffer,
      expect.arrayContaining([
        { ref: 'S!B1', value: '100', isDraft: false },
        { ref: 'S!B2', value: '200', isDraft: true },
      ]),
    );
  });

  it('answer:export-to-xlsx canceled path returns { canceled: true } and skips write', async () => {
    const fakeQuestionnaire = {
      questionnaire: { id: 'qn-1', document_id: 'doc-1', status: 'answering' },
      customer: { id: 'cust-1', name: 'Acme' },
      document: { id: 'doc-1', filename: 'q.xlsx', storage_path: '/data/q.xlsx' },
      questions: [{ id: 'q-1', position: 'S!B1' }],
    };
    const fakeAnswers = [
      { ...fakeAnswer, id: 'ans-1', question_id: 'q-1', value: '100', finalized_at: null },
    ];
    const fakeBuffer = Buffer.from('fake xlsx');

    const markExported = vi.fn();
    const getById = vi.fn().mockReturnValue(fakeQuestionnaire);
    const listQuestions = vi.fn().mockReturnValue(fakeQuestionnaire.questions);
    const documentGetById = vi.fn().mockReturnValue(fakeQuestionnaire.document);

    vi.mocked(answerSvc.listByQuestionnaire).mockReturnValue(Effect.succeed(fakeAnswers) as never);
    vi.mocked(fs.readFile).mockResolvedValue(fakeBuffer as never);
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true } as never);

    const ctx = Object.assign(makeCtx(), {
      questionnaireService: { getById, listQuestions, markExported },
      documentService: { getById: documentGetById },
    });

    const handlers = answerHandlers(ctx);
    const result = await handlers['answer:export-to-xlsx']!({ questionnaire_id: 'qn-1' });

    expect(result).toEqual({ canceled: true });
    expect(markExported).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
