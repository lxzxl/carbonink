vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: {
    listPresets: vi.fn(),
    listByOrg: vi.fn(),
    addFromPreset: vi.fn(),
  },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { SourceCatalogDrawer } from '@renderer/components/SourceCatalogDrawer';
import { sourceApi } from '@renderer/lib/api/emission-source';
import type { EmissionSource, PresetSource } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PRESETS: PresetSource[] = [
  {
    id: 'preset_natgas_combustion',
    name_zh: '天然气燃烧',
    name_en: 'Natural gas combustion',
    scope: 1,
    category: 'fuel.stationary',
    hint_unit: 'm3',
  },
  {
    id: 'preset_grid_electricity_cn',
    name_zh: '国家电网电力',
    name_en: 'Grid electricity',
    scope: 2,
    category: 'electricity.grid',
    hint_unit: 'kWh',
  },
  {
    id: 'preset_business_flight_domestic_short',
    name_zh: '国内商务机票',
    name_en: 'Domestic business flight',
    scope: 3,
    category: 'travel.air',
    hint_unit: 'person-km',
  },
];

describe('<SourceCatalogDrawer>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('groups presets by scope and adds one when the Add button is clicked', async () => {
    vi.mocked(sourceApi.listPresets).mockResolvedValue(PRESETS);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([] satisfies EmissionSource[]);
    const firstPreset = PRESETS[0];
    if (!firstPreset) throw new Error('test fixture must not be empty');
    vi.mocked(sourceApi.addFromPreset).mockResolvedValue({
      id: 'src-new',
      site_id: 'site-1',
      name: firstPreset.name_zh,
      scope: firstPreset.scope,
      category: firstPreset.category,
      ghg_protocol_path: null,
      default_ef_query: null,
      template_origin: firstPreset.id,
      is_active: true,
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SourceCatalogDrawer organizationId="org-1" open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    // Wait for presets to land + the 3 group headings to render.
    await waitFor(() => {
      expect(screen.getByText(/范围 1|Scope 1/)).toBeTruthy();
      expect(screen.getByText(/范围 2|Scope 2/)).toBeTruthy();
      expect(screen.getByText(/范围 3|Scope 3/)).toBeTruthy();
    });

    // Three Add buttons (one per preset) since the org has no existing sources.
    const addButtons = screen.getAllByRole('button', { name: /^Add$|^添加$/i });
    expect(addButtons.length).toBe(3);

    // Click the first Add button. We don't try to disambiguate which preset
    // it maps to (DOM order ≡ scope-then-array order) — we only care that
    // the IPC wrapper was called with *some* preset id.
    const firstAdd = addButtons[0];
    if (!firstAdd) throw new Error('expected at least one Add button');
    fireEvent.click(firstAdd);

    await waitFor(() => expect(sourceApi.addFromPreset).toHaveBeenCalled());
    const args = vi.mocked(sourceApi.addFromPreset).mock.calls[0]?.[0];
    expect(args?.organization_id).toBe('org-1');
    expect(args?.preset_id).toMatch(/^preset_/);
  });
});
