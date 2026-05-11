import { createFileRoute } from '@tanstack/react-router';

// Placeholder route stub created in Phase 1a task 11 so Sidebar <Link to="/activities">
// typechecks before task 13 ships the real list + create form.
export const Route = createFileRoute('/activities')({
  component: ActivitiesRoute,
});

function ActivitiesRoute() {
  return <div>Activities</div>;
}
