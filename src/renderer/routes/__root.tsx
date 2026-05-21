import { AppSidebar } from '@renderer/components/AppSidebar';
import { TopBar } from '@renderer/components/app-shell/TopBar';
import { CommandPalette } from '@renderer/components/command-palette';
import { LicenseBanner } from '@renderer/components/LicenseBanner';
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
      <AppSidebar />
      {/* `bg-transparent` overrides shadcn's default `bg-background`
       * (opaque cream from our theme). Without this override, the inset
       * painted an opaque cream rectangle while the sidebar stayed
       * vibrancy-transparent — creating a hard color boundary at
       * x=sidebar-width that visually CUT THROUGH the traffic-light
       * cluster (light extends ~72px, boundary at 48px collapsed = light
       * was half-on-vibrancy-gray, half-on-cream). Transparent inset lets
       * the same vibrancy carry across the whole window; cards inside
       * keep their own `bg-card` for readability. */}
      <SidebarInset className="flex flex-col min-h-0 bg-transparent">
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
