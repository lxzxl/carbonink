import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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
import {
  ClipboardList,
  FileSearch,
  FileText,
  Flame,
  LayoutDashboard,
  ScrollText,
  Settings as SettingsIcon,
  Sliders,
} from 'lucide-react';

/**
 * New AppSidebar (UI redesign Phase A) — wires our nav data to shadcn's
 * SidebarProvider/Sidebar primitive set. Mirrors the existing flat IA for
 * now so the rest of the app keeps working unchanged; Phase B introduces
 * the Inventory/Documents/Questionnaires grouping.
 *
 * Why shadcn primitives instead of rolling our own (per the redesign plan):
 *   - Built-in collapsible state (offcanvas / icon / hidden) + cookie
 *     persistence + Cmd/Ctrl+B hotkey + mobile Sheet fallback.
 *   - Tooltip on collapsed-icon-mode without extra wiring.
 *   - SidebarMenuButton's `isActive` prop handles selected-row treatment
 *     using our `--sidebar-accent` token.
 *
 * Native-feel notes: the `--sidebar` token resolves to `transparent` so
 * the macOS vibrancy / Windows mica blur shows through. The accent on
 * the selected row is `--sidebar-accent` (foreground/6) — calmer than the
 * old `bg-primary` filled-green. Matches Round 1 sidebar treatment.
 */

type NavItem = {
  id: string;
  to: string;
  icon: typeof LayoutDashboard;
  label: () => string;
};

const PRIMARY_NAV: ReadonlyArray<NavItem> = [
  { id: 'dashboard', to: '/', icon: LayoutDashboard, label: m.nav_dashboard },
  { id: 'sources', to: '/sources', icon: Sliders, label: m.nav_sources },
  { id: 'activities', to: '/activities', icon: Flame, label: m.nav_activities },
  { id: 'documents', to: '/documents', icon: FileText, label: m.nav_documents },
  { id: 'questionnaires', to: '/questionnaires', icon: ClipboardList, label: m.nav_questionnaires },
  { id: 'reports', to: '/reports', icon: ScrollText, label: m.reports_nav },
  { id: 'audit', to: '/audit', icon: FileSearch, label: m.audit_nav },
];

export function AppSidebar() {
  const pathname = useLocation({ select: (s) => s.pathname });
  const mcpStatus = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/60">
      <SidebarHeader>
        {/* macOS hiddenInset reserves the top ~32px for traffic lights.
         * The titlebar-region drag div in __root.tsx covers the same band,
         * so this header just gives the brand wordmark a comfortable
         * top inset. */}
        <div className="px-2 pt-8 pb-2 text-lg font-semibold">{m.app_title()}</div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {PRIMARY_NAV.map((item) => {
                const Icon = item.icon;
                // Active rule: dashboard matches exact "/"; all others
                // match by-prefix so detail routes (e.g. /documents/abc)
                // still light up their parent nav.
                const isActive = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label()}>
                      <Link to={item.to}>
                        <Icon />
                        <span>{item.label()}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith('/settings')}
              tooltip={m.nav_settings()}
            >
              <Link to="/settings" aria-label={m.nav_settings()}>
                <SettingsIcon />
                <span>{m.nav_settings()}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
