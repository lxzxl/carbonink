/**
 * Tests for the "Recommended for this document" section in ActivityForm.
 * Covers:
 *   1. Happy path — matcherHint + source selected → Recommended section renders.
 *   2. LLM failure fallback — recommend() rejects → no heading, full list preserved.
 *   3. No matcherHint — recommend() is never called.
 */

// Module-level mocks MUST precede any imports that reference the mocked modules.
vi.mock('@renderer/lib/api/ef-matcher', () => ({
  efMatcherApi: {
    recommend: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: {
    getCurrent: vi.fn(),
    listReportingPeriods: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/activity-data', () => ({
  activityApi: {
    create: vi.fn(),
    listByPeriod: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn(),
  },
}));

import { ActivityForm } from '@renderer/components/ActivityForm';
import { efApi } from '@renderer/lib/api/ef-library';
import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
import { orgApi } from '@renderer/lib/api/organization';
import type { EmissionFactor, EmissionSource, ReportingPeriod } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const FAKE_SOURCE: EmissionSource = {
  id: 'src_diesel',
  site_id: 'site_01',
  name: '柴油锅炉',
  scope: 1 as const,
  category: 'fuel.combustion',
  ghg_protocol_path: null,
  default_ef_query: null,
  template_origin: null,
  is_active: true,
};

const FAKE_PERIOD: ReportingPeriod = {
  id: 'period_01',
  organization_id: 'org_01',
  year: 2026,
  granularity: 'annual' as const,
  starts_at: '2026-01-01',
  ends_at: '2026-12-31',
  is_active: 1,
  created_at: '2026-05-11T00:00:00Z',
};

const BASE_EF: EmissionFactor = {
  factor_code: 'fuel.diesel.combustion',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.q1',
  scope: 1,
  category: 'fuel.combustion',
  ghg_protocol_path: null,
  input_unit: 'L',
  co2e_kg_per_unit: 2.68,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '柴油',
  name_en: 'Diesel',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url: null,
};

const GASOLINE_EF: EmissionFactor = {
  ...BASE_EF,
  factor_code: 'fuel.gasoline.combustion',
  name_zh: '汽油',
  name_en: 'Gasoline',
};

const LPG_EF: EmissionFactor = {
  ...BASE_EF,
  factor_code: 'fuel.lpg.combustion',
  name_zh: '液化石油气',
  name_en: 'LPG',
};

// ── Harness ──────────────────────────────────────────────────────────────────

/**
 * Wraps ActivityForm in a QueryClientProvider. The form is rendered directly
 * (no route) since we're testing component-level behaviour.
 */
function buildHarness(props: React.ComponentProps<typeof ActivityForm>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ActivityForm {...props} />
    </QueryClientProvider>
  );
}

const DEFAULT_PROPS = {
  organizationId: 'org_01',
  sources: [FAKE_SOURCE],
  onCancel: vi.fn(),
  onSuccess: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ActivityForm — matcher recommended section', () => {
  beforeEach(() => {
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    // Default: full EF list returns only BASE_EF (full list must remain visible).
    vi.mocked(efApi.list).mockResolvedValue([BASE_EF, GASOLINE_EF, LPG_EF]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Recommended section when matcherHint + source selected + LLM happy path', async () => {
    vi.mocked(efMatcherApi.recommend).mockResolvedValue({
      recommended: [
        { ef: BASE_EF, reasoning_zh: '直接命中柴油' },
        { ef: GASOLINE_EF, reasoning_zh: '同类燃料' },
        { ef: LPG_EF, reasoning_zh: '兜底' },
      ],
      ranked_full: [BASE_EF],
    });

    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: {
          matcherHint: { extraction_id: 'e1', stage_id: 'fuel_receipt.v1' },
        },
      }),
    );

    // Pick a source to enable the matcher query.
    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });

    // The recommended heading should appear.
    expect(await screen.findByText(/Recommended for this document|为本单据推荐/)).toBeTruthy();

    // All three reasoning strings should be in the DOM.
    expect(await screen.findByText('直接命中柴油')).toBeTruthy();
    expect(screen.getByText('同类燃料')).toBeTruthy();
    expect(screen.getByText('兜底')).toBeTruthy();

    // efMatcherApi.recommend was called with the right params.
    expect(efMatcherApi.recommend).toHaveBeenCalledWith({
      extraction_id: 'e1',
      emission_source_id: FAKE_SOURCE.id,
    });
  });

  it('omits Recommended section when LLM fails, and preserves full list', async () => {
    vi.mocked(efMatcherApi.recommend).mockRejectedValue(new Error('LLM down'));

    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: {
          matcherHint: { extraction_id: 'e1', stage_id: 'fuel_receipt.v1' },
        },
      }),
    );

    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });

    // Wait for the efApi full list to resolve (radios appear).
    const radios = await screen.findAllByRole('radio');
    expect(radios.length).toBeGreaterThan(0);

    // Recommended heading must NOT be in the DOM.
    expect(screen.queryByText(/Recommended for this document|为本单据推荐/)).toBeNull();
  });

  it('does not call matcher when matcherHint is absent', async () => {
    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: { unit: 'kWh' }, // no matcherHint
      }),
    );

    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });

    // Wait for the EF list to load so any async work has settled.
    await screen.findAllByRole('radio');

    // efMatcherApi.recommend must never have been called.
    await waitFor(() => {
      expect(efMatcherApi.recommend).not.toHaveBeenCalled();
    });
  });
});
