import { LLMClient } from '@main/llm/llm-client';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

describe('LLMClient.recommendEfs', () => {
  it('builds a structured-output call with the recommendation schema', async () => {
    const fakeConfig: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    const client = new LLMClient({ credentials: { get: () => 'sk-fake' } as never });
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      recommendations: [
        {
          factor_code: 'fuel.diesel.combustion',
          year: 2024,
          source: 'IPCC_AR6',
          geography: 'GLOBAL',
          dataset_version: '2024.q1',
          reasoning_zh: '直接命中柴油',
        },
        {
          factor_code: 'electricity.grid.cn.national.2024',
          year: 2024,
          source: 'MEE_China',
          geography: 'CN',
          dataset_version: '2024.q4',
          reasoning_zh: '兜底选项',
        },
        {
          factor_code: 'fuel.gasoline.combustion',
          year: 2024,
          source: 'IPCC_AR6',
          geography: 'GLOBAL',
          dataset_version: '2024.q1',
          reasoning_zh: '同类燃料',
        },
      ],
    } as unknown as never);

    const result = await client.recommendEfs(fakeConfig, '{"fuel_type":"柴油"}', [
      {
        factor_code: 'fuel.diesel.combustion',
        year: 2024,
        source: 'IPCC_AR6',
        geography: 'GLOBAL',
        dataset_version: '2024.q1',
      } as never,
    ]);

    expect(result.recommendations).toHaveLength(3);
    expect(stub).toHaveBeenCalledTimes(1);
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    expect(prompt).toContain('fuel.diesel.combustion');
    expect(prompt).toContain('柴油');
  });
});
