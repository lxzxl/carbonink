import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  const hasAny = useQuery({
    queryKey: ['org:has-any'],
    queryFn: orgApi.hasAny,
  });
  if (hasAny.isLoading) return <p className="text-muted-foreground">{m.loading()}</p>;
  if (!hasAny.data) return <Navigate to="/onboarding/$step" params={{ step: '1' }} />;
  return (
    <div>
      <h1 className="text-2xl font-semibold">{m.dashboard_inventory_title()}</h1>
      <p className="mt-2 text-muted-foreground">{m.dashboard_inventory_body()}</p>
    </div>
  );
}
