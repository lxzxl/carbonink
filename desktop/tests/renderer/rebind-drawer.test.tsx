vi.mock('@renderer/lib/api/activity-data', () => ({
  activityApi: {
    getById: vi.fn().mockResolvedValue({
      id: 'act-1',
      amount: 1000,
      unit: 'L',
      computed_co2e_kg: 2680,
      ef_factor_code: 'diesel_L',
      ef_year: 2024,
      ef_source: 'MEE',
      ef_geography: 'CN',
      ef_dataset_version: '2024.1',
      emission_source_id: 'src-1',
      pinned_ef: {
        factor_code: 'diesel_L',
        year: 2024,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2024.1',
        input_unit: 'L',
        co2e_kg_per_unit: 2.68,
        name_zh: '柴油',
        name_en: 'Diesel',
      },
    }),
    rebindEf: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn().mockResolvedValue([
      {
        factor_code: 'grid_kWh',
        year: 2025,
        source: 'MEE',
        geography: 'CN',
        dataset_version: '2025.1',
        scope: 2,
        category: 'electricity',
        input_unit: 'kWh',
        co2e_kg_per_unit: 0.57,
        gwp_basis: 'AR5',
        name_zh: '电网',
        name_en: 'Grid',
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
      },
    ]),
  },
}));
vi.mock('@renderer/lib/api/ef-matcher', () => ({
  efMatcherApi: { recommend: vi.fn() },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { RebindEfDrawer } from '@renderer/components/RebindEfDrawer';
import { activityApi } from '@renderer/lib/api/activity-data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('<RebindEfDrawer>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders current EF + activity info', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RebindEfDrawer activityId="act-1" open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/diesel_L/i)).toBeTruthy();
      expect(screen.getByText(/2,?680/)).toBeTruthy();
    });
  });

  it('cross-family pick shows override-amount input; confirm stays disabled until a positive number is entered', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RebindEfDrawer activityId="act-1" open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    // Wait for current EF to load + Browse list to populate.
    await waitFor(() => expect(screen.getByText(/Grid|电网/)).toBeTruthy());
    // Click the kWh EF row (cross-family from L).
    const row = screen.getByText(/Grid|电网/);
    row.click();
    // Cross-family informational message + the new override-amount input
    // both appear. Confirm is disabled until the input has a positive value.
    await waitFor(() => {
      expect(screen.getByText(/cross-unit|跨单位/i)).toBeTruthy();
    });
    const overrideInput = screen.getByLabelText(
      /new activity amount|新活动量/i,
    ) as HTMLInputElement;
    expect(overrideInput).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: /confirm|确认/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    // Typing a positive number enables confirm.
    fireEvent.change(overrideInput, { target: { value: '500' } });
    await waitFor(() => {
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('cross-family confirm passes override_amount through to rebindEf', async () => {
    vi.mocked(activityApi.rebindEf).mockResolvedValue({
      ok: true,
      updated: {} as unknown as ReturnType<typeof activityApi.rebindEf> extends Promise<infer R>
        ? R extends { updated: infer U }
          ? U
          : never
        : never,
      old_co2e_kg: 2680,
      new_co2e_kg: 285,
      old_amount: 1000,
      old_unit: 'L',
      new_amount: 500,
      new_unit: 'kWh',
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <RebindEfDrawer activityId="act-1" open={true} onClose={onClose} />
      </QueryClientProvider>,
    );

    // Pick the cross-family EF.
    await waitFor(() => expect(screen.getByText(/Grid|电网/)).toBeTruthy());
    screen.getByText(/Grid|电网/).click();

    // Enter override amount in the new unit (kWh).
    const overrideInput = (await screen.findByLabelText(
      /new activity amount|新活动量/i,
    )) as HTMLInputElement;
    fireEvent.change(overrideInput, { target: { value: '500' } });

    // Confirm — assert that the IPC wrapper was called with override_amount.
    const confirmBtn = screen.getByRole('button', { name: /confirm|确认/i });
    await waitFor(() => expect((confirmBtn as HTMLButtonElement).disabled).toBe(false));
    confirmBtn.click();

    await waitFor(() => expect(activityApi.rebindEf).toHaveBeenCalled());
    const args = vi.mocked(activityApi.rebindEf).mock.calls[0]?.[0];
    expect(args?.override_amount).toBe(500);
    expect(args?.activity_id).toBe('act-1');
    expect(args?.new_ef_pk.factor_code).toBe('grid_kWh');
  });
});
