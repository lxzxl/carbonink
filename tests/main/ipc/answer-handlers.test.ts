import { answerHandlers } from '@main/ipc/handlers/answer';
import * as answerSvc from '@main/services/answer-generation/index';
import { Effect, Either, Layer } from 'effect';
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
    const ctx = { answerLayer: Layer.empty, providerConfig: null } as never;
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
});
