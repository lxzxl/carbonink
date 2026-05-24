import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { appApi } from '@renderer/lib/api/app';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';

/**
 * Settings → About. Surfaces version + runtime info for support, plus
 * the "open data folder" action that power users + the support team
 * lean on heavily ("could you send me your sqlite file?").
 *
 * Layout: definition list (label → value) for version info, then a
 * row of action buttons (Open data folder, Visit website, Email
 * support). The definition list pattern reads as data, not chrome —
 * matches how macOS System Settings / Activity Monitor display
 * version blocks.
 */
export function AboutSection() {
  const infoQuery = useQuery({
    queryKey: ['app:get-info'],
    queryFn: appApi.getInfo,
  });

  const openDir = useMutation({
    mutationFn: appApi.openDataDir,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(m.settings_about_open_data_dir_failed(), {
          description: result.error,
        });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.settings_about_open_data_dir_failed(), { description: msg });
    },
  });

  const openLogDir = useMutation({
    mutationFn: appApi.openLogDir,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(m.settings_about_open_log_dir_failed(), { description: result.error });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.settings_about_open_log_dir_failed(), { description: msg });
    },
  });

  const info = infoQuery.data;
  if (!info) return null;

  return (
    <div className="space-y-6">
      {/* Version block — definition-list pattern. Two columns: label /
       * value. tabular-nums on values keeps version numbers aligned. */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{m.settings_about_app_name()}</dt>
        <dd className="font-medium">
          {info.name} <span className="text-muted-foreground">·</span>{' '}
          <span className="tabular-nums">v{info.version}</span>
        </dd>

        <dt className="text-muted-foreground">{m.settings_about_electron()}</dt>
        <dd className="tabular-nums">{info.electron_version}</dd>

        <dt className="text-muted-foreground">{m.settings_about_node()}</dt>
        <dd className="tabular-nums">{info.node_version}</dd>

        <dt className="text-muted-foreground">{m.settings_about_chrome()}</dt>
        <dd className="tabular-nums">{info.chrome_version}</dd>

        <dt className="text-muted-foreground">{m.settings_about_platform()}</dt>
        <dd>
          {info.platform} <span className="text-muted-foreground">·</span> {info.arch}
        </dd>

        <dt className="text-muted-foreground">{m.settings_about_user_data()}</dt>
        <dd className="font-mono text-xs break-all">{info.user_data_dir}</dd>
      </dl>

      {/* Actions row — visible affordances for the most common support
       * paths. Open data folder uses an outline button (utility
       * action), website + support are text-style links (informational). */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => openDir.mutate()}
            disabled={openDir.isPending}
            className="gap-2"
          >
            <FolderOpen className="h-4 w-4" />
            {m.settings_about_open_data_dir()}
          </Button>
          <p className="text-xs text-muted-foreground">{m.settings_about_open_data_dir_hint()}</p>
        </div>

        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => openLogDir.mutate()}
            disabled={openLogDir.isPending}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            {m.settings_about_open_log_dir()}
          </Button>
          <p className="text-xs text-muted-foreground">{m.settings_about_open_log_dir_hint()}</p>
        </div>

        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm pt-2 border-t border-border">
          <dt className="text-muted-foreground pt-2">{m.settings_about_support_label()}</dt>
          <dd className="pt-2">
            <a
              href={`mailto:${m.settings_about_support_email()}`}
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              {m.settings_about_support_email()}
              <ExternalLink className="h-3 w-3" />
            </a>
          </dd>

          <dt className="text-muted-foreground">{m.settings_about_website_label()}</dt>
          <dd>
            <button
              type="button"
              onClick={() => window.open(`https://${m.settings_about_website_url()}`, '_blank')}
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              {m.settings_about_website_url()}
              <ExternalLink className="h-3 w-3" />
            </button>
          </dd>
        </div>
      </div>
    </div>
  );
}
