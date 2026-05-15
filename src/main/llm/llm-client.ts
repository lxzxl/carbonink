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
  ): Promise<{
    recommendations: Array<{
      factor_code: string;
      year: number;
      source: string;
      geography: string;
      dataset_version: string;
      reasoning_zh: string;
    }>;
  }> {
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
        return `${i + 1}. ${c.factor_code} | ${c.year} | ${c.geography} | ${c.input_unit ?? '?'} | ${c.co2e_kg_per_unit ?? '?'} kgCO2e/unit | ${name}${desc ? ` — ${desc}` : ''}`;
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

  /**
   * Extract questions from a flat list of Excel cells. Used by Phase 2.2a's
   * questionnaire pipeline to find Q/A pairs in a CDP-style questionnaire.
   *
   * Returns an empty list if `cells` is empty (no LLM call fired). Caller
   * persists the returned records to the `question` table.
   *
   * The LLM is asked to:
   *   - ignore section headers / table-of-contents rows
   *   - identify the answer cell (typically next-column-to-question)
   *   - extract any expected_unit from the question wording
   */
  async extractQuestions(
    config: ProviderConfig,
    cells: ReadonlyArray<{
      sheet: string;
      row: number;
      col: number;
      value: string | number | null;
      ref: string;
    }>,
  ): Promise<{
    questions: Array<{
      raw_text: string;
      normalized_text: string;
      answer_cell_ref: string | null;
      expected_unit: string | null;
      sheet: string;
      question_row: number;
    }>;
  }> {
    if (cells.length === 0) return { questions: [] };

    const schema = z.object({
      questions: z
        .array(
          z.object({
            raw_text: z.string(),
            normalized_text: z.string(),
            answer_cell_ref: z.string().nullable(),
            expected_unit: z.string().nullable(),
            sheet: z.string(),
            question_row: z.number().int(),
          }),
        )
        .max(500),
    });

    // Group cells by (sheet, row) for compact prompt encoding.
    const bySheet = new Map<string, Map<number, (typeof cells)[number][]>>();
    for (const c of cells) {
      if (!bySheet.has(c.sheet)) bySheet.set(c.sheet, new Map());
      const sheetMap = bySheet.get(c.sheet);
      if (!sheetMap) continue;
      if (!sheetMap.has(c.row)) sheetMap.set(c.row, []);
      sheetMap.get(c.row)?.push(c);
    }

    let cellsText = '';
    for (const [sheetName, rowsMap] of bySheet) {
      cellsText += `\n=== Sheet "${sheetName}" ===\n`;
      const sortedRows = Array.from(rowsMap.keys()).sort((a, b) => a - b);
      for (const rowNum of sortedRows) {
        const rowCells = (rowsMap.get(rowNum) ?? []).sort((a, b) => a.col - b.col);
        const parts = rowCells.map((c) => `${c.ref}=${JSON.stringify(c.value)}`);
        cellsText += `Row ${rowNum}: ${parts.join(' | ')}\n`;
      }
    }

    const prompt = `你是一名碳核算助理。下面是一份 CDP 风格的供应商问卷 Excel 表所有非空单元格的清单。请识别出每道**问题**，并指出其**答案应该填入哪个单元格**。

规则：
- 忽略目录、章节标题、表头说明、纯空白行。
- 一道问题通常占一行：问题文本在某一列，紧邻的右侧空单元格就是答案位置。
- 如果一行有"题面 + 单位列 + 答案列"，那答案在最右边的空列。
- 题面应该是个真正可被回答的问题（含数字、范围、是非等可量化语义），而非说明性文字。
- 提取问题原文 (raw_text)，并给出规范化版本 (normalized_text，去标点、去前缀编号、单空格)。
- 如能从题面推断单位（kWh、tCO2e、m³、% 等），写入 expected_unit；否则 null。
- answer_cell_ref：填入答案的目标单元格 ref（同 sheet，紧挨题面的空单元格）；如果不能确定，置 null。
- 排除任何已经填了数字/答案的单元格（那是示例值或别人答过的）。

<cells>
${cellsText}
</cells>

返回 JSON: { questions: [{ raw_text, normalized_text, answer_cell_ref, expected_unit, sheet, question_row }] }`;

    return this.extract(config, schema, prompt);
  }

  /**
   * Classify a document into one of the 5 supported stage types.
   *
   * Text-first: if `parsedText` is non-empty, uses cheap text-only mode.
   * Otherwise falls back to vision (if images are provided).
   *
   * Returns `doc_type: null` for the explicit 'unknown' enum value OR
   * when the input is empty (no text and no images). Caller applies its
   * own confidence threshold on top.
   */
  async classifyDocument(
    config: ProviderConfig,
    parsedText: string | null,
    images: Buffer[] = [],
  ): Promise<{ doc_type: string | null; confidence: number }> {
    const schema = z.object({
      doc_type: z.enum([
        'china_utility.v1',
        'fuel_receipt.v1',
        'freight.v1',
        'purchase.v1',
        'travel.v1',
        'unknown',
      ]),
      confidence: z.number().min(0).max(1),
    });

    const text = (parsedText ?? '').trim();
    if (!text && images.length === 0) {
      return { doc_type: null, confidence: 0 };
    }

    const prompt = `你是一名碳核算助理。请判断下面这份单据属于以下哪一类。如果不能确定（80% 以下），请返回 "unknown"。

类型清单：
- china_utility.v1: 中国电费缴费通知单 / 电网账单 (供电公司、户号、用电量 kWh、计费周期、应缴电费)
- fuel_receipt.v1: 加油发票 / 燃油票 (加油站、油品类型、升数、单价、车牌号)
- freight.v1: 货物运输发票 / 物流单 (承运方、运输方式、起运地、到达地、货物重量、运费)
- purchase.v1: 采购发票 / 增值税发票 (销售方、商品名称、数量、金额)
- travel.v1: 差旅票据 / 机票 / 高铁票 / 出租车票 (承运方、旅客、出发地、目的地、舱位)

<document>
${text || '(no parsed text — see attached images)'}
</document>

返回 JSON: { doc_type: <类型 ID 或 "unknown">, confidence: <0..1 的浮点数> }`;

    let result: { doc_type: string; confidence: number };
    if (text) {
      result = await this.extract(config, schema, prompt);
    } else {
      // Vision path — pass the images via extractWithImages.
      const vision: VisionMessages = { userText: prompt };
      result = await this.extractWithImages(config, schema, vision, images);
    }

    return {
      doc_type: result.doc_type === 'unknown' ? null : result.doc_type,
      confidence: result.confidence,
    };
  }
}
