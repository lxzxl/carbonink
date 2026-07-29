import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks, FIXTURE_ACTIVITIES } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * The EF-rebind tour, which plays inside the vaul drawer.
 *
 * This is the one place the guidance runtime interacts with a modal:
 * driver.js renders its popover on `document.body`, so to Radix's
 * dismissable layer every click on it looks like a click *outside* the
 * drawer — i.e. "close me". `RebindEfDrawer` guards against that; this
 * spec is what proves the guard holds, since neither happy-dom nor a
 * unit test models the dismissable layer.
 */

const ACTIVITY = FIXTURE_ACTIVITIES[0];

const ACTIVITY_WITH_PINNED_EF = {
  ...ACTIVITY,
  pinned_ef: {
    factor_code: ACTIVITY?.ef_factor_code,
    year: ACTIVITY?.ef_year,
    source: ACTIVITY?.ef_source,
    geography: ACTIVITY?.ef_geography,
    dataset_version: ACTIVITY?.ef_dataset_version,
    scope: 2,
    category: 'electricity.purchased',
    ghg_protocol_path: null,
    input_unit: 'kWh',
    co2e_kg_per_unit: 0.5703,
    ch4_kg_per_unit: null,
    n2o_kg_per_unit: null,
    hfc_kg_per_unit: null,
    pfc_kg_per_unit: null,
    sf6_kg_per_unit: null,
    nf3_kg_per_unit: null,
    gwp_basis: 'AR6',
    name_zh: '全国电网平均排放因子',
    name_en: 'China national grid average',
    description_zh: null,
    description_en: null,
    notes: null,
    biogenic_co2_factor: null,
    citation_url: null,
  },
};

const EF_ROWS = [
  ACTIVITY_WITH_PINNED_EF.pinned_ef,
  {
    ...ACTIVITY_WITH_PINNED_EF.pinned_ef,
    factor_code: 'electricity.grid.cn.national.2025',
    year: 2025,
    dataset_version: '2025.q1',
    co2e_kg_per_unit: 0.5366,
    name_zh: '全国电网平均排放因子（2025）',
    name_en: 'China national grid average (2025)',
  },
];

test('guidance: the EF-rebind tour runs inside the drawer without closing it', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    guidance: true,
    cannedIpc: {
      ...baselineIpcMocks(),
      'activity:get-by-id': ACTIVITY_WITH_PINNED_EF,
      'ef:list': EF_ROWS,
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    await navigateTo(window, '/activities');
    await waitForRouteSettled(window);

    // Open the rebind drawer on the first activity row.
    await window.getByRole('button', { name: '重新镶嵌' }).first().click();
    await expect(window.getByText('重新镶嵌排放因子')).toBeVisible();

    // The tour takes over inside the drawer.
    const tooltip = window.getByTestId('guidance-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 10_000 });
    await expect(window.getByText('当前因子是钉住的快照')).toBeVisible();
    const box = await tooltip.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    await window.waitForTimeout(500);
    await snap(window, 'guidance-03-rebind-step1', { fullPage: false });

    // Clicking the popover is an "outside" click as far as the drawer's
    // dismissable layer is concerned — the drawer must survive it.
    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('什么时候该换')).toBeVisible();
    await expect(window.getByText('重新镶嵌排放因子')).toBeVisible();

    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('换绑之后')).toBeVisible();
    await window.getByRole('button', { name: '知道了' }).click();
    await expect(tooltip).toBeHidden();

    // Tour gone, drawer still open and usable.
    await expect(window.getByText('重新镶嵌排放因子')).toBeVisible();
    await snap(window, 'guidance-04-rebind-after', { fullPage: false });
  } finally {
    await teardown(setup);
  }
});
