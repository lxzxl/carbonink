import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@renderer/components/ui/dialog';
import { Label } from '@renderer/components/ui/label';
import { mcpApi, skillApi } from '@renderer/lib/api/mcp';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { AgentHost, McpClientId, McpClientStatus } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Integrations Settings sub-page — two-step layout (v1.1).
 *
 *   Step 1 · Install Agent Skill  (SkillStep, this file)
 *     Manages the `carbonink` agent skill bundle under
 *     `~/.agents/skills/carbonink/` and the per-host symlinks for
 *     Claude Code / Pi / Codex. Driven by the `skill:*` IPC channels.
 *
 *   Step 2 · MCP client config     (Step2McpClients, this file)
 *     The original v1 multi-client MCP UI — master toggle + per-client
 *     row with Configure / Reconfigure / Remove. Driven by `mcp:*`.
 *
 * Step 2 UI quirks worth knowing:
 *   - There's no shadcn `<Switch>` primitive in this project (see
 *     `SourceEditDrawer` for the same workaround). We roll a small
 *     button-toggle with `role="switch"` + `aria-checked` so the
 *     master toggle has correct semantics without adding a new dep.
 *   - The master toggle is purely a UX gate over the per-client
 *     buttons — flipping it off doesn't remove existing client
 *     configs (the help text spells that out). Clicking Remove on a
 *     row is the only way to actually withdraw.
 *   - Pi gets a setup-guide modal instead of a Configure button — Pi
 *     doesn't ship native `mcpServers` config support yet, so the
 *     workaround is the `pi-mcporter` bridge extension.
 *   - We poll `mcp:detect` (and `skill:detect`) every 10s so the user
 *     sees changes if they edit a config file out-of-band, or restart
 *     a client / re-link a host that was previously missing.
 */

interface ClientDef {
  id: McpClientId;
  label: () => string;
}

const CLIENTS: ReadonlyArray<ClientDef> = [
  { id: 'claudeDesktop', label: m.settings_mcp_client_claude_desktop },
  { id: 'claudeCode', label: m.settings_mcp_client_claude_code },
  { id: 'cursor', label: m.settings_mcp_client_cursor },
  { id: 'pi', label: m.settings_mcp_client_pi },
];

export function McpSection() {
  return (
    <div className="space-y-6">
      <SkillStep />
      <div className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-sm font-medium">{m.settings_mcp_step_title()}</h3>
          <p className="text-xs text-muted-foreground mt-1">{m.settings_mcp_step_help()}</p>
        </div>
        <Step2McpClients />
      </div>
    </div>
  );
}

/**
 * Step 1 · Agent Skill installer.
 *
 * Drives the `skill:*` IPC channels. Polls `skill:detect` every 10s
 * (same cadence as Step 2) so users see out-of-band edits to
 * `~/.agents/skills/carbonink/` reflected without a manual refresh.
 *
 * The three mutations share the same generic shape — success/error
 * toasts plus a `skill:detect` invalidation — so the helper text in
 * the empty-state and installed-state branches is the only thing that
 * actually differs in the UI.
 */
function SkillStep() {
  const qc = useQueryClient();
  const detectQuery = useQuery({
    queryKey: ['skill:detect'],
    queryFn: skillApi.detect,
    refetchInterval: 10_000,
  });

  const installMut = useMutation({
    mutationFn: () => skillApi.install(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(m.settings_skill_installed({ count: String(r.result.hostsLinked.length) }));
      } else {
        toast.error(m.settings_skill_install_failed(), { description: r.message });
      }
      qc.invalidateQueries({ queryKey: ['skill:detect'] });
    },
    onError: (e) =>
      toast.error(m.settings_skill_install_failed(), {
        description: friendlyErrorDescription(e),
      }),
  });

  const updateMut = useMutation({
    mutationFn: () => skillApi.update(),
    onSuccess: (r) => {
      if (r.ok) toast.success(m.settings_skill_updated());
      else toast.error(m.settings_skill_install_failed(), { description: r.message });
      qc.invalidateQueries({ queryKey: ['skill:detect'] });
    },
    onError: (e) =>
      toast.error(m.settings_skill_install_failed(), {
        description: friendlyErrorDescription(e),
      }),
  });

  const removeMut = useMutation({
    mutationFn: () => skillApi.remove(),
    onSuccess: (r) => {
      if (r.ok) toast.success(m.settings_skill_removed());
      else toast.error(m.settings_skill_install_failed(), { description: r.message });
      qc.invalidateQueries({ queryKey: ['skill:detect'] });
    },
    onError: (e) =>
      toast.error(m.settings_skill_install_failed(), {
        description: friendlyErrorDescription(e),
      }),
  });

  const d = detectQuery.data;
  const pending = installMut.isPending || updateMut.isPending || removeMut.isPending;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{m.settings_skill_step_title()}</h3>
        <p className="text-xs text-muted-foreground mt-1">{m.settings_skill_step_help()}</p>
      </div>

      {!d ? (
        <p className="text-xs text-muted-foreground">{m.settings_skill_loading()}</p>
      ) : d.state === 'not_installed' ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{m.settings_skill_status_not_installed()}</div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {m.settings_skill_will_install_to({
                hosts:
                  hostListLabel(d.detectedHosts.filter((h) => h !== 'agentsShared')) ||
                  m.settings_skill_no_hosts(),
              })}
            </div>
          </div>
          <Button onClick={() => installMut.mutate()} disabled={pending}>
            {m.settings_skill_action_install()}
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {d.needsUpdate
                  ? m.settings_skill_status_outdated()
                  : m.settings_skill_status_installed({ count: String(d.hostsLinked.length) })}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                {d.canonicalPath}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {d.needsUpdate && (
                <Button size="sm" onClick={() => updateMut.mutate()} disabled={pending}>
                  {m.settings_skill_action_update()}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => removeMut.mutate()}
                disabled={pending}
              >
                {m.settings_skill_action_remove()}
              </Button>
            </div>
          </div>
          {d.hostsLinked.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc pl-5">
              {d.hostsLinked.map((h) => (
                <li key={h}>{hostLabel(h)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function hostLabel(h: AgentHost): string {
  switch (h) {
    case 'agentsShared':
      return '~/.agents/skills/';
    case 'claudeCode':
      return 'Claude Code (~/.claude/skills/)';
    case 'pi':
      return 'Pi (~/.pi/agent/skills/)';
    case 'codex':
      return 'Codex (~/.codex/skills/)';
  }
}

function hostListLabel(hosts: AgentHost[]): string {
  return hosts.map(hostLabel).join(', ');
}

/**
 * Step 2 · MCP client config (the original v1 UI, body unchanged).
 *
 * Exported as a separate component so the outer `McpSection` can lay
 * out Step 1 + Step 2 with a divider; nothing inside this body has
 * changed from v1 beyond the unwrap of its own top-level container
 * div (the parent now owns the outer spacing).
 */
function Step2McpClients() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(true);

  const detectQuery = useQuery({
    queryKey: ['mcp:detect'],
    queryFn: mcpApi.detect,
    refetchInterval: 10_000,
  });
  const serverEntryQuery = useQuery({
    queryKey: ['mcp:server-entry'],
    queryFn: mcpApi.getServerEntry,
  });

  const configureMut = useMutation({
    mutationFn: (id: McpClientId) => mcpApi.configure(id),
    onSuccess: (r, id) => {
      if (r.ok) {
        toast.success(m.settings_mcp_configured({ client: clientLabel(id) }));
      } else if (r.error === 'invalid_json') {
        toast.error(m.settings_mcp_invalid_json(), { description: r.message });
      } else if (r.error === 'pi_not_supported') {
        // Shouldn't happen — Pi has its own button — but be safe.
        toast.error(m.settings_mcp_configure_failed(), { description: 'pi_not_supported' });
      } else {
        toast.error(m.settings_mcp_configure_failed(), { description: r.message });
      }
      qc.invalidateQueries({ queryKey: ['mcp:detect'] });
    },
    onError: (e) =>
      toast.error(m.settings_mcp_configure_failed(), { description: friendlyErrorDescription(e) }),
  });

  const removeMut = useMutation({
    mutationFn: (id: McpClientId) => mcpApi.remove(id),
    onSuccess: (r, id) => {
      if (r.ok) {
        toast.success(m.settings_mcp_removed({ client: clientLabel(id) }));
      } else if (r.error === 'invalid_json') {
        toast.error(m.settings_mcp_invalid_json(), { description: r.message });
      } else {
        toast.error(m.settings_mcp_remove_failed(), { description: r.message });
      }
      qc.invalidateQueries({ queryKey: ['mcp:detect'] });
    },
    onError: (e) =>
      toast.error(m.settings_mcp_remove_failed(), { description: friendlyErrorDescription(e) }),
  });

  const detect = detectQuery.data;
  const serverEntry = serverEntryQuery.data;
  const actionPending = configureMut.isPending || removeMut.isPending;

  return (
    <div className="space-y-4">
      <MasterToggle enabled={enabled} onToggle={setEnabled} />
      <p className="text-xs text-muted-foreground">{m.settings_mcp_master_toggle_help()}</p>

      {serverEntry && (
        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
          <Label className="text-xs">{m.settings_mcp_binary_label()}</Label>
          <code className="block truncate font-mono text-xs">{serverEntry.command}</code>
          <Label className="pt-2 text-xs">{m.settings_mcp_script_label()}</Label>
          <code className="block truncate font-mono text-xs">{serverEntry.args[0]}</code>
        </div>
      )}

      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {CLIENTS.map(({ id, label }) => (
          <li key={id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{label()}</div>
              <div className="text-xs text-muted-foreground">
                {detect ? renderStatusText(detect[id]) : '…'}
              </div>
            </div>
            <ClientAction
              id={id}
              status={detect?.[id]}
              disabled={!enabled || actionPending}
              onConfigure={() => configureMut.mutate(id)}
              onRemove={() => removeMut.mutate(id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function clientLabel(id: McpClientId): string {
  switch (id) {
    case 'claudeDesktop':
      return m.settings_mcp_client_claude_desktop();
    case 'claudeCode':
      return m.settings_mcp_client_claude_code();
    case 'cursor':
      return m.settings_mcp_client_cursor();
    case 'pi':
      return m.settings_mcp_client_pi();
  }
}

function renderStatusText(s: McpClientStatus | undefined): string {
  if (!s) return '';
  if (!s.installed) return m.settings_mcp_status_not_installed();
  if ('error' in s) return m.settings_mcp_status_invalid_json();
  if (!s.configured) return m.settings_mcp_status_not_configured();
  if (s.entryDiffersFromCurrent) return m.settings_mcp_status_needs_reconfigure();
  return m.settings_mcp_status_configured();
}

function ClientAction({
  id,
  status,
  disabled,
  onConfigure,
  onRemove,
}: {
  id: McpClientId;
  status: McpClientStatus | undefined;
  disabled: boolean;
  onConfigure: () => void;
  onRemove: () => void;
}) {
  if (id === 'pi') return <PiSetupButton />;
  // Not installed / unreadable config → no actionable button. We surface
  // the diagnostic in the status row above; the UI shows a dash so the
  // column is visually populated.
  if (!status?.installed || 'error' in status) {
    return (
      <Button size="sm" variant="outline" disabled>
        {m.settings_mcp_action_unavailable()}
      </Button>
    );
  }
  if (!status.configured) {
    return (
      <Button size="sm" disabled={disabled} onClick={onConfigure}>
        {m.settings_mcp_action_configure()}
      </Button>
    );
  }
  if (status.entryDiffersFromCurrent) {
    // Stale binary path — offer Reconfigure (primary) + Remove (escape
    // hatch) side by side so the user isn't railroaded into accepting
    // the rewrite if they're tracking a different install on purpose.
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={disabled} onClick={onConfigure}>
          {m.settings_mcp_action_reconfigure()}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onRemove}>
          {m.settings_mcp_action_remove()}
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="outline" disabled={disabled} onClick={onRemove}>
      {m.settings_mcp_action_remove()}
    </Button>
  );
}

/**
 * Pi has no native mcpServers config — we point the user at the
 * `pi-mcporter` bridge extension via a small in-app modal so they
 * don't have to leave Settings to find the install command.
 */
function PiSetupButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {m.settings_mcp_action_view_pi_guide()}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_mcp_pi_guide_title()}</DialogTitle>
          <DialogDescription>{m.settings_mcp_pi_guide_intro()}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>{m.settings_mcp_pi_guide_step1()}</p>
          <pre className="rounded bg-muted p-2 text-xs">pi install mavam/pi-mcporter</pre>
          <p>{m.settings_mcp_pi_guide_step2()}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rolled-own switch — there's no shadcn primitive in this project (see
 * `SourceEditDrawer` for the matching pattern). `role="switch"` +
 * `aria-checked` keeps screen readers honest; visual styling matches
 * the SourceEditDrawer toggle so the two read as one component.
 */
function MasterToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        id="mcp-enable"
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors',
          enabled ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition-transform',
            enabled ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
      <Label htmlFor="mcp-enable" className="text-sm">
        {m.settings_mcp_master_toggle()}
      </Label>
    </div>
  );
}
