import { Button } from '@renderer/components/ui/button';
import * as m from '@renderer/paraglide/messages';
import { useRouter } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * NavArrows — back / forward history buttons for the chrome row.
 * Extracted from the original `TopBar` so they can be passed as
 * children of the new shadcn-admin–style `Header` (or replaced per
 * route if a future page wants different header content).
 *
 * Wraps `router.history.back()` / `forward()`. These are no-ops at the
 * ends of the history stack; we don't disable the buttons because the
 * cost of checking `history.length` outweighs the polish — the native
 * macOS browser-toolbar arrows behave the same way (always enabled,
 * silently no-op at boundaries).
 */
export function NavArrows() {
  const router = useRouter();
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={m.topbar_back()}
        onClick={() => router.history.back()}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={m.topbar_forward()}
        onClick={() => router.history.forward()}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
