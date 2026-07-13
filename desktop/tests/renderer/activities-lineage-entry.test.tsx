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

vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: { getCurrent: vi.fn(), listReportingPeriods: vi.fn() },
}));
vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: { listByOrg: vi.fn() },
}));
vi.mock('@renderer/lib/api/activity-data', () => ({
  activityApi: { listByPeriod: vi.fn(), create: vi.fn() },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: { list: vi.fn() },
}));
vi.mock('@renderer/lib/api/lineage', () => ({
  lineageApi: { get: vi.fn() },
}));
vi.mock('@renderer/lib/api/audit', () => ({
  auditApi: { list: vi.fn(), exportCsv: vi.fn(), listByRecord: vi.fn() },
}));
vi.mock('@renderer/lib/api/evidence', () => ({
  evidenceApi: { add: vi.fn(), list: vi.fn(), remove: vi.fn() },
}));

import { activityApi } from '@renderer/lib/api/activity-data';
import { auditApi } from '@renderer/lib/api/audit';
import { efApi } from '@renderer/lib/api/ef-library';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { lineageApi } from '@renderer/lib/api/lineage';
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
  significant_changes_text: null,
  recalculation_reason: null,
};

/** Hand-typed row: extraction + inbound provenance both null. */
const MANUAL_ROW = {
  id: 'act_01',
  site_id: 'site_01',
  emission_source_id: 'src_01',
  reporting_period_id: 'period_01',
  occurred_at_start: '2026-01-01',
  occurred_at_end: '2026-01-31',
  amount: 1000,
  unit: 'kWh',
  ef_factor_code: 'electricity.grid.cn.national.2024',
  ef_year: 2024,
  ef_source: 'MEE_China',
  ef_geography: 'CN',
  ef_dataset_version: '2024.q4',
  computed_co2e_kg: 570.3,
  computed_at: '2026-05-11T00:00:00Z',
  extraction_id: null,
  notes: null,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
  inbound_question_id: null,
  inbound_tier: null,
  source_document_id: null,
  source_document_filename: null,
  inbound_questionnaire_id: null,
  inbound_supplier_name: null,
};

const activitiesComponent: NonNullable<typeof ActivitiesRoute.options.component> = (() => {
  const c = ActivitiesRoute.options.component;
  if (!c) throw new Error('activities route is missing a component');
  return c;
})();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const activitiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/activities',
    component: activitiesComponent,
  });
  // The lineage drawer deep-links to these; register stubs so Links resolve.
  const stubs = ['/documents/$id', '/supplier-disclosures/$id', '/questionnaires/$id'].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => null,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([activitiesRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/activities'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/activities lineage entry (audit-readiness 2026-07-11)', () => {
  beforeEach(() => {
    vi.mocked(orgApi.getCurrent).mockResolvedValue(FAKE_ORG);
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([FAKE_SOURCE]);
    vi.mocked(activityApi.listByPeriod).mockResolvedValue([MANUAL_ROW]);
    vi.mocked(efApi.list).mockResolvedValue([]);
    vi.mocked(auditApi.listByRecord).mockResolvedValue([]);
    vi.mocked(lineageApi.get).mockResolvedValue({
      entity: 'activity_data',
      activity: MANUAL_ROW,
      source: { kind: 'manual' },
      pinned_ef: null,
      emission_source_name: 'Purchased Electricity',
      answers: [],
      snapshots: [],
      evidence: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('marks hand-typed rows with an explicit manual-entry source line', async () => {
    render(buildHarness());
    expect(await screen.findByText(/Entered manually|手工录入/i)).toBeTruthy();
  });

  it('opens the lineage drawer from the row action', async () => {
    render(buildHarness());
    const lineageBtn = await screen.findByRole('button', { name: /Lineage|溯源/i });
    fireEvent.click(lineageBtn);

    await waitFor(() => {
      expect(lineageApi.get).toHaveBeenCalledWith({ entity: 'activity_data', id: 'act_01' });
    });
    // Drawer title renders.
    expect(await screen.findByText(/Data lineage|数据溯源/i)).toBeTruthy();
  });
});
