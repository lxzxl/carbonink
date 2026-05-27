import {
  generateReportNarrative,
  LlmNarrativeCanceled,
  LlmNarrativeRefused,
  ReportNarrativeSchema,
} from '@main/llm/report-narrative';
import { runAiObject } from '@main/llm/run-ai';
import type { CredentialService } from '@main/services/credential-service';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ProviderConfig } from '@shared/types';
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

function fakeConfig(): ProviderConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKeyKeyref: 'llm.openai.apikey',
  };
}

function fakeData(): InventoryReportData {
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
    language: 'zh-CN',
    prior_period_summary: null,
    base_year_summary: null,
  };
}

const FAKE_NARRATIVE = {
  boundary_description:
    '本盘查采用运营控制法定义组织边界，覆盖测试公司的北京工厂。该方法符合 ISO 14064-1:2018 §5.1 要求，确保所有权益股东的直接或间接排放均纳入统计范围。',
  reporting_boundary_description:
    '报告范围涵盖范围一直接排放、范围二外购电力的间接排放，以及范围三外购运输服务的间接排放。本期未涉及生物质排放，单独披露为零。',
  methodology_description:
    '排放量按 IPCC 与生态环境部公布的排放因子计算，所有因子均采用 AR5 GWP 基准。所有活动数据均通过单据来源识别并人工复核。数据来源包括生产部门报表、采购发票、能源账单等，确保完整性和准确性。',
  emissions_summary:
    '本期总排放量约 37.4 吨 CO2e，其中范围二占比最高，约为 91.7%，主要来自外购电力 50000 + 10000 kWh。范围一柴油使用产生约 3.16 吨排放，范围三外购运输服务各占小份额。',
  significant_changes:
    '本盘查为首次进行的 2025 年度盘查，无历史可比期，亦未设定基准年。后续年度将建立趋势分析基础。',
  notable_observations:
    '电网电力为最大排放源，年度排放量约 34.2 吨 CO2e，占总量 91% 以上。建议优先考虑可再生能源替代以降低范围二排放。',
};

afterEach(() => {
  vi.mocked(runAiObject).mockReset();
});

describe('generateReportNarrative', () => {
  it('validates a well-shaped LLM response against the schema', () => {
    const result = ReportNarrativeSchema.safeParse(FAKE_NARRATIVE);
    expect(result.success).toBe(true);
  });

  it('returns the narrative + emits at least one progress event', async () => {
    vi.mocked(runAiObject).mockResolvedValue(FAKE_NARRATIVE);

    const progressCalls: Array<{ sub_phase: string | null }> = [];
    const narrative = await generateReportNarrative({
      data: fakeData(),
      config: fakeConfig(),
      credentials: fakeCredentials(),
      onProgress: (ev) => progressCalls.push({ sub_phase: ev.sub_phase }),
      abortSignal: new AbortController().signal,
    });
    expect(narrative).toEqual(FAKE_NARRATIVE);
    // We can no longer observe per-section progress (AiClient.generateObject
    // is a single round-trip), but the helper must still emit at least one
    // tick so the renderer's subscriber doesn't think the call stalled.
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('forwards system + user prompt + schema to runAiObject', async () => {
    vi.mocked(runAiObject).mockResolvedValue(FAKE_NARRATIVE);

    await generateReportNarrative({
      data: fakeData(),
      config: fakeConfig(),
      credentials: fakeCredentials(),
      onProgress: () => {},
      abortSignal: new AbortController().signal,
    });

    expect(runAiObject).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runAiObject).mock.calls[0];
    expect(call?.[0]).toEqual(fakeConfig());
    const args = call?.[2];
    expect(args?.schema).toBe(ReportNarrativeSchema);
    expect(args?.system).toContain('ISO 14064-1');
    expect(args?.prompt).toContain('<inventory>');
  });

  it('throws LlmNarrativeCanceled when AbortSignal fires before the call', async () => {
    const controller = new AbortController();
    controller.abort();
    // runAiObject must not be reached — the pre-abort check throws first.
    vi.mocked(runAiObject).mockRejectedValue(new Error('should not be called'));

    await expect(
      generateReportNarrative({
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
      Object.assign(new Error('schema invalid: missing field foo'), {
        _tag: 'AiSchemaMismatch',
      }),
    );

    await expect(
      generateReportNarrative({
        data: fakeData(),
        config: fakeConfig(),
        credentials: fakeCredentials(),
        onProgress: () => {},
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(LlmNarrativeRefused);
  });
});
