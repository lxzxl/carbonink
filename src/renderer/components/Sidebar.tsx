import { useSettingsDrawer } from '@renderer/components/settings-drawer-context';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { Link } from '@tanstack/react-router';
import { Settings as SettingsIcon } from 'lucide-react';

export function Sidebar() {
  // Subscribe to the global Settings drawer state. The provider is mounted
  // at the renderer entry (see `src/renderer/main.tsx` / `__root.tsx`) so
  // both this Sidebar and the out-of-tree CommandPalette can toggle it.
  const { setOpen: setSettingsOpen } = useSettingsDrawer();

  return (
    <nav className="flex h-full w-56 flex-col border-r border-border bg-muted/30 px-4 pt-12 pb-4">
      <h2 className="mb-6 text-lg font-semibold">{m.app_title()}</h2>
      <ul className="space-y-1 flex-1">
        <li>
          <Link
            to="/"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              '[&.active]:bg-primary [&.active]:text-primary-foreground',
            )}
          >
            {m.nav_dashboard()}
          </Link>
        </li>
        <li>
          <Link
            to="/sources"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              '[&.active]:bg-primary [&.active]:text-primary-foreground',
            )}
          >
            {m.nav_sources()}
          </Link>
        </li>
        <li>
          <Link
            to="/activities"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              '[&.active]:bg-primary [&.active]:text-primary-foreground',
            )}
          >
            {m.nav_activities()}
          </Link>
        </li>
        <li>
          <Link
            to="/documents"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              '[&.active]:bg-primary [&.active]:text-primary-foreground',
            )}
          >
            {m.nav_documents()}
          </Link>
        </li>
        <li>
          <Link
            to="/questionnaires"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              '[&.active]:bg-primary [&.active]:text-primary-foreground',
            )}
          >
            {m.nav_questionnaires()}
          </Link>
        </li>
      </ul>
      {/* Settings button — opens the right-side drawer via shared context.
       * Phase 1b replaces the Phase 0 Moon placeholder with a real gear.
       * Theme toggle is now part of the Settings panel itself. */}
      <div className="mt-auto pt-4 border-t border-border/50">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={m.nav_settings()}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SettingsIcon className="h-4 w-4" />
          <span className="text-xs">{m.nav_settings()}</span>
        </button>
      </div>
    </nav>
  );
}
