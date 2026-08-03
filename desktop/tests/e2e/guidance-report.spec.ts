import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { navigateTo, snap, waitForReactMount } from './helpers.js';

/**
 * The ISO-report tour, in a real window.
 *
 * Two things only a real window settles here: the first step anchors on
 * `.report-preview__scope-table` — the one selector that is NOT a
 * `data-tour` attribute we own, so it can silently drift when the report
 * markup changes — and the report body scrolls, which is where driver's
 * scroll-into-view behaviour actually gets exercised.
 *
 * Real: /reports layout, period row, kind selector, ReportPreview.
 * Canned: `report:generate` (the LLM hop), same as tcfd-report.spec.ts.
 */

const ISO_DATA = {
  org: {
    id: 'org-e2e',
    name_zh: '碳墨端到端公司',
    name_en: null,
    industry: null,
    country_code: 'CN',
    boundary_kind: 'operational_control',
    responsible: { name: '张三', role: '可持续发展负责人' },
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
  scope_totals: {
    scope1_kg: 252.56,
    scope2_kg: 1254.66,
    scope3_kg: 0,
    total_kg: 1507.22,
    biogenic_kg: 0,
  },
  all_sources: [{ id: 'src-1', name: '电网电表', scope: 2, co2e_kg: 1254.66, share_pct: 83.2 }],
  activities: [],
  ef_sources_used: [{ source: 'MEE_China', count: 1, gwp_basis: 'AR6' }],
  language: 'zh-CN',
  prior_period_summary: null,
  base_year_summary: null,
};

const ISO_NARRATIVE = {
  boundary_description: '本报告以运营控制权法界定组织边界，覆盖总部一个场所。',
  reporting_boundary_description: '报告期为 2024 全年，涵盖范围一与范围二排放。',
  methodology_description: '活动数据来自电表与燃料票据，排放因子采用 AR6 GWP 基准。',
  emissions_summary: '本期温室气体排放合计 1507.22 kg CO2e。',
  significant_changes: '本期组织边界与核算方法均无重大变更。',
  notable_observations: '主要排放源为电网电表，占总排放的 83.2%。',
};

test('guidance: the ISO-report tour explains scope grouping and the two exports', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    guidance: true,
    cannedIpc: {
      'report:generate': { canceled: false, data: ISO_DATA, narrative: ISO_NARRATIVE },
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
      await ipc.invoke('org:update-reporting-profile', {
        id: onboarded.organization.id,
        boundary_kind: 'operational_control',
        responsible_person_name: '张三',
        responsible_person_role: '可持续发展负责人',
        base_year_period_id: null,
      });
    });

    await navigateTo(window, '/reports');
    await window.locator('li').filter({ hasText: '2024' }).first().click();

    // ISO is the default kind — generate against the canned handler.
    const kindSelect = window.getByLabel(/报告类型|report type/i);
    await kindSelect.waitFor({ state: 'visible', timeout: 15_000 });
    await window.getByRole('button', { name: /生成|generate/i }).click();

    // The tour only starts once a generated ISO report is on screen.
    const tooltip = window.getByTestId('guidance-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText('Scope 1 / 2 / 3 怎么分组')).toBeVisible();
    const box = await tooltip.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    await window.waitForTimeout(500);
    await snap(window, 'guidance-08-report-scope', { fullPage: false });

    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('导出 PDF 与 Excel')).toBeVisible();

    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('交付包', { exact: true })).toBeVisible();
    await window.getByRole('button', { name: '知道了' }).click();
    await expect(tooltip).toBeHidden();

    // Export bar still there and usable once the tour steps off it.
    await expect(
      window.getByRole('button', { name: /确认导出|confirm and export/i }),
    ).toBeVisible();
    await snap(window, 'guidance-09-report-after', { fullPage: false });
  } finally {
    await teardown(setup);
  }
});
