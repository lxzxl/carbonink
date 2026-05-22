// NOTE: CORS headers are applied centrally in `index.ts` via `addCors()` so
// every response (including non-JSON ones) gets credentialed CORS with an
// allowlisted Origin. Keep `json()`/`err()` request-less for simplicity.
export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

export type ErrorTag =
  | 'UnknownKey'
  | 'RevokedLicense'
  | 'DeviceCapReached'
  | 'RateLimited'
  | 'BadRequest'
  | 'Unauthorized'
  | 'NotFound'
  | 'Internal';

export function err(tag: ErrorTag, message: string, status: number): Response {
  return json({ error: { _tag: tag, message } }, status);
}
