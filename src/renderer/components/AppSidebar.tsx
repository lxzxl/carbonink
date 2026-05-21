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
import { Link } from '@tanstack/react-router';

/**
 * AppSidebar — adopted from the shadcn-admin layout pattern.
 *
 * Structure:
 *   <Sidebar collapsible="icon">
 *     <SidebarHeader>        — Leaf + "carbonbook" wordmark (AppTitle)
 *     <SidebarContent>       — N x NavGroup, driven by sidebar-data.ts
 *     <SidebarFooter>        — MCP status indicator
 *   </Sidebar>
 *
 * Differences from upstream shadcn-admin:
 *   - No `<TeamSwitcher>` — single org, no multi-tenancy.
 *   - No `<NavUser>` — no auth / sign-out (single-user desktop app).
 *   - No `<SidebarRail>` — fixed-width column. Drag-to-resize would
 *     conflict with the macOS hiddenInset traffic-light cluster
 *     (x=18-72) when the sidebar is collapsed.
 *   - `SidebarHeader` has `pt-11 pb-3` to clear macOS traffic lights
 *     (cluster bottom ≈ y=28 + 16px breathing room = 44px top padding).
 *   - Footer carries an MCP status pill instead of `<NavUser>` — tells
 *     users whether their Claude config can reach the embedded MCP
 *     server, which is more useful for our user than "signed in as".
 */
export function AppSidebar() {
  const mcpStatus = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

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
          {mcpStatus.data && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={m.sidebar_mcp_label_available()}>
                <Link to="/settings" className="text-xs">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
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
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
