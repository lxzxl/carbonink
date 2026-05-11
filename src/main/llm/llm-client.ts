import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfig } from '@shared/types.js';
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';

/**
 * Thrown by `LLMClient.getModel` when the provider's API key is not present
 * in the credential store. The caller (UI) should prompt the user to open
 * Settings and configure a key for this provider.
 *
 * Not a generic `Error` so the IPC layer / UI can `instanceof` it and render
 * a localized message rather than a stringy "No API key set for…" leak.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(public readonly provider: string) {
    super(`No API key set for provider: ${provider}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * Lightweight schema used by {@link LLMClient.ping}. We need a real zod schema
 * because AI SDK's `generateObject` validates the model response — a JSON
 * Schema literal would not type-check against the `schema` parameter.
 */
const pingSchema = z.object({ ok: z.boolean() });

/**
 * Thin wrapper around Vercel AI SDK 6's `generateObject` that fixes the
 * provider-instance / credential-lookup boilerplate in one place.
 *
 * Design:
 * - `extract` is the single entry point for structured extraction; the caller
 *   passes the {@link ProviderConfig} (chosen + persisted by SettingsService),
 *   a zod schema (usually from a Stage Registry entry), and a prompt string.
 * - `ping` is a "Test connection" lightweight call used by the Settings UI:
 *   it issues a trivial `generateObject({ ok: boolean })` request and
 *   returns a normalized success/failure object instead of throwing.
 * - `getModel` is private: it consults `CredentialService` for the key and
 *   constructs an AI SDK provider instance lazily — the renderer can never
 *   reach a model object directly because key lookup happens inside the
 *   main-process service boundary.
 */
export class LLMClient {
  constructor(private readonly ctx: { credentials: CredentialService }) {}

  /**
   * Resolve a {@link ProviderConfig} + the credential store into an AI SDK
   * model instance. Throws {@link ProviderNotConfiguredError} when the API
   * key for `config.apiKeyKeyref` is absent.
   *
   * Each AI SDK provider factory (e.g. `createOpenAI`) returns a callable
   * `Provider`: invoking it with a model id (`createOpenAI({ apiKey })('gpt-4o')`)
   * yields a `LanguageModel`. The switch handles each provider's own settings
   * shape.
   */
  private getModel(config: ProviderConfig): LanguageModel {
    const apiKey = this.ctx.credentials.get(config.apiKeyKeyref);
    if (apiKey === null) {
      throw new ProviderNotConfiguredError(config.provider);
    }

    switch (config.provider) {
      case 'openai':
        return createOpenAI({ apiKey })(config.model);
      case 'anthropic':
        return createAnthropic({ apiKey })(config.model);
      case 'azure':
        return createAzure({
          apiKey,
          resourceName: config.resourceName,
          apiVersion: config.apiVersion,
        })(config.model);
      case 'deepseek':
        return createDeepSeek({ apiKey })(config.model);
      case 'openai-compat':
        return createOpenAICompatible({
          apiKey,
          baseURL: config.baseUrl,
          name: config.name,
        })(config.model);
    }
  }

  /**
   * Run a structured extraction. The zod `schema` both enforces and parses
   * the model's response; the returned value is `schema`'s inferred type.
   *
   * Throws {@link ProviderNotConfiguredError} if no API key is set. Other
   * failures (network, provider errors) propagate from `generateObject`.
   */
  async extract<T>(config: ProviderConfig, schema: z.ZodType<T>, prompt: string): Promise<T> {
    const model = this.getModel(config);
    const result = await generateObject({ model, schema, prompt });
    return result.object;
  }

  /**
   * Lightweight health check. Issues a trivial `generateObject` call to
   * verify the API key works and the provider is reachable. Used by the
   * Settings UI's "Test connection" button.
   *
   * Returns `{ ok: true }` on success or `{ ok: false, error }` on any
   * failure (including {@link ProviderNotConfiguredError}). Never throws —
   * the UI can render the error string directly.
   */
  async ping(config: ProviderConfig): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const model = this.getModel(config);
      await generateObject({
        model,
        schema: pingSchema,
        prompt: 'Reply with {"ok": true}',
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }
}
