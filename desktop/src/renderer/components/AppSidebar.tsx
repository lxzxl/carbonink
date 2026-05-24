import { AppTitle } from '@renderer/components/layout/app-title';
import { NavGroup } from '@renderer/components/layout/nav-group';
import { sidebarData } from '@renderer/components/layout/sidebar-data';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@renderer/components/ui/sidebar';
import { mcpApi } from '@renderer/lib/api/mcp';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { Settings as SettingsIcon } from 'lucide-react';

/**
 * AppSidebar — adopted from the shadcn-admin layout pattern.
 *
 *   <Sidebar collapsible="icon">
 *     <SidebarHeader>     — Leaf + "carbonink" wordmark (AppTitle)
 *     <SidebarContent>    — N x NavGroup, driven by sidebar-data.ts
 *     <SidebarFooter>     — Settings link with inline MCP status dot
 *   </Sidebar>
 *
 * Footer choice — single Settings item, with MCP status as a trailing
 * colored dot rather than its own row. Previously the footer had two
 * items (an MCP status pill + a Settings button), and both linked to
 * /settings — when the sidebar collapsed to icon mode this rendered
 * as two stacked icons going to the same destination. Now: one row,
 * one click target, status visible inline.
 *
 * The MCP dot hides in icon-collapsed mode (the button shrinks to its
 * icon-only width with no room for trailing content; the gear icon
 * itself communicates "settings" sufficiently for the collapsed
 * state).
 *
 * Differences from upstream shadcn-admin:
 *   - No `<TeamSwitcher>` — single org.
 *   - No `<NavUser>` — no auth / sign-out (single-user desktop).
 *   - No `<SidebarRail>` — fixed-width collapse instead, to avoid
 *     conflict with the macOS hiddenInset traffic-light cluster
 *     (x=18-72) when the sidebar is collapsed.
 *   - `SidebarHeader` has `pt-11 pb-3` to clear macOS traffic lights.
 */
export function AppSidebar() {
  const pathname = useLocation({ select: (s) => s.pathname });
  const mcpStatus = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const mcp = mcpStatus.data;
  const mcpDotClass = mcp
    ? mcp.claude_config_references_us
      ? 'bg-green-500'
      : mcp.binary_built
        ? 'bg-amber-500'
        : 'bg-muted-foreground/40'
    : '';
  const mcpStatusLabel = mcp
    ? mcp.claude_config_references_us
      ? m.sidebar_mcp_label_available()
      : mcp.binary_built
        ? m.sidebar_mcp_label_pending()
        : m.sidebar_mcp_label_not_built()
    : '';

  return (
    <Sidebar collapsible="icon">
      {/* pt-11 clears the macOS traffic-light cluster; pb-3 gives a
       * 12px gap between brand row and first nav group. */}
      <SidebarHeader className="pt-11 pb-3">
        <AppTitle />
      </SidebarHeader>

      <SidebarContent>
        {sidebarData.navGroups.map((group) => (
          <NavGroup key={group.title} {...group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith('/settings')}
              tooltip={m.nav_settings()}
            >
              <Link to="/settings" aria-label={m.nav_settings()}>
                <SettingsIcon />
                <span>{m.nav_settings()}</span>
                {mcp && (
                  <span
                    role="status"
                    aria-label={mcpStatusLabel}
                    title={mcpStatusLabel}
                    className={cn(
                      // ms-auto pushes the dot to the trailing edge of
                      // the expanded button. Hidden in icon-collapsed
                      // mode so it doesn't fight for the centered icon
                      // slot (no room for trailing content in a square
                      // 32px button).
                      'ms-auto h-2 w-2 rounded-full shrink-0 group-data-[collapsible=icon]:hidden',
                      mcpDotClass,
                    )}
                  />
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
