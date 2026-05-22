import { LLMClient } from '@main/llm/llm-client';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const fakeConfig: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'llm.openai.apikey',
};

const fakeQuestion = {
  raw_text: '2026 年度总用电量 (kWh)?',
  expected_unit: 'kWh',
  question_kind: 'numerical' as const,
};
const fakeInventory = {
  year: 2026,
  activity_count: 12,
  activities_summary: '12 条电费抽取，总计 14820 kWh',
  totals: { total_co2e_kg: 8456.7, scope2_kg: 8456.7 },
};

describe('LLMClient.generateAnswer', () => {
  it('builds a structured-output call with the answer schema', async () => {
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      value: '14820',
      unit: 'kWh',
      source_summary: '12 条电费 sum = 14820',
    } as unknown as never);

    const result = await client.generateAnswer(fakeConfig, fakeQuestion, fakeInventory);

    expect(result.value).toBe('14820');
    expect(result.unit).toBe('kWh');
    expect(stub).toHaveBeenCalledTimes(1);
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    expect(prompt).toContain('14820');
    expect(prompt).toContain('总用电量');
  });
});
