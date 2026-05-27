import type { CredentialService } from '@main/services/credential-service.js';
import {
  type ProviderConfig,
  type ProviderConfigV2,
  providerConfig,
  providerConfigV2,
} from '@shared/types.js';
import type { ServiceContext } from './base.js';

/**
 * Key used inside the `setting` KV table for the active LLM provider config.
 * Centralized as a constant so handlers/tests can't drift on the spelling.
 */
const PROVIDER_SETTING_KEY = 'llm.provider';
const AMAP_KEY_SETTING = 'routing.amap.apikey';
const AUTO_BACKUP_ENABLED_SETTING = 'auto_backup.enabled';

/**
 * Persistence layer for the user-chosen LLM provider configuration.
 *
 * Split storage:
 * - The {@link ProviderConfig} (model, resourceName, baseUrl, etc. — public
 *   metadata) is JSON-serialized into the sqlite `setting` table, keyed by
 *   `llm.provider`. Plain rows so a curious user with a sqlite browser only
 *   sees provider/model + the keyref (a constant like `llm.openai.apikey`),
 *   never the secret.
 * - The plaintext API key is handed off to {@link CredentialService}, which
 *   pushes it through Electron `safeStorage` and lands an encrypted blob in
 *   `<userData>/credentials/{keyref}.bin`. The key never touches sqlite.
 *
 * Read paths:
 * - {@link getProviderConfig} returns the config + a *masked* preview of the
 *   key (`sk-...abcd`) for renderer/UI display. Safe to send over IPC.
 * - {@link getProviderConfigWithKey} returns the config + the *plaintext*
 *   key. This is the main-process internal entry point used by
 *   `LLMClient` and **must not** be exposed via an IPC handler.
 */
export class SettingsService {
  constructor(
    private readonly ctx: ServiceContext & {
      credentials: CredentialService;
    },
  ) {}

  saveProviderConfig(config: ProviderConfig, apiKeyPlaintext: string): void {
    // Re-parse defensively: callers come from the IPC boundary, and we'd
    // rather throw a ZodError than persist a malformed config that later
    // crashes the LLMClient resolver.
    const parsed = providerConfig.parse(config);

    // Order matters: write the credential first. If saveProviderConfig is
    // ever interrupted, having the key without the config is harmless (the
    // config row simply doesn't exist yet), but having the config without
    // the key would surface as a `ProviderNotConfiguredError` when the
    // user thinks they configured the provider.
    this.ctx.credentials.set(parsed.apiKeyKeyref, apiKeyPlaintext);

    const value = JSON.stringify(parsed);
    const ts = this.ctx.now();
    // sqlite UPSERT keeps this idempotent — calling save twice with the
    // same key updates `value` and `updated_at` in place.
    this.ctx.db
      .prepare(
        `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(PROVIDER_SETTING_KEY, value, ts);
  }

  getProviderConfig(): (ProviderConfig & { apiKeyMasked: string | null }) | null {
    const config = this.readConfig();
    if (config === null) return null;
    const apiKeyMasked = this.ctx.credentials.getMasked(config.apiKeyKeyref);
    return { ...config, apiKeyMasked };
  }

  /**
   * Main-process-only: returns the config alongside the plaintext key. Used
   * by `LLMClient` to build a provider instance. **Never** wire this to an
   * IPC handler — Renderer should only see masked output.
   */
  getProviderConfigWithKey(): { config: ProviderConfig; apiKey: string } | null {
    const config = this.readConfig();
    if (config === null) return null;
    const apiKey = this.ctx.credentials.get(config.apiKeyKeyref);
    if (apiKey === null) return null;
    return { config, apiKey };
  }

  /**
   * Returns the AMap API key stored in the `setting` table, or `null` if not
   * configured. Stored in sqlite (not safeStorage) since AMap keys are short
   * lived and the current threat model does not require OS-level encryption for
   * them.
   */
  getAmapKey(): string | null {
    const row = this.ctx.db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get(AMAP_KEY_SETTING) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Saves (or clears) the AMap API key. Pass an empty string to remove the
   * stored value. Stored in sqlite alongside other settings (not safeStorage —
   * AMap free-tier dev keys are not secrets in the same sense as LLM API keys).
   */
  setAmapKey(value: string): void {
    if (!value.trim()) {
      this.ctx.db.prepare('DELETE FROM setting WHERE key = ?').run(AMAP_KEY_SETTING);
      return;
    }
    const ts = this.ctx.now();
    this.ctx.db
      .prepare(
        `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(AMAP_KEY_SETTING, value.trim(), ts);
  }

  /**
   * Whether the daily auto-backup (run opportunistically at boot, see
   * `auto-backup-service.ts`) should fire. Defaults to **true** — users
   * are protected by default and only an explicit opt-out turns it off.
   * Stored as 'true' / 'false' in the `setting` table so a power user
   * can flip it via sqlite without booting the app.
   */
  getAutoBackupEnabled(): boolean {
    const row = this.ctx.db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get(AUTO_BACKUP_ENABLED_SETTING) as { value: string } | undefined;
    if (!row) return true;
    return row.value !== 'false';
  }

  setAutoBackupEnabled(enabled: boolean): void {
    const ts = this.ctx.now();
    this.ctx.db
      .prepare(
        `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(AUTO_BACKUP_ENABLED_SETTING, enabled ? 'true' : 'false', ts);
  }

  clearProviderConfig(): void {
    const config = this.readConfig();
    if (config !== null) {
      // Best-effort: delete the keychain blob before removing the setting
      // row. Same rationale as `saveProviderConfig` ordering — if we crash
      // mid-clear, a dangling encrypted blob with no referencing config is
      // strictly less bad than a config row pointing at a removed key.
      this.ctx.credentials.delete(config.apiKeyKeyref);
    }
    this.ctx.db.prepare('DELETE FROM setting WHERE key = ?').run(PROVIDER_SETTING_KEY);
  }

  private readConfig(): ProviderConfig | null {
    const row = this.ctx.db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get(PROVIDER_SETTING_KEY) as { value: string } | undefined;
    if (!row) return null;
    // Re-validate on read so a hand-edited sqlite row can't poison the
    // rest of the pipeline with an invalid `provider` discriminator.
    return providerConfig.parse(JSON.parse(row.value));
  }
}

/**
 * Migrate a saved provider config from the v1 discriminated-union shape to
 * the flat v2 shape consumed by pi-ai. Returns `null` when:
 *   - `raw` is not a recognizable v1 or v2 shape (corrupted user data)
 *   - any required field is missing
 *
 * The caller (settings-service read path) handles `null` by sending the user
 * back to onboarding to re-pick a provider.
 *
 * Already-v2 input passes through unchanged.
 */
export function migrateProviderConfig(raw: unknown): ProviderConfigV2 | null {
  if (raw === null || typeof raw !== 'object') return null;

  const rec = raw as Record<string, unknown>;
  const provider = typeof rec.provider === 'string' ? rec.provider : null;
  const model = typeof rec.model === 'string' ? rec.model : null;
  if (!provider || !model) return null;

  // Detect v1 by the presence of any v1-only field that v2 never carries:
  //   - `apiKeyKeyref` is on every v1 variant (literal)
  //   - `resourceName` + `apiVersion` are azure-v1-only
  //   - `name` is openai-compat-v1-only
  // Branching on this first prevents v2's permissive schema from
  // short-circuiting an incomplete v1 azure / openai-compat shape (which
  // would otherwise look like a valid v2 record missing the baseUrl we
  // should have derived).
  const hasV1Marker =
    typeof rec.apiKeyKeyref === 'string' ||
    typeof rec.resourceName === 'string' ||
    typeof rec.apiVersion === 'string' ||
    (provider === 'openai-compat' && typeof rec.name === 'string');
  if (hasV1Marker) {
    switch (provider) {
      case 'openai':
      case 'anthropic':
      case 'deepseek':
        return { provider, model };
      case 'azure': {
        // Old shape: resourceName + apiVersion; pi-ai treats azure as a
        // regular provider whose baseUrl encodes the resource. Reconstruct.
        const resourceName = typeof rec.resourceName === 'string' ? rec.resourceName : null;
        if (!resourceName) return null;
        const baseUrl = `https://${resourceName}.openai.azure.com`;
        return { provider: 'azure', model, baseUrl };
      }
      case 'openai-compat': {
        const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl : null;
        if (!baseUrl) return null;
        return { provider: 'openai-compat', model, baseUrl };
      }
      default:
        return null;
    }
  }

  // Not v1 — try v2. Fast path for re-reads after the first migration write
  // and for any already-flat input.
  const v2Try = providerConfigV2.safeParse(raw);
  if (v2Try.success) return v2Try.data;
  return null;
}
