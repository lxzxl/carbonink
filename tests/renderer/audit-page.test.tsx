import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sampleRow = {
  id: 'aud-1',
  event_kind: 'activity_rebind_ef',
  payload: JSON.stringify({
    activity_id: 'act-12345678',
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

vi.mock('@renderer/lib/api/audit', () => ({
  auditApi: { list: vi.fn() },
}));

describe('Audit page', () => {
  it('renders an activity_rebind_ef event with the pretty card', async () => {
    const { auditApi } = await import('@renderer/lib/api/audit');
    vi.mocked(auditApi.list).mockResolvedValue([sampleRow] as never);

    const { AuditPage } = await import('@renderer/routes/audit');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuditPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/diesel_L/)).toBeTruthy();
      expect(screen.getByText(/diesel_kg/)).toBeTruthy();
    });
  });

  it('shows empty-state message when no events match', async () => {
    const { auditApi } = await import('@renderer/lib/api/audit');
    vi.mocked(auditApi.list).mockResolvedValue([] as never);

    const { AuditPage } = await import('@renderer/routes/audit');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuditPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      // Match the English OR Chinese empty-state heading
      expect(screen.queryByText(/No audit events yet|暂无审计事件/)).toBeTruthy();
    });
  });
});
