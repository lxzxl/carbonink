import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks, FIXTURE_QUESTIONNAIRE, FIXTURE_QUESTIONS } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * In-app guidance tours, in a real Electron window.
 *
 * vitest proves the play-once / dismiss-forever bookkeeping (see
 * `tests/renderer/guided-tour.test.tsx`), but not the two things that can
 * only fail in a real window: the tooltip has to land somewhere visible
 * next to its anchor (happy-dom reports every rect as 0×0, so joyride's
 * positioning is a no-op there), and its buttons have to be genuinely
 * clickable through the overlay + spotlight cutout.
 *
 * This launch opts guidance back in (`guidance: true`) — every other spec
 * runs with it suppressed so no tour covers their screenshots.
 */

const QUESTIONNAIRE_ID = FIXTURE_QUESTIONNAIRE.id;

const CUSTOMER = {
  id: FIXTURE_QUESTIONNAIRE.customer_id,
  name: 'Unilever Supply Chain',
  notes: 'CDP 2026 climate change module',
};

const QUESTIONNAIRE_DOC = {
  id: FIXTURE_QUESTIONNAIRE.document_id,
  sha256: 'f'.repeat(64),
  filename: 'cdp-2026-questionnaire.xlsx',
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 24_576,
  storage_path: '/dev/null',
  uploaded_at: FIXTURE_QUESTIONNAIRE.created_at,
  uploaded_by: null,
  doc_type: 'questionnaire',
};

// One finalized + one draft answer, so the answer-review tour finds both
// the card anchor and the save/finalize action row.
const ANSWERS = [
  {
    id: 'ans_1',
    question_id: 'q_1',
    value: '1824.96',
    unit: 'kg CO2e',
    source_kind: 'mapped_inventory',
    source_calculation_snapshot_id: null,
    source_activity_data_id: 'act_001',
    source_company_profile_key: null,
    source_narrative_bank_id: null,
    source_summary: '基于 2026-04 总部电力账单（act_001）',
    finalized_at: null,
  },
];

test('guidance: the answer-review tour plays once, then never again', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    guidance: true,
    cannedIpc: {
      ...baselineIpcMocks(),
      'questionnaire:get-by-id': {
        questionnaire: FIXTURE_QUESTIONNAIRE,
        customer: CUSTOMER,
        document: QUESTIONNAIRE_DOC,
        questions: FIXTURE_QUESTIONS,
      },
      'answer:list-by-questionnaire': ANSWERS,
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    await navigateTo(window, `/questionnaires/${QUESTIONNAIRE_ID}`);
    await waitForRouteSettled(window);

    // Step 1 — the tooltip renders and is positioned on screen.
    const tooltip = window.getByTestId('guidance-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 10_000 });
    await expect(window.getByText('每题一张卡片')).toBeVisible();

    const box = await tooltip.boundingBox();
    expect(box).not.toBeNull();
    // A 0×0 or off-viewport tooltip means positioning failed.
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.height ?? 0).toBeGreaterThan(60);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    // The floater animates into place — settle before capturing.
    await window.waitForTimeout(500);
    await snap(window, 'guidance-01-answer-review-step1', { fullPage: false });

    // Step 2 — the primary button is clickable through the overlay.
    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('保存 与 保存并定稿')).toBeVisible();
    await window.waitForTimeout(500);
    await snap(window, 'guidance-02-answer-review-step2', { fullPage: false });

    // Walk to the end and dismiss.
    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('整份问卷的动作')).toBeVisible();
    await window.getByRole('button', { name: '知道了' }).click();
    await expect(tooltip).toBeHidden();

    // Re-entering the screen must not replay it. (Leaving via /documents
    // rather than /questionnaires: the list route has a tour of its own
    // that has not been seen yet, and it would be the thing on screen.)
    await navigateTo(window, '/documents');
    await waitForRouteSettled(window);
    await navigateTo(window, `/questionnaires/${QUESTIONNAIRE_ID}`);
    await waitForRouteSettled(window);
    await window.waitForTimeout(1200);
    await expect(window.getByTestId('guidance-tooltip')).toHaveCount(0);
  } finally {
    await teardown(setup);
  }
});

test('guidance: the questionnaire-list tour plays on the list screen', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    guidance: true,
    cannedIpc: { ...baselineIpcMocks() },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    await navigateTo(window, '/questionnaires');
    await waitForRouteSettled(window);

    await expect(window.getByTestId('guidance-tooltip')).toBeVisible({ timeout: 10_000 });
    await expect(window.getByText('从客户问卷开始')).toBeVisible();
    await window.waitForTimeout(500);
    await snap(window, 'guidance-05-questionnaire-list', { fullPage: false });

    // Two steps here, so the last one says "done" rather than "next".
    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('按状态与到期日追踪')).toBeVisible();
    await window.getByRole('button', { name: '知道了' }).click();
    await expect(window.getByTestId('guidance-tooltip')).toBeHidden();
  } finally {
    await teardown(setup);
  }
});
