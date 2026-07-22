import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { navigateTo, snap, waitForReactMount } from './helpers.js';

/**
 * Live GUI smoke for the TCFD four-pillar report (spec 2026-07-22-tcfd-report).
 *
 * Real: seeded org/period (real onboarding IPC), /reports layout + period
 * row, the report-kind selector, the TcfdReportPreview render path.
 * Canned: `report:generate-tcfd` (the only LLM hop) — the harness's
 * cannedIpc map replaces the handler with a fixed data+narrative payload,
 * so the smoke asserts the UI contract without a provider.
 */

const TCFD_DATA = {
  org: {
    id: 'org-e2e',
    name_zh: '碳墨端到端公司',
    name_en: null,
    industry: null,
    country_code: 'CN',
    boundary_kind: 'operational_control',
    responsible: { name: null, role: null },
  },
  period: {
    id: 'per-2024',
    year: 2024,
    granularity: 'annual',
    start: '2024-01-01',
    end: '2024-12-31',
    is_base_year: false,
    significant_changes_text: null,
  },
  sites: [{ id: 'site-1', name_zh: '总部', name_en: null, address: null }],
  scope_totals: { scope1_kg: 252.56, scope2_kg: 1254.66, scope3_kg: 0, total_kg: 1507.22, biogenic_kg: 0 },
  all_sources: [
    { id: 'src-grid', name: '电网电表', scope: 2, co2e_kg: 1254.66, share_pct: 83.2 },
    { id: 'src-boiler', name: '新锅炉', scope: 1, co2e_kg: 252.56, share_pct: 16.8 },
  ],
  activities: [],
  ef_sources_used: [{ source: 'MEE_China', count: 1, gwp_basis: 'AR6' }],
  language: 'zh-CN',
  prior_period_summary: { year: 2023, total_kg: 1400 },
  base_year_summary: null,
};

const TCFD_NARRATIVE = {
  governance: '董事会通过可持续发展负责人对气候相关议题进行监督，管理层按年度审阅温室气体盘查结果并向董事会汇报。本期治理安排的细化流程尚在建设中，后续将明确气候议题的议事频率与职责分工。',
  strategy: '公司识别的气候相关影响目前以运营用能的转型风险为主。本期未开展定量情景分析，后续计划结合盘查数据评估不同气候情景下的能源成本变化，并据此制定减排路径。',
  risk_management: '气候相关风险的识别与评估目前依托年度温室气体盘查流程：以排放源清单为基础识别主要暴露点。本期未开展独立的气候风险定量评估，相关流程将随盘查周期逐步完善并纳入整体风险管理。',
  metrics_targets: '本期温室气体排放合计 1507.22 kg CO2e，其中范围一 252.56 kg、范围二 1254.66 kg、范围三本期未评估。主要排放源为电网电表（占 83.2%）。排放因子采用 AR6 GWP 基准。与上一期（2023 年，1400 kg CO2e）相比有所上升，公司尚未设定量化减排目标，将在建立完整基准年后制定。',
};

test('tcfd report: kind selector → canned generate → four pillars + metrics tables', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedIpc: {
      'report:generate-tcfd': {
        canceled: false,
        data: TCFD_DATA,
        narrative: TCFD_NARRATIVE,
      },
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    // Seed a real org + 2024 period so /reports lists a period row.
    await window.evaluate(async () => {
      const ipc = (
        globalThis as unknown as {
          ipc: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }
      ).ipc;
      const onboarded = (await ipc.invoke('org:complete-onboarding', {
        organization: {
          name_zh: '碳墨端到端公司',
          country_code: 'CN',
          boundary_kind: 'operational_control',
        },
        first_site: { name_zh: '总部', country_code: 'CN' },
        reporting_period: { year: 2024, granularity: 'annual' },
      })) as { organization: { id: string } };
      // /reports gates period rows on a responsible person being set.
      await ipc.invoke('org:update-reporting-profile', {
        id: onboarded.organization.id,
        boundary_kind: 'operational_control',
        responsible_person_name: '张三',
        responsible_person_role: '可持续发展负责人',
        base_year_period_id: null,
      });
    });

    await navigateTo(window, '/reports');
    // The period row is a ListItem <li> that intercepts pointer events —
    // click the row, not the inner text div.
    await window.locator('li').filter({ hasText: '2024' }).first().click();

    // Pick the TCFD kind, generate against the canned handler.
    const kindSelect = window.getByLabel(/报告类型|report type/i);
    await kindSelect.waitFor({ state: 'visible', timeout: 15_000 });
    await kindSelect.selectOption('tcfd');
    await snap(window, 'tcfd-01-kind-selected');
    await window.getByRole('button', { name: /生成|generate/i }).click();

    // Four pillars + the quantitative appendix render.
    await window
      .getByText('气候相关财务信息披露报告（TCFD）')
      .waitFor({ state: 'visible', timeout: 15_000 });
    await expect(window.getByText('1 治理')).toBeVisible();
    await expect(window.getByText('2 战略')).toBeVisible();
    await expect(window.getByText('3 风险管理')).toBeVisible();
    await expect(window.getByText('4 指标与目标')).toBeVisible();
    await expect(window.getByText(/主要排放源为电网电表/)).toBeVisible();
    await expect(window.getByText('附表 1 主要排放源')).toBeVisible();
    await expect(window.getByText('附表 2 期间对比')).toBeVisible();
    await expect(window.getByRole('cell', { name: '上一期' })).toBeVisible();
    // The TCFD action bar exports PDF only (xlsx is ISO-only in v1).
    await expect(window.getByRole('button', { name: /^导出 PDF$|^export pdf$/i })).toBeVisible();
    await snap(window, 'tcfd-02-generated');
  } finally {
    await teardown(setup);
  }
});
