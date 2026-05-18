import { Data } from 'effect';

export class AirportUnknown extends Data.TaggedError('AirportUnknown')<{ iata: string }> {}

export class AmapApiKeyMissing extends Data.TaggedError('AmapApiKeyMissing')<{}> {}
export class AmapApiError extends Data.TaggedError('AmapApiError')<{ cause: unknown }> {}
export class AmapRateLimited extends Data.TaggedError('AmapRateLimited')<{ retryAfterSec?: number }> {}
export class AmapRouteNotFound extends Data.TaggedError('AmapRouteNotFound')<{ origin: string; dest: string }> {}

export type AmapErr = AmapApiKeyMissing | AmapApiError | AmapRateLimited | AmapRouteNotFound;
export type RoutingErr = AmapErr | AirportUnknown;
