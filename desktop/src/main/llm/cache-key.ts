import { createHash } from 'node:crypto';

/**
 * Canonical JSON with sorted object keys (recursive). Array order is
 * preserved — order is semantic there, unlike object keys. Only plain
 * data crosses this boundary (no cycles, no class instances); anything
 * else stringifies the same way `JSON.stringify` would.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .sort();
  return `{${entries.join(',')}}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface CacheKeyParts {
  /** Call-site scope: 'ef-single' | 'ef-text' | 'readiness' | 'classify'. */
  scope: string;
  provider: string;
  model: string;
  /** Prompt/schema version pinned at the call site — bump to invalidate. */
  promptVersion: string;
  /** EF library fingerprint for EF scopes; omit elsewhere. */
  datasetVersion?: string;
  /** Inventory fingerprint for the readiness scope; omit elsewhere. */
  inventoryHash?: string;
  /** The exact input the result depends on. Long payloads hash. */
  payload: unknown;
}

/**
 * Maximum inline payload length inside the semantic key. Above this the
 * payload is replaced by its sha256 hex so `index.json` stays small and
 * carries no prompt content — the full key is still collision-safe
 * because the blob filename is always the hash of the whole key.
 */
const MAX_INLINE_PAYLOAD = 256;

/**
 * Build the caller's semantic cache key. Deterministic: same inputs
 * always produce the same key regardless of object key order. Any input
 * that changes the result MUST be a key input — provider, model, prompt
 * version, dataset version, inventory hash — so upgrades and data edits
 * re-fetch instead of serving stale findings.
 */
export function buildCacheKey(parts: CacheKeyParts): string {
  const payloadJson = stableStringify(parts.payload);
  const payloadPart =
    payloadJson.length > MAX_INLINE_PAYLOAD ? sha256Hex(payloadJson) : payloadJson;
  return [
    parts.scope,
    parts.provider,
    parts.model,
    parts.promptVersion,
    parts.datasetVersion ?? '-',
    parts.inventoryHash ?? '-',
    payloadPart,
  ].join('|');
}
