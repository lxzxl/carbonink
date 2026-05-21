import { Button } from '@renderer/components/ui/button';
import * as m from '@renderer/paraglide/messages';
import { useRouter } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * NavArrows — back / forward history buttons for the chrome row.
 *
 * Wraps `router.history.back()` / `forward()`. Each arrow disables
 * itself when no history is available in that direction (user-
 * reported: "如果不能后退或前进，要用禁用状态").
 *
 * History state source: the Chromium Navigation API
 * (`window.navigation.canGoBack` / `canGoForward`). The standard web
 * `window.history` doesn't expose canGoBack/canGoForward — only
 * length, which counts both directions together. Navigation API
 * exposes them as live booleans plus a `currententrychange` event for
 * subscription. Available since Chrome 102; Electron ≥ 21 ships
 * Chromium ≥ 106, so it's safely available here.
 *
 * The hook is in this file rather than a shared lib because
 * NavArrows is the only consumer; if a second one shows up we'll
 * promote it.
 */

type ChromiumNavigation = {
  canGoBack: boolean;
  canGoForward: boolean;
  addEventListener: (type: 'currententrychange', listener: () => void) => void;
  removeEventListener: (type: 'currententrychange', listener: () => void) => void;
};

function getNavigation(): ChromiumNavigation | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { navigation?: ChromiumNavigation }).navigation ?? null;
}

function readState(): { canGoBack: boolean; canGoForward: boolean } {
  const nav = getNavigation();
  if (!nav) {
    // Fallback for environments without the Navigation API (vitest +
    // happy-dom, mostly). Render both buttons enabled — clicks become
    // no-ops at the history boundaries, same as macOS browser arrows.
    return { canGoBack: true, canGoForward: true };
  }
  return { canGoBack: nav.canGoBack, canGoForward: nav.canGoForward };
}

function useNavigationState() {
  const [state, setState] = useState(readState);

  useEffect(() => {
    const nav = getNavigation();
    if (!nav) return;
    const update = () => setState(readState());
    nav.addEventListener('currententrychange', update);
    return () => nav.removeEventListener('currententrychange', update);
  }, []);

  return state;
}

export function NavArrows() {
  const router = useRouter();
  const { canGoBack, canGoForward } = useNavigationState();
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!canGoBack}
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
        disabled={!canGoForward}
        aria-label={m.topbar_forward()}
        onClick={() => router.history.forward()}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
