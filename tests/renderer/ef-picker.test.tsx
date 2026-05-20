vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn().mockResolvedValue([
      {
        factor_code: 'diesel_L',
        year: 2025,
        source: 'IPCC',
        geography: 'CN',
        dataset_version: '2025.1',
        scope: 1,
        category: 'fuel',
        input_unit: 'L',
        co2e_kg_per_unit: 2.68,
        gwp_basis: 'AR5',
        name_zh: '柴油',
        name_en: 'Diesel',
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
  efMatcherApi: { recommend: vi.fn().mockResolvedValue({ recommended: [], ranked_full: [] }) },
}));

import { EfPicker } from '@renderer/components/EfPicker';
import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('<EfPicker>', () => {
  it('renders the Browse pane with EFs from ef:list', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EfPicker
          selectedSourceId="src-1"
          currentEfPk={null}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/diesel|柴油/i)).toBeTruthy();
    });
  });

  it('does not query the matcher when matcherHint is absent', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EfPicker
          selectedSourceId="src-1"
          currentEfPk={null}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(efMatcherApi.recommend).not.toHaveBeenCalled();
  });
});
