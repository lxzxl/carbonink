import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { navigateTo, snap, waitForReactMount } from './helpers.js';

/**
 * Live GUI smoke for client workspaces (spec 2026-07-22-client-workspaces).
 *
 * The switch is the one piece vitest can't reach end-to-end: cleanupIpc →
 * closeAppDb → openAppDb(new file) + migrate → setupIpc (fresh context) →
 * renderer reload. Everything here is real — real registry json in the
 * temp userData dir, real second SQLite file created on first open, real
 * IPC teardown/rebuild, real window reload.
 *
 * Flow: seed org via real onboarding IPC → Settings → 账套 → create
 * 客户甲 → switch (confirm stubbed) → app reloads into the EMPTY new
 * workspace → onboarding wizard appears (the new-client flow) → switch
 * back to 默认账套 via the IPC bridge (no sidebar during onboarding) →
 * reload lands on the dashboard again with the original org intact.
 */

test('workspace switch: create → switch to empty → onboarding → switch back', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    // Seed the default workspace's real DB through the real IPC surface.
    await window.evaluate(async () => {
      const ipc = (
        globalThis as unknown as {
          ipc: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
        }
      ).ipc;
      await ipc.invoke('org:complete-onboarding', {
        organization: {
          name_zh: '默认客户公司',
          country_code: 'CN',
          boundary_kind: 'operational_control',
        },
        first_site: { name_zh: '总部', country_code: 'CN' },
        reporting_period: { year: 2024, granularity: 'annual' },
      });
    });

    await navigateTo(window, '/settings');
    const nav = window.getByRole('navigation').first();
    await nav.waitFor({ state: 'visible', timeout: 15_000 });
    await nav
      .getByRole('button')
      .filter({ hasText: /账套|workspaces/i })
      .first()
      .click();
    await window.getByText(/客户账套|client workspaces/i).waitFor({ timeout: 10_000 });
    await expect(window.getByText('默认账套', { exact: true })).toBeVisible();
    await snap(window, 'workspace-01-default');

    // Create 客户甲.
    await window.getByPlaceholder(/新账套名称|new workspace name/i).fill('客户甲');
    await window.getByRole('button', { name: /新建账套|new workspace/i }).click();
    await window.getByText('客户甲', { exact: true }).waitFor({ timeout: 10_000 });
    await snap(window, 'workspace-02-created');

    // Switch — stub window.confirm, then the app tears down and reloads.
    await window.evaluate(() => {
      (globalThis as unknown as { confirm: (msg?: string) => boolean }).confirm = () => true;
    });
    await window.getByRole('button', { name: /切换|switch/i }).click();

    // The new workspace's DB is empty → org:has-any=false → onboarding
    // (step 1 heading is 公司基本信息).
    await window
      .getByText(/公司基本信息|company basics|第 1 步/i)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await snap(window, 'workspace-03-onboarding-in-new');

    // Switch back through the bridge (onboarding suppresses the sidebar).
    await window.evaluate(async () => {
      const ipc = (
        globalThis as unknown as {
          ipc: {
            invoke: ((channel: 'workspace:list') => Promise<Array<{ id: string; name: string }>>) &
              ((channel: 'workspace:switch', payload: { id: string }) => Promise<{ ok: boolean }>);
          };
        }
      ).ipc;
      const list = await ipc.invoke('workspace:list');
      const defaultWorkspace = list.find((w) => w.name === '默认账套');
      if (!defaultWorkspace) throw new Error('default workspace missing from registry');
      await ipc.invoke('workspace:switch', { id: defaultWorkspace.id });
    });

    // Back in the original workspace: org exists again, dashboard renders.
    await window
      .getByText(/默认客户公司|仪表盘|dashboard/i)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await snap(window, 'workspace-04-back-to-default');
  } finally {
    await teardown(setup);
  }
});
