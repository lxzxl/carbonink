import type { CredentialService } from '@main/services/credential-service.js';
import {
  apiKeyKeyrefForProvider,
  type ProviderConfig,
  type ProviderConfigV2,
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
 * - The {@link ProviderConfigV2} (provider + model + optional baseUrl — public
 *   metadata) is JSON-serialized into the sqlite `setting` table, keyed by
 *   `llm.provider`. Plain rows so a curious user with a sqlite browser only
 *   sees provider/model + the keyref (a constant like `llm.openai.apikey`),
 *   never the secret.
 * - The plaintext API key is handed off to {@link CredentialService}, which
 *   pushes it through Electron `safeStorage` and lands an encrypted blob in
 *   `<userData>/credentials/{keyref}.bin`. The key never touches sqlite.
 *
 * V1/V2 migration (Item 3, Task 10a): legacy V1 records on disk are silently
 * upgraded to V2 on read via {@link migrateProviderConfig}. {@link
 * saveProviderConfig} accepts either shape during the renderer-cutover window
 * (Task 10b flips the renderer to emit V2 directly), then narrows back to V2
 * once Task 11 deletes V1.
 *
 * Read paths:
 * - {@link getProviderConfig} returns a V1-reconstructed config + a *masked*
 *   preview of the key (`sk-...abcd`) for renderer/UI display. The renderer's
 *   AIProviderSection still hydrates from the V1 discriminated-union shape;
 *   Task 10b switches it to V2 and this method can return V2 directly.
 * - {@link getProviderConfigWithKey} returns the V2 config + the *plaintext*
 *   key. This is the main-process internal entry point used by
 *   `AiClient` and **must not** be exposed via an IPC handler.
 */
export class SettingsService {
  constructor(
    private readonly ctx: ServiceContext & {
      credentials: CredentialService;
    },
  ) {}

  /**
   * Persist a provider config (V2 shape) + its API key.
   *
   * Accepts arbitrary input and runs it through {@link migrateProviderConfig}
   * so renderers that still emit the V1 discriminated-union shape continue
   * to work during the Task 10a/10b transition. Once the renderer is on V2
   * (Task 10b) the caller can pass V2 directly without going through the
   * migrator. Invalid input throws synchronously — the IPC boundary catches
   * and turns it into a Zod-shaped error toast.
   */
  saveProviderConfig(config: ProviderConfigV2 | unknown, apiKeyPlaintext: string): void {
    // `migrateProviderConfig` handles both shapes: it detects V1 markers
    // (`apiKeyKeyref`, azure `resourceName`, openai-compat `name`) and uses
    // them to derive V2 fields (e.g. azure baseUrl from resourceName) BEFORE
    // falling through to the V2 fast path. Going through it always — rather
    // than trying V2's permissive schema first — is what keeps V1 azure's
    // `resourceName` from being silently dropped during the cutover window.
    const parsed = migrateProviderConfig(config);
    if (parsed === null) {
      throw new Error('Invalid provider config (neither V1 nor V2 shape).');
    }

    // Order matters: write the credential first. If saveProviderConfig is
    // ever interrupted, having the key without the config is harmless (the
    // config row simply doesn't exist yet), but having the config without
    // the key would surface as a `ProviderNotConfiguredError` when the
    // user thinks they configured the provider.
    this.ctx.credentials.set(apiKeyKeyrefForProvider(parsed.provider), apiKeyPlaintext);

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
    const apiKeyMasked = this.ctx.credentials.getMasked(apiKeyKeyrefForProvider(config.provider));
    const v1 = v2ToV1(config);
    if (v1 === null) return null;
    return { ...v1, apiKeyMasked };
  }

  /**
   * Main-process-only: returns the config alongside the plaintext key. Used
   * by `AiClient` to build a provider instance. **Never** wire this to an
   * IPC handler — Renderer should only see masked output.
   */
  getProviderConfigWithKey(): { config: ProviderConfigV2; apiKey: string } | null {
    const config = this.readConfig();
    if (config === null) return null;
    const apiKey = this.ctx.credentials.get(apiKeyKeyrefForProvider(config.provider));
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
      this.ctx.credentials.delete(apiKeyKeyrefForProvider(config.provider));
    }
    this.ctx.db.prepare('DELETE FROM setting WHERE key = ?').run(PROVIDER_SETTING_KEY);
  }

  /**
   * Read the stored config and migrate any legacy V1 record on disk to V2.
   * Returns null when the row is absent or unparseable in either shape — the
   * caller treats that as "no provider configured".
   */
  private readConfig(): ProviderConfigV2 | null {
    const row = this.ctx.db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get(PROVIDER_SETTING_KEY) as { value: string } | undefined;
    if (!row) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(row.value);
    } catch {
      return null;
    }
    // migrateProviderConfig handles both already-V2 records (fast path) and
    // legacy V1 rows that pre-date the Task 10a cutover.
    return migrateProviderConfig(raw);
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

/**
 * Reconstruct the V1 discriminated-union shape from a V2 record. Used by
 * {@link SettingsService.getProviderConfig} so the renderer's AIProviderSection
 * can keep hydrating from `existing.resourceName` / `existing.baseUrl` /
 * `existing.name` until Task 10b switches it to V2.
 *
 * Returns null for V2 records whose provider isn't one of the 5 V1 variants
 * (e.g. pi-ai's Kimi / Qwen / Zhipu). Those providers don't have a renderer
 * UI today; the renderer treats null as "no provider configured" and shows
 * the empty form — acceptable until T10b lands.
 *
 * Field defaults for azure `apiVersion` and openai-compat `name` match the
 * V1 schema defaults — the user-set values are LOST by the V1→V2 migration
 * (V2 doesn't carry them) so this reconstruction can only restore defaults.
 */
function v2ToV1(v2: ProviderConfigV2): ProviderConfig | null {
  switch (v2.provider) {
    case 'openai':
      return {
        provider: 'openai',
        model: v2.model,
        apiKeyKeyref: 'llm.openai.apikey',
      };
    case 'anthropic':
      return {
        provider: 'anthropic',
        model: v2.model,
        apiKeyKeyref: 'llm.anthropic.apikey',
      };
    case 'deepseek':
      return {
        provider: 'deepseek',
        model: v2.model,
        apiKeyKeyref: 'llm.deepseek.apikey',
      };
    case 'azure': {
      // Recover `resourceName` from the baseUrl pattern the V1→V2 migration
      // produced: `https://<resourceName>.openai.azure.com`. If baseUrl is
      // missing or doesn't match the pattern, we still try a best-effort
      // reconstruction so the renderer can at least render the form.
      const baseUrl = v2.baseUrl ?? '';
      const match = baseUrl.match(/^https:\/\/([^.]+)\.openai\.azure\.com/);
      const resourceName = match?.[1] ?? '';
      return {
        provider: 'azure',
        model: v2.model,
        apiKeyKeyref: 'llm.azure.apikey',
        resourceName,
        apiVersion: '2024-08-01-preview',
      };
    }
    case 'openai-compat': {
      const baseUrl = v2.baseUrl ?? '';
      if (!baseUrl) return null;
      return {
        provider: 'openai-compat',
        model: v2.model,
        apiKeyKeyref: 'llm.openai-compat.apikey',
        baseUrl,
        name: 'Custom',
      };
    }
    default:
      // pi-ai providers without a V1 counterpart (Kimi, Qwen, Zhipu, etc.).
      // Renderer treats null as "no provider configured" — T10b adds proper
      // V2-shape rendering for these.
      return null;
  }
}
