import { SettingsDrawerContent } from '@renderer/components/SettingsDrawerContent';
import { Sidebar } from '@renderer/components/Sidebar';
import { SettingsDrawer } from '@renderer/components/settings-drawer';
import { useSettingsDrawer } from '@renderer/components/settings-drawer-context';
import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  // SettingsDrawer is mounted at the route root so it shares lifetime with
  // the rest of the app chrome (Sidebar). The provider lives one level up
  // in `main.tsx` so the out-of-route CommandPalette can also toggle it.
  const { open, setOpen } = useSettingsDrawer();

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
      <SettingsDrawer open={open} onOpenChange={setOpen}>
        <SettingsDrawerContent onSaved={() => setOpen(false)} />
      </SettingsDrawer>
    </>
  );
}
