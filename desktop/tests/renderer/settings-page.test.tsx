import { SettingsPage } from '@renderer/components/SettingsPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IPC wrapper module directly. Each test reaches into these
// `vi.fn()` instances via the named imports below to set per-test return
// values. Keeping the mocks at module level (rather than per-test
// `vi.doMock`) matches the pattern used in `activities.test.tsx`.
vi.mock('@renderer/lib/api/settings', () => ({
  settingsApi: {
    available: vi.fn(),
    getProvider: vi.fn(),
    saveProvider: vi.fn(),
    clearProvider: vi.fn(),
    pingProvider: vi.fn(),
    getAmapKey: vi.fn(),
    setAmapKey: vi.fn(),
  },
}));

// Phase 5: UpdateSection (rendered as part of SettingsPage) calls
// `updaterApi.getStatus` via TanStack Query and `subscribe` from
// `@renderer/lib/ipc` inside a useEffect. Stub both so the render doesn't
// trip on a missing `window.ipc` shim.
vi.mock('@renderer/lib/api/updater', () => ({
  updaterApi: {
    getStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
    check: vi.fn(),
    install: vi.fn(),
  },
}));
vi.mock('@renderer/lib/ipc', () => ({
  invoke: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

import { settingsApi } from '@renderer/lib/api/settings';

function harness(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(settingsApi.getProvider).mockResolvedValue(null);
    vi.mocked(settingsApi.saveProvider).mockResolvedValue(undefined);
    vi.mocked(settingsApi.pingProvider).mockResolvedValue({ ok: true });
    vi.mocked(settingsApi.getAmapKey).mockResolvedValue(null);
    vi.mocked(settingsApi.setAmapKey).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders with default values (provider=openai, model=gpt-4o-mini, empty key)', async () => {
    render(harness(<SettingsPage />));

    // Wait for the getProvider query to settle (it resolves to null so no
    // hydration happens; we still want to be past the initial paint).
    await waitFor(() => {
      expect(settingsApi.getProvider).toHaveBeenCalled();
    });

    const providerSelect = screen.getByLabelText(/AI provider/i) as HTMLSelectElement;
    expect(providerSelect.value).toBe('openai');

    const modelInput = screen.getByLabelText(/^Model$/i) as HTMLInputElement;
    expect(modelInput.value).toBe('gpt-4o-mini');

    const apiKey = screen.getByLabelText(/API key/i) as HTMLInputElement;
    expect(apiKey.value).toBe('');
    expect(apiKey.type).toBe('password');
  });

  it('switching provider to Azure reveals resourceName field; switching back hides it', async () => {
    render(harness(<SettingsPage />));

    await waitFor(() => expect(settingsApi.getProvider).toHaveBeenCalled());

    expect(screen.queryByLabelText(/Azure resource name/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/AI provider/i), { target: { value: 'azure' } });

    await waitFor(() => {
      expect(screen.getByLabelText(/Azure resource name/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/AI provider/i), { target: { value: 'openai' } });

    await waitFor(() => {
      expect(screen.queryByLabelText(/Azure resource name/i)).toBeNull();
    });
  });

  it('with a saved key, renders masked key and Replace button (no password input)', async () => {
    vi.mocked(settingsApi.getProvider).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
      apiKeyMasked: 'sk-...abcd',
    });

    render(harness(<SettingsPage />));

    // Wait for hydration. The masked widget replaces the password input.
    await waitFor(() => {
      expect(screen.getByText('sk-...abcd')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /Replace/i })).toBeTruthy();
    // No password input rendered in this state — only the masked div
    // owns the `settings-apikey` id, no <input type="password"> is present.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('clicking Replace swaps the masked widget back to a fresh password input', async () => {
    vi.mocked(settingsApi.getProvider).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyKeyref: 'llm.openai.apikey',
      apiKeyMasked: 'sk-...abcd',
    });

    render(harness(<SettingsPage />));

    const replace = await screen.findByRole('button', { name: /Replace/i });
    fireEvent.click(replace);

    // After Replace, the password input is back and empty.
    const apiKey = (await screen.findByLabelText(/API key/i)) as HTMLInputElement;
    expect(apiKey.type).toBe('password');
    expect(apiKey.value).toBe('');
    // And the masked text is gone.
    expect(screen.queryByText('sk-...abcd')).toBeNull();
  });

  it('Save submits the expected payload to settingsApi.saveProvider', async () => {
    render(harness(<SettingsPage />));

    await waitFor(() => expect(settingsApi.getProvider).toHaveBeenCalled());

    // Type a key — provider defaults to openai, model=gpt-4o-mini.
    fireEvent.change(screen.getByLabelText(/API key/i), {
      target: { value: 'sk-test-key' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(settingsApi.saveProvider).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(settingsApi.saveProvider).mock.calls[0]?.[0]).toEqual({
      config: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKeyKeyref: 'llm.openai.apikey',
      },
      apiKey: 'sk-test-key',
    });
  });
});
