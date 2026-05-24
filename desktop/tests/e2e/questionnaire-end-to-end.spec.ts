import { test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import {
  baselineIpcMocks,
  FIXTURE_DOCUMENTS,
  FIXTURE_QUESTIONNAIRE,
  FIXTURE_QUESTIONS,
} from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * Questionnaire end-to-end snapshot — replaces the deferred stub.
 *
 * Captures two meaningful states in one launch:
 *   1. /questionnaires       — list view with 1 questionnaire in 'answering'
 *                              state, customer + question_count visible.
 *   2. /questionnaires/$id   — detail view: question list + AnswerReviewCard
 *                              for each. Three answer states co-exist in the
 *                              fixture (finalized / draft / unanswered) so
 *                              the screenshot covers the full visual matrix.
 *
 * Not covered (out of scope for snapshot): the export-to-xlsx flow (needs
 * `stubDialog` + a real ExcelJS round-trip), and the "Generate all
 * unanswered" bulk-answer action (covered by bulk-routing.spec.ts).
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

// Pre-filled answers — one finalized, one draft, one unanswered. Matches
// the three states the AnswerReviewCard renders distinctly.
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
    finalized_at: '2026-05-10T14:00:00Z',
  },
  {
    id: 'ans_2',
    question_id: 'q_2',
    value: '34.5',
    unit: '%',
    source_kind: 'ai_suggested',
    source_calculation_snapshot_id: null,
    source_activity_data_id: null,
    source_company_profile_key: null,
    source_narrative_bank_id: null,
    source_summary: 'AI 建议草稿；待确认',
    finalized_at: null,
  },
  // q_3 (narrative) deliberately unanswered → AnswerReviewCard renders
  // its "Generate answer" empty state.
];

test('questionnaire: list + detail snapshots', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedIpc: {
      ...baselineIpcMocks(),
      'questionnaire:get-by-id': {
        questionnaire: FIXTURE_QUESTIONNAIRE,
        customer: CUSTOMER,
        document: QUESTIONNAIRE_DOC,
        questions: FIXTURE_QUESTIONS,
      },
      'answer:list-by-questionnaire': ANSWERS,
      'document:list': [...FIXTURE_DOCUMENTS, QUESTIONNAIRE_DOC],
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    // /questionnaires — list
    await navigateTo(window, '/questionnaires');
    await waitForRouteSettled(window);
    await snap(window, 'questionnaire-01-list', { fullPage: true });

    // /questionnaires/<id> — Q&A detail
    await navigateTo(window, `/questionnaires/${QUESTIONNAIRE_ID}`);
    await waitForRouteSettled(window);
    await window.waitForTimeout(800);
    await snap(window, 'questionnaire-02-detail', { fullPage: true });
  } finally {
    await teardown(setup);
  }
});
