import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { Link } from '@tanstack/react-router';

export function Sidebar() {
  return (
    <nav className="flex h-full w-56 flex-col border-r border-border bg-muted/30 p-4">
      <h2 className="mb-6 text-lg font-semibold">{m.app_title()}</h2>
      <ul className="space-y-1">
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
    </nav>
  );
}
