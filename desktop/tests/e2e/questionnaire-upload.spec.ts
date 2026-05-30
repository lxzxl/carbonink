import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks, FIXTURE_QUESTIONNAIRE, FIXTURE_QUESTIONS } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * Outbound 披露填报 upload flow — drives the real `<input type=file>` in the
 * /questionnaires/new wizard with the committed sample questionnaire fixture
 * (scripts/make-sample-questionnaire.mjs → tests/e2e/fixtures/…xlsx).
 *
 * The e2e harness mocks IPC, so `questionnaire:create` returns a canned result
 * rather than really parsing the xlsx — this asserts the UI half end-to-end:
 *   fill customer → setInputFiles(fixture) → the wizard reflects the chosen file
 *   → submit → navigate to the new questionnaire's detail.
 * (The real parse → LLM-extract is covered deterministically by the vitest
 * integration test `questionnaire-import-fixture.test.ts`.)
 */

// Playwright transpiles specs to CJS, so `__dirname` is available natively
// (same pattern as helpers.ts).
const FIXTURE_XLSX = join(__dirname, 'fixtures', 'sample-customer-questionnaire-2025.xlsx');
const FIXTURE_BASENAME = 'sample-customer-questionnaire-2025.xlsx';

const NEW_ID = 'qst_uploaded';
const CUSTOMER = {
  id: 'cust_upload',
  name: 'Acme Manufacturing Co',
  notes: null,
  role: 'customer',
};
const DOC = {
  id: 'doc_uploaded',
  sha256: 'a'.repeat(64),
  filename: FIXTURE_BASENAME,
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 8452,
  storage_path: '/dev/null',
  uploaded_at: '2026-05-29T00:00:00Z',
  uploaded_by: null,
  doc_type: 'questionnaire',
};
// Post-upload the wizard lands on the new questionnaire in 'mapping' (草稿) status.
const QUESTIONNAIRE = {
  ...FIXTURE_QUESTIONNAIRE,
  id: NEW_ID,
  customer_id: CUSTOMER.id,
  document_id: DOC.id,
  status: 'mapping',
};
const QUESTIONS = FIXTURE_QUESTIONS.map((q) => ({ ...q, questionnaire_id: NEW_ID }));

test('questionnaire: upload .xlsx in the wizard → land on the new detail', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    locale: 'zh-CN',
    cannedIpc: {
      ...baselineIpcMocks(),
      // create is mocked (harness doesn't run the real parser); it returns the
      // new questionnaire id the wizard then navigates to.
      'questionnaire:create': {
        questionnaire_id: NEW_ID,
        question_count: QUESTIONS.length,
        reused_count: 0,
      },
      'questionnaire:get-by-id': {
        questionnaire: QUESTIONNAIRE,
        customer: CUSTOMER,
        document: DOC,
        questions: QUESTIONS,
      },
      'answer:list-by-questionnaire': [],
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);

    await navigateTo(window, '/questionnaires/new');
    await waitForRouteSettled(window);

    // Fill the required customer + attach the real sample questionnaire xlsx via
    // the hidden <input type=file> (Playwright sets files without the native dialog).
    await window.locator('#qa-customer').fill('Acme Manufacturing Co');
    await window.locator('#qa-file').setInputFiles(FIXTURE_XLSX);

    // The dropzone reflects the chosen file (filename is locale-independent).
    await expect(
      window.getByText(new RegExp(FIXTURE_BASENAME.replace(/\./g, '\\.'))),
    ).toBeVisible();
    await snap(window, 'questionnaire-upload-01-file-chosen', { fullPage: true });

    // Submit → questionnaire:create (mocked) → navigate to the new detail.
    await window.getByRole('button', { name: '上传 Excel 并解析' }).click();
    await waitForRouteSettled(window);

    // Landed on the new questionnaire's detail — the customer name is the h1.
    await expect(window.getByRole('heading', { name: 'Acme Manufacturing Co' })).toBeVisible();
    await snap(window, 'questionnaire-upload-02-detail', { fullPage: true });
  } finally {
    await teardown(setup);
  }
});
