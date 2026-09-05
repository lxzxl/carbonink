import type { Api, Model, Models } from '@earendil-works/pi-ai';

/**
 * Live model discovery for the selected provider (Phase C).
 *
 * pi-ai's bundled catalog is a publish-time snapshot and `Models.refresh()`
 * is a no-op for static built-in providers — so "latest models" for a
 * configured provider (OpenAI, Anthropic, DeepSeek, OpenRouter, …) needs a
 * protocol-level fetch against the provider's own list endpoint.
 *
 * Three protocol families:
 * - **OpenAI-compatible** (`GET {base}/models`, Bearer auth): DeepSeek,
 *   OpenAI, OpenRouter, Moonshot, Kimi, Qwen, Ollama/vLLM/LM Studio and any
 *   `baseUrl`-override self-hosted gateway. OpenRouter's response carries
 *   `supported_parameters` per model, which lets us detect tool-call support.
 * - **Anthropic** (`GET {base}/v1/models`, `x-api-key` + `anthropic-version`).
 * - **Gemini** (`GET {base}/models?key=`, filters `generateContent`).
 *
 * Capability honesty: list endpoints carry ids, not modality metadata.
 * Every fetched entry is marked capability-unknown (`input: ['text']` on the
 * pi side) so the vision gate treats dynamic rows as permissive rather than
 * text-only. Only the non-chat id filter (audio/whisper/embedding/tts/
 * image-generation) is applied here — pi-ai only ships tool-capable chat
 * models, so embedding/TTS/image rows must not leak into the picker.
 *
 * Never throws: all failures surface as `{ok: false, error}` with a short
 * renderer-safe English string (the UI toasts it verbatim).
 */

export interface FetchModelsArgs {
  /** pi-ai provider id, e.g. `deepseek`. */
  provider: string;
  /** Explicit base-URL override (Settings field, Azure/self-hosted). */
  baseUrl?: string;
  /** Plaintext key — in-memory only, never logged or persisted. */
  apiKey: string;
  /** Caller cancellation (Settings "Fetch latest" has no cancel UI; used by tests). */
  signal?: AbortSignal;
}

export type FetchModelsResult =
  | { ok: true; models: Array<Model<Api>> }
  | { ok: false; error: string };

const FETCH_TIMEOUT_MS = 15_000;

/** Id fragments that mark a non-chat row (embedding, TTS, STT, image-gen). */
const NON_CHAT_HINTS = [
  'whisper',
  'tts',
  'embedding',
  'embed',
  'dall-e',
  'dalle',
  'sora',
  'moderation',
  'transcribe',
  'realtime',
  'audio',
  'omni-moderation',
];

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !NON_CHAT_HINTS.some((hint) => lower.includes(hint));
}

/** Strip a trailing `/v1` so endpoint joinery stays predictable. */
function stripV1(base: string): string {
  return base.replace(/\/v1\/?$/, '');
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new Error(signal?.aborted ? 'fetch_canceled' : 'fetch_timeout');
    }
    throw new Error('network_error');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

interface OpenAiListItem {
  id?: string;
  name?: string;
  supported_parameters?: string[];
}

function parseOpenAiList(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data as OpenAiListItem[]) {
    if (item && typeof item.id === 'string' && item.id.length > 0) ids.push(item.id);
  }
  return ids;
}

/** OpenRouter variant: keep only tool-capable rows via `supported_parameters`. */
function parseOpenRouterList(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data as OpenAiListItem[]) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) continue;
    if (Array.isArray(item.supported_parameters) && !item.supported_parameters.includes('tools')) {
      continue;
    }
    ids.push(item.id);
  }
  return ids;
}

interface AnthropicListItem {
  id?: string;
  display_name?: string;
}

function parseAnthropicList(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data as AnthropicListItem[]) {
    if (item && typeof item.id === 'string' && item.id.length > 0) ids.push(item.id);
  }
  return ids;
}

interface GeminiListItem {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

function parseGeminiList(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { models?: unknown }).models;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data as GeminiListItem[]) {
    if (!item || typeof item.name !== 'string') continue;
    if (
      !Array.isArray(item.supportedGenerationMethods) ||
      !item.supportedGenerationMethods.includes('generateContent')
    ) {
      continue;
    }
    // `models/gemini-2.5-flash` → `gemini-2.5-flash`.
    ids.push(item.name.replace(/^models\//, ''));
  }
  return ids;
}

/**
 * Convert fetched ids into pi `Model<Api>` rows by cloning the provider's
 * bundled template transport (`api`, `baseUrl`, `provider`, `headers`,
 * `compat`) and swapping `id`/`name`. Metadata (`cost`, `contextWindow`,
 * `maxTokens`) is the template's approximation; `reasoning` stays off and
 * `input` stays `['text']` (capability-unknown, see module doc).
 */
export function toDynamicModels(template: Model<Api>, ids: string[]): Array<Model<Api>> {
  const { thinkingLevelMap: _dropped, ...rest } = template;
  return ids.map((id) => ({ ...rest, id, name: id, reasoning: false, input: ['text'] }));
}

export async function fetchModelsForProvider(
  collections: Models,
  args: FetchModelsArgs,
): Promise<FetchModelsResult> {
  const { provider, apiKey, signal } = args;
  if (!apiKey) return { ok: false, error: 'missing_api_key' };

  // Template = first bundled entry: carries the transport fields the clone
  // needs. No bundled entry → unknown provider, nothing to clone from.
  const template = collections.getModels(provider)[0] as Model<Api> | undefined;
  if (!template) return { ok: false, error: 'unknown_provider' };

  const base = stripV1(args.baseUrl?.trim() || template.baseUrl || '');
  if (!base) return { ok: false, error: 'no_endpoint' };

  try {
    // Route by provider family. Anthropic + Gemini have fixed hosts in the
    // bundled catalog; an explicit baseUrl override still wins (proxies).
    if (provider === 'anthropic') {
      const { status, body } = await fetchJson(
        joinUrl(base, 'v1/models'),
        {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal,
      );
      if (status === 401 || status === 403) return { ok: false, error: 'auth_failed' };
      if (status < 200 || status >= 300) return { ok: false, error: `http_${status}` };
      const ids = parseAnthropicList(body).filter(isChatModel);
      return { ok: true, models: toDynamicModels(template, ids) };
    }
    if (provider === 'google' || provider === 'google-vertex') {
      const url = `${joinUrl(base, 'models')}?key=${encodeURIComponent(apiKey)}`;
      const { status, body } = await fetchJson(url, {}, signal);
      if (status === 400 || status === 403) return { ok: false, error: 'auth_failed' };
      if (status < 200 || status >= 300) return { ok: false, error: `http_${status}` };
      const ids = parseGeminiList(body).filter(isChatModel);
      return { ok: true, models: toDynamicModels(template, ids) };
    }
    // Default: OpenAI-compatible `/v1/models` (covers deepseek/openai/
    // moonshot/kimi/qwen/self-hosted + OpenRouter with its tool filter).
    const { status, body } = await fetchJson(
      joinUrl(base, 'v1/models'),
      {
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    );
    if (status === 401 || status === 403) return { ok: false, error: 'auth_failed' };
    if (status < 200 || status >= 300) return { ok: false, error: `http_${status}` };
    const parse = provider === 'openrouter' ? parseOpenRouterList : parseOpenAiList;
    const ids = parse(body).filter(isChatModel);
    return { ok: true, models: toDynamicModels(template, ids) };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? 'fetch_failed' };
  }
}
