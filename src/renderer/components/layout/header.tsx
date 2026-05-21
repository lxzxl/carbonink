import { useIsScrolled } from '@renderer/components/layout/scroll-context';
import { Separator } from '@renderer/components/ui/separator';
import { SidebarTrigger } from '@renderer/components/ui/sidebar';
import { cn } from '@renderer/lib/utils';
import type { Ref } from 'react';

/**
 * Header — chrome row above the main content. Adopted from
 * shadcn-admin's `Header` component.
 *
 * Layout: [☰] | [back/forward] | [children — route-specific content]
 *
 * Adaptations from upstream:
 *   - `h-12` instead of upstream's `h-16` to preserve the previously
 *     committed content-edge alignment with `px-6` (see
 *     `17d12f5 ui(hotfix5): TopBar nav buttons align with content left
 *     edge`).
 *   - `titlebar-region` makes the bar a macOS window-drag handle; the
 *     inner `[-webkit-app-region:no-drag]` wrapper around interactive
 *     children re-enables clicks.
 *   - `px-6` matches the content area's `p-6` so the SidebarTrigger
 *     icon sits flush with content-left.
 *   - Scroll-aware shadow (the template's `offset > 10 ? shadow :
 *     shadow-none`) is deferred — the upstream listens to
 *     `document.body.scrollTop` but our scroll container is an
 *     internal `<div overflow-auto>` inside `SidebarInset`, not the
 *     document. Adding a ScrollContext is out of scope for this pass.
 *   - `bg-background` keeps the bar opaque (we dropped vibrancy in
 *     hotfix4); the soft `border-b border-border/40` is the only
 *     separator from the content below.
 *
 * Children slot: pass per-route content like breadcrumbs, search, or
 * action buttons. The Sidebar toggle + Separator render before
 * children so every route gets a consistent left edge.
 */

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  ref?: Ref<HTMLElement>;
};

export function Header({ className, children, ...props }: HeaderProps) {
  const scrolled = useIsScrolled();
  return (
    <header
      className={cn(
        'titlebar-region sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border/40 bg-background px-6 transition-shadow duration-150',
        // When the content area has scrolled past the threshold, lift
        // the bar with a soft shadow. Matches the shadcn-admin scroll-
        // aware Header pattern adapted for our internal scroll container
        // (see ScrollContext).
        scrolled && 'shadow-sm',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-3 [-webkit-app-region:no-drag]">
        {/* `variant='outline'` matches shadcn-admin's chrome treatment
         * — the visible border defines the button shape so the icon
         * doesn't read as floating chrome. `size-7 [&_svg]:size-3.5`
         * shrinks the trigger and its PanelLeftIcon to align visually
         * with the h-7 ChevronLeft/Right NavArrows that sit beside it.
         * (Without that, PanelLeft's denser geometry made the trigger
         * read as ~30% bulkier than the chevrons.) */}
        <SidebarTrigger variant="outline" className="size-7 [&_svg]:size-3.5" />
        <Separator orientation="vertical" className="h-5" />
        {children}
      </div>
    </header>
  );
}
