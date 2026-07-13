import { AppTitle } from '@renderer/components/layout/app-title';
import { NavGroup } from '@renderer/components/layout/nav-group';
import { getSidebarData } from '@renderer/components/layout/sidebar-data';
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
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import { isOverdue, localToday } from '@renderer/lib/inbound-overdue';
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
  const mcpDetect = useQuery({
    queryKey: ['mcp:detect'],
    queryFn: mcpApi.detect,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  // Overdue inbound disclosures → destructive count badge on 供应商披露.
  // Shares the list route's query key, so every send/import/ingest/delete
  // mutation that invalidates ['questionnaire:list'] refreshes the badge
  // for free; window-focus refetch catches the midnight rollover.
  const disclosures = useQuery({
    queryKey: ['questionnaire:list'],
    queryFn: questionnaireApi.list,
    refetchOnWindowFocus: true,
  });
  const today = localToday();
  const overdueCount = (disclosures.data ?? []).filter(
    (r) => r.direction === 'inbound' && isOverdue(r, today),
  ).length;

  // Post-redesign the sidebar only reflects a binary "is any client
  // configured to talk to us?" — the old "not built" state isn't
  // derivable from the new IPC surface (getServerEntry always returns
  // a path), so it collapses into "pending" alongside "no client
  // configured yet". Full per-client status lives on Settings →
  // Integrations.
  const detect = mcpDetect.data;
  const anyConfigured = detect
    ? Object.values(detect).some((s) => s.installed && 'configured' in s && s.configured)
    : false;
  const mcpDotClass = detect ? (anyConfigured ? 'bg-green-500' : 'bg-amber-500') : '';
  const mcpStatusLabel = detect
    ? anyConfigured
      ? m.sidebar_mcp_label_available()
      : m.sidebar_mcp_label_pending()
    : '';

  return (
    <Sidebar collapsible="icon">
      {/* pt-11 clears the macOS traffic-light cluster; pb-3 gives a
       * 12px gap between brand row and first nav group. */}
      <SidebarHeader className="pt-11 pb-3">
        <AppTitle />
      </SidebarHeader>

      <SidebarContent>
        {getSidebarData({ supplierDisclosuresOverdue: overdueCount }).navGroups.map((group) => (
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
                {detect && (
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
