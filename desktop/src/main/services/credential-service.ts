import type { CredentialStore } from '@main/credentials/safe-storage.js';

/**
 * Allowlist rule for `CredentialService.set` / `get` / `delete`.
 *
 * Keys MUST match `llm.{provider}.{slot}` where:
 *   - `{provider}` is a non-empty slug (lowercase, digits, `-`).
 *   - `{slot}` is a non-empty slug describing the credential kind
 *     (e.g. `apikey`).
 *
 * This is defense-in-depth: even if a future bug lets the renderer feed an
 * arbitrary `key` through IPC, the service refuses anything outside this
 * shape, so credentials can't be exfiltrated under fake key names like
 * `secret.token`.
 *
 * The rule is structural (not a static list of provider ids) because Item
 * 3 Task 10c took the renderer off a hardcoded provider list and onto
 * pi-ai's catalog (32+ providers including `azure-openai-responses`,
 * `kimi-coding`, `moonshotai-cn`, …). Hand-maintaining a parallel
 * allowlist here would re-introduce the drift bug class we just closed.
 */
const ALLOWED_KEY_RE = /^llm\.[a-z0-9-]+\.[a-z0-9-]+$/;

function assertAllowedKey(key: string): void {
  if (!ALLOWED_KEY_RE.test(key)) {
    throw new Error('credential key not in allowlist');
  }
}

/**
 * Mask a secret for renderer display.
 *
 * - Strings >= 8 chars: show last 4 + "..." prefix → `"sk-test12345"` → `"sk-...2345"`.
 *   The "sk-" head is preserved when present because it's a public prefix
 *   convention (OpenAI), not part of the secret entropy.
 * - Strings < 8 chars: redact entirely as `***...***` of the same length, so
 *   the masking layer never leaks the suffix of a short token (which would be
 *   nearly the whole thing).
 *
 * Examples:
 *   "sk-test12345"     → "sk-...2345"
 *   "abcd1234"         → "...1234"
 *   "abc"              → "***"
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length < 8) return '*'.repeat(plaintext.length);
  const last4 = plaintext.slice(-4);
  // Preserve a recognizable provider-prefix head ("sk-", "sk-ant-", "azure-", …)
  // up to the first '-' if it falls within the first 8 chars; otherwise no head.
  const dashIdx = plaintext.indexOf('-');
  const head = dashIdx > 0 && dashIdx <= 8 ? plaintext.slice(0, dashIdx + 1) : '';
  return `${head}...${last4}`;
}

export interface CredentialServiceContext {
  store: CredentialStore;
  /**
   * Filesystem-level blob deletion. Injected (not on `CredentialStore`) because
   * Phase 0's abstraction intentionally only knows set/get; the real deleter
   * lives in `safe-storage-backend.ts`. Tests pass a stub.
   */
  deleteBlob: (key: string) => void;
  /**
   * Whether the underlying keychain backend is usable. In production this is
   * `safeStorage.isEncryptionAvailable`. Injected so tests can flip it without
   * mocking `electron` at the module boundary.
   */
  isAvailable: () => boolean;
}

/**
 * IPC-safe wrapper around Phase 0's `CredentialStore`.
 *
 * - `set` / `get` / `delete` enforce a prefix allowlist
 * - `get` returns plaintext and is **main-only** (never wire it to a renderer
 *   IPC channel — the renderer should receive `getMasked` results instead)
 * - `getMasked` is the renderer-safe view: `sk-...abcd`
 * - `isAvailable` lets the UI render an actionable error ("safeStorage not
 *   available on this machine") instead of failing on first save attempt
 */
export class CredentialService {
  constructor(private readonly ctx: CredentialServiceContext) {}

  set(key: string, plaintext: string): void {
    assertAllowedKey(key);
    this.ctx.store.set(key, plaintext);
  }

  get(key: string): string | null {
    assertAllowedKey(key);
    return this.ctx.store.get(key);
  }

  getMasked(key: string): string | null {
    const plaintext = this.get(key);
    if (plaintext === null) return null;
    return maskSecret(plaintext);
  }

  delete(key: string): void {
    assertAllowedKey(key);
    this.ctx.deleteBlob(key);
  }

  /**
   * Whether the underlying OS keychain can encrypt/decrypt. False on machines
   * where `safeStorage.isEncryptionAvailable()` returns false (e.g. headless
   * macOS without keychain) — in which case `set`/`get` would throw, so the UI
   * should disable the credential-saving form.
   */
  isAvailable(): boolean {
    return this.ctx.isAvailable();
  }
}
