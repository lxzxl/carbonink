import { activityApi } from '@renderer/lib/api/activity-data';
import { orgApi } from '@renderer/lib/api/organization';
import { formatCo2e } from '@renderer/lib/format';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

// Round 4 #12: number formatting unified across the app via
// `formatCo2e` (see `lib/format.ts`). Dashboard, audit cards, and
// reports now use the same zh-CN locale + max-1-decimal contract.

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
        <div className="mt-4 rounded-lg border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
          {m.dashboard_empty_hint()}{' '}
          <Link
            to="/activities"
            className="text-primary font-medium hover:underline underline-offset-4"
          >
            {m.dashboard_add_first_activity()} →
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Single scope/total card. The previous layout put the unit (kg CO2e)
 * inline after the value with a much smaller size — visually the number
 * dominated and the unit looked like a footnote. Native KPI cards put
 * the unit on its own row below the number at a calmer size, so the
 * eye reads `label → value → unit` as three peers, not "MASSIVE NUMBER
 * with tiny suffix". Skill 06 — chrome typography should be calm.
 */
function ScopeCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="bg-card text-card-foreground rounded-lg border border-border/60 p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{formatCo2e(value)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{m.unit_kg_co2e()}</div>
    </div>
  );
}
