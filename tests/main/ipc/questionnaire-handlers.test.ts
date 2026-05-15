import { questionnaireHandlers } from '@main/ipc/handlers/questionnaire';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  return {
    questionnaireService: {
      createFromUpload: vi.fn().mockResolvedValue({ questionnaire_id: 'q-1', question_count: 5 }),
      list: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
    },
  } as unknown as never;
}

describe('questionnaire:* handlers', () => {
  it('questionnaire:create zod-rejects empty input', async () => {
    const handlers = questionnaireHandlers(makeCtx());
    await expect(handlers['questionnaire:create']!({} as never)).rejects.toThrow();
  });

  it('questionnaire:create rejects missing customer_name', async () => {
    const handlers = questionnaireHandlers(makeCtx());
    await expect(
      handlers['questionnaire:create']!({
        reporting_year: 2026,
        due_date: null,
        file_bytes: new Uint8Array([0]),
        filename: 'q.xlsx',
      } as never),
    ).rejects.toThrow();
  });

  it('questionnaire:create delegates to service on valid input', async () => {
    const ctx = makeCtx();
    const handlers = questionnaireHandlers(ctx);
    const r = await handlers['questionnaire:create']!({
      customer_name: 'Acme',
      reporting_year: 2026,
      due_date: '2026-12-31',
      file_bytes: new Uint8Array([0, 1, 2]),
      filename: 'q.xlsx',
    });
    expect(r.questionnaire_id).toBe('q-1');
    expect(
      (ctx as never as { questionnaireService: { createFromUpload: ReturnType<typeof vi.fn> } })
        .questionnaireService.createFromUpload,
    ).toHaveBeenCalledOnce();
  });

  it('questionnaire:list delegates to service.list', () => {
    const ctx = makeCtx();
    const handlers = questionnaireHandlers(ctx);
    handlers['questionnaire:list']!();
    expect(
      (ctx as never as { questionnaireService: { list: ReturnType<typeof vi.fn> } })
        .questionnaireService.list,
    ).toHaveBeenCalledOnce();
  });

  it('questionnaire:get-by-id zod-rejects empty id', () => {
    const handlers = questionnaireHandlers(makeCtx());
    expect(() => handlers['questionnaire:get-by-id']!({ id: '' } as never)).toThrow();
  });

  it('questionnaire:get-by-id delegates on valid id', () => {
    const ctx = makeCtx();
    const handlers = questionnaireHandlers(ctx);
    handlers['questionnaire:get-by-id']!({ id: 'q-1' });
    expect(
      (ctx as never as { questionnaireService: { getById: ReturnType<typeof vi.fn> } })
        .questionnaireService.getById,
    ).toHaveBeenCalledWith('q-1');
  });
});
