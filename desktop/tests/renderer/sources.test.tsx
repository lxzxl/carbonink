import { Route as SourcesRoute } from '@renderer/routes/sources';
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
// preload bridge, so we intercept at the wrapper layer (one boundary up
// from `window.ipc`). Each test resets the mock implementations in beforeEach.
vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: {
    getCurrent: vi.fn(),
    listSites: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: {
    listByOrg: vi.fn(),
    create: vi.fn(),
  },
}));

import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';

const FAKE_ORG = {
  id: 'org_01',
  name_zh: '中山钢铁',
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

const FAKE_SITE = {
  id: 'site_01',
  organization_id: 'org_01',
  name_zh: '主厂区',
  name_en: null,
  address: null,
  country_code: 'CN',
  is_active: 1,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

// Pull the component off the file route — we can't reuse the file-route
// instance directly under a test root (the type system locks `getParentRoute`
// to its generated parent), so we rebuild a minimal route tree that mounts
// the same component. The component is the only piece under test here.
const sourcesComponent: NonNullable<typeof SourcesRoute.options.component> = (() => {
  const c = SourcesRoute.options.component;
  if (!c) throw new Error('sources route is missing a component');
  return c;
})();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const sourcesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sources',
    component: sourcesComponent,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sourcesRoute]),
    history: createMemoryHistory({ initialEntries: ['/sources'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/sources route', () => {
  beforeEach(() => {
    vi.mocked(orgApi.getCurrent).mockResolvedValue(FAKE_ORG);
    vi.mocked(orgApi.listSites).mockResolvedValue([FAKE_SITE]);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([]);
    vi.mocked(sourceApi.create).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the page heading after the org is loaded', async () => {
    render(buildHarness());
    // Heading from m.nav_sources(): "Sources" (en) / "排放源" (zh-CN).
    expect(await screen.findByRole('heading', { name: /Sources|排放源/i })).toBeTruthy();
  });

  it('toggles the inline create form when the Add Source button is clicked', async () => {
    render(buildHarness());

    // Wait for org + sources queries to resolve so the button is rendered.
    const addBtn = await screen.findByRole('button', { name: /Add Source|添加排放源/i });

    // Form is hidden by default.
    expect(screen.queryByRole('button', { name: /Create source|创建排放源/i })).toBeNull();

    // Click toggles the form open.
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create source|创建排放源/i })).toBeTruthy();
    });

    // The toggle button label flips to the cancel state. Two Cancel buttons
    // are now in the DOM (the toggle + the form's own cancel), so use
    // getAllByRole and assert count >= 1 rather than getByRole.
    expect(
      screen.getAllByRole('button', { name: /^Cancel$|^取消$/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders the expected form fields after opening the form', async () => {
    render(buildHarness());
    const addBtn = await screen.findByRole('button', { name: /Add Source|添加排放源/i });
    fireEvent.click(addBtn);

    // Name + Category labels.
    expect(await screen.findByLabelText(/^Name$|^名称$/i)).toBeTruthy();
    expect(screen.getByLabelText(/Category \(optional\)|分类（可选）/i)).toBeTruthy();

    // Scope radios — 3 of them, one per scope.
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(3);

    // Submit button is present.
    expect(screen.getByRole('button', { name: /Create source|创建排放源/i })).toBeTruthy();
  });

  // Regression for Critical #1: sites query resolves AFTER the form mounts
  // (the dominant production path — Phase 1a always has exactly one site,
  // but it arrives via async IPC). The previous render-phase guard read
  // `form.state.values.site_id` without subscribing, so when the sites
  // promise resolved later nothing re-checked the guard and `site_id`
  // stayed empty → submit stayed disabled forever. The useEffect-based fix
  // populates site_id when the query resolves; this test pins that.
  it('enables submit after the async sites query resolves (Critical #1 fix)', async () => {
    // Defer the listSites resolve to a microtask AFTER mount so we
    // exercise the "data arrives later" path. The exact timing doesn't
    // matter — useEffect will run again once defaultSiteId flips.
    vi.mocked(orgApi.listSites).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([FAKE_SITE]), 10);
        }),
    );

    render(buildHarness());
    const addBtn = await screen.findByRole('button', { name: /Add Source|添加排放源/i });
    fireEvent.click(addBtn);

    // Fill in the required Name field so the only remaining gating
    // condition for the submit button is site_id.
    const nameInput = (await screen.findByLabelText(/^Name$|^名称$/i)) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Electricity meter A' } });

    // The form's own "Create source" submit button — there are two
    // buttons in this region, so disambiguate by name.
    const submit = screen.getByRole('button', {
      name: /Create source|创建排放源/i,
    }) as HTMLButtonElement;

    // Wait for the deferred sites query to resolve and the effect to
    // populate site_id; the button should be enabled.
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
  });
});
