import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { settingsApi } from '@renderer/lib/api/settings';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import type { ProviderConfigV2 } from '@shared/types';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

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
 *   The settings IPC channels now speak `ProviderConfigV2` — a flat
 *   `{provider, model, baseUrl?}` shape. The previous V1 discriminated
 *   union (with per-variant `apiKeyKeyref` / `resourceName` / `apiVersion`
 *   / `name` fields) is gone from the wire. `apiKeyKeyref` is derived
 *   deterministically on the main side from `provider`.
 *
 *   Azure UX choice: the form still asks for `resourceName` (familiar to
 *   existing Azure users) and composes it into V2's `baseUrl` as
 *   `https://{resourceName}.openai.azure.com` on submit. On load, an
 *   existing baseUrl is reverse-parsed back into the `resourceName` input.
 *   The previous `apiVersion` input is gone — pi-ai picks a default —
 *   and existing user-set apiVersion values are dropped by the V1→V2
 *   migration (acceptable: '2024-08-01-preview' was the only sensible
 *   value and pi-ai's default is current enough).
 *
 *   openai-compat's V1 `name` (a display label) is dropped — V2 doesn't
 *   carry it. The list of providers shown to the user is unchanged; the
 *   only user-visible effect is that the "Provider name" field is gone.
 *
 * Replace-key flow:
 *   When a saved key exists we show "<mask> · Saved · [Replace]"
 *   instead of a password input. Clicking Replace flips
 *   `isEditingKey=true` and clears the field for a fresh value. Save
 *   always requires a non-empty `apiKey` — Phase 1b decision so the
 *   user doesn't get "did Save succeed?" ambiguity when the key didn't
 *   change.
 *
 * Form reactivity:
 *   `provider` is subscribed via useStore so sibling conditional fields
 *   (Azure resourceName, openai-compat baseUrl) re-render when the
 *   dropdown changes. <form.Field> only re-renders its owner.
 */

/**
 * The 5 providers exposed in the UI today. The wire format (V2) is open
 * to any pi-ai provider id; we keep the picker scoped to these 5 in
 * v1 so labels + defaults stay stable. v1.x expands to the full pi-ai
 * provider list (32+).
 */
const PROVIDER_OPTIONS = ['openai', 'anthropic', 'azure', 'deepseek', 'openai-compat'] as const;
type ProviderOption = (typeof PROVIDER_OPTIONS)[number];

const PROVIDER_DEFAULTS: Record<ProviderOption, { model: string }> = {
  openai: { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-sonnet-4-5' },
  azure: { model: 'gpt-4o' },
  deepseek: { model: 'deepseek-chat' },
  'openai-compat': { model: 'gpt-4o-mini' },
};

const PROVIDER_LABELS: Record<ProviderOption, () => string> = {
  openai: m.settings_provider_openai,
  anthropic: m.settings_provider_anthropic,
  azure: m.settings_provider_azure,
  deepseek: m.settings_provider_deepseek,
  'openai-compat': m.settings_provider_openai_compat,
};

/**
 * Parse a stored Azure baseUrl back into the resourceName the user
 * originally typed. Mirrors the compose direction below — if either drifts
 * the migration round-trip breaks. The pattern is what the V1→V2
 * migration in settings-service produces, so it's safe to anchor on.
 */
function extractAzureResourceName(baseUrl: string | undefined): string {
  if (!baseUrl) return '';
  const match = baseUrl.match(/^https:\/\/([^.]+)\.openai\.azure\.com/);
  return match?.[1] ?? '';
}

type SettingsFormValues = {
  provider: ProviderOption;
  model: string;
  apiKey: string;
  /** Azure-only — composed into baseUrl on submit. */
  resourceName: string;
  /** openai-compat-only — submitted verbatim as baseUrl. */
  baseUrl: string;
};

const EMPTY_VALUES: SettingsFormValues = {
  provider: 'openai',
  model: PROVIDER_DEFAULTS.openai.model,
  apiKey: '',
  resourceName: '',
  baseUrl: '',
};

/**
 * Build the V2 wire payload from the form's local fields. Returns `null`
 * when a required field is missing — caller toasts a validation error
 * instead of dispatching the IPC. The provider/model trim happens here
 * so the call sites don't have to repeat it.
 */
function buildProviderConfigV2(v: SettingsFormValues): ProviderConfigV2 | null {
  const model = v.model.trim();
  if (!model) return null;
  const provider = v.provider;

  switch (provider) {
    case 'openai':
    case 'anthropic':
    case 'deepseek':
      return { provider, model };
    case 'azure': {
      const resourceName = v.resourceName.trim();
      if (!resourceName) return null;
      // The shape of this URL is load-bearing: the read-back path in
      // `extractAzureResourceName` regexes for `<name>.openai.azure.com`.
      // Don't change one without the other.
      return {
        provider,
        model,
        baseUrl: `https://${resourceName}.openai.azure.com`,
      };
    }
    case 'openai-compat': {
      const baseUrl = v.baseUrl.trim();
      if (!baseUrl) return null;
      return { provider, model, baseUrl };
    }
  }
}

export function AIProviderSection() {
  const queryClient = useQueryClient();

  const existingQuery = useQuery({
    queryKey: ['settings:get-provider'],
    queryFn: settingsApi.getProvider,
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
          description: 'Please fill in all required fields for the chosen provider.',
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

  // Hydrate from existing saved config when the query resolves. V2-shaped:
  // azure stores its resource encoded in `baseUrl`, so we reverse-parse on
  // load; openai-compat carries `baseUrl` verbatim.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable; including it would refire on every re-render and clobber user edits.
  useEffect(() => {
    const existing = existingQuery.data;
    if (!existing) return;
    // Defensive: only hydrate `provider` if the saved value is one of the
    // 5 we render. pi-ai providers outside this set (kimi-coding, qwen,
    // zhipu, …) can land here once v1.x adds them to the picker; until
    // then we fall back to 'openai' to keep the form usable.
    const provider: ProviderOption = (PROVIDER_OPTIONS as readonly string[]).includes(
      existing.provider,
    )
      ? (existing.provider as ProviderOption)
      : 'openai';
    form.setFieldValue('provider', provider);
    form.setFieldValue('model', existing.model);
    if (provider === 'azure') {
      form.setFieldValue('resourceName', extractAzureResourceName(existing.baseUrl));
    } else if (provider === 'openai-compat') {
      form.setFieldValue('baseUrl', existing.baseUrl ?? '');
    }
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

  const provider = useStore(form.store, (s) => s.values.provider);
  const apiKeyValue = useStore(form.store, (s) => s.values.apiKey);
  const modelValue = useStore(form.store, (s) => s.values.model);
  const resourceNameValue = useStore(form.store, (s) => s.values.resourceName);
  const baseUrlValue = useStore(form.store, (s) => s.values.baseUrl);

  const savedMask = existingQuery.data?.apiKeyMasked ?? null;
  const hasSavedKey = savedMask != null;

  const handleProviderChange = (next: ProviderOption) => {
    form.setFieldValue('provider', next);
    form.setFieldValue('model', PROVIDER_DEFAULTS[next].model);
  };

  const handleTest = () => {
    const values = form.state.values;
    const config = buildProviderConfigV2(values);
    if (!config) {
      toast.error(m.settings_test_failed(), {
        description: 'Please fill in all required fields first.',
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
    if (!modelValue.trim()) return false;
    if (!apiKeyValue.trim()) return false;
    if (provider === 'azure' && !resourceNameValue.trim()) return false;
    if (provider === 'openai-compat' && !baseUrlValue.trim()) return false;
    return true;
  })();

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
            <Label htmlFor="settings-provider">{m.settings_provider_label()}</Label>
            <select
              id="settings-provider"
              value={field.state.value}
              onChange={(e) => handleProviderChange(e.target.value as ProviderOption)}
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]()}
                </option>
              ))}
            </select>
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

      {provider === 'azure' && (
        <form.Field
          name="resourceName"
          validators={{
            onChange: ({ value }) => (value.trim().length > 0 ? undefined : m.required_field()),
          }}
          children={(field) => (
            <div className="space-y-1">
              <Label htmlFor="settings-resource-name">{m.settings_resource_name_label()}</Label>
              <Input
                id="settings-resource-name"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] && (
                <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        />
      )}

      {provider === 'openai-compat' && (
        <form.Field
          name="baseUrl"
          validators={{
            onChange: ({ value }) => (value.trim().length > 0 ? undefined : m.required_field()),
          }}
          children={(field) => (
            <div className="space-y-1">
              <Label htmlFor="settings-base-url">{m.settings_base_url_label()}</Label>
              <Input
                id="settings-base-url"
                value={field.state.value}
                placeholder="https://api.example.com/v1"
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] && (
                <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        />
      )}

      <form.Field
        name="model"
        validators={{
          onChange: ({ value }) => (value.trim().length > 0 ? undefined : m.required_field()),
        }}
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="settings-model">{m.settings_model_label()}</Label>
            <Input
              id="settings-model"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors[0] && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
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
