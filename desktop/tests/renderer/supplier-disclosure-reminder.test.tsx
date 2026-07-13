import { Route as DetailRoute } from '@renderer/routes/supplier-disclosures.$id.index';
import type { Questionnaire } from '@shared/types';
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

vi.mock('@renderer/lib/api/questionnaire', () => ({
  questionnaireApi: { list: vi.fn(), getById: vi.fn() },
}));
vi.mock('@renderer/lib/api/inbound-questionnaire', () => ({
  inboundQuestionnaireApi: {
    createDraft: vi.fn(),
    exportXlsx: vi.fn(),
    importPreview: vi.fn(),
    getPreview: vi.fn(),
    ingest: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/answer', () => ({
  answerApi: { listByQuestionnaire: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: { getCurrent: vi.fn() },
}));
vi.mock('@renderer/lib/api/supplier', () => ({
  supplierApi: { list: vi.fn(), create: vi.fn(), setEmail: vi.fn() },
}));

import { orgApi } from '@renderer/lib/api/organization';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import { supplierApi } from '@renderer/lib/api/supplier';

const FAKE_ORG = {
  id: 'org_01',
  name_zh: '碳墨咨询',
  name_en: null,
  industry: null,
  country_code: 'CN',
  boundary_kind: 'operational_control' as const,
  responsible_person_name: null,
  responsible_person_role: null,
  base_year_period_id: null,
  recalc_threshold_pct: 5.0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const FAKE_DOCUMENT = {
  id: 'doc_01',
  sha256: 'a'.repeat(64),
  filename: 'disclosure.xlsx',
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 1024,
  storage_path: '/dev/null',
  uploaded_at: '2026-01-01T00:00:00Z',
  uploaded_by: null,
  doc_type: 'questionnaire',
};

function makeQuestionnaire(overrides: Partial<Questionnaire>): Questionnaire {
  return {
    id: 'qn_01',
    customer_id: 'sup_01',
    document_id: null,
    template_kind: 'cat1_supplier_disclosure',
    reporting_year: 2025,
    status: 'sent',
    direction: 'inbound',
    due_date: '2000-01-10',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSupplier(email: string | null) {
  return { id: 'sup_01', name: '中山钢铁', notes: null, role: 'supplier' as const, email };
}

const detailComponent: NonNullable<typeof DetailRoute.options.component> = (() => {
  const c = DetailRoute.options.component;
  if (!c) throw new Error('supplier-disclosure detail route is missing a component');
  return c;
})();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/supplier-disclosures',
    component: () => null,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/supplier-disclosures/$id',
    component: detailComponent,
  });
  // The detail page links to these on other statuses; register stubs so
  // route resolution never throws.
  const stubs = ['/questionnaires/$id', '/activities'].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/supplier-disclosures/qn_01'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function mockDetail(questionnaire: Questionnaire, email: string | null): void {
  vi.mocked(questionnaireApi.getById).mockResolvedValue({
    questionnaire,
    customer: makeSupplier(email),
    document: FAKE_DOCUMENT,
    questions: [],
  });
}

describe('supplier-disclosure 催办 reminder', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(orgApi.getCurrent).mockResolvedValue(FAKE_ORG);
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    openSpy.mockRestore();
  });

  it('shows the overdue days in the detail header for a past-due sent row', async () => {
    mockDetail(makeQuestionnaire({}), 'esg@acme.cn');
    render(buildHarness());

    expect(await screen.findByText(/Overdue \d+d|逾期 \d+ 天/)).toBeTruthy();
  });

  it('composes a mailto draft directly when the supplier has an email', async () => {
    mockDetail(makeQuestionnaire({}), 'esg@acme.cn');
    render(buildHarness());

    fireEvent.click(await screen.findByRole('button', { name: /Send reminder|催办邮件/i }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    const url = String(openSpy.mock.calls[0]?.[0]);
    expect(url.startsWith('mailto:esg%40acme.cn?subject=')).toBe(true);
    const decoded = decodeURIComponent(url);
    // Subject names the year + supplier; body cites the deadline and the
    // org sign-off from org:get-current.
    expect(decoded).toContain('2025');
    expect(decoded).toContain('中山钢铁');
    expect(decoded).toContain('2000-01-10');
    expect(decoded).toContain('碳墨咨询');
  });

  it('uses the due-by phrasing (not overdue) when the deadline is in the future', async () => {
    mockDetail(makeQuestionnaire({ due_date: '2999-12-31' }), 'esg@acme.cn');
    render(buildHarness());

    expect(await screen.findByText(/Due 2999-12-31|截止 2999-12-31/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send reminder|催办邮件/i }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    const decoded = decodeURIComponent(String(openSpy.mock.calls[0]?.[0]));
    expect(decoded).toContain('2999-12-31');
    expect(decoded).not.toMatch(/overdue|逾期/);
  });

  it('collects and saves the email first when the supplier has none', async () => {
    mockDetail(makeQuestionnaire({}), null);
    vi.mocked(supplierApi.setEmail).mockResolvedValue(makeSupplier('esg@acme.cn'));
    render(buildHarness());

    fireEvent.click(await screen.findByRole('button', { name: /Send reminder|催办邮件/i }));
    // No email → dialog first, nothing opened yet.
    expect(openSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Add supplier email|填写供应商邮箱/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Supplier email|供应商邮箱/), {
      target: { value: ' esg@acme.cn ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & compose|保存并撰写/i }));

    await waitFor(() => {
      expect(supplierApi.setEmail).toHaveBeenCalledWith({ id: 'sup_01', email: 'esg@acme.cn' });
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    expect(String(openSpy.mock.calls[0]?.[0]).startsWith('mailto:esg%40acme.cn')).toBe(true);
  });
});
