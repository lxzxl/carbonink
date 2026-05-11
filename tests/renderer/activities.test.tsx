import { Route as ActivitiesRoute } from '@renderer/routes/activities';
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
// preload bridge, so we intercept at the wrapper layer. Each test resets
// the mock implementations in beforeEach so cross-test bleed is impossible.
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
    listByPeriod: vi.fn(),
    create: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn(),
  },
}));

import { activityApi } from '@renderer/lib/api/activity-data';
import { efApi } from '@renderer/lib/api/ef-library';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';

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

// Same harness pattern as sources.test.tsx — rebuild a minimal route tree
// rather than reusing the generated file-route under a different parent.
const activitiesComponent: NonNullable<typeof ActivitiesRoute.options.component> = (() => {
  const c = ActivitiesRoute.options.component;
  if (!c) throw new Error('activities route is missing a component');
  return c;
})();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const activitiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/activities',
    component: activitiesComponent,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([activitiesRoute]),
    history: createMemoryHistory({ initialEntries: ['/activities'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/activities route', () => {
  beforeEach(() => {
    vi.mocked(orgApi.getCurrent).mockResolvedValue(FAKE_ORG);
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([FAKE_SOURCE]);
    vi.mocked(activityApi.listByPeriod).mockResolvedValue([]);
    vi.mocked(activityApi.create).mockReset();
    vi.mocked(efApi.list).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the page heading after the org is loaded', async () => {
    render(buildHarness());
    // Heading from m.nav_activities(): "Activities" (en) / "活动数据" (zh-CN).
    expect(await screen.findByRole('heading', { name: /Activities|活动数据/i })).toBeTruthy();
  });

  it('toggles the inline create form when the Add Activity button is clicked', async () => {
    render(buildHarness());

    // Wait for org + sources + periods queries to resolve so the button is rendered.
    const addBtn = await screen.findByRole('button', {
      name: /Add Activity|添加活动数据/i,
    });

    // Form is hidden by default.
    expect(screen.queryByRole('button', { name: /Record activity|记录活动/i })).toBeNull();

    // Click toggles the form open.
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Record activity|记录活动/i })).toBeTruthy();
    });
  });

  it('renders the expected form fields after opening the form', async () => {
    render(buildHarness());
    const addBtn = await screen.findByRole('button', {
      name: /Add Activity|添加活动数据/i,
    });
    fireEvent.click(addBtn);

    // Core form fields — source / period selects, date pickers, amount + unit.
    expect(await screen.findByLabelText(/Emission source|^排放源$/i)).toBeTruthy();
    expect(screen.getByLabelText(/Reporting period|报告期/i)).toBeTruthy();
    expect(screen.getByLabelText(/Start date|开始日期/i)).toBeTruthy();
    expect(screen.getByLabelText(/End date|结束日期/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Amount$|^数量$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Unit$|^单位$/i)).toBeTruthy();
    expect(screen.getByLabelText(/Fuel \(optional\)|燃料（可选）/i)).toBeTruthy();
    expect(screen.getByLabelText(/Notes \(optional\)|备注（可选）/i)).toBeTruthy();

    // Submit button is present.
    expect(screen.getByRole('button', { name: /Record activity|记录活动/i })).toBeTruthy();
  });

  // Regression test for commit a4a69c3: picking an emission source must
  // trigger the EF candidate fetch and surface the resulting radio buttons.
  // Before the fix the ActivityForm was reading
  // `form.state.values.emission_source_id` synchronously (no subscription)
  // so the parent component never re-rendered after the user picked, and
  // efQuery stayed disabled.
  it('renders EF candidates after the user picks a source (a4a69c3 regression)', async () => {
    vi.mocked(efApi.list).mockResolvedValue([
      {
        factor_code: 'electricity.grid.cn',
        year: 2024,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2024.1',
        scope: 2,
        category: 'electricity.grid',
        ghg_protocol_path: null,
        input_unit: 'kWh',
        co2e_kg_per_unit: 0.5703,
        ch4_kg_per_unit: null,
        n2o_kg_per_unit: null,
        hfc_kg_per_unit: null,
        pfc_kg_per_unit: null,
        sf6_kg_per_unit: null,
        nf3_kg_per_unit: null,
        gwp_basis: 'AR5',
        name_zh: '中国电网平均',
        name_en: null,
        description_zh: null,
        description_en: null,
        notes: null,
        citation_url: null,
      },
    ]);

    render(buildHarness());
    const addBtn = await screen.findByRole('button', {
      name: /Add Activity|添加活动数据/i,
    });
    fireEvent.click(addBtn);

    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;

    // Pick the only source. The form should now fire efApi.list and the
    // radio button should appear once the query resolves.
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });
    const radio = await screen.findByRole('radio');
    expect(radio).toBeTruthy();
  });

  // Regression test for commit d3f1b31: picking an EF radio must flip the
  // submit button out of its disabled state. Before the fix the five ef_*
  // form fields weren't subscribed via useStore, so the parent re-render
  // that gates the submit button never ran and the button stayed grey.
  it('enables submit after the user picks an EF radio (d3f1b31 regression)', async () => {
    vi.mocked(efApi.list).mockResolvedValue([
      {
        factor_code: 'electricity.grid.cn',
        year: 2024,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2024.1',
        scope: 2,
        category: 'electricity.grid',
        ghg_protocol_path: null,
        input_unit: 'kWh',
        co2e_kg_per_unit: 0.5703,
        ch4_kg_per_unit: null,
        n2o_kg_per_unit: null,
        hfc_kg_per_unit: null,
        pfc_kg_per_unit: null,
        sf6_kg_per_unit: null,
        nf3_kg_per_unit: null,
        gwp_basis: 'AR5',
        name_zh: '中国电网平均',
        name_en: null,
        description_zh: null,
        description_en: null,
        notes: null,
        citation_url: null,
      },
    ]);

    render(buildHarness());
    const addBtn = await screen.findByRole('button', {
      name: /Add Activity|添加活动数据/i,
    });
    fireEvent.click(addBtn);

    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });

    const radio = (await screen.findByRole('radio')) as HTMLInputElement;
    const submit = screen.getByRole('button', {
      name: /Record activity|记录活动/i,
    }) as HTMLButtonElement;

    // Pre-condition: submit is disabled before an EF is chosen.
    expect(submit.disabled).toBe(true);

    fireEvent.click(radio);

    // After picking, the five composite-PK ef_* fields are set and the
    // submit button becomes enabled.
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
  });

  // Important #5: when there are no sources OR no reporting periods, the
  // ActivityForm renders only a prerequisite-missing message + a Cancel
  // button — not the full form body. This avoids the confusing UX where
  // users could fill in dates/amount only to find a permanently-disabled
  // submit button.
  it('shows the no-sources message instead of the form body when sources is empty', async () => {
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([]);

    render(buildHarness());
    const addBtn = await screen.findByRole('button', {
      name: /Add Activity|添加活动数据/i,
    });
    fireEvent.click(addBtn);

    // The no-sources message appears.
    expect(await screen.findByText(/No sources yet|还没有排放源。请先在/i)).toBeTruthy();

    // The form body fields do NOT render.
    expect(screen.queryByLabelText(/Emission source|^排放源$/i)).toBeNull();
    expect(screen.queryByLabelText(/Reporting period|报告期/i)).toBeNull();
    expect(screen.queryByLabelText(/Start date|开始日期/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Record activity|记录活动/i })).toBeNull();
  });
});
