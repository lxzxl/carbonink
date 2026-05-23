import { Route as QuestionnairesRoute } from '@renderer/routes/questionnaires';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IPC wrapper — the route mounts inside a test router with no
// preload bridge, so we intercept at the wrapper layer.
vi.mock('@renderer/lib/api/questionnaire', () => ({
  questionnaireApi: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
  },
}));

import { questionnaireApi } from '@renderer/lib/api/questionnaire';

const FAKE_QUESTIONNAIRE = {
  id: 'ques_01',
  customer_id: 'cust_01',
  customer_name: 'Acme Corp',
  document_id: 'doc_01',
  template_kind: null,
  reporting_year: 2025,
  question_count: 42,
  status: 'answering' as const,
  due_date: '2026-06-30',
  created_at: '2026-05-12T10:00:00.000Z',
};

const FAKE_QUESTIONNAIRE_2 = {
  id: 'ques_02',
  customer_id: 'cust_02',
  customer_name: 'Beta LLC',
  document_id: 'doc_02',
  template_kind: null,
  reporting_year: 2025,
  question_count: 28,
  status: 'parsing' as const,
  due_date: '2026-07-15',
  created_at: '2026-05-13T11:00:00.000Z',
};

const questionnairesComponent: NonNullable<typeof QuestionnairesRoute.options.component> = (() => {
  const c = QuestionnairesRoute.options.component;
  if (!c) throw new Error('questionnaires route is missing a component');
  return c;
})();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const questionnairesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/questionnaires',
    component: questionnairesComponent,
  });
  // Stub detail route so the click navigation has a real target.
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/questionnaires/$id',
    component: () => <p data-testid="detail-stub">detail</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([questionnairesRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/questionnaires'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/questionnaires route', () => {
  beforeEach(() => {
    vi.mocked(questionnaireApi.list).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state when there are no questionnaires', async () => {
    render(buildHarness());
    expect(await screen.findByText(/No questionnaires yet|还没有问卷/)).toBeTruthy();
  });

  it('renders rows after questionnaire:list resolves', async () => {
    vi.mocked(questionnaireApi.list).mockResolvedValue([FAKE_QUESTIONNAIRE, FAKE_QUESTIONNAIRE_2]);
    render(buildHarness());

    // Wait for both customer names to render
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeTruthy();
      expect(screen.getByText('Beta LLC')).toBeTruthy();
    });

    // Verify table content (use getAllByText for duplicate values)
    expect(screen.getAllByText('2025')).toHaveLength(2);
    // Status labels appear in both the filter chip row (top) and per-row
    // meta, so getAllByText: at least 1 chip + 1 row = 2 matches.
    expect(screen.getAllByText(/Answering|答题中/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Parsing|解析中/).length).toBeGreaterThanOrEqual(1);
  });
});
