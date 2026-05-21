import { AppSidebar } from '@renderer/components/AppSidebar';
import { CommandPalette } from '@renderer/components/command-palette';
import { LicenseBanner } from '@renderer/components/LicenseBanner';
import { Header } from '@renderer/components/layout/header';
import { NavArrows } from '@renderer/components/layout/nav-arrows';
import { NavigationProgress } from '@renderer/components/layout/navigation-progress';
import { ScrollProvider } from '@renderer/components/layout/scroll-context';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';
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

  if (pathname === '/print-render') {
    return <Outlet />;
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
      <SidebarInset className="flex flex-col min-h-0">
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
