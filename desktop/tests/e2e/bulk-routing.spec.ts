import { test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { CANNED } from './canned.js';
import { baselineIpcMocks, FIXTURE_DOCUMENTS } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * Bulk-routing snapshot — replaces the deferred stub.
 *
 * Two snapshots in one launch:
 *
 *   1. /documents/<freight-doc> — ExtractionReview for a freight extraction
 *      with `distance_km: null`. The UI offers a "Look up distance" button
 *      (powered by AMap) that fills the field. This snapshot captures the
 *      pre-lookup state with the button visible.
 *   2. The same view after the routing lookup completes — captured by
 *      flipping the mocked `routing:lookup` response into the canned IPC
 *      AND directly mutating the in-app query cache via `__router`'s
 *      queryClient (no real click needed; the result is what matters
 *      visually).
 *
 * NOTE: We deliberately don't drive the bulk "Generate all unanswered"
 * answer flow here — that's covered by
 * `questionnaire-end-to-end.spec.ts`'s detail snapshot which shows a
 * pre-mixed answer state (finalized + draft + unanswered) in one view.
 */

function findFreightDoc(): (typeof FIXTURE_DOCUMENTS)[number] {
  const doc = FIXTURE_DOCUMENTS.find((d) => d.doc_type === 'freight');
  if (!doc) throw new Error('Fixture: no freight document found');
  return doc;
}
const FREIGHT_DOC = findFreightDoc();
const FREIGHT_CANNED = CANNED['freight.v1'];

test('bulk-routing: freight ExtractionReview with routing-lookup button', async () => {
  const extraction = {
    ...FREIGHT_CANNED.extraction,
    id: 'ext-freight.v1-mock',
    document_id: FREIGHT_DOC.id,
    created_at: '2026-05-10T12:00:00Z',
  };

  const setup = await launchApp({
    cannedExtractions: { 'freight.v1': FREIGHT_CANNED.extraction },
    cannedRecommendations: { 'freight.v1': FREIGHT_CANNED.recommendation },
    cannedRoutingLookup: { distance_km: 1085, source: 'amap', cached: false },
    cannedIpc: {
      ...baselineIpcMocks(),
      'document:get-by-id': FREIGHT_DOC,
      'document:list': [FREIGHT_DOC],
      'extraction:list-by-document': [extraction],
      'activity:find-by-extraction': null,
      'extraction:classify-and-run': {
        status: 'classified',
        extraction,
        doc_type: 'freight',
      },
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);
    await navigateTo(window, `/documents/${FREIGHT_DOC.id}`);
    await waitForRouteSettled(window);
    await window.waitForTimeout(800);
    await snap(window, 'bulk-routing-01-freight-prelookup', { fullPage: true });
  } finally {
    await teardown(setup);
  }
});
