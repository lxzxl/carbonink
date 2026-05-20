vi.mock('@renderer/lib/api/license', () => ({
  licenseApi: {
    getState: vi.fn(),
    setJwt: vi.fn(),
    clear: vi.fn(),
  },
}));

import { LicenseBanner } from '@renderer/components/LicenseBanner';
import { licenseApi } from '@renderer/lib/api/license';
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

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <LicenseBanner />
        <Outlet />
      </>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div data-testid="route-marker">home</div>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: () => <div data-testid="route-marker">settings</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('<LicenseBanner>', () => {
  beforeEach(() => {
    vi.mocked(licenseApi.getState).mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when state=active', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'active',
      claims: null,
      device_id: 'd1',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'License is active.',
    });
    render(harness());
    await screen.findByTestId('route-marker');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing when state=unverified', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'unverified',
      claims: null,
      device_id: 'd1',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'no license',
    });
    render(harness());
    await screen.findByTestId('route-marker');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders an alert with grace title + renew CTA when state=grace', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'grace',
      claims: {
        iss: 'carbonbook.app',
        license_id: 'lic_01',
        user_id: 'usr_01',
        plan: 'base@2026-q2',
        features: ['inventory'],
        devices_max: 1,
        issued_at: now - 86400 * 365,
        expires_at: now - 86400 * 5, // 5 days past expiry
        grace_until: now + 86400 * 25, // 25 days of grace remain
        revocation_check_after: now + 86400 * 7,
      },
      device_id: 'd1',
      last_verified_at: '2026-05-21T00:00:00.000Z',
      consecutive_offline_days: 0,
      reason: 'In grace period — 25 day(s) until full expiry.',
    });
    render(harness());
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toMatch(/grace|宽限/i);
    expect(screen.getByRole('link', { name: /License settings|授权设置/ })).toBeTruthy();
  });

  it('renders the expired alert when state=expired', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'expired',
      claims: null,
      device_id: 'd1',
      last_verified_at: null,
      consecutive_offline_days: 35,
      reason: 'Offline for 35 consecutive days (limit: 30).',
    });
    render(harness());
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toMatch(/expired|read-only|过期|只读/i);
  });

  it('renders the revoked alert when state=revoked', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'revoked',
      claims: null,
      device_id: 'd1',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'Cloud /verify returned revoked=true.',
    });
    render(harness());
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toMatch(/revoked|撤销/i);
  });
});
