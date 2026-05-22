import { Effect, Schedule } from 'effect';
import {
  AmapApiError,
  AmapApiKeyMissing,
  type AmapErr,
  AmapRateLimited,
  AmapRouteNotFound,
} from './errors.js';

const AMAP_BASE = 'https://restapi.amap.com/v3';
const RETRY_SCHEDULE = Schedule.exponential('200 millis').pipe(
  Schedule.compose(Schedule.recurs(2)),
);

interface AmapDirectionResponse {
  status: '0' | '1';
  info: string;
  infocode: string;
  route?: { paths?: { distance: string }[]; transits?: { distance: string }[] };
}

export interface AmapDeps {
  apiKey: string;
  fetch?: typeof fetch;
}

export function distanceByAddressAmap(
  deps: AmapDeps,
  mode: 'driving' | 'transit',
  origin: string,
  destination: string,
): Effect.Effect<number, AmapErr, never> {
  if (!deps.apiKey) return Effect.fail(new AmapApiKeyMissing());

  const endpoint = mode === 'driving' ? '/direction/driving' : '/direction/transit/integrated';
  const url =
    `${AMAP_BASE}${endpoint}?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}&key=${deps.apiKey}`;

  return Effect.tryPromise({
    try: async (): Promise<number> => {
      const res = await (deps.fetch ?? fetch)(url);
      const body = (await res.json()) as AmapDirectionResponse;
      if (body.status !== '1') {
        if (body.infocode === '10003' || body.infocode === '10004') {
          throw new AmapRateLimited({});
        }
        if (body.infocode === '20800') {
          throw new AmapRouteNotFound({ origin, dest: destination });
        }
        throw new AmapApiError({ cause: body.info });
      }
      const meters =
        mode === 'driving'
          ? Number(body.route?.paths?.[0]?.distance)
          : Number(body.route?.transits?.[0]?.distance);
      if (!Number.isFinite(meters)) {
        throw new AmapApiError({ cause: 'unexpected response shape' });
      }
      return Math.round(meters / 1000);
    },
    catch: (e): AmapErr =>
      e instanceof AmapApiKeyMissing
        ? e
        : e instanceof AmapRateLimited
          ? e
          : e instanceof AmapRouteNotFound
            ? e
            : e instanceof AmapApiError
              ? e
              : new AmapApiError({ cause: e }),
  }).pipe(
    Effect.retry({
      schedule: RETRY_SCHEDULE,
      while: (err): err is AmapApiError => err._tag === 'AmapApiError',
    }),
  );
}
