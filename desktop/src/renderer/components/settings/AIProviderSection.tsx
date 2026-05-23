import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { settingsApi } from '@renderer/lib/api/settings';
import * as m from '@renderer/paraglide/messages';
import type { ProviderConfig, ProviderKind } from '@shared/types';
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

const PROVIDER_DEFAULTS: Record<ProviderKind, { model: string }> = {
  openai: { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-sonnet-4-5' },
  azure: { model: 'gpt-4o' },
  deepseek: { model: 'deepseek-chat' },
  'openai-compat': { model: 'gpt-4o-mini' },
};

const PROVIDER_LABELS: Record<ProviderKind, () => string> = {
  openai: m.settings_provider_openai,
  anthropic: m.settings_provider_anthropic,
  azure: m.settings_provider_azure,
  deepseek: m.settings_provider_deepseek,
  'openai-compat': m.settings_provider_openai_compat,
};

const PROVIDER_OPTIONS: ProviderKind[] = [
  'openai',
  'anthropic',
  'azure',
  'deepseek',
  'openai-compat',
];

type SettingsFormValues = {
  provider: ProviderKind;
  model: string;
  apiKey: string;
  resourceName: string;
  apiVersion: string;
  baseUrl: string;
  compatName: string;
};

const EMPTY_VALUES: SettingsFormValues = {
  provider: 'openai',
  model: PROVIDER_DEFAULTS.openai.model,
  apiKey: '',
  resourceName: '',
  apiVersion: '2024-08-01-preview',
  baseUrl: '',
  compatName: 'Custom',
};

function buildProviderConfig(v: SettingsFormValues): ProviderConfig | null {
  const model = v.model.trim();
  if (!model) return null;

  switch (v.provider) {
    case 'openai':
      return { provider: 'openai', model, apiKeyKeyref: 'llm.openai.apikey' };
    case 'anthropic':
      return { provider: 'anthropic', model, apiKeyKeyref: 'llm.anthropic.apikey' };
    case 'azure': {
      const resourceName = v.resourceName.trim();
      if (!resourceName) return null;
      return {
        provider: 'azure',
        model,
        apiKeyKeyref: 'llm.azure.apikey',
        resourceName,
        apiVersion: v.apiVersion.trim() || '2024-08-01-preview',
      };
    }
    case 'deepseek':
      return { provider: 'deepseek', model, apiKeyKeyref: 'llm.deepseek.apikey' };
    case 'openai-compat': {
      const baseUrl = v.baseUrl.trim();
      if (!baseUrl) return null;
      return {
        provider: 'openai-compat',
        model,
        apiKeyKeyref: 'llm.openai-compat.apikey',
        baseUrl,
        name: v.compatName.trim() || 'Custom',
      };
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
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.settings_save_failed(), { description: msg });
    },
  });

  const form = useForm({
    defaultValues: EMPTY_VALUES,
    onSubmit: async ({ value }) => {
      const config = buildProviderConfig(value);
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

  // Hydrate from existing saved config when the query resolves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable; including it would refire on every re-render and clobber user edits.
  useEffect(() => {
    const existing = existingQuery.data;
    if (!existing) return;
    form.setFieldValue('provider', existing.provider);
    form.setFieldValue('model', existing.model);
    if (existing.provider === 'azure') {
      form.setFieldValue('resourceName', existing.resourceName);
      form.setFieldValue('apiVersion', existing.apiVersion);
    } else if (existing.provider === 'openai-compat') {
      form.setFieldValue('baseUrl', existing.baseUrl);
      form.setFieldValue('compatName', existing.name);
    }
    form.setFieldValue('apiKey', '');
    setIsEditingKey(false);
  }, [existingQuery.data]);

  const pingMutation = useMutation({
    mutationFn: async (input: { config: ProviderConfig; apiKey?: string }) =>
      await settingsApi.pingProvider(input),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(m.settings_test_success());
      } else {
        toast.error(m.settings_test_failed(), { description: result.error });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.settings_test_failed(), { description: msg });
    },
  });

  const provider = useStore(form.store, (s) => s.values.provider);
  const apiKeyValue = useStore(form.store, (s) => s.values.apiKey);
  const modelValue = useStore(form.store, (s) => s.values.model);
  const resourceNameValue = useStore(form.store, (s) => s.values.resourceName);
  const baseUrlValue = useStore(form.store, (s) => s.values.baseUrl);

  const savedMask = existingQuery.data?.apiKeyMasked ?? null;
  const hasSavedKey = savedMask != null;

  const handleProviderChange = (next: ProviderKind) => {
    form.setFieldValue('provider', next);
    form.setFieldValue('model', PROVIDER_DEFAULTS[next].model);
  };

  const handleTest = () => {
    const values = form.state.values;
    const config = buildProviderConfig(values);
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
              onChange={(e) => handleProviderChange(e.target.value as ProviderKind)}
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

      {provider === 'azure' && (
        <>
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
          <form.Field
            name="apiVersion"
            children={(field) => (
              <div className="space-y-1">
                <Label htmlFor="settings-api-version">{m.settings_api_version_label()}</Label>
                <Input
                  id="settings-api-version"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          />
        </>
      )}

      {provider === 'openai-compat' && (
        <>
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
          <form.Field
            name="compatName"
            children={(field) => (
              <div className="space-y-1">
                <Label htmlFor="settings-compat-name">{m.settings_compat_name_label()}</Label>
                <Input
                  id="settings-compat-name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          />
        </>
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
