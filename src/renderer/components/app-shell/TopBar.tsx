import { Button } from '@renderer/components/ui/button';
import { Separator } from '@renderer/components/ui/separator';
import { SidebarTrigger } from '@renderer/components/ui/sidebar';
import * as m from '@renderer/paraglide/messages';
import { useRouter } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * TopBar — chrome row above the main content (Round 3 hotfix).
 *
 * Earlier draft included a breadcrumb here showing the current route
 * label, but the sidebar (active item) and the list-column header
 * already carried that information — three places saying "Reports" /
 * "Documents" / etc. Reverted to just the controls: sidebar toggle,
 * back, forward. Everything else lives in the routes' own headers.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ [mac TL]   [☰]  ← →                                                 │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * - ml-16 reserves the macOS traffic-light cluster.
 * - `titlebar-region` makes the bar a window-drag handle; the inner
 *   `[-webkit-app-region:no-drag]` wrapper lets the buttons still fire.
 */
export function TopBar() {
  return (
    <header className="titlebar-region sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-background/40 backdrop-blur-sm px-3">
      <div className="ml-16 flex items-center gap-1 [-webkit-app-region:no-drag]">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <NavArrows />
      </div>
    </header>
  );
}

function NavArrows() {
  const router = useRouter();
  return (
    <>
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
    </>
  );
}
