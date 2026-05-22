import { Main } from '@renderer/components/layout/main';
import { activityApi } from '@renderer/lib/api/activity-data';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import { formatCo2e } from '@renderer/lib/format';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, EmissionSource } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
import { useMemo } from 'react';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

// Round 4 #12: number formatting unified across the app via
// `formatCo2e` (see `lib/format.ts`). Dashboard, audit cards, and
// reports now use the same zh-CN locale + max-1-decimal contract.

function Dashboard() {
  const hasAny = useQuery({ queryKey: ['org:has-any'], queryFn: orgApi.hasAny });

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

  // Round 4 #5: pull the full activity list once so the recent-activities
  // widget + monthly-trend widget can derive their data without two more
  // round-trips. The activity:list-by-period query is already cached, so
  // adding a second consumer is free.
  const activitiesQuery = useQuery({
    queryKey: ['activity:list-by-period', currentPeriodId],
    queryFn: () => activityApi.listByPeriod({ reporting_period_id: currentPeriodId! }),
    enabled: !!currentPeriodId,
  });

  // Sources lookup so the recent-activities row can render
  // "厂区电表" instead of the raw emission_source_id.
  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', orgId],
    queryFn: () => sourceApi.listByOrg({ organization_id: orgId! }),
    enabled: !!orgId,
  });

  if (hasAny.isLoading) {
    return <p className="text-muted-foreground">{m.loading()}</p>;
  }
  if (!hasAny.data) {
    return <Navigate to="/onboarding/$step" params={{ step: '1' }} />;
  }

  const totals = totalsQuery.data;
  const showEmptyHint = totals?.total_co2e_kg === 0;
  const activities = activitiesQuery.data ?? [];
  const sourceById = new Map((sourcesQuery.data ?? []).map((s) => [s.id, s]));

  return (
    <Main className="space-y-6">
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

      {/* Two-column widget row below the KPI cards. Round 4 #5: was empty
       * space until now. Left = monthly trend (bar chart); right = recent
       * activities list. */}
      {!showEmptyHint && activities.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
          <MonthlyTrendCard activities={activities} />
          <RecentActivitiesCard activities={activities} sourceById={sourceById} />
        </div>
      )}
    </Main>
  );
}

/**
 * Single scope/total card. Round 2: label (uppercase tracking-wide) →
 * number (text-2xl) → unit (text-xs muted) read as three peers, not
 * "MASSIVE NUMBER with tiny suffix".
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

/**
 * Recent activities widget — 5 most-recent activities by occurred_at_end.
 * Each row: source name, date, value. No emission factor / unit display
 * to keep it scannable; user clicks through to /activities for the full
 * table.
 */
function RecentActivitiesCard({
  activities,
  sourceById,
}: {
  activities: ActivityData[];
  sourceById: Map<string, EmissionSource>;
}) {
  // Sort desc by occurred_at_end so the freshest entries appear first.
  // listByPeriod returns ascending so we copy + reverse rather than
  // mutating the cached array.
  const recent = useMemo(
    () =>
      [...activities]
        .sort((a, b) => b.occurred_at_end.localeCompare(a.occurred_at_end))
        .slice(0, 5),
    [activities],
  );

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{m.dashboard_recent_activities()}</h2>
        <Link
          to="/activities"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {m.dashboard_widget_view_all()} →
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{m.dashboard_recent_empty()}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/40">
          {recent.map((a) => {
            const source = sourceById.get(a.emission_source_id);
            return (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{source?.name ?? a.emission_source_id}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {a.occurred_at_end.slice(0, 10)}
                  </span>
                </div>
                <span className="ml-3 shrink-0 font-mono tabular-nums text-foreground">
                  {formatCo2e(a.computed_co2e_kg)}{' '}
                  <span className="text-xs text-muted-foreground">{m.unit_kg_co2e()}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Monthly trend bar chart. Round 4 #5: no chart library — divs sized by
 * percentage of the max month. Simple, reads at a glance.
 *
 * Aggregation: bucket by YYYY-MM (occurred_at_end's month). Show last
 * 12 months. Months with no data render as a 1px-tall track so the eye
 * still sees the time axis without thinking "data missing".
 */
function MonthlyTrendCard({ activities }: { activities: ActivityData[] }) {
  const months = useMemo(() => buildMonthBuckets(activities), [activities]);
  const max = months.reduce((m, b) => Math.max(m, b.total), 0);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{m.dashboard_monthly_trend()}</h2>
      </div>
      {max === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{m.dashboard_no_data_for_chart()}</p>
      ) : (
        <div
          className="mt-4 grid items-end gap-1"
          style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, height: 120 }}
        >
          {months.map((b) => {
            // Height as a percentage of the tallest bar; 1px floor so
            // empty months still render the axis baseline.
            const heightPct = b.total === 0 ? 1 : Math.max(2, (b.total / max) * 100);
            return (
              <div key={b.label} className="flex flex-col items-stretch gap-1">
                <div
                  className="flex items-end justify-center"
                  style={{ height: `${heightPct}%` }}
                  title={`${b.label} · ${formatCo2e(b.total)} kg CO2e`}
                >
                  <div className="w-full rounded-t bg-primary/60 hover:bg-primary transition-colors" />
                </div>
                <div className="text-center text-[10px] text-muted-foreground">{b.shortLabel}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Bucket = { label: string; shortLabel: string; total: number };

function buildMonthBuckets(activities: ActivityData[]): Bucket[] {
  // Last 12 calendar months including current month.
  const now = new Date();
  const months: Bucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      label: yyyymm,
      shortLabel: `${d.getMonth() + 1}`, // "1", "2", ... — bar labels are tight
      total: 0,
    });
  }
  const byMonth = new Map(months.map((b) => [b.label, b]));
  for (const a of activities) {
    const key = a.occurred_at_end.slice(0, 7); // YYYY-MM
    const bucket = byMonth.get(key);
    if (bucket) bucket.total += a.computed_co2e_kg;
  }
  return months;
}
