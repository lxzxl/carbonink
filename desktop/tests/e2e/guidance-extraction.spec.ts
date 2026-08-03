import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { CANNED } from './canned.js';
import { baselineIpcMocks, FIXTURE_DOCUMENTS } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * The extraction-stage tour, in a real window.
 *
 * Its three anchors live in `ExtractionReview` and only exist once an
 * extraction has been parsed — the branch of the screen a unit test can
 * assert but only a real window can prove is reachable, laid out, and
 * clickable. Reuses the stage-spec fixture shape (see stages.spec.ts).
 *
 * Deliberately serves NO pdf bytes (unlike stages.spec.ts): with real
 * bytes the preview's sandboxed iframe crashes under the harness, and a
 * crashed subframe stalls the window's animation frames — driver's step
 * transition then never paints until something poking the renderer wakes
 * it. The tour's anchors are all in the review panel, so the PDF
 * fallback is fine here and the run stays honest.
 */

const STAGE_ID = 'china_utility.v1';
const DOC_ID = 'doc_utility';

test('guidance: the extraction tour explains the stage, the actions and the escape hatch', async () => {
  const doc = FIXTURE_DOCUMENTS.find((d) => d.id === DOC_ID);
  if (!doc) throw new Error(`Fixture document not found: ${DOC_ID}`);
  const canned = CANNED[STAGE_ID];
  const extraction = {
    ...canned.extraction,
    id: `ext-${STAGE_ID}-mock`,
    document_id: doc.id,
    created_at: '2026-05-10T12:00:00Z',
  };

  const setup = await launchApp({
    cannedExtractions: { [STAGE_ID]: canned.extraction },
    cannedRecommendations: { [STAGE_ID]: canned.recommendation },
    guidance: true,
    cannedIpc: {
      ...baselineIpcMocks(),
      'document:get-by-id': doc,
      'document:list': [doc],
      'extraction:list-by-document': [extraction],
      'activity:find-by-extraction': null,
      'extraction:classify-and-run': {
        status: 'classified',
        extraction,
        doc_type: STAGE_ID.replace(/\..+$/, ''),
      },
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    await navigateTo(window, `/documents/${doc.id}`);
    await waitForRouteSettled(window);

    const tooltip = window.getByTestId('guidance-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 10_000 });
    await expect(window.getByText('抽取阶段', { exact: true })).toBeVisible();
    const box = await tooltip.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    await window.waitForTimeout(500);
    await snap(window, 'guidance-06-extraction-step1', { fullPage: false });

    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('确认之后会发生什么')).toBeVisible();

    await window.getByRole('button', { name: '下一步' }).click();
    await expect(window.getByText('分类判错了？')).toBeVisible();
    await window.waitForTimeout(500);
    await snap(window, 'guidance-07-extraction-step3', { fullPage: false });

    await window.getByRole('button', { name: '知道了' }).click();
    await expect(tooltip).toBeHidden();
    // The review panel underneath is intact and usable afterwards.
    await expect(window.getByRole('button', { name: '确认 → 记为活动数据' })).toBeVisible();
  } finally {
    await teardown(setup);
  }
});
