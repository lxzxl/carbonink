import { AppSidebar } from '@renderer/components/AppSidebar';
import { SidebarProvider } from '@renderer/components/ui/sidebar';
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
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/api/mcp', () => ({
  mcpApi: { detect: vi.fn() },
}));
vi.mock('@renderer/lib/api/questionnaire', () => ({
  questionnaireApi: { list: vi.fn() },
}));

import { mcpApi } from '@renderer/lib/api/mcp';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';

type ListRow = Questionnaire & { customer_name: string; question_count: number };

function makeRow(overrides: Partial<ListRow>): ListRow {
  return {
    id: 'qn_x',
    customer_id: 'sup_x',
    document_id: null,
    template_kind: 'cat1_supplier_disclosure',
    reporting_year: 2026,
    status: 'sent',
    direction: 'inbound',
    due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    customer_name: '某供应商',
    question_count: 7,
    ...overrides,
  };
}

/** All sidebar link targets need stub routes or Link resolution throws. */
const NAV_PATHS = [
  '/audit',
  '/sources',
  '/activities',
  '/reports',
  '/documents',
  '/questionnaires',
  '/supplier-disclosures',
  '/settings',
];

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <AppSidebar />
        <Outlet />
      </SidebarProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  });
  const stubs = NAV_PATHS.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

async function findSupplierDisclosuresLink(): Promise<HTMLElement> {
  return await screen.findByRole('link', { name: /Supplier disclosures|供应商披露/i });
}

describe('AppSidebar overdue badge', () => {
  beforeEach(() => {
    vi.mocked(mcpApi.detect).mockResolvedValue({} as Awaited<ReturnType<typeof mcpApi.detect>>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the overdue count for inbound sent rows past due — outbound excluded', async () => {
    vi.mocked(questionnaireApi.list).mockResolvedValue([
      makeRow({ id: 'qn_1', due_date: '2000-01-01' }),
      makeRow({ id: 'qn_2', due_date: '2999-12-31' }),
      // Outbound row past a date — must NOT count (badge is inbound-only).
      makeRow({ id: 'qn_3', direction: 'outbound', status: 'sent', due_date: '2000-01-01' }),
      // Received past due — ours to ingest, not the supplier's lateness.
      makeRow({ id: 'qn_4', status: 'received', due_date: '2000-01-01' }),
    ]);

    render(buildHarness());

    const link = await findSupplierDisclosuresLink();
    expect(await within(link).findByText('1')).toBeTruthy();
  });

  it('renders no badge when nothing is overdue', async () => {
    vi.mocked(questionnaireApi.list).mockResolvedValue([
      makeRow({ id: 'qn_1', due_date: '2999-12-31' }),
    ]);

    render(buildHarness());

    const link = await findSupplierDisclosuresLink();
    // Give the list query a tick to settle, then assert absence.
    await screen.findByRole('link', { name: /Supplier disclosures|供应商披露/i });
    expect(within(link).queryByText(/^\d+$/)).toBeNull();
  });
});
