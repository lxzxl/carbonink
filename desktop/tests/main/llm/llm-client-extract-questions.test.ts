import { LLMClient } from '@main/llm/llm-client';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const fakeConfig: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey',
};

describe('LLMClient.extractQuestions', () => {
  it('passes cells through prompt and returns zod-validated questions', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      questions: [
        {
          raw_text: 'Q1: Total electricity (kWh)?',
          normalized_text: 'Total electricity',
          answer_cell_ref: 'Sheet1!B5',
          expected_unit: 'kWh',
          sheet: 'Sheet1',
          question_row: 5,
        },
      ],
    } as unknown as never);

    const cells = [
      { sheet: 'Sheet1', row: 5, col: 1, value: 'Q1: Total electricity (kWh)?', ref: 'Sheet1!A5' },
      { sheet: 'Sheet1', row: 5, col: 2, value: '', ref: 'Sheet1!B5' },
    ];
    const result = await client.extractQuestions(fakeConfig, cells as never);

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.normalized_text).toBe('Total electricity');
    expect(stub).toHaveBeenCalledTimes(1);
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    expect(prompt).toContain('Total electricity');
    expect(prompt).toContain('Sheet1');
  });

  it('returns empty list when no cells provided', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const result = await client.extractQuestions(fakeConfig, []);
    expect(result.questions).toEqual([]);
  });
});
