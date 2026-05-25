import { AppSidebar } from '@renderer/components/AppSidebar';
import { CommandPalette } from '@renderer/components/command-palette';
import { LicenseBanner } from '@renderer/components/LicenseBanner';
import { Header } from '@renderer/components/layout/header';
import { NavArrows } from '@renderer/components/layout/nav-arrows';
import { NavigationProgress } from '@renderer/components/layout/navigation-progress';
import { ScrollProvider } from '@renderer/components/layout/scroll-context';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';
import { useUndo } from '@renderer/lib/use-undo';
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { type UIEvent, useState } from 'react';

export const Route = createRootRoute({
  component: RootComponent,
});

const SCROLL_SHADOW_THRESHOLD_PX = 10;

/**
 * Root layout — shadcn-admin template adoption.
 *
 * Print-render bypass remains (hidden BrowserWindow for printToPDF must
 * render content-only).
 *
 * Otherwise:
 *
 *   <SidebarProvider>
 *     <NavigationProgress />              ← route transition bar
 *     <AppSidebar />                      ← data-driven nav groups
 *     <SidebarInset>
 *       <ScrollProvider>                  ← lifts scroll-past-threshold
 *         <Header><NavArrows /></Header>  ← gets shadow when scrolled
 *         <LicenseBanner />
 *         <div @container/content overflow-auto onScroll>
 *           <Outlet />
 *         </div>
 *       </ScrollProvider>
 *       <CommandPalette />
 *     </SidebarInset>
 *   </SidebarProvider>
 *
 * The `@container/content` named container lets nested `<Main>` opt
 * into `@7xl/content:max-w-7xl` capping on wide displays.
 *
 * `ScrollProvider` exposes a boolean ("has scroll passed the chrome
 * threshold?") that `Header` reads to decide whether to render a soft
 * shadow. We only flip the boolean when the scroll crosses 10px, so
 * the Outlet content tree doesn't re-render on every scroll pixel.
 */
function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [scrolled, setScrolled] = useState(false);

  // Mount the undo hook once at the root so its menu:undo / menu:redo
  // subscription is live across every route. The hook returns ref-stable
  // values; not destructuring them here keeps render-cost zero for the
  // root component itself.
  useUndo();

  if (pathname === '/print-render') {
    return <Outlet />;
  }

  // Onboarding chrome strip: until the user has completed the wizard,
  // the sidebar nav + header back/forward + license chip are all
  // distractions. The wizard is linear, modal in spirit. We render
  // ONLY the page content + a minimal macOS drag region (preserves the
  // hidden-titlebar window-drag affordance) until they exit
  // `/onboarding/*`.
  //
  // The post-onboarding redirect is already handled — `index.tsx`
  // returns `<Navigate to="/onboarding/$step">` when `org:has-any` is
  // false; the wizard's last step writes the org and routes to `/`.
  // Once `pathname` flips out of `/onboarding`, the full chrome
  // returns automatically.
  if (pathname.startsWith('/onboarding')) {
    return (
      <div className="relative h-svh w-full bg-background overflow-hidden">
        {/* macOS hidden-titlebar window drag region. Overlaid at the
         * top via absolute positioning so it doesn't take a flex slot
         * and break the centering of the wizard below. `h-10` matches
         * traffic-light cluster height; `z-10` keeps it above the
         * centering layer for drag-on-empty-area to still work. */}
        <div className="titlebar-region absolute inset-x-0 top-0 h-10 z-10" aria-hidden />
        {/* Wizard centered in the full viewport. `h-svh` on the outer
         * wrapper gives this absolutely-positioned child a definite
         * height to center against. `grid place-items-center` was
         * unreliable in earlier attempts (the implicit grid track
         * sizes to content), so we use flex with `items-center
         * justify-center` — the parent is explicitly sized, so the
         * flex centering has a known target. `overflow-auto` on this
         * layer (not the parent, which clips) lets a tall step scroll
         * gracefully. */}
        <div className="absolute inset-0 flex items-center justify-center overflow-auto px-6 py-8">
          <Outlet />
        </div>
      </div>
    );
  }

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const past = event.currentTarget.scrollTop > SCROLL_SHADOW_THRESHOLD_PX;
    // Only commit a state update when we actually cross the threshold.
    // setState bails out on identical values but the comparison-then-skip
    // also dodges allocating an event-bound closure in the React queue.
    if (past !== scrolled) setScrolled(past);
  };

  return (
    // h-svh (not min-h-svh, shadcn's default) caps the outer wrapper's
    // height to the viewport. Without this cap, `flex-1 overflow-auto`
    // inside doesn't actually clip — the inner pane just expands and the
    // OUTER wrapper grows past 100vh, which is why the resizable panels
    // ended up with 0 free space and the list column squeezed to ~32 px.
    <SidebarProvider className="h-svh">
      <NavigationProgress />
      <AppSidebar />
      {/* `peer-data-[state=collapsed]:pl-2` shifts the entire inset
       * (Header + content + footer) 8px to the right when the sidebar
       * is collapsed.
       *
       * Why: in collapsed mode the sidebar is 48px wide, but the
       * macOS hiddenInset traffic-light cluster extends to x=72.
       * That leaves the strip x=48–72 inside the inset overlapped
       * by OS chrome. With the default `px-6` on Header / Main, the
       * sidebar toggle and content's first column both land at x=72
       * — flush against the green light. The 8px nudge gives ~10px
       * breathing room *and* keeps toggle and content vertically
       * aligned (both shift together).
       *
       * In expanded mode (sidebar=256px) the traffic lights are
       * entirely behind the sidebar — no overlap — so the rule
       * (gated by `peer-data-[state=collapsed]`) doesn't apply and
       * layout returns to flush 24px alignment. */}
      <SidebarInset className="flex flex-col min-h-0 peer-data-[state=collapsed]:pl-2">
        <ScrollProvider scrolled={scrolled}>
          <Header>
            <NavArrows />
          </Header>
          <LicenseBanner />
          {/* `@container/content` lets nested `<Main>` opt-in to the
           * `@7xl/content:max-w-7xl` cap on wide displays. `flex-1
           * min-h-0 overflow-auto` makes this the scroll container.
           * Padding lives in each route's `<Main>` wrapper, not here. */}
          <div className="@container/content flex-1 min-h-0 overflow-auto" onScroll={handleScroll}>
            <Outlet />
          </div>
        </ScrollProvider>
        <CommandPalette />
      </SidebarInset>
    </SidebarProvider>
  );
}
