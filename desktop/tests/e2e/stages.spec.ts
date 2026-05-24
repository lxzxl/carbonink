import { test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { CANNED } from './canned.js';
import { baselineIpcMocks, FIXTURE_DOCUMENTS } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * Stage-extraction screenshot specs. Replaces the 5 deferred stage stubs
 * (china_utility / fuel_receipt / freight / purchase / travel).
 *
 * Each scenario:
 *   1. Launches with canned IPC seeded so /documents/$id resolves to a
 *      mocked Document + a single Extraction whose `parsed_json` matches
 *      the stage's Zod schema (via CANNED from canned.ts).
 *   2. Navigates to /documents/<docId> via `window.__router`.
 *   3. Waits for the ExtractionReview right pane to mount.
 *   4. Captures the page (full-page so reviewers see the PDF placeholder
 *      + parsed-field list + Confirm/Discard buttons in one shot).
 *
 * The PDF preview iframe will fail to load real bytes (storage_path is
 * `/dev/null`); that's expected — the iframe area shows a graceful
 * fallback. The ExtractionReview component on the right is what we want
 * to capture, and it doesn't depend on the PDF.
 *
 * One file rather than 5 separate ones because each scenario is
 * essentially "same shape, different `stage_id` + `doc_id`". Splitting
 * would just duplicate the launch + navigate boilerplate 5x. The 5
 * legacy deferred stub files now delegate to this — see each one's
 * comment block.
 */

type StageScenario = {
  stageId: keyof typeof CANNED;
  docId: string;
  snapshotName: string;
};

const SCENARIOS: StageScenario[] = [
  { stageId: 'china_utility.v1', docId: 'doc_utility', snapshotName: 'stage-01-china-utility' },
  { stageId: 'fuel_receipt.v1', docId: 'doc_fuel', snapshotName: 'stage-02-fuel-receipt' },
  { stageId: 'freight.v1', docId: 'doc_freight', snapshotName: 'stage-03-freight' },
  { stageId: 'purchase.v1', docId: 'doc_purchase', snapshotName: 'stage-04-purchase' },
  { stageId: 'travel.v1', docId: 'doc_travel', snapshotName: 'stage-05-travel' },
];

function findDoc(id: string): (typeof FIXTURE_DOCUMENTS)[number] {
  const doc = FIXTURE_DOCUMENTS.find((d) => d.id === id);
  if (!doc) throw new Error(`Fixture document not found: ${id}`);
  return doc;
}

for (const scenario of SCENARIOS) {
  test(`${scenario.stageId}: ExtractionReview snapshot`, async () => {
    const { stageId, docId, snapshotName } = scenario;
    const doc = findDoc(docId);
    const canned = CANNED[stageId];

    // The Extraction row the renderer reads via `extraction:list-by-document`.
    // ID format mirrors what `_setup.ts`'s `extraction:run` mock generates
    // — `ext-<stage_id>-mock` — so the harness's `ef:recommend` interceptor
    // (which decodes stage_id from the ID) routes correctly when the user
    // navigates further.
    const extraction = {
      ...canned.extraction,
      id: `ext-${stageId}-mock`,
      document_id: doc.id,
      created_at: '2026-05-10T12:00:00Z',
    };

    const setup = await launchApp({
      cannedExtractions: { [stageId]: canned.extraction },
      cannedRecommendations: { [stageId]: canned.recommendation },
      // org + provider supplied via `cannedIpc` (typed slots reject the
      // JSON-flexible fixtures' nominal union shapes).
      cannedIpc: {
        ...baselineIpcMocks(),
        // Per-scenario overrides — both are static (single-doc test):
        'document:get-by-id': doc,
        'document:list': [doc],
        'extraction:list-by-document': [extraction],
        // No activity has been confirmed-from-this-extraction yet.
        'activity:find-by-extraction': null,
        // Avoid the auto-classify side effect (extractionsQuery has data
        // → useEffect won't fire) but mock anyway in case the renderer
        // calls it on retry.
        'extraction:classify-and-run': {
          status: 'classified',
          extraction,
          doc_type: stageId.replace(/\..+$/, ''),
        },
      },
    });

    try {
      const { window } = setup;
      await waitForReactMount(window);
      await navigateTo(window, `/documents/${doc.id}`);
      await waitForRouteSettled(window);
      // Extra settle — ExtractionReview reads parsed_json + computes
      // confidence chip + waits on source:list-by-org. Brief pad ensures
      // the field list paints before screenshot.
      await window.waitForTimeout(800);
      await snap(window, snapshotName, { fullPage: true });
    } finally {
      await teardown(setup);
    }
  });
}
