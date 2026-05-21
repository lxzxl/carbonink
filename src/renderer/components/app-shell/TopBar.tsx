import { Button } from '@renderer/components/ui/button';
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
// Round 4 hotfix3: dropped `bg-background/40` + `backdrop-blur-sm` from
// the header className. The opaque-ish tint behind the topbar broke the
// vibrancy carry-through between sidebar and main area (introducing yet
// another background-color seam in the title-bar zone). Now the topbar
// is fully transparent; the SidebarInset is also transparent above so
// the OS vibrancy is uninterrupted from x=0 across the whole top strip.
// Border-b stays — it's at y=48, below the traffic lights.
export function TopBar() {
  return (
    <header className="titlebar-region sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-3">
      {/* Round 4 #9: visually separated the sidebar toggle from the
       * back/forward pair. Previously [☰] [|] [<] [>] read as one
       * cramped group; now [☰]   [< >] with breathing room. */}
      <div className="ml-16 flex items-center gap-3 [-webkit-app-region:no-drag]">
        <SidebarTrigger />
        <div className="flex items-center gap-1">
          <NavArrows />
        </div>
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
