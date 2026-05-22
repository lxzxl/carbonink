import { ActivityForm } from '@renderer/components/ActivityForm';
import { Main } from '@renderer/components/layout/main';
import { RebindEfDrawer } from '@renderer/components/RebindEfDrawer';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { activityApi } from '@renderer/lib/api/activity-data';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, EmissionSource, ReportingPeriod } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

/**
 * /activities — list + create form for ActivityData rows.
 *
 * Phase 1a scope (per docs/plans/2026-05-11): list-by-period + inline create.
 * Edit / delete are deferred to Phase 1b — the table renders the
 * service-computed `computed_co2e_kg` read-only here. The orgId is resolved
 * via `org:get-current` (singleton accessor); if onboarding hasn't run,
 * redirect to the wizard.
 *
 * "Current reporting period" is just `periods[0]` for Phase 1a, since the
 * onboarding wizard creates exactly one. Phase 1b adds a period switcher
 * UI; the data shape (one query per period_id) already supports it.
 */
export const Route = createFileRoute('/activities')({
  component: ActivitiesRoute,
});

function ActivitiesRoute() {
  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: orgApi.getCurrent,
  });

  if (orgQuery.isLoading) {
    return <p className="text-muted-foreground">{m.loading()}</p>;
  }
  if (!orgQuery.data) {
    return <Navigate to="/onboarding/$step" params={{ step: '1' }} />;
  }
  return <ActivitiesList organizationId={orgQuery.data.id} />;
}

function ActivitiesList({ organizationId }: { organizationId: string }) {
  const [formOpen, setFormOpen] = useState(false);
  const [rebindActivityId, setRebindActivityId] = useState<string | null>(null);

  // Sources are loaded once at the page level and threaded into the form.
  // Doing the lookup here also gives us a `sourceById` map for joining the
  // activity table — the activity row only carries `emission_source_id`, so
  // we need this same data to render `source.name` in the list column.
  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', organizationId],
    queryFn: () => sourceApi.listByOrg({ organization_id: organizationId }),
  });

  const periodsQuery = useQuery<ReportingPeriod[]>({
    queryKey: ['org:list-reporting-periods', organizationId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: organizationId }),
  });

  const currentPeriodId = periodsQuery.data?.[0]?.id;

  const activitiesQuery = useQuery<ActivityData[]>({
    queryKey: ['activity:list-by-period', currentPeriodId],
    queryFn: () => activityApi.listByPeriod({ reporting_period_id: currentPeriodId! }),
    enabled: !!currentPeriodId,
  });

  // Surface load errors via toast (same pattern as /sources). Effect depends
  // ONLY on the boolean `isError` so React Query's 3-retry default doesn't
  // refire the toast three times (each retry mints a new error object).
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately excluding activitiesQuery.error from deps — including it would refire the toast on every retry attempt (each retry mints a new error object), defeating the purpose of the fix.
  useEffect(() => {
    if (!activitiesQuery.isError) return;
    const err = activitiesQuery.error;
    const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    toast.error(m.activities_load_failed(), { description: msg });
  }, [activitiesQuery.isError]);

  const sources = sourcesQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];

  // Build a Map for O(1) source name lookup. useMemo so we don't rebuild on
  // every render — the source list changes much less often than form state.
  const sourceById = useMemo(() => {
    const map = new Map<string, EmissionSource>();
    for (const s of sources) map.set(s.id, s);
    return map;
  }, [sources]);

  return (
    // Sticky top + scrolling list (see CLAUDE.md → Scroll containment).
    // Heading + Add button + open form stay pinned; only the activity rows
    // scroll inside the list container.
    <Main className="flex h-full flex-col gap-4">
      <div className="shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{m.nav_activities()}</h1>
          <Button onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? m.sources_cancel_button() : m.activities_add_button()}
          </Button>
        </div>

        {formOpen && (
          <ActivityForm
            organizationId={organizationId}
            sources={sources}
            onCancel={() => setFormOpen(false)}
            onSuccess={() => setFormOpen(false)}
          />
        )}
      </div>

      {activities.length === 0 ? (
        <p className="shrink-0 text-sm text-muted-foreground">{m.activities_empty()}</p>
      ) : (
        // List container claims the remaining height and owns the scroll.
        // Each row stacks three lines vertically so wide EF descriptors and
        // long source names breathe instead of pushing the table off-screen
        // horizontally. The Rebind action sits top-right as a ghost button.
        // occurred_at_start may be ISO datetime or bare date; first 10 chars
        // are always YYYY-MM-DD for scannability.
        <ul className="flex-1 min-h-0 divide-y divide-border overflow-auto rounded-md border border-border bg-card">
          {activities.map((a) => {
            const src = sourceById.get(a.emission_source_id);
            return (
              <li
                key={a.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className="truncate font-medium text-foreground"
                      title={src?.name ?? a.emission_source_id}
                    >
                      {src?.name ?? a.emission_source_id}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {a.occurred_at_start.slice(0, 10)}
                    </span>
                  </div>
                  <div className="text-sm text-foreground">
                    <span className="tabular-nums">
                      {a.amount} {a.unit}
                    </span>
                    <span className="mx-1.5 text-muted-foreground">→</span>
                    <span className="font-medium tabular-nums">{a.computed_co2e_kg} kg CO2e</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{a.ef_factor_code}</span>
                    <span className="ml-1.5">
                      ({a.ef_source} · {a.ef_year} · {a.ef_geography})
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRebindActivityId(a.id)}
                  className="shrink-0"
                >
                  {m.rebind_button()}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {rebindActivityId && (
        <RebindEfDrawer
          activityId={rebindActivityId}
          open={true}
          onClose={() => setRebindActivityId(null)}
        />
      )}
    </Main>
  );
}
