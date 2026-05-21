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
 * AppTitle — sidebar header for carbonbook. Adapted from shadcn-admin.
 *
 * Layout: Leaf icon + "carbonbook" wordmark. In icon-collapsed mode the
 * wordmark hides (group-data-[collapsible=icon]:hidden) and shadcn's
 * sidebar CSS automatically centers the lone icon child of
 * SidebarMenuButton.
 *
 * Why this is flat (icon + span as DIRECT children of the asChild
 * target, no wrapping div):
 *
 * shadcn's SidebarMenuButton applies `flex items-center justify-center
 * group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2`
 * rules — they assume the icon is a direct child. If you nest the icon
 * inside an extra <div>, the parent flex layout centers the wrapper
 * div instead of the icon itself, and (because the inner flex has its
 * own gap-2 + an invisible-via-display:none span) the icon ends up
 * left of center by half the gap.
 *
 * Previous version had `<Link><div flex gap-2><Leaf /><span/></div></Link>`
 * which produced exactly that visible left-shift in collapsed mode.
 * Flattening fixes it without touching the primitive.
 *
 * No embedded sidebar-toggle: carbonbook's toggle lives in the Header
 * chrome row, not inside the sidebar header (would sit behind the
 * macOS traffic-light cluster when collapsed).
 */
export function AppTitle() {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="gap-2 hover:bg-transparent active:bg-transparent"
          asChild
        >
          <Link to="/" onClick={() => setOpenMobile(false)}>
            <Leaf className="size-5 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
            <span className="truncate font-bold group-data-[collapsible=icon]:hidden">
              {m.app_title()}
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
