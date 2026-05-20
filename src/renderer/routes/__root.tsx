import { CommandPalette } from '@renderer/components/command-palette';
import { Sidebar } from '@renderer/components/Sidebar';
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  // /print-render is loaded inside a hidden BrowserWindow by
  // ReportExportService.renderReportPdf / renderQuestionnairePdf to drive
  // `webContents.printToPDF`. If we render the normal app shell around it,
  // printToPDF captures the *entire window* — sidebar, titlebar, command
  // palette — which is exactly the bug the user reported as "PDF 就是简单
  // 的整个 app 截图". Bypass the shell on this route so the print payload
  // owns the whole document.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === '/print-render') {
    return <Outlet />;
  }

  // CommandPalette mounts at the route root so it sits inside <RouterProvider>
  // and can call `useNavigate()`. If it lives outside (as a sibling in
  // main.tsx) every render logs "useRouter must be used inside a
  // <RouterProvider> component!" and the navigate stub becomes a no-op —
  // that breakage also corrupts in-tree TanStack <Link> click handlers (the
  // cause of the historical /documents row "click does nothing" bug). Keep
  // it inside the route tree.
  return (
    <>
      {/* macOS: traffic lights sit at left:18, top:16 inside this 32px-tall
       *        drag region. Sidebar must offset its content downward so
       *        nothing collides with the traffic lights.
       * Windows: this region is a normal draggable area (no traffic lights).
       *        autoHideMenuBar makes the legacy menu disappear. */}
      <div className="titlebar-region fixed top-0 left-0 right-0 h-8 z-50" />
      {/* NOTE: bg-background omitted from this wrapper so macOS vibrancy /
       * Windows Mica show through. text-foreground stays for inherited
       * text color tokens. */}
      <div className="flex h-screen pt-8 text-foreground">
        <Sidebar />
        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </>
  );
}
