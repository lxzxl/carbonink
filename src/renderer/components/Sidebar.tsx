import { mcpApi } from '@renderer/lib/api/mcp';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Settings as SettingsIcon } from 'lucide-react';

export function Sidebar() {
  // Poll MCP status every 10 seconds to show binary build + Claude config state.
  const mcpStatus = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  return (
    <nav className="flex h-full w-56 flex-col border-r border-border/60 bg-transparent px-4 pt-12 pb-4">
      {/* bg-transparent (not bg-muted/30) so the OS sidebar-vibrancy
       * shows through cleanly. The border-r at 60% opacity keeps the
       * column edge soft — a hard 1px line over vibrancy looks dated. */}
      <h2 className="mb-6 text-lg font-semibold">{m.app_title()}</h2>
      <ul className="space-y-1 flex-1">
        <li>
          <Link
            to="/"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-foreground/5',
              '[&.active]:bg-primary/15 [&.active]:text-primary [&.active]:font-medium',
            )}
          >
            {m.nav_dashboard()}
          </Link>
        </li>
        <li>
          <Link
            to="/sources"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-foreground/5',
              '[&.active]:bg-primary/15 [&.active]:text-primary [&.active]:font-medium',
            )}
          >
            {m.nav_sources()}
          </Link>
        </li>
        <li>
          <Link
            to="/activities"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-foreground/5',
              '[&.active]:bg-primary/15 [&.active]:text-primary [&.active]:font-medium',
            )}
          >
            {m.nav_activities()}
          </Link>
        </li>
        <li>
          <Link
            to="/documents"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-foreground/5',
              '[&.active]:bg-primary/15 [&.active]:text-primary [&.active]:font-medium',
            )}
          >
            {m.nav_documents()}
          </Link>
        </li>
        <li>
          <Link
            to="/questionnaires"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-foreground/5',
              '[&.active]:bg-primary/15 [&.active]:text-primary [&.active]:font-medium',
            )}
          >
            {m.nav_questionnaires()}
          </Link>
        </li>
        <li>
          <Link
            to="/reports"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-foreground/5',
              '[&.active]:bg-primary/15 [&.active]:text-primary [&.active]:font-medium',
            )}
          >
            {m.reports_nav()}
          </Link>
        </li>
        <li>
          <Link
            to="/audit"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-foreground/5',
              '[&.active]:bg-primary/15 [&.active]:text-primary [&.active]:font-medium',
            )}
          >
            {m.audit_nav()}
          </Link>
        </li>
      </ul>
      {/* MCP status chip + Settings link — both navigate to the Settings page.
       * MCP chip shows binary build + Claude config state with a colored dot. */}
      <div className="mt-auto pt-4 border-t border-border/50 space-y-1">
        {mcpStatus.data && (
          <Link
            to="/settings"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-foreground/5"
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                mcpStatus.data.claude_config_references_us
                  ? 'bg-green-500'
                  : mcpStatus.data.binary_built
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground/40',
              )}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              {mcpStatus.data.claude_config_references_us
                ? m.sidebar_mcp_label_available()
                : mcpStatus.data.binary_built
                  ? m.sidebar_mcp_label_pending()
                  : m.sidebar_mcp_label_not_built()}
            </span>
          </Link>
        )}
        <Link
          to="/settings"
          aria-label={m.nav_settings()}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            '[&.active]:bg-primary/15 [&.active]:text-primary',
          )}
        >
          <SettingsIcon className="h-4 w-4" />
          <span className="text-xs">{m.nav_settings()}</span>
        </Link>
      </div>
    </nav>
  );
}
