import { Route as DocumentReviewRoute } from '@renderer/routes/documents_.$id';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IPC wrappers — the route mounts inside a test router with no
// preload bridge, so we intercept at the wrapper layer.
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
  id: 'doc_01',
  sha256: 'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
  filename: 'bill.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1234,
  storage_path: '/tmp/uploads/ab/abcd...pdf',
  uploaded_at: '2026-05-12T10:00:00.000Z',
  uploaded_by: null,
};

// Representative china_utility extraction JSON. The Phase 1b stage schema
// (see `src/main/llm/stages/china-utility.ts`) is the source of truth.
const PARSED_JSON = JSON.stringify({
  doc_type: 'china_utility',
  supplier_name: '国网XX供电公司',
  account_no: '1234567890',
  amount_kwh: 1000,
  amount_yuan: 570.3,
  period_start: '2025-01-01',
  period_end: '2025-01-31',
  confidence: 'high',
});

const FAKE_EXTRACTION = {
  id: 'ext_01',
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
  name_zh: '中山钢铁',
  name_en: null,
  industry: null,
  country_code: 'CN',
  boundary_kind: 'operational_control' as const,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

const FAKE_SOURCE = {
  id: 'src_01',
  site_id: 'site_01',
  name: 'Purchased Electricity',
  scope: 2 as const,
  category: 'electricity.grid',
  ghg_protocol_path: null,
  default_ef_query: null,
  template_origin: null,
  is_active: true,
};

const FAKE_PERIOD = {
  id: 'period_01',
  organization_id: 'org_01',
  year: 2026,
  granularity: 'annual' as const,
  starts_at: '2026-01-01',
  ends_at: '2026-12-31',
  is_active: 1,
  created_at: '2026-05-11T00:00:00Z',
};

const reviewComponent: NonNullable<typeof DocumentReviewRoute.options.component> = (() => {
  const c = DocumentReviewRoute.options.component;
  if (!c) throw new Error('documents.$id route is missing a component');
  return c;
})();

// happy-dom doesn't implement URL.createObjectURL out of the box. Stub it so
// the PdfPreview component renders without exploding.
beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-pdf-url');
  globalThis.URL.revokeObjectURL = vi.fn();
});

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  // Stub /documents — needed for the BackLink Link's type registration.
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
  // Stub dashboard — Confirm flow navigates to '/'.
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

describe('/documents/$id review route', () => {
  beforeEach(() => {
    vi.mocked(documentApi.getById).mockResolvedValue(FAKE_DOC);
    vi.mocked(documentApi.readBytes).mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    vi.mocked(extractionApi.listByDocument).mockResolvedValue([FAKE_EXTRACTION]);
    vi.mocked(extractionApi.confirm).mockResolvedValue(undefined);
    vi.mocked(extractionApi.discard).mockResolvedValue(undefined);
    vi.mocked(orgApi.getCurrent).mockResolvedValue(FAKE_ORG);
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([FAKE_SOURCE]);
    vi.mocked(activityApi.create).mockReset();
    vi.mocked(activityApi.listByPeriod).mockResolvedValue([]);
    vi.mocked(efApi.list).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the extracted fields from the extraction JSON', async () => {
    render(buildHarness());

    // Filename heading.
    expect(await screen.findByRole('heading', { name: /bill\.pdf/ })).toBeTruthy();
    // Supplier (Chinese text from PARSED_JSON).
    expect(await screen.findByText('国网XX供电公司')).toBeTruthy();
    // amount_kwh formatted as "1000 kWh".
    expect(screen.getByText('1000 kWh')).toBeTruthy();
    // amount_yuan formatted as ¥570.3.
    expect(screen.getByText('¥570.3')).toBeTruthy();
    // Period dates.
    expect(screen.getByText('2025-01-01')).toBeTruthy();
    expect(screen.getByText('2025-01-31')).toBeTruthy();
  });

  it('Confirm button opens the embedded ActivityForm with prefilled values', async () => {
    render(buildHarness());

    // Wait for extracted fields to render.
    await screen.findByText('国网XX供电公司');

    // Click Confirm to open the embedded form.
    const confirmButton = screen.getByRole('button', {
      name: /Confirm → Add as activity|确认 → 记为活动数据/,
    });
    fireEvent.click(confirmButton);

    // The ActivityForm prefills the amount field with the extracted kWh.
    const amountInput = (await screen.findByLabelText(/^Amount$|^数量$/)) as HTMLInputElement;
    expect(amountInput.value).toBe('1000');

    const unitInput = screen.getByLabelText(/^Unit$|^单位$/) as HTMLInputElement;
    expect(unitInput.value).toBe('kWh');

    const startInput = screen.getByLabelText(/Start date|开始日期/) as HTMLInputElement;
    expect(startInput.value).toBe('2025-01-01');
    const endInput = screen.getByLabelText(/End date|结束日期/) as HTMLInputElement;
    expect(endInput.value).toBe('2025-01-31');

    // Notes prefilled with "Auto-extracted from: bill.pdf".
    const notesInput = screen.getByLabelText(
      /Notes \(optional\)|备注（可选）/,
    ) as HTMLTextAreaElement;
    expect(notesInput.value).toContain('bill.pdf');
  });

  it('shows the no-extraction message when no extractions exist', async () => {
    vi.mocked(extractionApi.listByDocument).mockResolvedValue([]);

    render(buildHarness());

    expect(await screen.findByText(/No extraction yet|这份文档还没有抽取结果/)).toBeTruthy();
  });

  it('Discard button calls extractionApi.discard after confirmation', async () => {
    // happy-dom doesn't ship a `window.confirm` implementation out of the
    // box — assign a stub directly. Returning true exercises the
    // discard-mutation branch; the cleanup restores the original value
    // (which is `undefined`, but explicit restore keeps the test isolated).
    const originalConfirm = window.confirm;
    (window as unknown as { confirm: (msg?: string) => boolean }).confirm = vi.fn(() => true);
    try {
      render(buildHarness());

      // Wait for the extracted fields, then click Discard.
      await screen.findByText('国网XX供电公司');
      const discardButton = screen.getByRole('button', { name: /^Discard$|^丢弃$/ });
      fireEvent.click(discardButton);

      await waitFor(() => {
        expect(extractionApi.discard).toHaveBeenCalledWith({ id: FAKE_EXTRACTION.id });
      });
    } finally {
      (window as unknown as { confirm: typeof originalConfirm }).confirm = originalConfirm;
    }
  });
});
