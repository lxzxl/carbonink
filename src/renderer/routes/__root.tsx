import { AppSidebar } from '@renderer/components/AppSidebar';
import { TopBar } from '@renderer/components/app-shell/TopBar';
import { CommandPalette } from '@renderer/components/command-palette';
import { LicenseBanner } from '@renderer/components/LicenseBanner';
import { NavigationProgress } from '@renderer/components/layout/navigation-progress';
import { SidebarInset, SidebarProvider } from '@renderer/components/ui/sidebar';
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * Root layout — UI redesign Phase F.
 *
 * Print-render bypass remains (hidden BrowserWindow for printToPDF must
 * render content-only).
 *
 * Otherwise: SidebarProvider > AppSidebar + SidebarInset(TopBar +
 * LicenseBanner + main Outlet + CommandPalette). The TopBar component
 * now owns the chrome-row content (back/forward arrows, breadcrumb,
 * sidebar toggle); __root just composes them.
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
      {/* NavigationProgress renders a fixed-position thin bar at top:0;
       * z-index sits above everything except modal overlays. Placed
       * OUTSIDE SidebarInset so it spans the full window (incl. the
       * sidebar column) rather than just the content area. */}
      <NavigationProgress />
      <AppSidebar />
      <SidebarInset className="flex flex-col min-h-0">
        <TopBar />
        <LicenseBanner />
        {/* Content area: flex-1 + min-h-0 makes the flex child shrinkable;
         * overflow-auto clips overflow so the page scrolls inside (not the
         * whole window). Padding is applied here so single-pane routes get
         * a comfortable inset; two-pane routes use `-m-6` to break back
         * out to flush edges (see documents.tsx etc.). */}
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <Outlet />
        </div>
        <CommandPalette />
      </SidebarInset>
    </SidebarProvider>
  );
}
