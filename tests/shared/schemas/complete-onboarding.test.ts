import { describe, expect, it } from 'vitest';
import { completeOnboardingInput } from '@shared/schemas/complete-onboarding';

describe('completeOnboardingInput schema', () => {
  it('loads without throwing (regression: Zod 4 forbids .omit() on refined ZodObject)', () => {
    expect(completeOnboardingInput).toBeDefined();
  });

  it('parses a valid full payload', () => {
    const input = {
      organization: {
        name_zh: '示例公司',
        country_code: 'CN',
        boundary_kind: 'operational_control' as const,
      },
      first_site: {
        name_zh: '示例厂区',
        country_code: 'CN',
      },
      reporting_period: {
        year: 2026,
        granularity: 'annual' as const,
      },
    };
    const result = completeOnboardingInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects first_site with no name_zh and no name_en', () => {
    const input = {
      organization: {
        name_zh: '示例公司',
        country_code: 'CN',
        boundary_kind: 'operational_control' as const,
      },
      first_site: {
        country_code: 'CN',
      },
      reporting_period: {
        year: 2026,
        granularity: 'annual' as const,
      },
    };
    const result = completeOnboardingInput.safeParse(input);
    expect(result.success).toBe(false);
  });
});
