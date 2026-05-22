import { generateReportNarrative, ReportNarrativeSchema } from '@main/llm/report-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { describe, expect, it, vi } from 'vitest';

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

describe('generateReportNarrative', () => {
  it('validates a well-shaped LLM response against the schema', () => {
    const result = ReportNarrativeSchema.safeParse(FAKE_NARRATIVE);
    expect(result.success).toBe(true);
  });

  it('returns the narrative + emits progress events for each section', async () => {
    const progressCalls: Array<{ sub_phase: string | null }> = [];
    // Stub the streamObject call by intercepting the provider hook.
    const provider = {
      streamObjectMock: vi.fn().mockResolvedValue({
        object: Promise.resolve(FAKE_NARRATIVE),
        partialObjectStream: (async function* () {
          yield { boundary_description: '...' };
          yield { boundary_description: '...full...', reporting_boundary_description: '...' };
          yield { reporting_boundary_description: '...full...', methodology_description: '...' };
          yield { methodology_description: '...full...', emissions_summary: '...' };
          yield { emissions_summary: '...full...', significant_changes: '...' };
          yield { significant_changes: '...full...', notable_observations: '...' };
          yield FAKE_NARRATIVE;
        })(),
      }),
    };
    const narrative = await generateReportNarrative({
      data: fakeData(),
      provider: {
        kind: 'mock',
        streamObject: provider.streamObjectMock,
      } as never,
      onProgress: (ev) => progressCalls.push({ sub_phase: ev.sub_phase }),
      abortSignal: new AbortController().signal,
    });
    expect(narrative).toEqual(FAKE_NARRATIVE);
    // At least 5 sub-phase transitions seen.
    const phases = progressCalls.map((c) => c.sub_phase);
    expect(phases).toContain('boundary');
    expect(phases).toContain('methodology');
    expect(phases).toContain('emissions');
    expect(phases).toContain('changes');
  });

  it('throws LlmNarrativeCanceled when AbortSignal fires before completion', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = {
      streamObject: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    };
    await expect(
      generateReportNarrative({
        data: fakeData(),
        provider: provider as never,
        onProgress: () => {},
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow(/canceled/i);
  });
});
