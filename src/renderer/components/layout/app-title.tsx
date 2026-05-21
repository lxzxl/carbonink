import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@renderer/components/ui/sidebar';
import * as m from '@renderer/paraglide/messages';
import { Link } from '@tanstack/react-router';
import { Leaf } from 'lucide-react';

/**
 * AppTitle — sidebar header for carbonbook. Adapted from shadcn-admin's
 * AppTitle (which has a ToggleSidebar slot embedded in the title row).
 *
 * Differences from upstream:
 *   - No embedded ToggleSidebar — carbonbook puts the sidebar toggle in
 *     the TopBar instead, so the user can collapse the sidebar without
 *     hovering over its header (which sits behind the macOS traffic
 *     lights when collapsed).
 *   - The title row uses a Leaf icon + "carbonbook" wordmark + tagline
 *     ("GHG accounting") instead of the shadcn-admin generic title.
 *   - Header is padded `pt-11 pb-3` at the wrapping `<SidebarHeader>`
 *     in `AppSidebar` to clear the macOS traffic-light cluster (cluster
 *     bottom ≈ y=28; we want ≥16px clearance below).
 */
export function AppTitle() {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="gap-2 py-0 hover:bg-transparent active:bg-transparent"
          asChild
        >
          <Link
            to="/"
            onClick={() => setOpenMobile(false)}
            className="grid flex-1 text-start text-sm leading-tight"
          >
            <div className="flex items-center gap-2">
              <Leaf className="size-5 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
              <span className="truncate font-bold group-data-[collapsible=icon]:hidden">
                {m.app_title()}
              </span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
