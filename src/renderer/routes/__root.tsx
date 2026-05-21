import { AppSidebar } from '@renderer/components/AppSidebar';
import { CommandPalette } from '@renderer/components/command-palette';
import { LicenseBanner } from '@renderer/components/LicenseBanner';
import { Header } from '@renderer/components/layout/header';
import { NavArrows } from '@renderer/components/layout/nav-arrows';
import { NavigationProgress } from '@renderer/components/layout/navigation-progress';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * Root layout — shadcn-admin template adoption.
 *
 * Print-render bypass remains (hidden BrowserWindow for printToPDF must
 * render content-only).
 *
 * Otherwise:
 *
 *   <SidebarProvider>
 *     <NavigationProgress />            ← route transition bar
 *     <AppSidebar />                    ← shadcn-admin layout pattern
 *     <SidebarInset>
 *       <Header><NavArrows /></Header>  ← chrome row, children-slot
 *       <LicenseBanner />
 *       <div @container/content overflow-auto>  ← scroll container
 *         <Outlet />
 *       </div>
 *       <CommandPalette />
 *     </SidebarInset>
 *   </SidebarProvider>
 *
 * The scroll container declares `@container/content` so any
 * `<Main fluid={false}>` inside (the shadcn-admin Main wrapper) can
 * cap content at `max-w-7xl` only once the named container reaches
 * `@7xl` (≈80rem). On a laptop the cap is never reached so layout is
 * unaffected; on a 32" external display it prevents dashboard cards
 * from stretching ~3000px edge-to-edge.
 *
 * Single-pane routes currently rely on the `p-6` on this scroll div
 * for their inset. A follow-up may move that into per-route `<Main>`
 * wrappers (so two-pane routes don't need the `-m-6` break-out hack);
 * for now the global p-6 stays to keep the diff small.
 */
function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === '/print-render') {
    return <Outlet />;
  }

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
        <Header>
          <NavArrows />
        </Header>
        <LicenseBanner />
        {/* `@container/content` lets nested `<Main>` opt-in to the
         * `@7xl/content:max-w-7xl` cap. `flex-1 min-h-0 overflow-auto`
         * makes this the scroll container. `p-6` stays for single-pane
         * routes; two-pane routes break out with `-m-6`. */}
        <div className="@container/content flex-1 min-h-0 overflow-auto p-6">
          <Outlet />
        </div>
        <CommandPalette />
      </SidebarInset>
    </SidebarProvider>
  );
}
