import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@renderer/lib/trpc';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  const hasAny = trpc.organization.hasAny.useQuery();

  if (hasAny.isLoading) return <p className="text-muted-foreground">Loading…</p>;

  if (!hasAny.data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Welcome to carbonbook</h1>
        <p className="mt-2 text-muted-foreground">
          You haven&apos;t set up your organization yet. The onboarding wizard will guide you next.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Inventory Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        No emission data yet. Phase 1 will let you upload documents and see CO2e.
      </p>
    </div>
  );
}
