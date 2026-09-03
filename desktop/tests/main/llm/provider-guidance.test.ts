import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProviderGuidance } from '@main/llm/provider-guidance';
import { describe, expect, it } from 'vitest';

describe('getProviderGuidance', () => {
  it('returns curated guidance with recommendedFor tags matching spec', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guidance-test-'));
    try {
      const list = getProviderGuidance(tmp);
      const deepseek = list.find((g) => g.id === 'deepseek');
      const openai = list.find((g) => g.id === 'openai');
      const anthropic = list.find((g) => g.id === 'anthropic');

      expect(deepseek?.recommendedFor).toEqual(['cn']);
      expect(openai?.recommendedFor).toEqual(['global']);
      expect(anthropic?.recommendedFor).toEqual(['global']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('merges https referral links from runtime file and drops non-https', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guidance-test-'));
    try {
      writeFileSync(
        join(tmp, 'provider-referrals.json'),
        JSON.stringify({
          deepseek: 'https://platform.deepseek.com/invite/123',
          openai: 'http://insecure.example.com',
        }),
      );
      const list = getProviderGuidance(tmp);
      const deepseek = list.find((g) => g.id === 'deepseek');
      const openai = list.find((g) => g.id === 'openai');

      expect(deepseek?.referralUrl).toBe('https://platform.deepseek.com/invite/123');
      expect(openai?.referralUrl).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
