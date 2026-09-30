import { aiErrToast, providerErrorDetail } from '@main/llm/error-copy';
import { AiAuthError, AiCanceled, AiNoData, AiProviderError } from '@main/llm/errors';
import { describe, expect, it } from 'vitest';

describe('aiErrToast — one translation seam for the AiErr union', () => {
  it('translates every Ai tag to its Chinese copy', () => {
    expect(aiErrToast({ _tag: 'AiSchemaMismatch' })).toBe('LLM 返回的内容格式不符合预期，请重试。');
    expect(aiErrToast({ _tag: 'AiRateLimited' })).toBe('AI provider 限流，请稍后重试。');
    expect(aiErrToast({ _tag: 'AiTimeout' })).toBe('LLM 调用超时，请重试或检查网络。');
    expect(aiErrToast({ _tag: 'AiNoData' })).toBe('LLM 未返回任何可解析内容，请重试。');
  });

  it('distinguishes missing vs rejected keys', () => {
    expect(aiErrToast({ _tag: 'AiAuthError', reason: 'missing_key' })).toContain('未配置 API key');
    expect(aiErrToast({ _tag: 'AiAuthError', reason: 'rejected' })).toContain('鉴权失败');
  });

  it('surfaces provider causes, falls back when opaque', () => {
    expect(aiErrToast({ _tag: 'AiProviderError', cause: 'boom', status: 503 })).toBe(
      'LLM 调用失败：boom',
    );
    expect(aiErrToast({ _tag: 'AiProviderError', status: 503 })).toBe('LLM 调用失败：HTTP 503');
    expect(aiErrToast({ _tag: 'AiProviderError' })).toBe('LLM 调用失败，请检查网络与 API key。');
  });

  it('AiCanceled is silent (null) — callers swallow it', () => {
    expect(aiErrToast({ _tag: 'AiCanceled' })).toBeNull();
    expect(aiErrToast(new AiCanceled({}))).toBeNull();
  });

  it('unknown tags degrade to the 生成答案失败 copy, never empty', () => {
    expect(aiErrToast({ _tag: 'SomethingNew' })).toBe('生成答案失败：SomethingNew');
    expect(aiErrToast(null)).toBe('生成答案失败：未知错误');
    expect(aiErrToast(undefined)).toBe('生成答案失败：未知错误');
  });

  it('accepts real tagged-error instances (not just shapes)', () => {
    expect(aiErrToast(new AiAuthError({ provider: 'openai', reason: 'missing_key' }))).toContain(
      '未配置 API key',
    );
    expect(aiErrToast(new AiNoData({}))).toBe('LLM 未返回任何可解析内容，请重试。');
    expect(aiErrToast(new AiProviderError({ cause: new Error('ECONNREFUSED') }))).toBe(
      'LLM 调用失败：ECONNREFUSED',
    );
  });
});

describe('providerErrorDetail', () => {
  it('prefers string causes, then Error messages, then HTTP status', () => {
    expect(providerErrorDetail('  boom  ', 500)).toBe('boom');
    expect(providerErrorDetail(new Error('ECONNREFUSED'), 500)).toBe('ECONNREFUSED');
    expect(providerErrorDetail(undefined, 503)).toBe('HTTP 503');
    expect(providerErrorDetail({ weird: 'object' }, undefined)).toBe('');
    expect(providerErrorDetail(undefined, undefined)).toBe('');
  });
});
