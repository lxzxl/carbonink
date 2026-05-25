import type { CredentialService } from '@main/services/credential-service.js';
import { type ProviderConfig, providerConfig } from '@shared/types.js';
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
