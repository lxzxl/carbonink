import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@renderer/lib/trpc';
import * as m from '@renderer/paraglide/messages';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  const hasAny = trpc.organization.hasAny.useQuery();
  if (hasAny.isLoading) return <p className="text-muted-foreground">{m.loading()}</p>;
  if (!hasAny.data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">{m.dashboard_welcome_title()}</h1>
        <p className="mt-2 text-muted-foreground">{m.dashboard_welcome_body()}</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold">{m.dashboard_inventory_title()}</h1>
      <p className="mt-2 text-muted-foreground">{m.dashboard_inventory_body()}</p>
    </div>
  );
}
