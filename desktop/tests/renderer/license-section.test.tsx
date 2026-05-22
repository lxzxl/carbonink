vi.mock('@renderer/lib/api/license', () => ({
  licenseApi: {
    getState: vi.fn(),
    setJwt: vi.fn(),
    clear: vi.fn(),
  },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { LicenseSection } from '@renderer/components/LicenseSection';
import { licenseApi } from '@renderer/lib/api/license';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function harness(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe('<LicenseSection>', () => {
  beforeEach(() => {
    vi.mocked(licenseApi.setJwt).mockReset();
    vi.mocked(licenseApi.clear).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the activation form when state=unverified', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'unverified',
      claims: null,
      device_id: 'dev_test',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'No license JWT has been activated on this device.',
    });

    render(harness(<LicenseSection />));

    expect(await screen.findByText(/No license activated|未激活/)).toBeTruthy();
    expect(await screen.findByLabelText(/License JWT|授权 JWT/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Activate|激活/ })).toBeTruthy();
  });

  it('renders plan + features + deactivate button when state=active', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'active',
      claims: {
        iss: 'carbonbook.app',
        license_id: 'lic_01',
        user_id: 'usr_demo',
        plan: 'base@2026-q2',
        features: ['inventory', 'questionnaire'],
        devices_max: 1,
        issued_at: 1716000000,
        expires_at: 1747500000,
        grace_until: 1750000000,
        revocation_check_after: 1716700000,
      },
      device_id: 'dev_test',
      last_verified_at: '2026-05-21T00:00:00.000Z',
      consecutive_offline_days: 0,
      reason: 'License is active.',
    });

    render(harness(<LicenseSection />));

    expect(await screen.findByText(/Active|已激活/)).toBeTruthy();
    expect(screen.getByText('base@2026-q2')).toBeTruthy();
    expect(screen.getByText('inventory, questionnaire')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Deactivate|解绑/ })).toBeTruthy();
    // No activation form in this state.
    expect(screen.queryByLabelText(/License JWT|授权 JWT/i)).toBeNull();
  });

  it('calls licenseApi.setJwt when the user pastes a JWT and clicks Activate', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'unverified',
      claims: null,
      device_id: 'dev_test',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'No license JWT has been activated on this device.',
    });
    vi.mocked(licenseApi.setJwt).mockResolvedValue({ ok: true });

    render(harness(<LicenseSection />));

    const input = (await screen.findByLabelText(/License JWT|授权 JWT/i)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'eyJ.fake.jwt' } });
    const submit = screen.getByRole('button', { name: /Activate|激活/ });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(licenseApi.setJwt).toHaveBeenCalledWith({ jwt: 'eyJ.fake.jwt' });
    });
  });

  it('disables Activate until a non-empty JWT is entered', async () => {
    vi.mocked(licenseApi.getState).mockResolvedValue({
      state: 'unverified',
      claims: null,
      device_id: 'dev_test',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'No license JWT has been activated on this device.',
    });

    render(harness(<LicenseSection />));

    const submit = (await screen.findByRole('button', {
      name: /Activate|激活/,
    })) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const input = (await screen.findByLabelText(/License JWT|授权 JWT/i)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'x.y.z' } });
    await waitFor(() => expect(submit.disabled).toBe(false));
  });
});
