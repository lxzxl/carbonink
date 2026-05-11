import * as m from '@renderer/paraglide/messages';
import { createFileRoute } from '@tanstack/react-router';

/**
 * /documents — placeholder route for Phase 1b Task 14.
 *
 * Stubbed now so that:
 *   1. TanStack Router's generated routeTree typechecks the
 *      `nav.documents` cmdk command (Task 7).
 *   2. The Sidebar `nav.documents` link (added later in Task 14) has a
 *      valid target.
 *
 * Task 14 swaps this body for the drag-drop upload zone + DocumentList.
 * Until then the route is reachable but intentionally empty — same
 * pattern Phase 1a used for `/sources` and `/activities` stubs.
 */
export const Route = createFileRoute('/documents')({
  component: DocumentsRoute,
});

function DocumentsRoute() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{m.nav_documents()}</h1>
      <p className="text-sm text-muted-foreground">{m.documents_placeholder()}</p>
    </div>
  );
}
