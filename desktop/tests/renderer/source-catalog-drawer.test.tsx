vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: {
    listPresets: vi.fn(),
    listByOrg: vi.fn(),
    addFromPreset: vi.fn(),
    addFromPresets: vi.fn(),
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

function mountDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SourceCatalogDrawer organizationId="org-1" open={true} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('<SourceCatalogDrawer>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders all 3 presets and batches the selected ones into one IPC call', async () => {
    vi.mocked(sourceApi.listPresets).mockResolvedValue(PRESETS);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([] satisfies EmissionSource[]);
    vi.mocked(sourceApi.addFromPresets).mockResolvedValue(
      [PRESETS[0], PRESETS[1]].map((p) => ({
        // biome-ignore lint/style/noNonNullAssertion: fixtures are defined above
        id: `src-${p!.id}`,
        site_id: 'site-1',
        // biome-ignore lint/style/noNonNullAssertion: same
        name: p!.name_zh,
        // biome-ignore lint/style/noNonNullAssertion: same
        scope: p!.scope,
        // biome-ignore lint/style/noNonNullAssertion: same
        category: p!.category,
        ghg_protocol_path: null,
        default_ef_query: null,
        // biome-ignore lint/style/noNonNullAssertion: same
        template_origin: p!.id,
        is_active: true,
      })) as EmissionSource[],
    );

    mountDrawer();

    // All three names land once the listPresets query resolves.
    await waitFor(() => {
      expect(screen.getByText('天然气燃烧')).toBeTruthy();
      expect(screen.getByText('国家电网电力')).toBeTruthy();
      expect(screen.getByText('国内商务机票')).toBeTruthy();
    });

    // One checkbox per preset (none of them are already in the org).
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);

    // Select the first two (natgas + grid electricity).
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    fireEvent.click(checkboxes[0]!);
    // biome-ignore lint/style/noNonNullAssertion: same
    fireEvent.click(checkboxes[1]!);

    // The batch button label tracks the selection count. We don't pin the
    // exact wording (i18n) — just that there's a button whose label
    // mentions "2".
    const confirmButton = await waitFor(() => {
      const candidates = screen.getAllByRole('button').filter((b) => /2/.test(b.textContent ?? ''));
      if (candidates.length === 0) throw new Error('confirm button with count 2 not yet rendered');
      // biome-ignore lint/style/noNonNullAssertion: candidates.length > 0
      return candidates[candidates.length - 1]!;
    });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(sourceApi.addFromPresets).toHaveBeenCalledTimes(1));
    const args = vi.mocked(sourceApi.addFromPresets).mock.calls[0]?.[0];
    expect(args?.organization_id).toBe('org-1');
    expect(args?.preset_ids).toEqual(['preset_natgas_combustion', 'preset_grid_electricity_cn']);
  });

  it('search input filters the visible rows', async () => {
    vi.mocked(sourceApi.listPresets).mockResolvedValue(PRESETS);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([] satisfies EmissionSource[]);
    mountDrawer();

    await waitFor(() => expect(screen.getByText('天然气燃烧')).toBeTruthy());

    // Search by the English name of just one preset — the other two
    // should drop out of the DOM. We don't pin the placeholder; we
    // grab the only searchbox in the drawer.
    const searchbox = screen.getByRole('searchbox');
    fireEvent.change(searchbox, { target: { value: 'flight' } });

    await waitFor(() => {
      expect(screen.queryByText('天然气燃烧')).toBeNull();
      expect(screen.queryByText('国家电网电力')).toBeNull();
      expect(screen.getByText('国内商务机票')).toBeTruthy();
    });
  });

  it('hides the checkbox and shows the "added" badge for presets already in the org', async () => {
    vi.mocked(sourceApi.listPresets).mockResolvedValue(PRESETS);
    // Org already has the natgas source under the same zh name — that
    // row should render without a checkbox and with the added badge.
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([
      {
        id: 'src-existing-natgas',
        site_id: 'site-1',
        name: '天然气燃烧',
        scope: 1,
        category: 'fuel.stationary',
        ghg_protocol_path: null,
        default_ef_query: null,
        template_origin: 'preset_natgas_combustion',
        is_active: true,
      },
    ]);
    mountDrawer();

    await waitFor(() => expect(screen.getByText('天然气燃烧')).toBeTruthy());

    // Only 2 selectable presets remain (electricity + flight); natgas is
    // covered by a ✓ badge instead of a checkbox.
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(screen.getByText(/^已添加$|^Added$/)).toBeTruthy();
  });
});
