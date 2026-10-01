import type { ProviderHeaders } from '@earendil-works/pi-ai';

/**
 * OpenCode session routing header (upstream `earendil-works/pi#9326`).
 *
 * The OpenCode gateway (Zen + Go) rejects requests without
 * `x-opencode-session` with `400 MissingSessionID`. pi-ai ≥0.86 maps
 * `options.sessionId` to that header natively — but only for models whose
 * provider id is `opencode`/`opencode-go`. A generic provider id pointed at
 * the OpenCode base URL (via Settings "Override base URL") misses the
 * wrapper, so we inject the header ourselves for any model routing to the
 * OpenCode gateway. Explicit caller headers always win (case-insensitive,
 * mirroring upstream).
 */
export const OPENCODE_SESSION_HEADER = 'x-opencode-session';

const OPENCODE_PROVIDER_IDS: Record<string, true> = {
  opencode: true,
  'opencode-go': true,
};

/** True when the model routes to the OpenCode gateway, by id or base URL. */
export function needsOpenCodeSessionHeader(model: { provider: string; baseUrl: string }): boolean {
  return OPENCODE_PROVIDER_IDS[model.provider] === true || model.baseUrl.includes('opencode.ai');
}

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
  if (!headers) return false;
  const expected = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

/**
 * Return headers carrying `x-opencode-session` for OpenCode-routed models,
 * or `undefined` when no injection is needed (other providers, or the
 * caller already set the header). Never mutates the input.
 */
export function opencodeSessionHeaders(
  model: { provider: string; baseUrl: string },
  sessionId: string,
  headers: ProviderHeaders | undefined,
): ProviderHeaders | undefined {
  if (!needsOpenCodeSessionHeader(model)) return undefined;
  if (hasHeader(headers, OPENCODE_SESSION_HEADER)) return headers;
  return { ...headers, [OPENCODE_SESSION_HEADER]: sessionId };
}
