import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { stubDialog } from 'electron-playwright-helpers';
import { launchApp, teardown } from './_setup.js';
import { FIXTURE_ORG } from './fixtures.js';
import { navigateTo, snap, waitForReactMount } from './helpers.js';

/**
 * Live GUI smoke for the user EF-library import (ROADMAP §8.1-④).
 *
 * Unlike the stage specs, nothing on the import path is mocked: the file
 * is parsed by the real main-process parser, rows land in the real
 * SQLite catalog (temp userData dir), and the registry list re-queries
 * the real DB. The only stub is `dialog.showOpenDialog` (native chooser
 * can't be driven from Playwright) — same approach as the existing
 * `saveDialogFileName` harness option.
 *
 * Flow: Settings → 因子库 → import drawer → pick csv (3 valid rows +
 * 1 bad-scope row) → validation preview → import → registry row →
 * same-name re-import arms the replace confirmation → replace →
 * delete library → empty state again.
 */

const FIXTURE_CSV = join(__dirname, 'fixtures', 'ef-library-import.csv');

test('EF library import: pick → preview → import → replace → delete', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedOrg: FIXTURE_ORG,
  });

  try {
    const { app, window } = setup;

    await stubDialog(app, 'showOpenDialog', {
      canceled: false,
      filePaths: [FIXTURE_CSV],
    });

    await waitForReactMount(window);
    await navigateTo(window, '/settings');

    // Open the 因子库 section from the settings rail.
    const nav = window.getByRole('navigation').first();
    await nav.waitFor({ state: 'visible', timeout: 15_000 });
    await nav.getByRole('button').filter({ hasText: /因子库|ef librar/i }).first().click();
    await window
      .getByText(/导入排放因子库|import an emission-factor library/i)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    await snap(window, 'ef-library-01-empty');

    // ---------------------------------------------------------------------
    // Import: pick the fixture csv, check the validation preview.
    // ---------------------------------------------------------------------
    await window.getByRole('button', { name: /导入因子库|import library/i }).click();
    const drawerTitle = window.getByText(/^导入排放因子库$|^import ef library$/i).first();
    await drawerTitle.waitFor({ state: 'visible', timeout: 5_000 });

    await window.getByRole('button', { name: /选择文件|choose file/i }).click();

    // Real parse happened in the main process: filename + counts render.
    await window.getByText('ef-library-import.csv', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await expect(window.getByText(/3 条有效|3 valid/)).toBeVisible();
    await expect(window.getByText(/1 条错误|1 errors?/)).toBeVisible();
    // The bad row is reported with its file row number + coded message.
    await expect(window.getByText(/第 5 行|row 5/i)).toBeVisible();
    await expect(window.getByText(/范围须为 1、2 或 3|scope must be 1, 2 or 3/i)).toBeVisible();
    // Auto-mapping detected the Chinese headers → sample preview shows a row.
    await expect(window.getByText('内部柴油因子').first()).toBeVisible();

    // Library name was prefilled from the filename stem; set our own.
    const nameInput = window.getByLabel(/库名称|library name/i);
    await expect(nameInput).toHaveValue('ef-library-import');
    await nameInput.fill('内部台账');
    await window.getByLabel(/^版本$|^version$/i).fill('v1');
    await snap(window, 'ef-library-02-preview');

    await window.getByRole('button', { name: /^导入$|^import$/i }).click();

    // Success toast + drawer closes + registry row appears (real DB read).
    await window.getByText(/已导入 3 条因子|imported 3 factors/i).last().waitFor({ timeout: 10_000 });
    const row = window.getByText('user:内部台账');
    await row.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(window.getByText(/v1 · 3 条因子|v1 · 3 factors/)).toBeVisible();
    await snap(window, 'ef-library-03-imported');

    // ---------------------------------------------------------------------
    // Replace: same name again must arm the destructive confirmation.
    // ---------------------------------------------------------------------
    await window.getByRole('button', { name: /导入因子库|import library/i }).click();
    await window.getByRole('button', { name: /选择文件|choose file/i }).click();
    await window.getByText('ef-library-import.csv', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await window.getByLabel(/库名称|library name/i).fill('内部台账');
    await window.getByRole('button', { name: /^导入$|^import$/i }).click();

    await window
      .getByText(/已存在同名库|already exists/i)
      .waitFor({ state: 'visible', timeout: 5_000 });
    await snap(window, 'ef-library-04-replace-confirm');
    await window.getByRole('button', { name: /替换导入|replace library/i }).click();
    await window.getByText(/已导入 3 条因子|imported 3 factors/i).last().waitFor({ timeout: 10_000 });
    // Blank version defaulted to the import date; still exactly one registry row.
    await expect(window.getByText('user:内部台账')).toHaveCount(1);

    // ---------------------------------------------------------------------
    // Delete: catalog rows + registry entry go; empty state returns.
    // ---------------------------------------------------------------------
    // window.confirm opens a native blocking dialog in Electron — replace it
    // in the renderer context (same determinism trade the vitest suite makes).
    await window.evaluate(() => {
      (globalThis as unknown as { confirm: (msg?: string) => boolean }).confirm = () => true;
    });
    await window.getByRole('button', { name: /删除库|delete library/i }).click();
    await window.getByText(/已删除|library deleted/i).waitFor({ timeout: 10_000 });
    await window
      .getByText(/还没有导入过因子库|no imported libraries yet/i)
      .waitFor({ state: 'visible', timeout: 10_000 });
    await snap(window, 'ef-library-05-deleted');
  } finally {
    await teardown(setup);
  }
});
