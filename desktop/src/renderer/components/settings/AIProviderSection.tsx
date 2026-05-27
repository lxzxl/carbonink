import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { settingsApi } from '@renderer/lib/api/settings';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import type { ProviderCatalogModel, ProviderConfigV2 } from '@shared/types';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

/**
 * AI provider configuration section. Extracted from the monolithic
 * SettingsPage so it can sit in its own tab inside the new left-rail
 * Settings layout.
 *
 * Storage policy (set by SettingsService / CredentialService):
 *   - Provider config → sqlite `setting` table.
 *   - API key plaintext → OS keychain via CredentialService. Renderer
 *     only ever sees the mask (e.g. `sk-...abcd`).
 *
 * Wire shape (Item 3 Task 10b):
 *   The settings IPC channels speak `ProviderConfigV2` — a flat
 *   `{provider, model, baseUrl?}` shape. The previous V1 discriminated
 *   union (with per-variant `apiKeyKeyref` / `resourceName` / `apiVersion`
 *   / `name` fields) is gone from the wire. `apiKeyKeyref` is derived
 *   deterministically on the main side from `provider`.
 *
 * Catalog source-of-truth (Item 3 Task 10c):
 *   The provider + model dropdowns are populated from pi-ai's runtime
 *   catalog via two new IPC channels (`settings:list-providers`,
 *   `settings:list-models`) rather than hardcoded lists in this file.
 *   The previous PROVIDER_OPTIONS / PROVIDER_DEFAULTS / PROVIDER_LABELS
 *   tables drifted from pi-ai's actual catalog (smoke tests caught
 *   `deepseek-chat` vs pi-ai's `deepseek-v4-pro`, `azure` vs
 *   `azure-openai-responses`); pulling the lists at runtime closes that
 *   drift class entirely.
 *
 *   The Azure-specific `resourceName` input + the openai-compat-specific
 *   `baseUrl` input have collapsed into one universally-visible
 *   "Override base URL (advanced)" field. Empty by default; users only
 *   fill it for self-hosted gateways or Azure resource endpoints. pi-ai
 *   carries the canonical baseUrl per model, so the override stays empty
 *   for the common case.
 *
 * Replace-key flow:
 *   When a saved key exists we show "<mask> · Saved · [Replace]"
 *   instead of a password input. Clicking Replace flips
 *   `isEditingKey=true` and clears the field for a fresh value. Save
 *   always requires a non-empty `apiKey` — Phase 1b decision so the
 *   user doesn't get "did Save succeed?" ambiguity when the key didn't
 *   change.
 *
 * Unknown-provider state:
 *   On load, if the saved provider id isn't in pi-ai's `getProviders()`
 *   list — e.g. a legacy `'openai-compat'` row that didn't survive the
 *   migration rename, or a typo from a hand-edited sqlite row — we show
 *   an inline warning and force the user to pick a fresh provider before
 *   saving. `migrateProviderConfig` returns null for these cases, but
 *   defending in the UI keeps us robust to future provider retirements.
 *
 * Form reactivity:
 *   `provider` is subscribed via useStore so the Model dropdown re-renders
 *   when the provider changes. <form.Field> only re-renders its owner.
 */

/**
 * Providers surfaced at the top of the Provider dropdown. Everything else
 * sorts alphabetically below. We curate this list (rather than letting
 * popularity bubble up automatically) so the picker has a predictable
 * default ordering — newer users without a strong preference get
 * recommended options first; advanced users still see every pi-ai
 * provider further down.
 */
const RECOMMENDED_PROVIDERS: ReadonlySet<string> = new Set([
  'deepseek',
  'anthropic',
  'openai',
  'kimi-coding',
  'moonshotai-cn',
]);

function sortProviders(ids: ReadonlyArray<string>): string[] {
  // Stable two-bucket sort: recommended (in RECOMMENDED_PROVIDERS-declaration
  // order — we walk that set instead of relying on insertion order through
  // sort comparators, which would otherwise scramble the recommended order
  // alphabetically when more than one recommended id is present).
  const recommended: string[] = [];
  for (const id of RECOMMENDED_PROVIDERS) {
    if (ids.includes(id)) recommended.push(id);
  }
  const rest = ids.filter((id) => !RECOMMENDED_PROVIDERS.has(id)).sort();
  return [...recommended, ...rest];
}

type SettingsFormValues = {
  provider: string;
  model: string;
  apiKey: string;
  /** Optional base-URL override — empty unless user runs a self-hosted gateway or Azure resource. */
  baseUrl: string;
};

const EMPTY_VALUES: SettingsFormValues = {
  provider: '',
  model: '',
  apiKey: '',
  baseUrl: '',
};

/**
 * Build the V2 wire payload from the form's local fields. Returns `null`
 * when a required field is missing — caller toasts a validation error
 * instead of dispatching the IPC. The provider/model trim happens here
 * so the call sites don't have to repeat it.
 */
function buildProviderConfigV2(v: SettingsFormValues): ProviderConfigV2 | null {
  const provider = v.provider.trim();
  const model = v.model.trim();
  if (!provider || !model) return null;
  const baseUrl = v.baseUrl.trim();
  return {
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

/**
 * Render a one-line label for a model option: prefers the human `name`
 * (e.g. "DeepSeek V4 Pro"), falls back to the raw id when the catalog
 * doesn't carry one. Capability badges (image, reasoning) trail the
 * label so they're discoverable at a glance without a tooltip.
 */
function renderModelLabel(model: ProviderCatalogModel): string {
  const base = model.name && model.name !== model.id ? `${model.id} · ${model.name}` : model.id;
  const badges: string[] = [];
  if (model.input.includes('image')) badges.push('image');
  if (model.reasoning) badges.push('reasoning');
  return badges.length > 0 ? `${base} (${badges.join(', ')})` : base;
}

export function AIProviderSection() {
  const queryClient = useQueryClient();

  const existingQuery = useQuery({
    queryKey: ['settings:get-provider'],
    queryFn: settingsApi.getProvider,
  });

  const providersQuery = useQuery({
    queryKey: ['settings:list-providers'],
    queryFn: settingsApi.listProviders,
    // pi-ai's catalog is bundled (not network-fetched); it cannot change
    // within a session, so we never refetch.
    staleTime: Number.POSITIVE_INFINITY,
  });

  const [isEditingKey, setIsEditingKey] = useState(false);

  const saveMutation = useMutation({
    mutationFn: settingsApi.saveProvider,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings:get-provider'] });
      toast.success(m.settings_save_success());
    },
    onError: (err) => {
      toast.error(m.settings_save_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const form = useForm({
    defaultValues: EMPTY_VALUES,
    onSubmit: async ({ value }) => {
      const config = buildProviderConfigV2(value);
      if (!config) {
        toast.error(m.settings_save_failed(), {
          description: 'Please pick a provider and a model.',
        });
        return;
      }
      if (!value.apiKey.trim()) {
        toast.error(m.settings_save_failed(), {
          description: 'Please enter an API key.',
        });
        return;
      }
      await saveMutation.mutateAsync({ config, apiKey: value.apiKey.trim() });
    },
  });

  const provider = useStore(form.store, (s) => s.values.provider);
  const apiKeyValue = useStore(form.store, (s) => s.values.apiKey);
  const modelValue = useStore(form.store, (s) => s.values.model);

  const sortedProviders = useMemo(
    () => (providersQuery.data ? sortProviders(providersQuery.data) : []),
    [providersQuery.data],
  );

  const knownProviders = providersQuery.data ?? [];
  const hasUnknownProvider = provider !== '' && !knownProviders.includes(provider);

  const modelsQuery = useQuery({
    queryKey: ['settings:list-models', provider],
    queryFn: () => settingsApi.listModels(provider),
    // Only ask for models once the provider is known to pi-ai. Asking for an
    // unknown provider would return [] anyway, but skipping the IPC keeps the
    // network panel clean and avoids confusing the loading state.
    enabled: provider !== '' && !hasUnknownProvider,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Hydrate from existing saved config when the query resolves. V2-shaped:
  // any provider id pi-ai accepts is allowed; baseUrl (if non-empty) flows
  // straight into the optional override field. Legacy ids that no longer
  // match pi-ai's catalog (rare — `migrateProviderConfig` rescues the
  // common ones) land in `hasUnknownProvider` and surface a warning.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable; including it would refire on every re-render and clobber user edits.
  useEffect(() => {
    const existing = existingQuery.data;
    if (!existing) return;
    form.setFieldValue('provider', existing.provider);
    form.setFieldValue('model', existing.model);
    form.setFieldValue('baseUrl', existing.baseUrl ?? '');
    form.setFieldValue('apiKey', '');
    setIsEditingKey(false);
  }, [existingQuery.data]);

  const pingMutation = useMutation({
    mutationFn: async (input: { config: ProviderConfigV2; apiKey?: string }) =>
      await settingsApi.pingProvider(input),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(m.settings_test_success());
      } else {
        toast.error(m.settings_test_failed(), { description: result.error });
      }
    },
    onError: (err) => {
      toast.error(m.settings_test_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const savedMask = existingQuery.data?.apiKeyMasked ?? null;
  const hasSavedKey = savedMask != null;

  const handleProviderChange = (next: string) => {
    form.setFieldValue('provider', next);
    // Reset model + baseUrl when the provider changes — the previous
    // selections are almost never valid against a different provider's
    // catalog. The new model defaults are set in the modelsQuery effect
    // below when its data arrives.
    form.setFieldValue('model', '');
    form.setFieldValue('baseUrl', '');
  };

  // When the model catalog for the selected provider arrives, default to
  // the first model unless the form already has a value (preserves the
  // user's choice when they switch providers and come back).
  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable; we explicitly only run when models data flips.
  useEffect(() => {
    const models = modelsQuery.data;
    if (!models || models.length === 0) return;
    const current = form.state.values.model;
    const stillValid = models.some((m) => m.id === current);
    if (stillValid) return;
    form.setFieldValue('model', models[0]?.id ?? '');
  }, [modelsQuery.data]);

  const handleTest = () => {
    const values = form.state.values;
    const config = buildProviderConfigV2(values);
    if (!config) {
      toast.error(m.settings_test_failed(), {
        description: 'Please pick a provider and a model first.',
      });
      return;
    }
    const typedKey = values.apiKey.trim();
    if (isEditingKey || !hasSavedKey) {
      if (!typedKey) {
        toast.error(m.settings_test_failed(), {
          description: 'Please enter an API key first.',
        });
        return;
      }
      pingMutation.mutate({ config, apiKey: typedKey });
    } else {
      pingMutation.mutate({ config });
    }
  };

  const canSave = (() => {
    if (saveMutation.isPending) return false;
    if (!provider.trim()) return false;
    if (!modelValue.trim()) return false;
    if (!apiKeyValue.trim()) return false;
    return true;
  })();

  // The model catalog drives the dropdown vs. text-input choice: pi-ai
  // returned models → render a <select>; empty → fall back to a free-form
  // <Input> so the user can type an id we don't yet know about (or escape
  // a transient catalog read failure).
  const modelsCatalog = modelsQuery.data ?? [];
  const useModelDropdown = !hasUnknownProvider && modelsCatalog.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field
        name="provider"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="settings-provider">{m.settings_provider_picker_label()}</Label>
            <select
              id="settings-provider"
              value={field.state.value}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
            >
              {/* Placeholder option only renders before a provider is chosen,
                  so the dropdown isn't pre-filled with the alphabetically
                  first id (which would mislead users into thinking they had
                  configured something they hadn't). */}
              {field.state.value === '' && (
                <option value="" disabled>
                  {m.settings_provider_picker_placeholder()}
                </option>
              )}
              {sortedProviders.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {/* If the saved provider id isn't in pi-ai's list, render it
                  as a visible disabled option so the user sees what's there
                  and can pick a replacement. */}
              {hasUnknownProvider && (
                <option key={provider} value={provider} disabled>
                  {provider} (unknown)
                </option>
              )}
            </select>
            {hasUnknownProvider && (
              <p className="text-xs text-destructive">
                {m.settings_provider_unknown_warning({ provider })}
              </p>
            )}
          </div>
        )}
      />

      {provider === 'anthropic' && (
        // OAuth flow is a v1.x target — for now we just nudge users
        // toward the API-key path. Placeholder copy is intentionally
        // plain (not a localized message key) so we don't ship a string
        // we'll throw away in v1.x.
        <p className="text-xs text-muted-foreground">
          Anthropic OAuth login is coming in a future release. Use an API key for now.
        </p>
      )}

      <form.Field
        name="model"
        validators={{
          onChange: ({ value }) => (value.trim().length > 0 ? undefined : m.required_field()),
        }}
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="settings-model">{m.settings_provider_model_label()}</Label>
            {useModelDropdown ? (
              <select
                id="settings-model"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
              >
                {/* Render a placeholder when the form hasn't picked a model
                    yet (initial render before the catalog effect runs). */}
                {field.state.value === '' && (
                  <option value="" disabled>
                    {m.settings_provider_picker_placeholder()}
                  </option>
                )}
                {modelsCatalog.map((model) => (
                  <option key={model.id} value={model.id}>
                    {renderModelLabel(model)}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="settings-model"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={
                  hasUnknownProvider ? 'pick a known provider above first' : 'gpt-4o-mini'
                }
              />
            )}
            {field.state.meta.errors[0] && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      />

      <form.Field
        name="baseUrl"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="settings-base-url">
              {m.settings_provider_base_url_label_advanced()}
            </Label>
            <Input
              id="settings-base-url"
              value={field.state.value}
              placeholder="https://api.example.com/v1"
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </div>
        )}
      />

      <div className="space-y-1">
        <Label htmlFor="settings-apikey">{m.settings_apikey_label()}</Label>
        {hasSavedKey && !isEditingKey ? (
          <div
            id="settings-apikey"
            className="flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <span className="font-mono text-muted-foreground">{savedMask}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{m.settings_apikey_saved()}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsEditingKey(true);
                  form.setFieldValue('apiKey', '');
                }}
              >
                {m.settings_apikey_replace()}
              </Button>
            </span>
          </div>
        ) : (
          <form.Field
            name="apiKey"
            children={(field) => (
              <Input
                id="settings-apikey"
                type="password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
              />
            )}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTest}
          disabled={pingMutation.isPending}
        >
          {pingMutation.isPending ? m.settings_testing() : m.settings_test_connection()}
        </Button>
        <div className="flex-1" />
        <Button type="submit" disabled={!canSave}>
          {saveMutation.isPending ? m.settings_saving() : m.settings_save()}
        </Button>
      </div>
    </form>
  );
}
