import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';
import { licenseApi } from '@renderer/lib/api/license';
import * as m from '@renderer/paraglide/messages';
import type { LicenseState, LicenseStateView } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Settings page License section (Phase 4 sub-project B).
 *
 * Reads the current state from `license:get-state`. When a JWT is present
 * it shows plan / expiry / device / features; otherwise it shows just the
 * activation form. Activation calls `license:set-jwt`; deactivation
 * (clearing the JWT) calls `license:clear`.
 *
 * Cloud-side issuance is sub-project G; until then a developer mints a
 * dev JWT via `scripts/issue-dev-license.mjs` and pastes it into this
 * form. Production flow will be: buy → email contains the JWT → paste here.
 */
export function LicenseSection() {
  const queryClient = useQueryClient();
  const stateQuery = useQuery({
    queryKey: ['license:get-state'],
    queryFn: licenseApi.getState,
  });

  const [keyInput, setKeyInput] = useState('');

  const activate = useMutation({
    mutationFn: () => licenseApi.activateWithKey({ license_key: keyInput.trim() }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(m.license_activation_success());
        setKeyInput('');
        queryClient.invalidateQueries({ queryKey: ['license:get-state'] });
        return;
      }
      // 7 error tags from `license:activate-with-key`. The 3 that overlap
      // with the old setJwt flow (BadSignature, Malformed, BadSchema) keep
      // their existing i18n strings; the cloud-roundtrip-specific tags
      // (Network, KeyNotFound, RateLimited, DeviceCapReached, Server) get
      // a generic toast title + the server message as description, so the
      // operator can fix without us shipping a new translation per tag.
      const tagToTitle: Record<string, string> = {
        BadSignature: m.license_activation_error_bad_signature(),
        Malformed: m.license_activation_error_malformed(),
        BadSchema: m.license_activation_error_bad_schema(),
      };
      const title = tagToTitle[result.error._tag] ?? m.license_activation_error_malformed();
      toast.error(title, { description: result.error.message });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(m.license_activation_error_malformed(), { description: msg });
    },
  });

  const deactivate = useMutation({
    mutationFn: licenseApi.clear,
    onSuccess: () => {
      toast.success(m.license_deactivated_toast());
      queryClient.invalidateQueries({ queryKey: ['license:get-state'] });
    },
  });

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-3">
      <h3 className="text-sm font-medium">{m.license_section_heading()}</h3>
      <p className="text-sm text-muted-foreground">{m.license_section_subheading()}</p>

      {stateQuery.isLoading && <p className="text-sm text-muted-foreground">{m.loading()}</p>}

      {stateQuery.data && <LicenseStateBlock view={stateQuery.data} />}

      {/* Activation form: visible only when no JWT is currently active
       *  OR the user has explicitly deactivated. Input takes the
       *  humanized cik- key from the activation email; main process
       *  exchanges it for a signed JWT via /api/v1/activate. */}
      {stateQuery.data && stateQuery.data.claims == null && (
        <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
          <h4 className="text-sm font-medium">{m.license_activation_heading()}</h4>
          <p className="text-sm text-muted-foreground">{m.license_activation_body()}</p>
          <div className="space-y-1">
            <Label htmlFor="license-key-input">{m.license_activation_input_label()}</Label>
            <input
              id="license-key-input"
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={m.license_activation_input_placeholder()}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm tracking-wider outline-none focus-visible:border-ring"
            />
          </div>
          <Button
            type="button"
            onClick={() => activate.mutate()}
            disabled={!keyInput.trim() || activate.isPending}
          >
            {m.license_activation_submit()}
          </Button>
        </div>
      )}

      {/* Upgrade CTA — surfaced inline in the License section whenever the
       *  current plan is a trial (paid plans don't need it). Same target
       *  as the topbar banner so users hitting either path land on the
       *  same pricing page in their default browser. */}
      {stateQuery.data?.claims?.plan.startsWith('trial') && (
        <Button
          type="button"
          variant="default"
          onClick={() => window.open('https://carbonink.xyz/pricing', '_blank')}
        >
          {m.license_section_upgrade_button()}
        </Button>
      )}

      {/* Deactivate button — only when a JWT is active. Confirmation prompt
       *  prevents accidental wipes; on confirm we call license:clear and
       *  re-render into the activation-form state above. */}
      {stateQuery.data?.claims && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (window.confirm(m.license_deactivate_confirm())) {
              deactivate.mutate();
            }
          }}
          disabled={deactivate.isPending}
        >
          {m.license_deactivate_button()}
        </Button>
      )}
    </div>
  );
}

/**
 * Read-only block summarising the current state + claims. Pulled out so
 * the section file isn't dominated by formatting boilerplate.
 */
function LicenseStateBlock({ view }: { view: LicenseStateView }) {
  const stateLabels: Record<LicenseState, string> = {
    unverified: m.license_state_unverified(),
    active: m.license_state_active(),
    grace: m.license_state_grace(),
    expired: m.license_state_expired(),
    revoked: m.license_state_revoked(),
  };
  // Chip color per state. Same palette as the rest of the app's status chips.
  const chipClasses: Record<LicenseState, string> = {
    unverified: 'border-border bg-muted/30 text-muted-foreground',
    active: 'border-primary/40 bg-primary/10 text-primary',
    grace: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    expired: 'border-destructive/40 bg-destructive/10 text-destructive',
    revoked: 'border-destructive/40 bg-destructive/10 text-destructive',
  };

  const c = view.claims;
  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${chipClasses[view.state]}`}
        >
          {stateLabels[view.state]}
        </span>
        <span className="text-xs text-muted-foreground">{view.reason}</span>
      </div>

      {c && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{m.license_field_plan()}</dt>
          <dd className="font-mono">{c.plan}</dd>
          <dt className="text-muted-foreground">{m.license_field_user_id()}</dt>
          <dd className="font-mono">{c.user_id}</dd>
          <dt className="text-muted-foreground">{m.license_field_license_id()}</dt>
          <dd className="font-mono">{c.license_id}</dd>
          <dt className="text-muted-foreground">{m.license_field_features()}</dt>
          <dd>{c.features.join(', ')}</dd>
          <dt className="text-muted-foreground">{m.license_field_expires_at()}</dt>
          <dd>{formatUnixDate(c.expires_at)}</dd>
          <dt className="text-muted-foreground">{m.license_field_grace_until()}</dt>
          <dd>{formatUnixDate(c.grace_until)}</dd>
          <dt className="text-muted-foreground">{m.license_field_last_verified_at()}</dt>
          <dd>{view.last_verified_at ?? m.license_field_never_verified()}</dd>
          <dt className="text-muted-foreground">{m.license_field_device_id()}</dt>
          <dd className="font-mono">{view.device_id}</dd>
        </dl>
      )}
    </div>
  );
}

function formatUnixDate(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}
