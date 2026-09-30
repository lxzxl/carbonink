/**
 * One shared translation seam for the `AiErr` union into user-facing copy.
 *
 * Previously every IPC handler hand-rolled its own `_tag` switch (answer.ts
 * with Chinese toasts, settings.ts with English machine codes), so adding a
 * member to the union (e.g. `AiCanceled`) meant touching N switches — and
 * missing one meant a "未知错误" toast. Now the Chinese toast copy lives
 * here, in one function, with an exhaustive switch: a new union member
 * fails typecheck until it gets copy (or an explicit silent `null`).
 *
 * Deliberately NOT here:
 * - settings.ts's English `auth_failed: …` / `provider_error: …` codes —
 *   machine-readable, unlocalized, a different shape for a different reader.
 * - Domain errors from answer-generation (LLMNoData, InventoryEmpty,
 *   QuestionAlreadyAnswered) — those belong to that module, not to the LLM
 *   infrastructure tier.
 * - Abort plumbing (`controller.signal.aborted`, `AbortError`,
 *   `LlmNarrativeCanceled`) — cancellation identity, not error copy.
 */

export interface AiErrLike {
  _tag?: string;
  reason?: unknown;
  cause?: unknown;
  status?: number;
}

/**
 * Chinese toast copy for an `AiErr`-shaped failure, or `null` when the
 * failure must stay silent (caller-driven cancellation — the user asked
 * for it, a toast would be noise).
 */
export function aiErrToast(err: AiErrLike | null | undefined): string | null {
  const tag = err?._tag;
  switch (tag) {
    case 'AiSchemaMismatch':
      return 'LLM 返回的内容格式不符合预期，请重试。';
    case 'AiAuthError':
      return err?.reason === 'missing_key'
        ? 'AI provider 未配置 API key，请在设置中填写后重试。'
        : 'AI provider 鉴权失败，请在设置中检查 API key。';
    case 'AiRateLimited':
      return 'AI provider 限流，请稍后重试。';
    case 'AiTimeout':
      return 'LLM 调用超时，请重试或检查网络。';
    case 'AiCanceled':
      return null;
    case 'AiNoData':
      return 'LLM 未返回任何可解析内容，请重试。';
    case 'AiProviderError': {
      const detail = providerErrorDetail(err?.cause, err?.status);
      return detail ? `LLM 调用失败：${detail}` : 'LLM 调用失败，请检查网络与 API key。';
    }
    default:
      return `生成答案失败：${tag ?? '未知错误'}`;
  }
}

/**
 * Human-readable suffix for an `AiProviderError` toast. Returns an empty
 * string when there's nothing actionable to add (e.g. opaque non-Error
 * cause) so the caller can fall back to the generic copy.
 */
export function providerErrorDetail(cause: unknown, status?: number): string {
  if (typeof cause === 'string' && cause.trim() !== '') return cause.trim();
  if (cause instanceof Error && cause.message.trim() !== '') return cause.message.trim();
  if (status !== undefined) return `HTTP ${status}`;
  return '';
}
