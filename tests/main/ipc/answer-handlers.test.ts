import { answerHandlers } from '@main/ipc/handlers/answer';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

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
    answerGenerationService: {
      generate: vi.fn().mockReturnValue(Effect.succeed(fakeAnswer)),
      save: vi.fn().mockReturnValue(Effect.succeed(fakeAnswer)),
      listByQuestionnaire: vi.fn().mockReturnValue(Effect.succeed([fakeAnswer])),
    },
  } as unknown as never;
}

describe('answer:* handlers', () => {
  it('answer:generate calls service.generate and resolves the answer', async () => {
    const ctx = makeCtx();
    const handlers = answerHandlers(ctx);
    const result = await handlers['answer:generate']!({ question_id: 'q-1' });
    expect(result).toEqual(fakeAnswer);
    expect(
      (
        ctx as never as {
          answerGenerationService: { generate: ReturnType<typeof vi.fn> };
        }
      ).answerGenerationService.generate,
    ).toHaveBeenCalledWith('q-1');
  });

  it('answer:save calls service.save and resolves the updated answer', async () => {
    const ctx = makeCtx();
    const handlers = answerHandlers(ctx);
    const input = { question_id: 'q-1', value: '42', unit: 'tCO2e', finalize: true };
    const result = await handlers['answer:save']!(input);
    expect(result).toEqual(fakeAnswer);
    expect(
      (
        ctx as never as {
          answerGenerationService: { save: ReturnType<typeof vi.fn> };
        }
      ).answerGenerationService.save,
    ).toHaveBeenCalledWith(input);
  });

  it('answer:list-by-questionnaire calls service.listByQuestionnaire and resolves the list', async () => {
    const ctx = makeCtx();
    const handlers = answerHandlers(ctx);
    const result = await handlers['answer:list-by-questionnaire']!({ questionnaire_id: 'qs-1' });
    expect(result).toEqual([fakeAnswer]);
    expect(
      (
        ctx as never as {
          answerGenerationService: { listByQuestionnaire: ReturnType<typeof vi.fn> };
        }
      ).answerGenerationService.listByQuestionnaire,
    ).toHaveBeenCalledWith('qs-1');
  });
});
