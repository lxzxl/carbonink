import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@renderer/components/ui/breadcrumb';
import { Button } from '@renderer/components/ui/button';
import { Separator } from '@renderer/components/ui/separator';
import { SidebarTrigger } from '@renderer/components/ui/sidebar';
import * as m from '@renderer/paraglide/messages';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * TopBar — Phase F of the UI redesign.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ [mac TL]  [☰]  ← →  │ Documents · bill.pdf                          │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Components in order:
 *   - ml-16 reserves space for the macOS traffic-light cluster (~18px left,
 *     70px wide). Buttons live in a `no-drag` wrapper so clicks don't get
 *     stolen by the OS as window-move gestures.
 *   - SidebarTrigger toggles the sidebar (Cmd/Ctrl+B also works globally).
 *   - Back/Forward arrows wrap router.history. We don't disable them
 *     conditionally — native browsers don't either; the first back at
 *     start-of-history is a no-op which TanStack handles gracefully.
 *   - Breadcrumb shows current path, derived from the URL alone (cheap;
 *     no lookups). Detail routes ($id) display the parent + a placeholder
 *     for the current — proper detail-name labels are a sub-task for
 *     each route to fill in via its own header (already done in
 *     /documents/$id which shows the filename).
 *
 * The whole bar is `titlebar-region` so empty space drags the window
 * (macOS hiddenInset convention). Children explicitly opt out via
 * `-webkit-app-region: no-drag` (Tailwind-friendly via the
 * `[-webkit-app-region:no-drag]` arbitrary class).
 */
export function TopBar() {
  return (
    <header className="titlebar-region sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-background/40 backdrop-blur-sm px-3">
      <div className="ml-16 flex items-center gap-1 [-webkit-app-region:no-drag]">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <NavArrows />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <RouteBreadcrumb />
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

/**
 * Top-level breadcrumb — maps URL segments to localized labels.
 *
 * Kept deliberately shallow: top-level route name + "detail" placeholder
 * for nested routes. We don't try to resolve the entity name (filename
 * of the selected document, customer name of the selected questionnaire)
 * here because that would require a query per route — each detail page
 * already renders its own header with that info, so duplicating it here
 * adds visual weight without information.
 */
function RouteBreadcrumb() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const segments = pathname.split('/').filter(Boolean);
  const top = segments[0];

  const topLabel = (() => {
    switch (top) {
      case undefined:
        return m.nav_dashboard();
      case 'sources':
        return m.nav_sources();
      case 'activities':
        return m.nav_activities();
      case 'documents':
        return m.nav_documents();
      case 'questionnaires':
        return m.nav_questionnaires();
      case 'reports':
        return m.reports_nav();
      case 'audit':
        return m.audit_nav();
      case 'settings':
        return m.nav_settings();
      default:
        return top;
    }
  })();

  // Single-segment URL: show just the top label.
  if (segments.length <= 1) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="text-sm font-medium">{topLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // Detail route: parent label + chevron + placeholder (detail page header
  // carries the actual entity name). Italics signal "depends on context".
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage className="text-sm text-muted-foreground font-normal">
            {topLabel}
          </BreadcrumbPage>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="text-sm font-medium">{m.topbar_detail()}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
