import { LineageDrawer } from '@renderer/components/lineage/LineageDrawer';
import type { ActivityLineage, AnswerLineage } from '@shared/types';
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

vi.mock('@renderer/lib/api/lineage', () => ({
  lineageApi: { get: vi.fn() },
}));
vi.mock('@renderer/lib/api/evidence', () => ({
  evidenceApi: { add: vi.fn(), list: vi.fn(), remove: vi.fn() },
}));
vi.mock('@renderer/lib/api/audit', () => ({
  auditApi: { list: vi.fn(), exportCsv: vi.fn(), listByRecord: vi.fn() },
}));

import { auditApi } from '@renderer/lib/api/audit';
import { evidenceApi } from '@renderer/lib/api/evidence';
import { lineageApi } from '@renderer/lib/api/lineage';

const ACTIVITY = {
  id: 'act-1',
  site_id: 'site-1',
  emission_source_id: 'src-1',
  reporting_period_id: 'per-1',
  occurred_at_start: '2024-01-01',
  occurred_at_end: '2024-01-31',
  amount: 1000,
  unit: 'kWh',
  ef_factor_code: 'electricity.grid.cn.national.2024',
  ef_year: 2024,
  ef_source: 'MEE_China',
  ef_geography: 'CN',
  ef_dataset_version: '2024.q4',
  computed_co2e_kg: 570.3,
  computed_at: '2026-07-11T00:00:00Z',
  extraction_id: null,
  notes: null,
  created_at: '2026-07-11T00:00:00Z',
  updated_at: '2026-07-11T00:00:00Z',
  inbound_question_id: null,
  inbound_tier: null,
};

const PINNED_EF = {
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
  name_zh: '全国电网',
  name_en: 'CN national grid',
  description_zh: null,
  description_en: null,
  citation_url: null,
  pinned_at: '2026-07-11T00:00:00Z',
  pinned_from: 'catalog',
};

const EVIDENCE_ROW = {
  id: 'ev-1',
  activity_data_id: 'act-1',
  answer_id: null,
  document_id: 'doc-1',
  note: '电费原件',
  created_at: '2026-07-11T00:00:00Z',
  filename: '电费单.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  sha256: 'abc123',
};

const ACTIVITY_LINEAGE: ActivityLineage = {
  entity: 'activity_data',
  activity: ACTIVITY,
  source: { kind: 'manual' },
  // biome-ignore lint/suspicious/noExplicitAny: fixture narrows fine at runtime
  pinned_ef: PINNED_EF as any,
  emission_source_name: 'Grid meter',
  answers: [],
  snapshots: [],
  evidence: [],
};

const ANSWER_LINEAGE: AnswerLineage = {
  entity: 'answer',
  answer: {
    id: 'ans-1',
    question_id: 'q-1',
    value: '1000',
    unit: 'kWh',
    source_kind: 'mapped_inventory',
    source_calculation_snapshot_id: null,
    source_activity_data_id: 'act-1',
    source_company_profile_key: null,
    source_narrative_bank_id: null,
    source_summary: null,
    finalized_at: null,
  },
  question_text: 'Total electricity (kWh)?',
  questionnaire: {
    id: 'qn-1',
    direction: 'outbound',
    reporting_year: 2024,
    customer_name: 'Client A',
  },
  source_activity: ACTIVITY_LINEAGE,
  evidence: [],
};

function buildHarness(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{node}</>,
  });
  // Stub targets so the drawer's deep links resolve inside the test router.
  const stubs = [
    '/activities',
    '/documents/$id',
    '/supplier-disclosures/$id',
    '/questionnaires/$id',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => null,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('LineageDrawer', () => {
  beforeEach(() => {
    vi.mocked(lineageApi.get).mockResolvedValue(ACTIVITY_LINEAGE);
    vi.mocked(auditApi.listByRecord).mockResolvedValue([
      {
        id: 'aud-1',
        event_kind: 'activity_data.created',
        payload: '{"activity_id":"act-1"}',
        occurred_at: '2026-07-11T00:00:00Z',
      },
    ]);
    vi.mocked(evidenceApi.add).mockReset();
    vi.mocked(evidenceApi.remove).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the manual-source activity chain, EF snapshot, and audit timeline', async () => {
    render(buildHarness(<LineageDrawer entity="activity_data" id="act-1" onClose={() => {}} />));

    // Chain: manual source hint + emission source name + pinned EF code.
    expect(await screen.findByText(/Grid meter/)).toBeTruthy();
    expect(screen.getByText(/electricity\.grid\.cn\.national\.2024/)).toBeTruthy();
    expect(screen.getByText(/Manual entry|手工录入/i)).toBeTruthy();
    // Downstream empty note.
    expect(screen.getByText(/Not yet cited|尚未被/)).toBeTruthy();
    // Evidence empty note.
    expect(screen.getByText(/No evidence attached|暂无证据附件/)).toBeTruthy();
    // Audit timeline shows the created event's human label.
    expect(screen.getByText(/Activity data created|创建活动数据/)).toBeTruthy();
  });

  it('attaches a file through the hidden input and refetches the chain', async () => {
    vi.mocked(evidenceApi.add).mockResolvedValue(EVIDENCE_ROW);
    const { container } = render(
      buildHarness(<LineageDrawer entity="activity_data" id="act-1" onClose={() => {}} />),
    );
    await screen.findByText(/Grid meter/);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], 'bill.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(evidenceApi.add).toHaveBeenCalledWith(
        expect.objectContaining({
          activity_data_id: 'act-1',
          filename: 'bill.pdf',
          mimeType: 'application/pdf',
        }),
      );
    });
    // Successful add invalidates the lineage query → a second fetch.
    await waitFor(() => {
      expect(vi.mocked(lineageApi.get).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    void container;
  });

  it('removes an attachment via its remove button', async () => {
    vi.mocked(lineageApi.get).mockResolvedValue({
      ...ACTIVITY_LINEAGE,
      evidence: [EVIDENCE_ROW],
    });
    vi.mocked(evidenceApi.remove).mockResolvedValue(undefined);
    render(buildHarness(<LineageDrawer entity="activity_data" id="act-1" onClose={() => {}} />));

    expect(await screen.findByText('电费单.pdf')).toBeTruthy();
    const removeBtn = screen.getByRole('button', { name: /Remove evidence|移除证据/i });
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(evidenceApi.remove).toHaveBeenCalledWith({ id: 'ev-1' });
    });
  });

  it('renders the answer chain with its embedded upstream activity', async () => {
    vi.mocked(lineageApi.get).mockResolvedValue(ANSWER_LINEAGE);
    render(buildHarness(<LineageDrawer entity="answer" id="ans-1" onClose={() => {}} />));

    expect(await screen.findByText(/Total electricity \(kWh\)\?/)).toBeTruthy();
    expect(screen.getByText(/Client A/)).toBeTruthy();
    // Embedded upstream activity chain renders too.
    expect(screen.getByText(/Grid meter/)).toBeTruthy();
    expect(screen.getByText(/Show in activities|在活动数据中查看/)).toBeTruthy();
  });

  it('renders nothing when id is null', () => {
    const { container } = render(
      buildHarness(<LineageDrawer entity="activity_data" id={null} onClose={() => {}} />),
    );
    expect(container.querySelector('[data-vaul-drawer]')).toBeNull();
    expect(lineageApi.get).not.toHaveBeenCalled();
  });
});
