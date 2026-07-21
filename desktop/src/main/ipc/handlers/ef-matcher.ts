import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

/**
 * Input schema for `ef:recommend`. Mirrors `RecommendQuery` in shared types.
 * Both IDs are required and non-empty.
 */
const recommendQuery = z.object({
  extraction_id: z.string().min(1),
  emission_source_id: z.string().min(1),
});

/** Text-hint variant (batch activity import, one call per confirm-group). */
const textRecommendQuery = z.object({
  hint_text: z.string().min(1).max(500),
  emission_source_id: z.string().min(1),
});

export function efMatcherHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'ef:recommend': async (input) => ctx.efMatcherService.recommend(recommendQuery.parse(input)),
    'ef:recommend-text': async (input) =>
      ctx.efMatcherService.recommendForText(textRecommendQuery.parse(input)),
  };
}
