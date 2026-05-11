import * as m from '@renderer/paraglide/messages';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

/**
 * /documents/$id — placeholder route for Phase 1b Task 15.
 *
 * Task 14 ships /documents (the list page) which navigates rows here on
 * click. Wiring the route stub now keeps the routeTree generator happy and
 * lets the list compile against the typed `to: '/documents/$id'` target.
 *
 * Task 15 swaps this body for the full PDF preview + ExtractionReview
 * layout. The route shape (`$id` param) is final.
 */
export const Route = createFileRoute('/documents/$id')({
  component: DocumentReviewRoute,
});

function DocumentReviewRoute() {
  const { id } = useParams({ from: '/documents/$id' });
  return (
    <div className="space-y-4">
      <Link
        to="/documents"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {m.documents_review_back()}
      </Link>
      <p className="text-sm text-muted-foreground">
        Review detail for {id} — lands in Phase 1b Task 15.
      </p>
    </div>
  );
}
