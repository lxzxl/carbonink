import { AppSidebar } from '@renderer/components/AppSidebar';
import { CommandPalette } from '@renderer/components/command-palette';
import { LicenseBanner } from '@renderer/components/LicenseBanner';
import { Separator } from '@renderer/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@renderer/components/ui/sidebar';
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * Root layout (UI redesign Phase A).
 *
 * Bypass for the hidden /print-render BrowserWindow remains — that route
 * is loaded by ReportExportService into a separate window for printToPDF
 * and must render content-only (no sidebar, no chrome).
 *
 * Otherwise the app uses shadcn's <SidebarProvider> + <Sidebar> +
 * <SidebarInset> three-piece layout. SidebarProvider:
 *   - Owns the collapsed/expanded state (persisted to cookie + Cmd/Ctrl+B)
 *   - Threads the state into Sidebar (resizes 16rem ↔ 3rem on collapse)
 *     and SidebarInset (the right-hand main pane that adapts to fill).
 *
 * Top chrome row sits at the very top of SidebarInset:
 *   - macOS hiddenInset reserves left-18, top-16 for traffic lights, so
 *     the trigger button needs `ml-12` left-inset (skill 06: don't paint
 *     buttons over the OS's traffic-light hit zone).
 *   - The titlebar-region drag div is now ONLY in the topbar (not full
 *     window width) — clicking inside the main content shouldn't trigger
 *     window-move on a stray empty space.
 */
function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === '/print-render') {
    return <Outlet />;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* TopBar — h-12 / drag region / SidebarTrigger.
         * `titlebar-region` makes this band a window-move handle (mac
         * hiddenInset). Children explicitly opt-out via `no-drag` so
         * clicks on the trigger button + future back/forward arrows
         * actually fire instead of being eaten by the OS. */}
        <header className="titlebar-region sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-background/40 backdrop-blur-sm px-3">
          {/* Mac: ml-16 clears the traffic-light cluster (~18px left, 70px
           * wide). Win: the OS chrome is on the right, so left-inset can
           * be small. We don't currently branch on platform — picking the
           * larger inset works on both (Win just sees extra left padding,
           * harmless). */}
          <div className="ml-16 flex items-center gap-2 [-webkit-app-region:no-drag]">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
          </div>
        </header>
        <LicenseBanner />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        <CommandPalette />
      </SidebarInset>
    </SidebarProvider>
  );
}
