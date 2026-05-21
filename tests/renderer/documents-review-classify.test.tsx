/**
 * Tests for the T7 classify pipeline on the /documents/$id review page.
 *
 * Covers three states that are triggered when the extraction list is empty:
 *  1. classifying — mutation pending → shows "正在分析单据类型…"
 *  2. classify_failed — mutation resolves with {status:'classify_failed'} → ManualStagePicker
 *  3. classify_succeeded — mutation resolves with {status:'classified'} → ExtractionReview
 */
import { Route as DocumentReviewRoute } from '@renderer/routes/documents.$id';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/ipc', () => ({
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('@renderer/lib/api/document', () => ({
  documentApi: {
    upload: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    readBytes: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/extraction', () => ({
  extractionApi: {
    classifyAndRun: vi.fn(),
    run: vi.fn(),
    listPending: vi.fn(),
    listByDocument: vi.fn(),
    getById: vi.fn(),
    confirm: vi.fn(),
    discard: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: {
    getCurrent: vi.fn(),
    listReportingPeriods: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: {
    listByOrg: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/activity-data', () => ({
  activityApi: {
    create: vi.fn(),
    listByPeriod: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn(),
  },
}));

import { activityApi } from '@renderer/lib/api/activity-data';
import { documentApi } from '@renderer/lib/api/document';
import { efApi } from '@renderer/lib/api/ef-library';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { extractionApi } from '@renderer/lib/api/extraction';
import { orgApi } from '@renderer/lib/api/organization';

const FAKE_DOC = {
  id: 'doc_classify_01',
  sha256: 'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
  filename: 'unknown.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  storage_path: '/tmp/uploads/ab/abcd...pdf',
  uploaded_at: '2026-05-12T10:00:00.000Z',
  uploaded_by: null,
  doc_type: null,
};

const PARSED_JSON = JSON.stringify({
  doc_type: 'china_utility',
  supplier_name: '国网XX供电公司',
  account_no: '1234567890',
  amount_kwh: 500,
  amount_yuan: 285.0,
  period_start: '2025-03-01',
  period_end: '2025-03-31',
  confidence: 'high',
});

const FAKE_EXTRACTION = {
  id: 'ext_classify_01',
  document_id: FAKE_DOC.id,
  llm_provider: 'openai',
  llm_model: 'gpt-4o-mini',
  prompt_version: 'china_utility.v1',
  raw_response: PARSED_JSON,
  parsed_json: PARSED_JSON,
  error_json: null,
  status: 'review_needed' as const,
  reviewed_by_user_at: null,
  cost_usd: null,
  created_at: '2026-05-12T10:00:01.000Z',
};

const FAKE_ORG = {
  id: 'org_01',
  name_zh: '测试公司',
  name_en: null,
  industry: null,
  country_code: 'CN',
  boundary_kind: 'operational_control' as const,
  responsible_person_name: null,
  responsible_person_role: null,
  base_year_period_id: null,
  recalc_threshold_pct: 5.0,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

const reviewComponent: NonNullable<typeof DocumentReviewRoute.options.component> = (() => {
  const c = DocumentReviewRoute.options.component;
  if (!c) throw new Error('documents.$id route is missing a component');
  return c;
})();

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-pdf-url');
  globalThis.URL.revokeObjectURL = vi.fn();
});

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const docsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents',
    component: () => <p data-testid="docs-stub">docs list</p>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents/$id',
    component: reviewComponent,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p data-testid="dash-stub">dashboard</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([docsRoute, detailRoute, indexRoute]),
    history: createMemoryHistory({ initialEntries: [`/documents/${FAKE_DOC.id}`] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/documents/$id classify pipeline', () => {
  beforeEach(() => {
    vi.mocked(documentApi.getById).mockResolvedValue(FAKE_DOC);
    vi.mocked(documentApi.readBytes).mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    vi.mocked(orgApi.getCurrent).mockResolvedValue(FAKE_ORG);
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([]);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([]);
    vi.mocked(activityApi.create).mockReset();
    vi.mocked(activityApi.listByPeriod).mockResolvedValue([]);
    vi.mocked(efApi.list).mockResolvedValue([]);
    vi.mocked(extractionApi.confirm).mockResolvedValue(undefined);
    vi.mocked(extractionApi.discard).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows classifying state while classifyAndRun is pending', async () => {
    // Empty extraction list → auto-triggers classifyAndRun.
    // classifyAndRun never resolves so we stay in the pending state.
    vi.mocked(extractionApi.listByDocument).mockResolvedValue([]);
    vi.mocked(extractionApi.classifyAndRun).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    render(buildHarness());

    expect(await screen.findByText(/Analyzing document type|正在分析单据类型/)).toBeTruthy();
    expect(extractionApi.classifyAndRun).toHaveBeenCalledWith({
      document_id: FAKE_DOC.id,
    });
  });

  it('shows ManualStagePicker with 5 stage options when classifyAndRun returns classify_failed', async () => {
    vi.mocked(extractionApi.listByDocument).mockResolvedValue([]);
    vi.mocked(extractionApi.classifyAndRun).mockResolvedValue({ status: 'classify_failed' });

    render(buildHarness());

    // ManualStagePicker renders the error message and the stage dropdown.
    expect(
      await screen.findByText(/Could not identify document type|无法识别单据类型/),
    ).toBeTruthy();

    // The <select> should have all 5 stage options.
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.options).toHaveLength(5);
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('china_utility.v1');
    expect(optionValues).toContain('fuel_receipt.v1');
    expect(optionValues).toContain('freight.v1');
    expect(optionValues).toContain('purchase.v1');
    expect(optionValues).toContain('travel.v1');
  });

  it('shows ExtractionReview when classifyAndRun returns classified and extraction query refetches', async () => {
    // First call: empty list → triggers classifyAndRun.
    // After classifyAndRun resolves with classified, query invalidates,
    // second listByDocument call returns the new extraction.
    let callCount = 0;
    vi.mocked(extractionApi.listByDocument).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return [];
      return [FAKE_EXTRACTION];
    });
    vi.mocked(extractionApi.classifyAndRun).mockResolvedValue({
      status: 'classified',
      extraction: FAKE_EXTRACTION,
      doc_type: 'china_utility',
    });

    render(buildHarness());

    // After the full pipeline runs, ExtractionReview renders the extracted fields.
    await waitFor(() => {
      expect(screen.getByText('国网XX供电公司')).toBeTruthy();
    });

    // Confirm the classify call happened exactly once.
    expect(extractionApi.classifyAndRun).toHaveBeenCalledOnce();
  });
});
