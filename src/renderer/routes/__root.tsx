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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex flex-col">
        <TopBar />
        <LicenseBanner />
        <main className="flex-1 overflow-auto p-6 min-h-0">
          <Outlet />
        </main>
        <CommandPalette />
      </SidebarInset>
    </SidebarProvider>
  );
}
