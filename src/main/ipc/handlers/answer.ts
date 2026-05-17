import * as answerSvc from '@main/services/answer-generation/index.js';
import { Effect, Either } from 'effect';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const generateInput = z.object({ question_id: z.string().min(1) });
const saveInput = z.object({
  question_id: z.string().min(1),
  value: z.string(),
  unit: z.string().nullable(),
  finalize: z.boolean(),
});
const listInput = z.object({ questionnaire_id: z.string().min(1) });

export function answerHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'answer:generate': async (input) => {
      const parsed = generateInput.parse(input);
      const config = ctx.providerConfig;
      if (!config) {
        throw new Error('AI provider not configured. Open Settings to set up.');
      }
      return Effect.runPromise(
        answerSvc.generate(parsed.question_id, config).pipe(Effect.provide(ctx.answerLayer)),
      );
    },
    'answer:save': async (input) => {
      const parsed = saveInput.parse(input);
      return Effect.runPromise(answerSvc.save(parsed).pipe(Effect.provide(ctx.answerLayer)));
    },
    'answer:list-by-questionnaire': async (input) => {
      const parsed = listInput.parse(input);
      return Effect.runPromise(
        answerSvc
          .listByQuestionnaire(parsed.questionnaire_id)
          .pipe(Effect.provide(ctx.answerLayer)),
      );
    },
    'answer:generate-all-unanswered': async (input) => {
      const parsed = listInput.parse(input);
      if (!ctx.providerConfig) {
        throw new Error('AI provider not configured. Open Settings to set up.');
      }
      const results = await Effect.runPromise(
        answerSvc
          .generateAllUnanswered(parsed.questionnaire_id, ctx.providerConfig)
          .pipe(Effect.provide(ctx.answerLayer)),
      );
      return results.map((r) =>
        Either.match(r, {
          onRight: (value) => ({ ok: true as const, result: { value } }),
          onLeft: (error) => ({
            ok: false as const,
            result: {
              error: {
                _tag: error._tag,
                message: 'cause' in error ? String(error.cause) : error._tag,
              },
            },
          }),
        }),
      );
    },
  };
}
