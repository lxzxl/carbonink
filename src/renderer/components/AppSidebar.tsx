import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
  Leaf,
  ScrollText,
  Settings as SettingsIcon,
  Sliders,
} from 'lucide-react';

/**
 * AppSidebar — UI redesign Phase B IA.
 *
 * Three-tier nav:
 *   - Top: Dashboard (no group) — the hub.
 *   - Group "Inventory" (排放清单) — the three "compute the number" routes.
 *   - Group "Inputs" (输入资料) — the data-feeding routes (documents,
 *     questionnaires). Status-filter sub-items (待审核/已确认/已否决)
 *     deferred to Phase E once the list-column query-param work lands.
 *   - Group "More" (其他) — audit log + future settings.
 *
 * The grouping mirrors how a small-team ESG manager mentally splits
 * their work: "feed the system raw data" (Inputs) vs "look at the
 * numbers" (Inventory) vs "trace what changed" (More).
 *
 * Why not nested SidebarMenuSub everywhere: shadcn's sub-menus need an
 * expand/collapse trigger per parent, which adds another click layer
 * to reach a route. SidebarGroup with a static label is one render of
 * the group title + flat list of sub-items; less interaction, better
 * for our small route count.
 */

type NavItem = {
  id: string;
  to: string;
  icon: typeof LayoutDashboard;
  label: () => string;
};

// Round 4 #13: audit log moved from a single-item "更多" group into the
// top section beside the dashboard. A single-item group with a section
// label was visual noise — the section label was longer than its only
// child.
const TOP_NAV: ReadonlyArray<NavItem> = [
  { id: 'dashboard', to: '/', icon: LayoutDashboard, label: m.nav_dashboard },
  { id: 'audit', to: '/audit', icon: FileSearch, label: m.audit_nav },
];

const INVENTORY_GROUP: ReadonlyArray<NavItem> = [
  { id: 'sources', to: '/sources', icon: Sliders, label: m.nav_sources },
  { id: 'activities', to: '/activities', icon: Flame, label: m.nav_activities },
  { id: 'reports', to: '/reports', icon: ScrollText, label: m.reports_nav },
];

const INPUTS_GROUP: ReadonlyArray<NavItem> = [
  { id: 'documents', to: '/documents', icon: FileText, label: m.nav_documents },
  { id: 'questionnaires', to: '/questionnaires', icon: ClipboardList, label: m.nav_questionnaires },
];

function isPathActive(pathname: string, to: string): boolean {
  // Dashboard matches "/" exactly; everything else matches by prefix so
  // detail routes light up their parent nav.
  if (to === '/') return pathname === '/';
  return pathname.startsWith(to);
}

function NavMenuItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = isPathActive(pathname, item.to);
  return (
    <SidebarMenuItem key={item.id}>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label()}>
        <Link to={item.to}>
          <Icon />
          <span>{item.label()}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const pathname = useLocation({ select: (s) => s.pathname });
  const mcpStatus = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  // Round 4 hotfix3: `border-r` removed from the sidebar wrapper.
  // The full-height vertical line at x = sidebar-width cut RIGHT
  // THROUGH the macOS traffic-light cluster (which spans x=18-72) in
  // icon-collapsed mode (sidebar width = 48px), creating the "menu
  // block splits the window buttons" effect the user reported.
  // Replacement: globals.css draws an absolute-positioned right
  // border via `::after` on the sidebar-container, starting at
  // top=3rem (below the traffic-light zone). Same visual divider,
  // but only below where the OS controls live.
  return (
    <Sidebar collapsible="icon">
      {/* macOS hiddenInset: traffic lights are at top:16 with ~12px
       * diameter → bottom of cluster at y≈28. Earlier I had this at
       * pt-7 (28px) which left no breathing room — brand glyph sat
       * RIGHT at the traffic-light bottom edge, especially obvious
       * in icon-collapsed mode where the leaf was practically touching
       * the green button.
       *
       * pt-11 (44px) gives ~16px clearance below the traffic lights.
       * Header layout: pt-11 (44) + brand-row (~24px content) + pb-3
       * (12) = ~80px total header height. The expanded-mode wordmark
       * + the icon-mode glyph both sit at the same y in both states. */}
      <SidebarHeader className="pt-11 pb-3">
        <div className="flex items-center gap-2 px-2">
          <Leaf className="size-5 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
          <span className="text-lg font-semibold group-data-[collapsible=icon]:hidden">
            {m.app_title()}
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Top: dashboard + audit, no group label. */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {TOP_NAV.map((item) => (
                <NavMenuItem key={item.id} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Section labels: native macOS-style "SECTION HEADER" treatment
         * (uppercase + tracking + smaller + more muted). The previous
         * implementation had Package/FileText icons + standard text-xs
         * font-medium label, which read as "clickable nav row" — the
         * icon especially fooled the eye into thinking it was a menu
         * item. Sub-items beneath looked larger than their parent
         * label, which is backwards from any list hierarchy convention.
         *
         * Now: no icon, uppercase 10px, 50% foreground opacity, extra
         * letter-spacing. Reads unambiguously as "section name". */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
            {m.nav_section_inventory()}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {INVENTORY_GROUP.map((item) => (
                <NavMenuItem key={item.id} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
            {m.nav_section_documents_questionnaires()}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {INPUTS_GROUP.map((item) => (
                <NavMenuItem key={item.id} item={item} pathname={pathname} />
              ))}
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
