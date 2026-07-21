vi.mock('@renderer/lib/api/activity-import', () => ({
  activityImportApi: {
    pickFile: vi.fn(),
    revalidate: vi.fn(),
    listSources: vi.fn(),
    resolveSource: vi.fn(),
    listGroups: vi.fn(),
    confirmGroup: vi.fn(),
    skipGroup: vi.fn(),
    import: vi.fn(),
    discard: vi.fn(),
    recommendText: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: { listByOrg: vi.fn(), create: vi.fn() },
}));
vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: { listReportingPeriods: vi.fn(), listSites: vi.fn() },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: { list: vi.fn() },
}));
vi.mock('@renderer/lib/api/ef-matcher', () => ({
  efMatcherApi: { recommend: vi.fn(), recommendText: vi.fn() },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ActivityImportDrawer } from '@renderer/components/ActivityImportDrawer';
import { activityImportApi } from '@renderer/lib/api/activity-import';
import { efApi } from '@renderer/lib/api/ef-library';
import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import type {
  ActivityImportGroup,
  ActivityImportPreview,
  ActivityImportValidation,
  EmissionFactor,
} from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALIDATION: ActivityImportValidation = {
  total_rows: 3,
  valid_count: 2,
  error_count: 1,
  warning_count: 0,
  errors: [{ row: 4, code: 'amount_missing' }],
  warnings: [],
  sample: [
    {
      row: 2,
      source_name: 'Grid meter',
      description: '电网电力',
      amount: 1000,
      unit: 'kWh',
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      notes: null,
    },
  ],
};

const PREVIEW: ActivityImportPreview = {
  token: 'tok-1',
  filename: '台账.csv',
  headers: ['排放源', '描述', '数量', '单位'],
  total_rows: 3,
  mapping: { source_name: 0, description: 1, amount: 2, unit: 3 },
  validation: VALIDATION,
};

const GROUP: ActivityImportGroup = {
  key: 'g1',
  description: '电网电力',
  unit: 'kWh',
  source_id: 'src-1',
  source_name: 'Grid meter',
  row_count: 2,
  amount_total: 2200,
  status: 'pending',
  ef: null,
  fuel_code: null,
};

const GRID_EF: EmissionFactor = {
  factor_code: 'electricity.grid.cn.national.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN',
  dataset_version: '2024.q4',
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
  gwp_basis: 'AR6',
  name_zh: '全国电网平均',
  name_en: 'CN national grid',
  description_zh: null,
  description_en: null,
  notes: null,
  biogenic_co2_factor: null,
  citation_url: null,
};

function mountDrawer(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ActivityImportDrawer open={true} onClose={onClose} organizationId="org-1" />
    </QueryClientProvider>,
  );
  return onClose;
}

async function pickAndReachMapping() {
  vi.mocked(activityImportApi.pickFile).mockResolvedValue({ canceled: false, preview: PREVIEW });
  fireEvent.click(screen.getByRole('button', { name: /choose file|选择文件/i }));
  await waitFor(() => expect(screen.getByText(/台账\.csv/)).toBeTruthy());
}

async function choosePeriod() {
  vi.mocked(activityImportApi.revalidate).mockResolvedValue(VALIDATION);
  fireEvent.change(screen.getByLabelText(/reporting period|报告期/i), {
    target: { value: 'p-2024' },
  });
  await waitFor(() => expect(activityImportApi.revalidate).toHaveBeenCalled());
}

beforeEach(() => {
  vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([
    {
      id: 'p-2024',
      organization_id: 'org-1',
      year: 2024,
      granularity: 'annual',
      starts_at: '2024-01-01',
      ends_at: '2024-12-31',
      is_active: true,
      created_at: '2024-01-01',
    } as never,
  ]);
  vi.mocked(orgApi.listSites).mockResolvedValue([
    { id: 'site-1', organization_id: 'org-1', name_en: 'HQ' } as never,
  ]);
  vi.mocked(sourceApi.listByOrg).mockResolvedValue([
    { id: 'src-1', site_id: 'site-1', name: 'Grid meter', scope: 2, is_active: true } as never,
  ]);
  vi.mocked(efApi.list).mockResolvedValue([GRID_EF]);
  vi.mocked(efMatcherApi.recommendText).mockResolvedValue({ recommended: [], ranked_full: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<ActivityImportDrawer>', () => {
  it('walks the wizard: pick → mapping+period → sources → groups → import → result', async () => {
    mountDrawer();
    await pickAndReachMapping();

    // Next is gated on the period choice.
    const nextButton = () => screen.getByRole('button', { name: /next|下一步/i });
    expect(nextButton().hasAttribute('disabled')).toBe(true);
    await choosePeriod();
    expect(nextButton().hasAttribute('disabled')).toBe(false);

    vi.mocked(activityImportApi.listSources).mockResolvedValue([
      {
        name: 'Grid meter',
        row_count: 2,
        matched_source_id: 'src-1',
        resolved_source_id: 'src-1',
      },
    ]);
    fireEvent.click(nextButton());
    await waitFor(() => expect(screen.getByText(/matched existing|已匹配现有源/i)).toBeTruthy());

    vi.mocked(activityImportApi.listGroups).mockResolvedValue([GROUP]);
    fireEvent.click(nextButton());
    await waitFor(() => expect(screen.getByText('电网电力')).toBeTruthy());

    // Pick the EF in the embedded picker, then confirm the group.
    await waitFor(() => expect(screen.getByText(/全国电网平均/)).toBeTruthy());
    fireEvent.click(screen.getByRole('radio'));
    vi.mocked(activityImportApi.confirmGroup).mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: /confirm ef|确认因子/i }));
    await waitFor(() =>
      expect(activityImportApi.confirmGroup).toHaveBeenCalledWith({
        token: 'tok-1',
        group_key: 'g1',
        ef: {
          factor_code: GRID_EF.factor_code,
          year: GRID_EF.year,
          source: GRID_EF.source,
          geography: GRID_EF.geography,
          dataset_version: GRID_EF.dataset_version,
        },
        fuel_code: null,
      }),
    );

    vi.mocked(activityImportApi.import).mockResolvedValue({
      ok: true,
      imported_count: 2,
      skipped: { validation_errors: 1, unresolved_sources: 0, skipped_groups: 0 },
      warnings: [{ row: 3, code: 'duplicate_in_db' }],
      warning_count: 1,
      document_id: 'doc-1',
    });
    fireEvent.click(screen.getByRole('button', { name: /^import$|^导入$/i }));
    await waitFor(() => expect(screen.getByText(/import complete|导入完成/i)).toBeTruthy());
    expect(activityImportApi.import).toHaveBeenCalledWith({ token: 'tok-1' });
    expect(screen.getByText(/2 rows imported|已导入 2 行/i)).toBeTruthy();
  });

  it('shows the dimension-mismatch hint and keeps the group pending', async () => {
    mountDrawer();
    await pickAndReachMapping();
    await choosePeriod();

    vi.mocked(activityImportApi.listSources).mockResolvedValue([
      {
        name: 'Grid meter',
        row_count: 2,
        matched_source_id: 'src-1',
        resolved_source_id: 'src-1',
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /next|下一步/i }));
    await waitFor(() => expect(screen.getByText(/matched existing|已匹配现有源/i)).toBeTruthy());

    vi.mocked(activityImportApi.listGroups).mockResolvedValue([GROUP]);
    fireEvent.click(screen.getByRole('button', { name: /next|下一步/i }));
    await waitFor(() => expect(screen.getByText('电网电力')).toBeTruthy());

    await waitFor(() => expect(screen.getByText(/全国电网平均/)).toBeTruthy());
    fireEvent.click(screen.getByRole('radio'));
    vi.mocked(activityImportApi.confirmGroup).mockResolvedValue({
      ok: false,
      error: 'DimensionMismatch',
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm ef|确认因子/i }));
    await waitFor(() => expect(screen.getByText(/unit family differs|不同族/i)).toBeTruthy());
    // Import stays disabled: the lone group is still pending.
    expect(screen.getByRole('button', { name: /^import$|^导入$/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('discards the staged token when closed before importing', async () => {
    const onClose = mountDrawer();
    await pickAndReachMapping();
    vi.mocked(activityImportApi.discard).mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: /cancel|取消/i }));
    await waitFor(() => expect(activityImportApi.discard).toHaveBeenCalledWith({ token: 'tok-1' }));
    expect(onClose).toHaveBeenCalled();
  });
});
