import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { VisionMessages } from '@main/llm/stages/types.js';
import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfig } from '@shared/types.js';
import { generateObject, type LanguageModel, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';

/**
 * Thrown when the model returned a response but it didn't match the requested
 * zod schema. We capture the raw text so the UI can surface what the model
 * actually said (truncated, sanitized) — far more actionable than the generic
 * "extraction failed" message.
 *
 * Common with providers that lack native JSON Schema mode (DeepSeek,
 * OpenAI-compat endpoints). AI SDK falls back to "compatibility mode" which
 * injects the schema into the system message; if the model returns markdown
 * fences, prose, or omits required fields, validation fails here.
 */
export class SchemaMismatchError extends Error {
  constructor(
    public readonly provider: string,
    public readonly rawText: string | undefined,
    cause?: unknown,
  ) {
    const preview = rawText ? rawText.slice(0, 200) : '(no text captured)';
    super(
      `Model (${provider}) returned a response that did not match the expected schema. ` +
        `Raw preview: ${preview}`,
    );
    this.name = 'SchemaMismatchError';
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

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
   * `overrideApiKey` lets the Settings UI "Test connection" path supply a
   * key the user has typed but not yet saved — bypassing the credential
   * lookup keeps the keychain free of unverified secrets. The override is
   * never persisted by this client (callers that want persistence go
   * through `SettingsService.saveProviderConfig`).
   *
   * Each AI SDK provider factory (e.g. `createOpenAI`) returns a callable
   * `Provider`: invoking it with a model id (`createOpenAI({ apiKey })('gpt-4o')`)
   * yields a `LanguageModel`. The switch handles each provider's own settings
   * shape.
   */
  private getModel(config: ProviderConfig, overrideApiKey?: string): LanguageModel {
    const apiKey = overrideApiKey ?? this.ctx.credentials.get(config.apiKeyKeyref);
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
    try {
      // `mode: 'json'` forces JSON-mode where supported and reliably falls
      // back to system-message schema injection elsewhere. Default 'auto'
      // picked tool-calling for OpenAI and compatibility mode for DeepSeek,
      // and the auto-detection logged a warning at runtime ("…used in a
      // compatibility mode…"). Setting json explicitly silences the warning
      // and gives us the same behavior across all providers.
      const result = await generateObject({ model, schema, prompt, mode: 'json' });
      return result.object;
    } catch (err) {
      // `NoObjectGeneratedError` is AI SDK's signal that the model responded
      // but the response failed schema validation (or wasn't valid JSON).
      // Capture the raw text so the IPC sanitize layer can include a useful
      // preview in the user-facing error (without leaking the API key or
      // other secrets — the raw text is just the model's response).
      if (NoObjectGeneratedError.isInstance(err)) {
        throw new SchemaMismatchError(config.provider, err.text, err);
      }
      throw err;
    }
  }

  /**
   * Variant of `extract` for image inputs. Builds a multipart user
   * message — one text part followed by one image part per buffer —
   * and calls AI SDK 6's `generateObject` with `mode: 'json'`.
   *
   * The image parts use AI SDK's `{ type: 'image', image: Buffer }`
   * shape. The SDK is responsible for base64-encoding and selecting
   * the right MIME type per provider; PNG buffers (what `pdfToImages`
   * produces) are universally accepted.
   *
   * Schema validation + error translation matches `extract`:
   * NoObjectGeneratedError → SchemaMismatchError with a raw-text
   * preview.
   */
  async extractWithImages<T>(
    config: ProviderConfig,
    schema: z.ZodType<T>,
    vision: VisionMessages,
    images: Buffer[],
  ): Promise<T> {
    const model = this.getModel(config);

    // AI SDK 6 message shape: each role-message has `content` that's
    // either a string OR an array of typed parts. We always use the
    // array form for the user turn so adding more content types in
    // the future is non-breaking.
    const userContent: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer }> = [
      { type: 'text', text: vision.userText },
      ...images.map((image) => ({ type: 'image' as const, image })),
    ];

    const messages = vision.system
      ? [
          { role: 'system' as const, content: vision.system },
          { role: 'user' as const, content: userContent },
        ]
      : [{ role: 'user' as const, content: userContent }];

    try {
      const result = await generateObject({
        model,
        schema,
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK's `messages` union is too broad for our narrowed multipart shape.
        messages: messages as any,
        mode: 'json',
      });
      return result.object;
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        throw new SchemaMismatchError(config.provider, err.text, err);
      }
      throw err;
    }
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
    return this.pingInternal(config);
  }

  /**
   * Variant of {@link ping} that uses an explicit plaintext key instead of
   * the credential store. Lets the Settings UI verify a key before the user
   * commits to saving it. The key is held in-memory for the duration of
   * this call and never persisted by this client.
   */
  async pingWithKey(
    config: ProviderConfig,
    overrideApiKey: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.pingInternal(config, overrideApiKey);
  }

  private async pingInternal(
    config: ProviderConfig,
    overrideApiKey?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const model = this.getModel(config, overrideApiKey);
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

  /**
   * Ask the LLM to pick the 3 most-relevant emission factors from a
   * pre-filtered candidate list. Used by EfMatcherService to overlay
   * "Recommended for this document" suggestions on the EF picker.
   *
   * Inputs:
   * - `parsedJson`: the extraction's parsed_json string.
   * - `candidates`: the FTS5-ranked candidate list (max 20 rows).
   *
   * Output: zod-validated `{ recommendations: 3 × {composite_pk, reasoning_zh} }`.
   * Throws if the model fails schema validation (caller catches and
   * falls back to FTS5-only).
   */
  async recommendEfs(
    config: ProviderConfig,
    parsedJson: string,
    candidates: ReadonlyArray<{
      factor_code: string;
      year: number;
      source: string;
      geography: string;
      dataset_version: string;
      input_unit?: string;
      name_zh?: string | null;
      name_en?: string | null;
      description_zh?: string | null;
      co2e_kg_per_unit?: number;
    }>,
  ): Promise<{ recommendations: Array<{ factor_code: string; year: number; source: string; geography: string; dataset_version: string; reasoning_zh: string }> }> {
    const schema = z.object({
      recommendations: z
        .array(
          z.object({
            factor_code: z.string(),
            year: z.number().int(),
            source: z.string(),
            geography: z.string(),
            dataset_version: z.string(),
            reasoning_zh: z.string().max(200),
          }),
        )
        .length(3),
    });

    const candidateList = candidates
      .map((c, i) => {
        const name = c.name_zh ?? c.name_en ?? c.factor_code;
        const desc = c.description_zh ?? '';
        return `${i + 1}. ${c.factor_code} | ${c.year} | ${c.geography} | ${c.input_unit ?? '?'} | ${c.co2e_kg_per_unit ?? '?'} kgCO2e/unit | ${name}${desc ? ' — ' + desc : ''}`;
      })
      .join('\n');

    const prompt = `你是一名碳核算助理。下面是一份单据的抽取结果（parsed_json），以及一个候选排放因子清单。
请从候选清单中选出最贴合该单据的 3 个排放因子，并给出 1-2 句简短的中文理由。

<parsed_json>
${parsedJson}
</parsed_json>

<candidates>
${candidateList}
</candidates>

返回 JSON：{ recommendations: [3 个对象，每个包含完整复合主键 factor_code/year/source/geography/dataset_version 以及 reasoning_zh] }。
factor_code 等 5 个键必须从上方候选清单中原样复制；不要凭空构造。`;

    return this.extract(config, schema, prompt);
  }
}
