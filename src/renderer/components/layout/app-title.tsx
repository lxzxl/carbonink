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
 * AppTitle — sidebar header for carbonbook.
 *
 * Expanded layout (sidebar wide):
 *
 *   ┌──┐
 *   │🍃│ carbonbook         ← font-semibold, tracking-tight
 *   └──┘ 本地碳核算          ← subtitle, muted-foreground
 *
 * Collapsed layout (icon-only sidebar):
 *
 *   ┌──┐
 *   │🍃│                    ← only the boxed mark; text-wrapper hides
 *   └──┘
 *
 * Why a boxed mark (rounded square + tinted bg) instead of a bare Leaf:
 *
 * A bare lucide icon read as utility-class chrome (same visual weight
 * as the nav-row icons below it). Giving the brand mark its own
 * container — `bg-primary/15` tinted square with the Leaf inside —
 * establishes a clear "this is the app icon, that's nav" hierarchy
 * without needing a separate divider. The subtitle adds one line of
 * concrete identity ("本地碳核算" / "Local GHG accounting") so a
 * fresh user immediately knows what app they're in.
 *
 * Collapsed-mode notes (mirrors globals.css `[data-collapsible=icon]
 * [data-sidebar=menu-button] > span { display: none }`):
 *
 * - The text wrapper is a `<span>` so the global rule hides it cleanly
 *   in collapsed mode. No extra `group-data-[collapsible=icon]:hidden`
 *   needed.
 * - The boxed mark is a `<div>` (NOT a span) so the same rule LEAVES
 *   IT ALONE. Critically, the div contains ONLY the icon — no gap, no
 *   sibling — so when shadcn's `justify-content: center !important`
 *   fires in collapsed mode it centers a div the same width as the
 *   icon. The previous bare-Leaf version paired with a sibling
 *   `<span>` (now hidden, but width-0 either way); the new version is
 *   equivalent — but documents the constraint inline.
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
          className="gap-2.5 hover:bg-transparent active:bg-transparent"
          asChild
        >
          <Link to="/" onClick={() => setOpenMobile(false)}>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Leaf className="size-4" strokeWidth={2.25} aria-hidden="true" />
            </div>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-base font-semibold tracking-tight text-foreground">
                {m.app_title()}
              </span>
              <span className="truncate text-xs text-muted-foreground">{m.app_tagline()}</span>
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
