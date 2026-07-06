import type { UpdateStatus } from '@main/updater/auto-updater';
import { Button } from '@renderer/components/ui/button';
import { updaterApi } from '@renderer/lib/api/updater';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Settings page "Software Updates" section (Phase 5).
 *
 * Shows current app version, update status, and action buttons.
 * Subscribes to `updater:status` push events for real-time progress;
 * the initial value comes from the `updater:get-status` invoke channel.
 */
export function UpdateSection() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['updater:get-status'],
    queryFn: updaterApi.getStatus,
  });

  // Subscribe to push events and update the query cache in real-time so
  // every consumer of the `updater:get-status` query key (only this
  // section today) sees fresh data without re-invoking.
  useEffect(() => {
    return subscribe('updater:status', (status) => {
      queryClient.setQueryData(['updater:get-status'], status);
    });
  }, [queryClient]);

  const check = useMutation({
    mutationFn: updaterApi.check,
  });

  const install = useMutation({
    mutationFn: updaterApi.install,
  });

  const status: UpdateStatus = statusQuery.data ?? { state: 'idle' };
  // `__APP_VERSION__` is declared as `string` in `src/renderer/env.d.ts`
  // and substituted by Vite at build time (see `electron.vite.config.ts`
  // `define`), so no runtime guard is needed here.
  const version = __APP_VERSION__;

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-3">
      <h3 className="text-sm font-medium">{m.updater_section_heading()}</h3>
      <p className="text-sm text-muted-foreground">{m.updater_section_subheading()}</p>

      <p className="text-xs text-muted-foreground">{m.updater_current_version({ version })}</p>

      <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
        <StatusMessage status={status} />
      </div>

      <div className="flex gap-2">
        {(status.state === 'idle' ||
          status.state === 'not-available' ||
          status.state === 'error') && (
          <Button
            type="button"
            variant="outline"
            onClick={() => check.mutate()}
            disabled={check.isPending}
          >
            {m.updater_check_button()}
          </Button>
        )}

        {status.state === 'downloaded' && (
          <Button type="button" onClick={() => install.mutate()} disabled={install.isPending}>
            {m.updater_install_button()}
          </Button>
        )}

        {status.state === 'available-manual' && (
          <Button
            type="button"
            onClick={() => window.open(`https://${m.updater_download_url()}`, '_blank')}
          >
            {m.updater_download_button()}
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusMessage({ status }: { status: UpdateStatus }) {
  switch (status.state) {
    case 'idle':
      return <p className="text-muted-foreground">{m.updater_status_idle()}</p>;
    case 'checking':
      return <p className="text-muted-foreground">{m.updater_status_checking()}</p>;
    case 'available':
      return <p>{m.updater_status_available({ version: status.version })}</p>;
    case 'available-manual':
      return <p>{m.updater_status_available_manual({ version: status.version })}</p>;
    case 'not-available':
      return <p className="text-muted-foreground">{m.updater_status_not_available()}</p>;
    case 'downloading':
      return <p>{m.updater_status_downloading({ percent: String(status.percent) })}</p>;
    case 'downloaded':
      return (
        <p className="text-primary">{m.updater_status_downloaded({ version: status.version })}</p>
      );
    case 'error':
      return (
        <p className="text-destructive">{m.updater_status_error({ message: status.message })}</p>
      );
  }
}
