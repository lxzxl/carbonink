import { LlmNarrativeCanceled, LlmNarrativeRefused } from '@main/llm/report-narrative';
import { runAiObject } from '@main/llm/run-ai';
import { generateTcfdNarrative, TcfdNarrativeSchema } from '@main/llm/tcfd-narrative';
import type { CredentialService } from '@main/services/credential-service';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ProviderConfigV2 } from '@shared/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/llm/run-ai', () => ({
  runAiObject: vi.fn(),
}));

function fakeCredentials(): CredentialService {
  return {
    get: vi.fn(() => 'sk-fake'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

function fakeConfig(): ProviderConfigV2 {
  return { provider: 'openai', model: 'gpt-4o-mini' };
}

function fakeData(language: 'zh-CN' | 'en' = 'zh-CN'): InventoryReportData {
  return {
    org: {
      id: 'org-1',
      name_zh: '测试公司',
      name_en: 'Test Co',
      industry: '制造业',
      country_code: 'CN',
      boundary_kind: 'operational_control',
      responsible: { name: '张三', role: '可持续发展负责人' },
    },
    period: {
      id: 'per-2025',
      year: 2025,
      granularity: 'annual',
      start: '2025-01-01',
      end: '2025-12-31',
      is_base_year: false,
      significant_changes_text: null,
    },
    sites: [{ id: 'site-1', name_zh: '北京工厂', name_en: 'Beijing Plant', address: '北京市' }],
    scope_totals: {
      scope1_kg: 3160,
      scope2_kg: 34218,
      scope3_kg: 22,
      total_kg: 37400,
      biogenic_kg: 0,
    },
    all_sources: [],
    activities: [],
    ef_sources_used: [{ source: 'MEE', count: 2, gwp_basis: 'AR5' }],
    language,
    prior_period_summary: null,
    base_year_summary: null,
  };
}

const FAKE_TCFD = {
  governance: '一'.repeat(120),
  strategy: '二'.repeat(120),
  risk_management: '三'.repeat(120),
  metrics_targets: '四'.repeat(150),
};

afterEach(() => {
  vi.mocked(runAiObject).mockReset();
});

describe('generateTcfdNarrative', () => {
  it('validates a well-shaped response against the four-pillar schema', () => {
    expect(TcfdNarrativeSchema.safeParse(FAKE_TCFD).success).toBe(true);
    expect(TcfdNarrativeSchema.safeParse({ ...FAKE_TCFD, governance: 'too short' }).success).toBe(
      false,
    );
  });

  it('returns the narrative and forwards the TCFD system prompt + schema', async () => {
    vi.mocked(runAiObject).mockResolvedValue(FAKE_TCFD);
    const progress: Array<string | null> = [];
    const narrative = await generateTcfdNarrative({
      data: fakeData(),
      config: fakeConfig(),
      credentials: fakeCredentials(),
      onProgress: (ev) => progress.push(ev.sub_phase),
      abortSignal: new AbortController().signal,
    });
    expect(narrative).toEqual(FAKE_TCFD);
    expect(progress.length).toBeGreaterThanOrEqual(1);

    const call = vi.mocked(runAiObject).mock.calls[0];
    expect(call?.[2]?.schema).toBe(TcfdNarrativeSchema);
    expect(call?.[2]?.system).toContain('TCFD');
    expect(call?.[2]?.system).toContain('本期未开展定量评估');
    expect(call?.[2]?.prompt).toContain('<inventory>');
  });

  it('uses the English guardrail prompt for en reports', async () => {
    vi.mocked(runAiObject).mockResolvedValue(FAKE_TCFD);
    await generateTcfdNarrative({
      data: fakeData('en'),
      config: fakeConfig(),
      credentials: fakeCredentials(),
      onProgress: () => {},
      abortSignal: new AbortController().signal,
    });
    expect(vi.mocked(runAiObject).mock.calls[0]?.[2]?.system).toContain(
      'No quantitative assessment was performed this period',
    );
  });

  it('raises LlmNarrativeCanceled when already aborted, without calling the LLM', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateTcfdNarrative({
        data: fakeData(),
        config: fakeConfig(),
        credentials: fakeCredentials(),
        onProgress: () => {},
        abortSignal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(LlmNarrativeCanceled);
    expect(runAiObject).not.toHaveBeenCalled();
  });

  it('translates AiSchemaMismatch into LlmNarrativeRefused', async () => {
    vi.mocked(runAiObject).mockRejectedValue(
      Object.assign(new Error('bad shape'), { _tag: 'AiSchemaMismatch' }),
    );
    await expect(
      generateTcfdNarrative({
        data: fakeData(),
        config: fakeConfig(),
        credentials: fakeCredentials(),
        onProgress: () => {},
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(LlmNarrativeRefused);
  });
});
