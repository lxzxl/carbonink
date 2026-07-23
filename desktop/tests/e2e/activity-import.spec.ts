import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { stubDialog } from 'electron-playwright-helpers';
import { launchApp, teardown } from './_setup.js';
import { navigateTo, snap, waitForReactMount } from './helpers.js';

/**
 * Live GUI smoke for the batch activity-data import wizard (ROADMAP §8.1-①).
 *
 * Nothing on the import path is mocked: the ledger csv is parsed by the
 * real main-process parser, sources/periods live in the real SQLite
 * (temp userData dir), EF candidates come from the real seeded catalog,
 * and the final import creates real activity_data rows + evidence links.
 * The only stubs are `dialog.showOpenDialog` (native chooser can't be
 * driven from Playwright) and the DB seed itself, which goes through the
 * real `org:complete-onboarding` / `source:create` IPC handlers.
 *
 * The group-level LLM recommendation (`ef:recommend-text`) runs for real
 * too: with no AI provider configured it falls back to FTS-only, so the
 * Browse pane is deterministic — exactly the offline posture we ship.
 *
 * Flow: seed org/site/period(2024) + one source 电网电表 → /activities →
 * 批量导入 → pick csv (4 valid rows + 1 amount-missing) → zh headers
 * auto-map + period select → source step (电网电表 auto-matched, 新锅炉
 * batch-created scope-1) → group step (2 groups, pick real EFs) →
 * import → result counts → list shows 4 rows with 台账导入 badges →
 * 溯源 drawer shows the archived ledger as evidence.
 */

const FIXTURE_CSV = join(__dirname, 'fixtures', 'activity-import.csv');

test('activity import: ledger → mapping → sources → groups → import → lineage', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
  });

  try {
    const { app, window } = setup;

    await stubDialog(app, 'showOpenDialog', {
      canceled: false,
      filePaths: [FIXTURE_CSV],
    });

    await waitForReactMount(window);

    // ---------------------------------------------------------------------
    // Seed the real DB through the real IPC surface: org + site + 2024
    // annual period, plus one pre-existing source the ledger will
    // auto-match by name.
    // ---------------------------------------------------------------------
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
      })) as { site: { id: string } };
      await ipc.invoke('source:create', {
        site_id: onboarded.site.id,
        name: '电网电表',
        scope: 2,
      });
    });

    await navigateTo(window, '/activities');
    await window.getByRole('button', { name: /批量导入|batch import/i }).click();

    // ---------------------------------------------------------------------
    // Step 1+2: pick the fixture, verify real parse + auto-mapping, choose
    // the reporting period.
    // ---------------------------------------------------------------------
    await window.getByRole('button', { name: /选择文件|choose file/i }).click();
    await window
      .getByText('activity-import.csv', { exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await expect(window.getByText(/5 行数据|5 data rows/)).toBeVisible();
    await expect(window.getByText(/4 行有效|4 valid/)).toBeVisible();
    await expect(window.getByText(/1 行错误|1 errors?/)).toBeVisible();
    // The bad row is reported with its file row number + coded message.
    await expect(window.getByText(/第 6 行|row 6/)).toBeVisible();
    await expect(window.getByText(/缺数量|amount missing/)).toBeVisible();

    const nextButton = window.getByRole('button', { name: /下一步|next/i });
    await expect(nextButton).toBeDisabled();
    await window.getByLabel(/报告期|reporting period/i).selectOption({ index: 1 });
    await expect(nextButton).toBeEnabled();
    await snap(window, 'activity-import-01-mapping');
    await nextButton.click();

    // ---------------------------------------------------------------------
    // Step 3: source resolution — 电网电表 auto-matched by normalized name,
    // 新锅炉 batch-created through the inline mini-form (scope 1).
    // ---------------------------------------------------------------------
    await window.getByText(/排放源落位|map ledger sources/i).waitFor({ timeout: 10_000 });
    // Exact match: the step's body copy contains 未落位 as a substring too.
    await expect(window.getByText('已匹配现有源', { exact: true })).toHaveCount(1);
    await expect(window.getByText('未落位', { exact: true })).toHaveCount(1);
    await snap(window, 'activity-import-02-sources');

    // Open the create form (first button), then submit it (second, same label).
    await window
      .getByRole('button', { name: /新建排放源|create source/i })
      .first()
      .click();
    await window
      .getByRole('button', { name: /新建排放源|create source/i })
      .last()
      .click();
    await expect(window.getByText('已匹配现有源', { exact: true })).toHaveCount(2, {
      timeout: 10_000,
    });
    await nextButton.click();

    // ---------------------------------------------------------------------
    // Step 4: two confirm-groups; pick a real catalog EF in each embedded
    // picker and confirm. Real FTS candidates, no LLM (no provider).
    // ---------------------------------------------------------------------
    await window
      .getByText(/按组确认排放因子|confirm emission factors/i)
      .waitFor({ timeout: 10_000 });
    const gridCard = window
      .locator('div.rounded-md.border')
      .filter({ has: window.getByText('电网电力', { exact: true }) })
      .first();
    const fuelCard = window
      .locator('div.rounded-md.border')
      .filter({ has: window.getByText('汽油 叉车', { exact: true }) })
      .first();

    await gridCard.getByText('中国国家电网平均').first().click();
    await gridCard.getByRole('button', { name: /确认因子|confirm ef/i }).click();
    await expect(gridCard.getByText(/已确认|confirmed/i).first()).toBeVisible({ timeout: 5_000 });

    await fuelCard.getByText('汽油燃烧').first().click();
    await fuelCard.getByRole('button', { name: /确认因子|confirm ef/i }).click();
    await expect(fuelCard.getByText(/已确认|confirmed/i).first()).toBeVisible({ timeout: 5_000 });
    await snap(window, 'activity-import-03-groups');

    // ---------------------------------------------------------------------
    // Import + result report.
    // ---------------------------------------------------------------------
    await window.getByRole('button', { name: /^导入$|^import$/i }).click();
    await window.getByText(/导入完成|import complete/i).waitFor({ timeout: 15_000 });
    await expect(window.getByText(/已导入 4 行|4 rows imported/)).toBeVisible();
    await expect(
      window.getByText(/1 行跳过（校验错误）|1 skipped \(validation errors\)/),
    ).toBeVisible();
    await snap(window, 'activity-import-04-result');
    await window.getByRole('button', { name: /^完成$|^done$/i }).click();
    // Let the vaul exit animation finish so the list screenshot is clean.
    await window
      .getByText(/批量导入活动数据|batch import activity data/i)
      .waitFor({ state: 'hidden', timeout: 5_000 });

    // ---------------------------------------------------------------------
    // The list re-queries the real DB: 4 rows, each with the 台账导入
    // provenance badge.
    // ---------------------------------------------------------------------
    await expect(window.getByText(/台账导入|ledger import/i)).toHaveCount(4, { timeout: 10_000 });
    await snap(window, 'activity-import-05-list-badges');

    // ---------------------------------------------------------------------
    // Lineage: the archived ledger file hangs off every imported row as
    // evidence — the 溯源 drawer must answer "where did this number come
    // from" with the ledger itself.
    // ---------------------------------------------------------------------
    await window
      .getByRole('button', { name: /溯源|lineage/i })
      .first()
      .click();
    await window
      .getByText('activity-import.csv', { exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await snap(window, 'activity-import-06-lineage');
  } finally {
    await teardown(setup);
  }
});
