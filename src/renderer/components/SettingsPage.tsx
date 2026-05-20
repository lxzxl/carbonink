import { LicenseSection } from '@renderer/components/LicenseSection';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { mcpApi } from '@renderer/lib/api/mcp';
import { orgApi } from '@renderer/lib/api/organization';
import { settingsApi } from '@renderer/lib/api/settings';
import * as m from '@renderer/paraglide/messages';
import type { ProviderConfig, ProviderKind } from '@shared/types';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * Provider config form rendered inside the global Settings drawer.
 *
 * Storage policy (set by SettingsService / CredentialService):
 *   - Provider config (provider, model, resourceName, baseUrl, ...) →
 *     sqlite `setting` table, returned by `settings:get-provider`.
 *   - API key plaintext → OS keychain via `CredentialService`. The
 *     renderer never sees the plaintext — only `apiKeyMasked` (e.g.
 *     `sk-...abcd`) once a key has been saved.
 *   - AMap API key → sqlite `setting` table (not safeStorage; free dev
 *     keys are not secrets in the same threat model as LLM keys).
 *
 * Replace-key flow:
 *   When a saved key exists we show "Saved · sk-...abcd · [Replace]"
 *   instead of a password input. Clicking Replace flips `isEditingKey`
 *   true, clearing the field for fresh input. Save always requires a
 *   non-empty `apiKey` field — this is intentionally crude for Phase 1b
 *   so editing any config field forces the user to re-supply the key
 *   (avoids "did Save succeed?" ambiguity when the key didn't change).
 *   Phase 1c can split a "metadata-only update" path if useful.
 *
 * Form reactivity:
 *   The `provider` field is subscribed via `useStore(form.store, ...)`
 *   so conditional fields (Azure resourceName / openai-compat baseUrl)
 *   re-render correctly when the dropdown changes. Reading
 *   `form.state.values.provider` synchronously would NOT subscribe — only
 *   the <form.Field> for that name would react, leaving sibling
 *   conditional fields stale (the bug fixed in Phase 1a d3f1b31).
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
  // azure-only
  resourceName: string;
  apiVersion: string;
  // openai-compat-only
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

/**
 * Build a ProviderConfig payload from the flat form values. Returns null
 * when required fields for the chosen provider are missing — the caller
 * (Save handler) reports the error rather than the schema throwing on
 * `saveProvider`.
 */
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

/**
 * Organization Profile section (ISO 14064-1 metadata).
 * Allows editing boundary_kind, responsible_person_name/role, and base_year_period_id.
 */
function OrganizationProfileSection() {
  const queryClient = useQueryClient();

  // Fetch current org + reporting periods
  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: () => orgApi.getCurrent(),
  });

  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgQuery.data?.id],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgQuery.data!.id }),
    enabled: !!orgQuery.data?.id,
  });

  // Local state for form fields
  const [boundary, setBoundary] = useState<
    'equity_share' | 'financial_control' | 'operational_control'
  >('operational_control');
  const [respName, setRespName] = useState('');
  const [respRole, setRespRole] = useState('');
  const [baseYearId, setBaseYearId] = useState<string | null>(null);

  // Hydrate from org data when it loads
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional: only re-run when the query data changes
  useEffect(() => {
    if (orgQuery.data) {
      setBoundary(orgQuery.data.boundary_kind);
      setRespName(orgQuery.data.responsible_person_name ?? '');
      setRespRole(orgQuery.data.responsible_person_role ?? '');
      setBaseYearId(orgQuery.data.base_year_period_id ?? null);
    }
  }, [orgQuery.data]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      orgApi.updateReportingProfile({
        id: orgQuery.data!.id,
        boundary_kind: boundary,
        responsible_person_name: respName || null,
        responsible_person_role: respRole || null,
        base_year_period_id: baseYearId,
      }),
    onSuccess: () => {
      toast.success(m.settings_reporting_profile_saved());
      queryClient.invalidateQueries({ queryKey: ['org:get-current'] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.settings_save_failed(), { description: msg });
    },
  });

  if (!orgQuery.data) return null;

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-3">
      <h3 className="text-sm font-medium">{m.settings_org_profile_heading()}</h3>
      <p className="text-sm text-muted-foreground">{m.settings_org_profile_subheading()}</p>

      {/* Boundary kind radio group (using select for simplicity) */}
      <div className="space-y-1">
        <Label htmlFor="settings-boundary">{m.settings_boundary_label()}</Label>
        <select
          id="settings-boundary"
          value={boundary}
          onChange={(e) =>
            setBoundary(
              e.target.value as 'equity_share' | 'financial_control' | 'operational_control',
            )
          }
          className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
        >
          <option value="equity_share">{m.settings_boundary_equity_share()}</option>
          <option value="financial_control">{m.settings_boundary_financial_control()}</option>
          <option value="operational_control">{m.settings_boundary_operational_control()}</option>
        </select>
      </div>

      {/* Responsible person name */}
      <div className="space-y-1">
        <Label htmlFor="settings-resp-name">{m.settings_responsible_name_label()}</Label>
        <Input
          id="settings-resp-name"
          value={respName}
          onChange={(e) => setRespName(e.target.value)}
          placeholder=""
        />
      </div>

      {/* Responsible person role */}
      <div className="space-y-1">
        <Label htmlFor="settings-resp-role">{m.settings_responsible_role_label()}</Label>
        <Input
          id="settings-resp-role"
          value={respRole}
          onChange={(e) => setRespRole(e.target.value)}
          placeholder=""
        />
      </div>

      {/* Base year period dropdown */}
      <div className="space-y-1">
        <Label htmlFor="settings-base-year">{m.settings_base_year_label()}</Label>
        <select
          id="settings-base-year"
          value={baseYearId ?? ''}
          onChange={(e) => setBaseYearId(e.target.value === '' ? null : e.target.value)}
          className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
        >
          <option value="">{m.settings_base_year_none()}</option>
          {periodsQuery.data?.map((period) => (
            <option key={period.id} value={period.id}>
              {period.year}
            </option>
          ))}
        </select>
      </div>

      {/* Save button */}
      <Button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="w-full"
      >
        {saveMutation.isPending ? m.settings_saving() : m.settings_reporting_profile_save()}
      </Button>
    </div>
  );
}

/**
 * Settings form, rendered as its own route at `/settings`. Previously this
 * lived inside a slide-out drawer; the move to a dedicated page lets users
 * link/refresh/back-button their way through configuration and gives long
 * sub-sections (provider config, AMap key, organization profile, MCP) room
 * to breathe without a tiny side panel.
 */
export function SettingsPage() {
  const queryClient = useQueryClient();

  // Prefill from existing saved config. We don't render a loading state
  // for this — the form mounts with EMPTY_VALUES and we hydrate via
  // `form.setFieldValue` once the query resolves (same pattern as
  // ActivityForm / SourceForm).
  const existingQuery = useQuery({
    queryKey: ['settings:get-provider'],
    queryFn: settingsApi.getProvider,
  });

  // Whether a saved key exists. Drives the "Saved · sk-...abcd · Replace"
  // affordance. When the user clicks Replace we flip `isEditingKey` to
  // surface a normal password input again.
  const [isEditingKey, setIsEditingKey] = useState(false);

  // ── AMap API key ────────────────────────────────────────────────────────────
  // Stored in sqlite (not OS keychain) — AMap free dev keys are low-risk.
  // We use a controlled input with a Save-on-submit style.
  const [amapKey, setAmapKey] = useState('');
  const amapKeyQuery = useQuery({
    queryKey: ['settings:get-amap-key'],
    queryFn: settingsApi.getAmapKey,
  });
  // Hydrate the AMap key input once the query resolves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional: only re-run when the query data changes (not on every render)
  useEffect(() => {
    if (amapKeyQuery.data != null) {
      setAmapKey(amapKeyQuery.data);
    }
  }, [amapKeyQuery.data]);

  const saveAmapKeyMutation = useMutation({
    mutationFn: (value: string) => settingsApi.setAmapKey({ value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings:get-amap-key'] });
      toast.success(m.settings_save_success());
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.settings_save_failed(), { description: msg });
    },
  });

  // ── MCP Server status ────────────────────────────────────────────────────────
  // Polls every 10 s so the UI reflects an external `pnpm build` without
  // requiring a manual refresh.
  const mcpStatusQuery = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
  });

  const writeClaudeConfig = useMutation({
    mutationFn: mcpApi.writeClaudeConfig,
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(m.settings_mcp_write_done());
        mcpStatusQuery.refetch();
      } else {
        toast.error(m.settings_mcp_write_failed(), { description: r.error });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.settings_mcp_write_failed(), { description: msg });
    },
  });

  const mcpStatus = mcpStatusQuery.data;
  const mcpStatusLabel = !mcpStatus?.binary_built
    ? m.settings_mcp_status_not_built()
    : mcpStatus.claude_config_references_us
      ? m.settings_mcp_status_available()
      : m.settings_mcp_status_pending();

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

  // Hydrate from existing saved config when the query resolves. Idempotent
  // and effect-keyed on the data identity so user edits aren't clobbered
  // on re-renders. We set isEditingKey=false here so the Replace widget
  // surfaces correctly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable across renders; including it would refire on every re-render and clobber user edits.
  useEffect(() => {
    const existing = existingQuery.data;
    if (!existing) return;
    form.setFieldValue('provider', existing.provider);
    form.setFieldValue('model', existing.model);
    // Azure / openai-compat extras
    if (existing.provider === 'azure') {
      form.setFieldValue('resourceName', existing.resourceName);
      form.setFieldValue('apiVersion', existing.apiVersion);
    } else if (existing.provider === 'openai-compat') {
      form.setFieldValue('baseUrl', existing.baseUrl);
      form.setFieldValue('compatName', existing.name);
    }
    // Clear apiKey field — the saved-mask renderer takes over instead.
    form.setFieldValue('apiKey', '');
    setIsEditingKey(false);
  }, [existingQuery.data]);

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

  // `ping-provider` is the one IPC channel whose handler signature is
  // typed `Promise<{ok}|{!ok}>` (others are sync-shaped and the bridge
  // wraps them). That makes `invoke()`'s ReturnType nested
  // (`Promise<Promise<...>>`); we flatten with an explicit `await` here
  // so the mutation's `data` type is the unwrapped result.
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

  // Subscribe to `provider` so sibling conditional fields re-render when
  // the dropdown changes. The d3f1b31 / a4a69c3 lesson from Phase 1a:
  // <form.Field> alone only re-renders its own owner; sibling JSX (here:
  // the Azure / openai-compat conditional sections) needs an explicit
  // store subscription.
  const provider = useStore(form.store, (s) => s.values.provider);

  // Saved-key state from the persisted config — the mask string and the
  // boolean of "does a key live in keychain". Derived from the query data
  // directly so it tracks invalidation after Save.
  const savedMask = existingQuery.data?.apiKeyMasked ?? null;
  const hasSavedKey = savedMask != null;

  const handleProviderChange = (next: ProviderKind) => {
    form.setFieldValue('provider', next);
    // Always reset the model to the chosen provider's default. Users
    // almost never customize model names; auto-fill saves a step. If
    // someone needs a custom model they can still type after switching.
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
    // If the user is editing or no key is saved yet, send the typed key.
    // Otherwise omit `apiKey` — the handler will use the stored key.
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

  // Save is disabled when the form's required fields aren't satisfied or
  // a request is in flight. We always require apiKey non-empty for
  // Phase 1b (see component docstring).
  const apiKeyValue = useStore(form.store, (s) => s.values.apiKey);
  const modelValue = useStore(form.store, (s) => s.values.model);
  const resourceNameValue = useStore(form.store, (s) => s.values.resourceName);
  const baseUrlValue = useStore(form.store, (s) => s.values.baseUrl);
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
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
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
          // Saved-key affordance. The mask comes from the main process —
          // the renderer never sees plaintext.
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

      {/* AMap API key — used by the "Look up distance" feature on freight +
       * travel activity rows. Free dev key (100,000 requests/day); stored in
       * sqlite, not OS keychain, since it's a low-risk public dev credential.
       * Get one at https://lbs.amap.com/dev/ */}
      <div className="border-t border-border pt-4 mt-2 space-y-2">
        <div className="space-y-1">
          <Label htmlFor="settings-amap-key">AMap routing key</Label>
          <div className="flex gap-2">
            <Input
              id="settings-amap-key"
              value={amapKey}
              onChange={(e) => setAmapKey(e.target.value)}
              placeholder="amap key (optional)"
            />
            <Button
              type="button"
              variant="outline"
              aria-label="Save AMap key"
              onClick={() => saveAmapKeyMutation.mutate(amapKey)}
              disabled={saveAmapKeyMutation.isPending}
            >
              {saveAmapKeyMutation.isPending ? m.settings_saving() : m.settings_save()}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get a free key at https://lbs.amap.com/dev/ (100,000 requests/day) · Used for "Look up
            distance" on freight + travel rows.
          </p>
        </div>
      </div>

      {/* MCP Server — Claude Desktop integration (Phase 2 Block 4).
       * Shows binary build status + one-click config write. */}
      <div className="border-t border-border pt-4 mt-2 space-y-3">
        <h3 className="text-sm font-medium">{m.settings_mcp_title()}</h3>
        <p className="text-sm">{mcpStatusLabel}</p>
        {mcpStatus?.binary_path && (
          <>
            <div className="space-y-1">
              <Label>{m.settings_mcp_binary_label()}</Label>
              <div className="flex items-center gap-2">
                <code className="text-xs truncate flex-1 font-mono">{mcpStatus.binary_path}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(mcpStatus.binary_path!);
                    toast.success(m.settings_mcp_copy_done());
                  }}
                >
                  复制
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{m.settings_mcp_config_label()}</Label>
              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                {JSON.stringify(
                  {
                    mcpServers: {
                      carbonbook: { command: 'node', args: [mcpStatus.binary_path] },
                    },
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
            <Button
              type="button"
              onClick={() => writeClaudeConfig.mutate()}
              disabled={writeClaudeConfig.isPending || mcpStatus.claude_config_references_us}
            >
              {m.settings_mcp_write_button()}
            </Button>
          </>
        )}
      </div>

      {/* Organization Profile — ISO 14064-1 metadata (Phase 3) */}
      <OrganizationProfileSection />

      {/* License — Ed25519 JWT activation + state display (Phase 4 sub-project B) */}
      <LicenseSection />
    </form>
  );
}
