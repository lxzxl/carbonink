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

    // The provider picker is a searchable combobox (pi-ai's catalog is too
    // long for a native <select>). Its trigger mounts disabled until the
    // `settings:list-providers` query resolves, so wait for that first.
    const trigger = (await screen.findByRole('combobox', {
      name: /Provider/i,
    })) as HTMLButtonElement;
    await waitFor(() => expect(trigger.disabled).toBe(false));

    // Nothing selected yet — the trigger shows the placeholder.
    expect(trigger.textContent).toContain('Select a provider');

    // Open the popover; the catalog options render (in a portal) as
    // role=option rows. We assert representative providers — grouping is
    // recommended-first, rest alphabetical.
    fireEvent.click(trigger);
    await waitFor(() => {
      const optionNames = screen.getAllByRole('option').map((o) => o.textContent ?? '');
      expect(optionNames).toContain('openai');
      expect(optionNames).toContain('anthropic');
      expect(optionNames).toContain('azure-openai-responses');
    });

    const apiKey = screen.getByLabelText(/API key/i) as HTMLInputElement;
    expect(apiKey.value).toBe('');
    expect(apiKey.type).toBe('password');
  });

  it('selecting a provider populates the Model picker from pi-ai and defaults to the first model', async () => {
    render(harness(<SettingsPage />));
    gotoAiSection();

    // Wait for the catalog to enable the combobox before driving it.
    const trigger = (await screen.findByRole('combobox', {
      name: /Provider/i,
    })) as HTMLButtonElement;
    await waitFor(() => expect(trigger.disabled).toBe(false));

    // Open the picker and choose openai. cmdk items select on click.
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'openai' }));

    // The renderer fetches the model list for the selected provider and
    // defaults to the first id; `gpt-4o-mini` leads our stand-in catalog
    // for openai so it should land in the Model combobox trigger.
    await waitFor(() => {
      expect(settingsApi.listModels).toHaveBeenCalledWith('openai');
      const modelTrigger = screen.getByRole('combobox', { name: /^Model$/i });
      expect(modelTrigger.textContent).toContain('gpt-4o-mini');
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

    // Drive the pickers the way the user would: open the provider
    // combobox, pick openai, confirm the model default lands, then enter
    // an API key. Without hardcoded defaults, the form requires both
    // selections before Save is enabled — Task 10c moved provider/model
    // defaults out of this component and onto pi-ai's runtime catalog.
    const trigger = (await screen.findByRole('combobox', {
      name: /Provider/i,
    })) as HTMLButtonElement;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'openai' }));

    await waitFor(() => {
      const modelTrigger = screen.getByRole('combobox', { name: /^Model$/i });
      expect(modelTrigger.textContent).toContain('gpt-4o-mini');
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

  it('typing an uncatalogued model id offers the custom-id escape hatch', async () => {
    render(harness(<SettingsPage />));
    gotoAiSection();

    const trigger = (await screen.findByRole('combobox', {
      name: /Provider/i,
    })) as HTMLButtonElement;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'openai' }));

    const modelTrigger = await screen.findByRole('combobox', { name: /^Model$/i });
    await waitFor(() => expect(modelTrigger.textContent).toContain('gpt-4o-mini'));

    // Type an id the stand-in catalog doesn't know. The filter matches
    // nothing, so the trailing custom-value row is the only option left.
    fireEvent.click(modelTrigger);
    fireEvent.change(screen.getByPlaceholderText(/Search models/i), {
      target: { value: 'my-custom-model' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /use "my-custom-model"/i }));

    // The verbatim id lands in the trigger, with the catalog-miss hint below.
    expect(modelTrigger.textContent).toContain('my-custom-model');
    expect(screen.getByText(/Custom id: not in the bundled catalog/i)).toBeTruthy();
  });

  it('a saved custom model id survives catalog hydration (not clobbered to the first model)', async () => {
    vi.mocked(settingsApi.getProvider).mockResolvedValue({
      provider: 'openai',
      model: 'brand-new-model:free',
      apiKeyMasked: 'sk-...abcd',
    });

    render(harness(<SettingsPage />));
    gotoAiSection();

    // Wait until the openai model catalog has loaded — the moment the old
    // effect would have overwritten an uncatalogued id with gpt-4o-mini.
    await waitFor(() => {
      expect(settingsApi.listModels).toHaveBeenCalledWith('openai');
    });
    const modelTrigger = await screen.findByRole('combobox', { name: /^Model$/i });
    await waitFor(() => {
      expect(modelTrigger.textContent).toContain('brand-new-model:free');
      expect(screen.getByText(/Custom id: not in the bundled catalog/i)).toBeTruthy();
    });
  });
});
