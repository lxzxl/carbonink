import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { Link } from '@tanstack/react-router';
import { Moon } from 'lucide-react';

export function Sidebar() {
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
      </ul>
      {/* Theme toggle placeholder — wired in Phase 1 settings panel.
       * Static for now; the icon reserves the visual position. */}
      <div className="mt-auto pt-4 border-t border-border/50">
        <button
          type="button"
          aria-label="Toggle theme (coming in Phase 1)"
          disabled
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground"
        >
          <Moon className="h-4 w-4" />
          <span className="text-xs">Theme</span>
        </button>
      </div>
    </nav>
  );
}
