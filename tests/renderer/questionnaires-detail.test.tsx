import { Route as QuestionnairesDetailRoute } from '@renderer/routes/questionnaires.$id';
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

const FAKE_CUSTOMER = {
  id: 'cust_01',
  name: 'Acme Corp',
  notes: null,
};

const FAKE_DOCUMENT = {
  id: 'doc_01',
  sha256: 'abc123',
  filename: 'questionnaire_2025.xlsx',
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 12345,
  storage_path: '/storage/doc_01',
  uploaded_at: '2026-05-12T10:00:00.000Z',
  uploaded_by: 'user_01',
  doc_type: 'questionnaire',
};

const FAKE_QUESTIONNAIRE = {
  id: 'ques_01',
  customer_id: 'cust_01',
  document_id: 'doc_01',
  template_kind: null,
  reporting_year: 2025,
  status: 'answering' as const,
  due_date: '2026-06-30',
  created_at: '2026-05-12T10:00:00.000Z',
};

const FAKE_QUESTIONS = [
  {
    id: 'q_01',
    questionnaire_id: 'ques_01',
    question_signature: 'sig_01',
    signature_version: 'v1',
    normalized_text: 'What is the total energy consumption?',
    raw_text: 'Total energy (kWh)',
    parsed_intent: null,
    question_kind: 'numerical' as const,
    expected_unit: 'kWh',
    position: 'B2',
    required: 0,
  },
  {
    id: 'q_02',
    questionnaire_id: 'ques_01',
    question_signature: 'sig_02',
    signature_version: 'v1',
    normalized_text: 'What is the reporting period?',
    raw_text: 'Reporting period',
    parsed_intent: null,
    question_kind: 'numerical' as const,
    expected_unit: null,
    position: 'C3',
    required: 0,
  },
  {
    id: 'q_03',
    questionnaire_id: 'ques_01',
    question_signature: 'sig_03',
    signature_version: 'v1',
    normalized_text: 'What is the waste generation?',
    raw_text: 'Waste (tons)',
    parsed_intent: null,
    question_kind: 'numerical' as const,
    expected_unit: 'tons',
    position: null,
    required: 0,
  },
];

const questionnaireDetailComponent: NonNullable<
  typeof QuestionnairesDetailRoute.options.component
> = (() => {
  const c = QuestionnairesDetailRoute.options.component;
  if (!c) throw new Error('questionnaires detail route is missing a component');
  return c;
})();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const questionnairesListRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/questionnaires',
    component: () => <p data-testid="list-stub">list</p>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/questionnaires/$id',
    component: questionnaireDetailComponent,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([questionnairesListRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/questionnaires/ques_01'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/questionnaires/$id detail route', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders questionnaire detail with questions', async () => {
    vi.mocked(questionnaireApi.getById).mockResolvedValue({
      questionnaire: FAKE_QUESTIONNAIRE,
      customer: FAKE_CUSTOMER,
      document: FAKE_DOCUMENT,
      questions: FAKE_QUESTIONS,
    });

    render(buildHarness());

    // Wait for customer name to render
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeTruthy();
    });

    // Verify header info
    expect(screen.getByText('2025 · answering · questionnaire_2025.xlsx')).toBeTruthy();

    // Verify question table rows
    expect(screen.getByText('Total energy (kWh)')).toBeTruthy();
    expect(screen.getByText('Reporting period')).toBeTruthy();
    expect(screen.getByText('Waste (tons)')).toBeTruthy();

    // Verify units display
    expect(screen.getByText('kWh')).toBeTruthy();
    expect(screen.getByText('tons')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2); // for expected_unit and position that are null

    // Verify cell positions display
    expect(screen.getByText('B2')).toBeTruthy();
    expect(screen.getByText('C3')).toBeTruthy();

    // Verify answer pending message
    expect(
      screen.getByText(/Phase 2\.2b will generate answers here|Phase 2\.2b 将在此处生成答案/),
    ).toBeTruthy();

    // Verify back link
    expect(screen.getAllByText(/← Questionnaires|← 返回问卷列表/)).toBeTruthy();
  });

  it('renders not-found state when questionnaire does not exist', async () => {
    vi.mocked(questionnaireApi.getById).mockResolvedValue(null);

    render(buildHarness());

    // Wait for not-found message to render
    await waitFor(() => {
      expect(
        screen.getByText(/Questionnaire not found|问卷不存在/),
      ).toBeTruthy();
    });

    // Verify back link is still available
    expect(screen.getAllByText(/← Questionnaires|← 返回问卷列表/)).toBeTruthy();
  });
});
