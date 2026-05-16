import { Effect } from 'effect';
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
      return Effect.runPromise(ctx.answerGenerationService.generate(parsed.question_id));
    },
    'answer:save': async (input) => {
      const parsed = saveInput.parse(input);
      return Effect.runPromise(ctx.answerGenerationService.save(parsed));
    },
    'answer:list-by-questionnaire': async (input) => {
      const parsed = listInput.parse(input);
      return Effect.runPromise(
        ctx.answerGenerationService.listByQuestionnaire(parsed.questionnaire_id),
      );
    },
  };
}
