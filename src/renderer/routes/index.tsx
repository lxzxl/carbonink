import { activityApi } from '@renderer/lib/api/activity-data';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

/**
 * Format a CO2e value (kg) with the zh-CN locale's thousands separator and
 * a single decimal place. Used uniformly across the four scope cards so a
 * "0" value still renders as "0" (not "0.0") via maximumFractionDigits.
 *
 * Defined at module scope so the test harness can rely on stable output
 * without re-mounting the component.
 */
const format = (n: number | undefined) =>
  new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(n ?? 0);

function Dashboard() {
  // Onboarding gate: if no org exists, redirect into the wizard. This is the
  // same check the Phase 0 placeholder did — kept verbatim so users who never
  // ran onboarding still land on /onboarding/1 first.
  const hasAny = useQuery({
    queryKey: ['org:has-any'],
    queryFn: orgApi.hasAny,
  });

  // Once we know an org exists, resolve the current org → its reporting
  // periods → totals for the first period. Each step gates the next via
  // `enabled` so we never fire a query with an undefined argument.
  // Phase 1a assumes single org / single period (wizard creates exactly one);
  // Phase 1b adds a period switcher and this chain stays the same shape.
  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: orgApi.getCurrent,
    enabled: hasAny.data === true,
  });
  const orgId = orgQuery.data?.id;

  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgId! }),
    enabled: !!orgId,
  });
  const currentPeriodId = periodsQuery.data?.[0]?.id;

  const totalsQuery = useQuery({
    queryKey: ['activity:totals-by-period', currentPeriodId],
    queryFn: () => activityApi.totalsByPeriod({ reporting_period_id: currentPeriodId! }),
    enabled: !!currentPeriodId,
  });

  if (hasAny.isLoading) {
    return <p className="text-muted-foreground">{m.loading()}</p>;
  }
  if (!hasAny.data) {
    return <Navigate to="/onboarding/$step" params={{ step: '1' }} />;
  }

  const totals = totalsQuery.data;
  const showEmptyHint = totals?.total_co2e_kg === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{m.dashboard_inventory_title()}</h1>

      <div className="grid grid-cols-4 gap-4">
        <ScopeCard label={m.dashboard_total_co2e()} value={totals?.total_co2e_kg} />
        <ScopeCard label={m.dashboard_scope_1()} value={totals?.scope1_kg} />
        <ScopeCard label={m.dashboard_scope_2()} value={totals?.scope2_kg} />
        <ScopeCard label={m.dashboard_scope_3()} value={totals?.scope3_kg} />
      </div>

      {showEmptyHint && (
        <p className="text-muted-foreground">
          {m.dashboard_empty_hint()}{' '}
          <Link to="/activities" className="text-primary underline">
            {m.dashboard_add_first_activity()}
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * Single scope/total card. Inlined rather than reaching for shadcn `<Card>`
 * because the project's ui/ folder only ships button/input/label so far —
 * adding a Card primitive just for four divs would be premature factoring.
 * When more pages need cards we can extract this into components/ui/card.tsx.
 */
function ScopeCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="bg-card text-card-foreground rounded-lg border border-border p-6">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {format(value)}{' '}
        <span className="text-base font-normal text-muted-foreground">{m.unit_kg_co2e()}</span>
      </div>
    </div>
  );
}
