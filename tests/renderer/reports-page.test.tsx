import { ReportsList } from '@renderer/routes/reports';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: {
    getCurrent: vi.fn(),
    listReportingPeriods: vi.fn(),
  },
}));

import { orgApi } from '@renderer/lib/api/organization';

const FAKE_ORG_WITH_PROFILE = {
  id: 'org_01',
  name_zh: '示例公司',
  name_en: null,
  industry: null,
  country_code: 'CN',
  boundary_kind: 'operational_control' as const,
  responsible_person_name: '张三',
  responsible_person_role: '总经理',
  base_year_period_id: null,
  recalc_threshold_pct: 5.0,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

const FAKE_ORG_WITHOUT_PROFILE = {
  id: 'org_01',
  name_zh: '示例公司',
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

const FAKE_REPORTING_PERIOD = {
  id: 'per-2025',
  organization_id: 'org_01',
  year: 2025,
  granularity: 'annual' as const,
  starts_at: '2025-01-01',
  ends_at: '2025-12-31',
  is_active: 1,
  significant_changes_text: null,
  recalculation_reason: null,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

function buildHarness(component: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const reportsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/reports',
    component: () => component,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([reportsRoute]),
    history: createMemoryHistory({ initialEntries: ['/reports'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('Reports list page', () => {
  beforeEach(() => {
    vi.mocked(orgApi.getCurrent).mockReset();
    vi.mocked(orgApi.listReportingPeriods).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the period and new-report link when profile is set', async () => {
    vi.mocked(orgApi.getCurrent).mockResolvedValueOnce(FAKE_ORG_WITH_PROFILE);
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValueOnce([FAKE_REPORTING_PERIOD]);

    render(buildHarness(<ReportsList />));

    await waitFor(() => {
      expect(screen.getByText(/2025/)).toBeTruthy();
    });

    // CTA link rendered and enabled
    const link = screen.getByRole('link', { name: /新建报告|New report/i });
    expect(link.getAttribute('href')).toContain('/reports/per-2025');
    expect(link.classList.contains('pointer-events-none')).toBe(false);
  });

  it('shows setup-required banner when responsible_person_name is null', async () => {
    vi.mocked(orgApi.getCurrent).mockResolvedValueOnce(FAKE_ORG_WITHOUT_PROFILE);
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValueOnce([FAKE_REPORTING_PERIOD]);

    render(buildHarness(<ReportsList />));

    await waitFor(() => {
      expect(screen.getByText(/设置|Settings/)).toBeTruthy();
    });

    // Banner should be visible with the setup message
    const banner = screen.getByText(/请先在设置中填写组织档案|Set organization profile in Settings first/);
    expect(banner).toBeTruthy();

    // When profile is not ready, verify the banner is shown (which indicates responsible_person_name is null)
    // and the UI warns the user to set up their profile first
    expect(banner.textContent).toContain('Settings');
  });
});
