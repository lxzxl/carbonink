import { SettingsPage } from '@renderer/components/SettingsPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IPC wrapper module directly. Each test reaches into these
// `vi.fn()` instances via the named imports below to set per-test return
// values. Keeping the mocks at module level (rather than per-test
// `vi.doMock`) matches the pattern used in `activities.test.tsx`.
//
// `listProviders` and `listModels` mirror the Task 10c runtime-catalog
// channels — the renderer pulls both via TanStack Query on mount, so the
// dropdown population path needs deterministic data here. We seed a small
// stand-in catalog covering the providers used in the test scenarios
// below (openai + anthropic + azure-openai-responses).
vi.mock('@renderer/lib/api/settings', () => ({
  settingsApi: {
    available: vi.fn(),
    getProvider: vi.fn(),
    saveProvider: vi.fn(),
    clearProvider: vi.fn(),
    pingProvider: vi.fn(),
    getAmapKey: vi.fn(),
    setAmapKey: vi.fn(),
    listProviders: vi.fn(),
    listModels: vi.fn(),
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

/**
 * Click into the "AI" section in the SettingsPage left rail.
 *
 * SettingsPage now defaults to the "General" section (language +
 * theme) — see the rationale in `SettingsPage.tsx`. These tests
 * exercise the AI provider section specifically, so each one
 * starts by navigating there. Locale-agnostic regex matches both
 * zh ("AI 提供方") and en ("AI provider") label variants.
 */
function gotoAiSection() {
  const aiNav = screen.getByRole('button', { name: /ai|llm/i });
  fireEvent.click(aiNav);
}

/**
 * Stand-in catalog covering the providers we exercise in the tests below.
 * The real pi-ai catalog is bigger; we keep this minimal so the dropdown
 * options are predictable and the test focus stays on form behavior
 * rather than catalog inventory.
 */
const TEST_PROVIDERS = ['openai', 'anthropic', 'azure-openai-responses'];

const TEST_MODELS: Record<string, Array<{ id: string; name: string }>> = {
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
  ],
  anthropic: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
  'azure-openai-responses': [{ id: 'gpt-4o', name: 'GPT-4o (Azure)' }],
};

function mockModelCatalog() {
  vi.mocked(settingsApi.listProviders).mockResolvedValue(TEST_PROVIDERS);
  vi.mocked(settingsApi.listModels).mockImplementation((provider: string) =>
    Promise.resolve(
      (TEST_MODELS[provider] ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        api: 'openai-completions',
        input: ['text'],
        reasoning: false,
        costInput: 0,
        costOutput: 0,
        contextWindow: 8192,
        maxTokens: 4096,
      })),
    ),
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.mocked(settingsApi.getProvider).mockResolvedValue(null);
    vi.mocked(settingsApi.saveProvider).mockResolvedValue(undefined);
    vi.mocked(settingsApi.pingProvider).mockResolvedValue({ ok: true });
    vi.mocked(settingsApi.getAmapKey).mockResolvedValue(null);
    vi.mocked(settingsApi.setAmapKey).mockResolvedValue(undefined);
    mockModelCatalog();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty form when no config is saved; provider picker lists pi-ai providers', async () => {
    // No saved config + Task 10c removed hardcoded `openai` defaults, so the
    // form mounts empty and waits for the user to pick a provider. The
    // picker is populated via the `settings:list-providers` IPC channel.
    render(harness(<SettingsPage />));
    gotoAiSection();

    // Wait for the catalog query to resolve AND the options to appear in
    // the DOM — `waitFor` re-evaluates the dropdown contents each tick so
    // we don't race the React reconciler.
    await waitFor(() => {
      const providerSelect = screen.getByLabelText(/Provider/i) as HTMLSelectElement;
      const optionValues = Array.from(providerSelect.options).map((o) => o.value);
      // The catalog options are rendered as <option> children. We assert
      // representative providers — sorting is exercised by a dedicated case.
      expect(optionValues).toContain('openai');
      expect(optionValues).toContain('anthropic');
      expect(optionValues).toContain('azure-openai-responses');
    });

    const providerSelect = screen.getByLabelText(/Provider/i) as HTMLSelectElement;
    expect(providerSelect.value).toBe('');

    const apiKey = screen.getByLabelText(/API key/i) as HTMLInputElement;
    expect(apiKey.value).toBe('');
    expect(apiKey.type).toBe('password');
  });

  it('selecting a provider populates the Model dropdown from pi-ai and defaults to the first model', async () => {
    render(harness(<SettingsPage />));
    gotoAiSection();

    // Wait for the catalog to land in the DOM before driving the change.
    await waitFor(() => {
      const providerSelect = screen.getByLabelText(/Provider/i) as HTMLSelectElement;
      expect(Array.from(providerSelect.options).map((o) => o.value)).toContain('openai');
    });

    fireEvent.change(screen.getByLabelText(/Provider/i), { target: { value: 'openai' } });

    // The renderer fetches the model list for the selected provider and
    // defaults to the first id; `gpt-4o-mini` leads our stand-in catalog
    // for openai so it should land selected.
    await waitFor(() => {
      expect(settingsApi.listModels).toHaveBeenCalledWith('openai');
      const modelSelect = screen.getByLabelText(/^Model$/i) as HTMLSelectElement;
      expect(modelSelect.value).toBe('gpt-4o-mini');
    });
  });

  it('with a saved key, renders masked key and Replace button (no password input)', async () => {
    // V2 wire shape: flat { provider, model, baseUrl? } + apiKeyMasked.
    // No `apiKeyKeyref` — derived deterministically from provider on the
    // main side.
    vi.mocked(settingsApi.getProvider).mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyMasked: 'sk-...abcd',
    });

    render(harness(<SettingsPage />));
    gotoAiSection();

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
      apiKeyMasked: 'sk-...abcd',
    });

    render(harness(<SettingsPage />));
    gotoAiSection();

    const replace = await screen.findByRole('button', { name: /Replace/i });
    fireEvent.click(replace);

    // After Replace, the password input is back and empty.
    const apiKey = (await screen.findByLabelText(/API key/i)) as HTMLInputElement;
    expect(apiKey.type).toBe('password');
    expect(apiKey.value).toBe('');
    // And the masked text is gone.
    expect(screen.queryByText('sk-...abcd')).toBeNull();
  });

  it('Save submits the dynamic provider+model selection to settingsApi.saveProvider', async () => {
    render(harness(<SettingsPage />));
    gotoAiSection();

    // Wait for the provider catalog to populate the dropdown before driving
    // the change events. Without this, the next fireEvent races the query
    // resolution and selects on a yet-empty <select>.
    await waitFor(() => {
      const providerSelect = screen.getByLabelText(/Provider/i) as HTMLSelectElement;
      expect(Array.from(providerSelect.options).map((o) => o.value)).toContain('openai');
    });

    // Drive the dropdowns the way the user would: pick provider, then
    // confirm the model default lands, then enter an API key. Without
    // hardcoded defaults, the form requires both selections before Save
    // is enabled — Task 10c moved provider/model defaults out of this
    // component and onto pi-ai's runtime catalog.
    fireEvent.change(screen.getByLabelText(/Provider/i), { target: { value: 'openai' } });
    await waitFor(() => {
      const modelSelect = screen.getByLabelText(/^Model$/i) as HTMLSelectElement;
      expect(modelSelect.value).toBe('gpt-4o-mini');
    });

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
      },
      apiKey: 'sk-test-key',
    });
  });
});
