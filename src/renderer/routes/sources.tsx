import { createFileRoute } from '@tanstack/react-router';

// Placeholder route stub created in Phase 1a task 11 so Sidebar <Link to="/sources">
// typechecks before task 12 ships the real list + create form.
export const Route = createFileRoute('/sources')({
  component: SourcesRoute,
});

function SourcesRoute() {
  return <div>Sources</div>;
}
