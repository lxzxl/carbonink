import { Route as NewQuestionnaireRoute } from '@renderer/routes/questionnaires_.new';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IPC wrapper
vi.mock('@renderer/lib/api/questionnaire', () => ({
  questionnaireApi: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
  },
}));

const newQuestionnaireComponent: NonNullable<typeof NewQuestionnaireRoute.options.component> =
  (() => {
    const c = NewQuestionnaireRoute.options.component;
    if (!c) throw new Error('new questionnaire route is missing a component');
    return c;
  })();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/questionnaires/new',
    component: newQuestionnaireComponent,
  });
  // Stub detail route so navigation won't error
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/questionnaires/$id',
    component: () => <p data-testid="detail-stub">detail</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([newRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/questionnaires/new'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/questionnaires/new route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the wizard form with all required inputs', async () => {
    const { container } = render(buildHarness());

    // Wait for the component to mount (router + queries need a tick)
    await waitFor(() => {
      expect(container.innerHTML).not.toBe('');
    });

    // Verify customer name input field exists
    expect(container.querySelector('input[id="qa-customer"]')).toBeTruthy();

    // Verify year input field exists with the default year
    const yearInput = container.querySelector(
      'input[id="qa-year"][type="number"]',
    ) as HTMLInputElement;
    expect(yearInput).toBeTruthy();
    expect(yearInput.value).toBe(new Date().getFullYear().toString());

    // Verify due date input field exists
    expect(container.querySelector('input[id="qa-due"][type="date"]')).toBeTruthy();

    // Verify file input is visible
    expect(container.querySelector('input[id="qa-file"][type="file"]')).toBeTruthy();

    // Verify submit button is visible
    expect(screen.getByRole('button')).toBeTruthy();
  });
});
