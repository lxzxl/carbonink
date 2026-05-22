vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn(),
    getByPk: vi.fn(),
  },
}));

import { ActivityRebindCard } from '@renderer/components/audit/ActivityRebindCard';
import { efApi } from '@renderer/lib/api/ef-library';
import type { AuditEvent } from '@shared/types';
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
import { beforeEach, describe, expect, it, vi } from 'vitest';

const event: AuditEvent = {
  id: 'aud-1',
  event_kind: 'activity_rebind_ef',
  payload: JSON.stringify({
    activity_id: '01HXX9YYABCDEFGHIJKLMNOPQR',
    old_ef: {
      factor_code: 'diesel_L',
      year: 2024,
      source: 'MEE',
      geography: 'CN',
      dataset_version: '2024.1',
    },
    new_ef: {
      factor_code: 'diesel_kg',
      year: 2025,
      source: 'IPCC',
      geography: 'CN',
      dataset_version: '2025.1',
    },
    old_amount: 1000,
    old_unit: 'L',
    old_computed_co2e_kg: 2680,
    new_amount: 800,
    new_unit: 'kg',
    new_computed_co2e_kg: 2540,
  }),
  occurred_at: '2026-05-20T12:00:00Z',
};

function harness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <ActivityRebindCard event={event} />,
  });
  const activitiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/activities',
    component: () => <div>activities</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, activitiesRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('<ActivityRebindCard>', () => {
  beforeEach(() => {
    // Default: getByPk returns null so the card falls back to the raw
    // factor_code (matching the pre-Round-4 visible text).
    vi.mocked(efApi.getByPk).mockResolvedValue(null);
  });

  it('renders the activity id shortened to 8 chars as a link to /activities', async () => {
    render(harness());
    // Shortened activity id appears as link text (#01HXX9YY).
    const link = await screen.findByRole('link', { name: /01HXX9YY/ });
    expect(link.getAttribute('href')).toContain('/activities');
  });

  it('falls back to factor_code when EF lookup returns null', async () => {
    render(harness());
    await waitFor(() => {
      expect(screen.getByText(/diesel_L/)).toBeTruthy();
      expect(screen.getByText(/diesel_kg/)).toBeTruthy();
    });
  });

  it('renders humanized EF name when the lookup resolves', async () => {
    vi.mocked(efApi.getByPk).mockImplementation((pk) =>
      Promise.resolve(
        pk.factor_code === 'diesel_L'
          ? ({
              factor_code: 'diesel_L',
              year: 2024,
              source: 'MEE',
              geography: 'CN',
              dataset_version: '2024.1',
              name_zh: '柴油 (按升)',
              name_en: 'Diesel (L)',
              scope: 1,
              category: 'fuel',
              input_unit: 'L',
              co2e_kg_per_unit: 2.68,
              gwp_basis: 'AR5',
              description_zh: null,
              description_en: null,
              ghg_protocol_path: null,
              notes: null,
              citation_url: null,
              ch4_kg_per_unit: null,
              n2o_kg_per_unit: null,
              hfc_kg_per_unit: null,
              pfc_kg_per_unit: null,
              sf6_kg_per_unit: null,
              nf3_kg_per_unit: null,
              biogenic_co2_factor: null,
            } as never)
          : null,
      ),
    );
    render(harness());
    await waitFor(() => {
      // Card shows the i18n name + the year (resolved EF).
      expect(screen.getByText(/柴油 \(按升\) \(2024\)/)).toBeTruthy();
    });
  });

  it('renders delta with signed values and percentage', async () => {
    render(harness());
    // Delta = 2540 - 2680 = -140; pct ≈ -5.2%.
    await waitFor(() => {
      const deltas = screen.getAllByText((content) => content.includes('CO2e'));
      expect(deltas.length).toBeGreaterThan(0);
      const text = deltas[0]?.textContent ?? '';
      expect(text).toMatch(/2[,\s]*680/);
      expect(text).toMatch(/2[,\s]*540/);
      expect(text).toMatch(/-140/);
      expect(text).toMatch(/-5\.2/);
    });
  });
});
