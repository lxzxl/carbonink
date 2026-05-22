import * as routingSvc from '@main/services/routing/index.js';
import { Cause, Effect, Exit, Option } from 'effect';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const input = z.object({
  mode: z.enum(['driving', 'transit', 'air']),
  origin: z.string().min(1),
  destination: z.string().min(1),
});

export function routingHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'routing:lookup': async (raw) => {
      const parsed = input.parse(raw);
      const exit = await Effect.runPromiseExit(
        routingSvc.lookup(parsed).pipe(Effect.provide(ctx.routingLayer)),
      );
      if (Exit.isSuccess(exit)) {
        return { ok: true as const, ...exit.value };
      }
      const failure = Cause.failureOption(exit.cause);
      const err = Option.isSome(failure) ? (failure.value as { _tag?: string }) : undefined;
      return {
        ok: false as const,
        error: {
          _tag: err?._tag ?? 'UnknownError',
          message: errorMessage(err),
        },
      };
    },
  };
}

function errorMessage(err: { _tag?: string } | undefined): string {
  if (!err?._tag) return 'Unknown error';
  switch (err._tag) {
    case 'AmapApiKeyMissing':
      return 'AMap API key not configured. Open Settings to set it up.';
    case 'AmapRateLimited':
      return 'AMap rate limit reached. Try again later.';
    case 'AmapRouteNotFound':
      return 'AMap could not find a route between these locations.';
    case 'AirportUnknown':
      return `Unknown airport: ${(err as { iata?: string }).iata ?? '?'}`;
    case 'AmapApiError':
    default:
      return 'AMap API error. Check the address format and try again.';
  }
}
