import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { appApi } from '@renderer/lib/api/app';
import { cacheApi, dataApi } from '@renderer/lib/api/data';
import { formatBytes } from '@renderer/lib/format';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArchiveRestore,
  Calendar,
  Database,
  Download,
  FolderOpen,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';

/**
 * Settings → Data. Three groups, each a self-contained card with the
 * same header / body / button rhythm.
 *
 * Group ordering deliberately matches user mental model:
 *   1. Backup & restore (most common, low-risk)
 *   2. Cache (intermediate-risk, common cleanup)
 *   3. Reset (destructive, requires typed confirmation)
 *
 * Reset uses a typed-text guard ("RESET") rather than a vanilla
 * confirm dialog because the action is irreversible. Native confirm()
 * is too click-and-forget for "delete every activity record you
 * have".
 */
export function DataSection() {
  const queryClient = useQueryClient();

  const cacheStats = useQuery({
    queryKey: ['cache:get-stats'],
    queryFn: cacheApi.getStats,
    // Refetch when the user clicks Clear — see the mutation onSuccess
    // below — but also periodically refresh so stale numbers don't
    // confuse a user who left this tab open while doing other work.
    refetchInterval: 30_000,
  });

  const exportMutation = useMutation({
    mutationFn: dataApi.exportBackup,
    onSuccess: (result) => {
      if ('canceled' in result) return;
      if (result.ok) {
        toast.success(m.settings_data_export_success(), {
          description: `${result.path} · ${formatBytes(result.bytes_written)}`,
        });
      } else {
        toast.error(m.settings_data_export_failed(), { description: result.error });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.settings_data_export_failed(), { description: msg });
    },
  });

  const importMutation = useMutation({
    mutationFn: dataApi.importBackup,
    onSuccess: (result) => {
      if ('canceled' in result) return;
      if (result.ok) {
        toast.success(m.settings_data_import_success());
      } else {
        toast.error(m.settings_data_import_failed(), { description: result.error });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.settings_data_import_failed(), { description: msg });
    },
  });

  const clearCacheMutation = useMutation({
    mutationFn: cacheApi.clearExtractionRaw,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['cache:get-stats'] });
      toast.success(
        m.settings_data_cache_clear_success({
          rows: String(result.rows_cleared),
          size: formatBytes(result.bytes_freed),
        }),
      );
    },
  });

  const requestImport = () => {
    if (window.confirm(m.settings_data_import_confirm())) {
      importMutation.mutate();
    }
  };

  return (
    <div className="space-y-6">
      {/* Group 1: Backup & restore */}
      <DataGroup
        heading={m.settings_data_backup_heading()}
        body={m.settings_data_backup_body()}
        icon={<ArchiveRestore className="h-4 w-4" />}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {m.settings_data_export_button()}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={importMutation.isPending}
            onClick={requestImport}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            {m.settings_data_import_button()}
          </Button>
        </div>
      </DataGroup>

      {/* Group 2: Cache */}
      <DataGroup
        heading={m.settings_data_cache_heading()}
        body={m.settings_data_cache_body()}
        icon={<Database className="h-4 w-4" />}
      >
        <div className="space-y-3">
          {cacheStats.data && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <dt>{m.settings_data_db_size()}</dt>
              <dd className="font-mono tabular-nums">
                {formatBytes(cacheStats.data.db_file_bytes)}
              </dd>
            </dl>
          )}
          <p className="text-sm text-muted-foreground">
            {(cacheStats.data?.extraction_raw_count ?? 0) === 0
              ? m.settings_data_cache_extraction_empty()
              : m.settings_data_cache_extraction_summary({
                  count: String(cacheStats.data?.extraction_raw_count ?? 0),
                  size: formatBytes(cacheStats.data?.extraction_raw_bytes ?? 0),
                })}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={
              clearCacheMutation.isPending || (cacheStats.data?.extraction_raw_count ?? 0) === 0
            }
            onClick={() => clearCacheMutation.mutate()}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {m.settings_data_cache_clear_button()}
          </Button>
        </div>
      </DataGroup>

      {/* Group 3: Auto-backup — purely informational + folder shortcut. */}
      <AutoBackupGroup />

      {/* Group 4: Reset — destructive, typed confirmation. */}
      <ResetGroup />
    </div>
  );
}

/**
 * Shared layout for each data-management section. Light card with an
 * icon-titled heading + body explanation + custom action area below.
 */
function DataGroup({
  heading,
  body,
  icon,
  children,
}: {
  heading: string;
  body: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card/30 p-4">
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {heading}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Auto-backup group. Behavior lives in the main process (runs on app
 * boot if >23h since the last one); this card just describes the
 * feature and provides a button to reveal the folder in the OS file
 * manager so users can confirm backups exist and grab one to copy
 * off-machine if they want.
 */
function AutoBackupGroup() {
  const openMutation = useMutation({
    mutationFn: appApi.openAutoBackupDir,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(m.settings_data_auto_backup_open_failed(), { description: result.error });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.settings_data_auto_backup_open_failed(), { description: msg });
    },
  });
  return (
    <DataGroup
      heading={m.settings_data_auto_backup_heading()}
      body={m.settings_data_auto_backup_body()}
      icon={<Calendar className="h-4 w-4" />}
    >
      <Button
        type="button"
        variant="outline"
        onClick={() => openMutation.mutate()}
        disabled={openMutation.isPending}
        className="gap-2"
      >
        <FolderOpen className="h-4 w-4" />
        {m.settings_data_auto_backup_open()}
      </Button>
    </DataGroup>
  );
}

/**
 * The Reset group lives in its own component because the typed
 * confirmation needs local state (the typed value) and resetting the
 * input on completion. Visual treatment uses a destructive palette
 * (amber border) to signal danger separately from the other groups.
 */
function ResetGroup() {
  const [confirmText, setConfirmText] = useState('');
  const resetMutation = useMutation({
    mutationFn: dataApi.reset,
  });
  const isArmed = confirmText.trim().toUpperCase() === 'RESET';

  return (
    <section className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {m.settings_data_reset_heading()}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {m.settings_data_reset_body()}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-confirm" className="text-xs">
          {m.settings_data_reset_confirm_input()}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="reset-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="RESET"
            className="max-w-[200px] font-mono uppercase"
            autoComplete="off"
            spellCheck={false}
            disabled={resetMutation.isPending}
          />
          <Button
            type="button"
            variant="destructive"
            disabled={!isArmed || resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {resetMutation.isPending
              ? m.settings_data_reset_inflight()
              : m.settings_data_reset_confirm()}
          </Button>
        </div>
      </div>
    </section>
  );
}
