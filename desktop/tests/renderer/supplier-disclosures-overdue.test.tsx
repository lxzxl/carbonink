import { Route as SupplierDisclosuresRoute } from '@renderer/routes/supplier-disclosures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/api/questionnaire', () => ({
  questionnaireApi: { list: vi.fn() },
}));

import { questionnaireApi } from '@renderer/lib/api/questionnaire';

/** Bare-date helpers relative to the real clock — the overdue logic
 * compares against local "today", so fixtures are built the same way. */
function daysFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('sv-SE');
}

function inboundRow(overrides: Record<string, unknown>) {
  return {
    id: 'qn-x',
    customer_id: 'sup-x',
    document_id: null,
    template_kind: 'cat1_supplier_disclosure',
    reporting_year: 2026,
    status: 'sent',
    direction: 'inbound',
    due_date: null,
    created_at: '2026-07-01T00:00:00Z',
    customer_name: 'Supplier X',
    question_count: 7,
    ...overrides,
  };
}

const ROWS = [
  // Sent, deadline 3 days behind us → overdue.
  inboundRow({ id: 'qn-late', customer_name: '迟到供应商', due_date: daysFromToday(-3) }),
  // Sent, deadline ahead → waiting, not overdue.
  inboundRow({ id: 'qn-ok', customer_name: '正常供应商', due_date: daysFromToday(14) }),
  // Ingested with a past due date → done, never overdue.
  inboundRow({
    id: 'qn-done',
    customer_name: '已入库供应商',
    status: 'ingested',
    due_date: daysFromToday(-30),
  }),
];

const layoutComponent: NonNullable<typeof SupplierDisclosuresRoute.options.component> = (() => {
  const c = SupplierDisclosuresRoute.options.component;
  if (!c) throw new Error('supplier-disclosures route is missing a component');
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
    component: layoutComponent,
  });
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/supplier-disclosures/new',
    component: () => null,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/supplier-disclosures/$id',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, newRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/supplier-disclosures'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/supplier-disclosures overdue tracking (ROADMAP §8.1-⑤ v1)', () => {
  beforeEach(() => {
    vi.mocked(questionnaireApi.list).mockResolvedValue(
      // biome-ignore lint/suspicious/noExplicitAny: fixture matches the joined list shape at runtime
      ROWS as any,
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('badges the sent-past-due row and leaves the others alone', async () => {
    render(buildHarness());

    const lateRow = (await screen.findByText('迟到供应商')).closest('li');
    expect(lateRow).toBeTruthy();
    expect(within(lateRow as HTMLElement).getByText(/Overdue 3d|逾期 3 天/)).toBeTruthy();

    const okRow = screen.getByText('正常供应商').closest('li');
    expect(within(okRow as HTMLElement).queryByText(/Overdue|逾期/)).toBeNull();
    expect(within(okRow as HTMLElement).getByText(/Due |截止 /)).toBeTruthy();

    const doneRow = screen.getByText('已入库供应商').closest('li');
    expect(within(doneRow as HTMLElement).queryByText(/Overdue|逾期/)).toBeNull();
  });

  it('offers an overdue filter chip whose count and filtering are correct', async () => {
    render(buildHarness());

    const chip = await screen.findByRole('button', { name: /(Overdue|逾期)\s*1/ });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(screen.getByText('迟到供应商')).toBeTruthy();
      expect(screen.queryByText('正常供应商')).toBeNull();
      expect(screen.queryByText('已入库供应商')).toBeNull();
    });
  });
});
