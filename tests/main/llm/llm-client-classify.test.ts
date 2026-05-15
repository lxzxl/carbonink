import { LLMClient } from '@main/llm/llm-client';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const fakeConfig: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey',
};

describe('LLMClient.classifyDocument', () => {
  it('text-only path: returns the doc_type when LLM responds with a known stage', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      doc_type: 'fuel_receipt.v1',
      confidence: 0.92,
    } as unknown as never);

    const result = await client.classifyDocument(fakeConfig, '中国石化加油 0号柴油 45.6升 357.96元', []);

    expect(result.doc_type).toBe('fuel_receipt.v1');
    expect(result.confidence).toBe(0.92);
    expect(stub).toHaveBeenCalledTimes(1);
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    expect(prompt).toContain('中国石化');
  });

  it("returns doc_type=null when LLM responds with 'unknown'", async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    vi.spyOn(client, 'extract').mockResolvedValue({
      doc_type: 'unknown',
      confidence: 0.55,
    } as unknown as never);

    const result = await client.classifyDocument(fakeConfig, 'random text', []);
    expect(result.doc_type).toBeNull();
    expect(result.confidence).toBe(0.55);
  });

  it('vision fallback: when parsedText is empty AND images is non-empty, uses extractWithImages', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const textStub = vi.spyOn(client, 'extract');
    const visionStub = vi.spyOn(client, 'extractWithImages').mockResolvedValue({
      doc_type: 'travel.v1',
      confidence: 0.85,
    } as unknown as never);

    const result = await client.classifyDocument(fakeConfig, '', [Buffer.from('fake-png')]);

    expect(textStub).not.toHaveBeenCalled();
    expect(visionStub).toHaveBeenCalledTimes(1);
    expect(result.doc_type).toBe('travel.v1');
  });

  it('returns doc_type=null when neither text nor images are provided', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const result = await client.classifyDocument(fakeConfig, '', []);
    expect(result.doc_type).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
