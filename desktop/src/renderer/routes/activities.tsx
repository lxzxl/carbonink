import { ActivityForm } from '@renderer/components/ActivityForm';
import { Main } from '@renderer/components/layout/main';
import { RebindEfDrawer } from '@renderer/components/RebindEfDrawer';
import { SortMenu, type SortMenuOption } from '@renderer/components/sort-menu';
import { ChipCountBadge } from '@renderer/components/source-filters';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { activityApi } from '@renderer/lib/api/activity-data';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, EmissionSource, ReportingPeriod } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

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
/**
 * `?highlight=<activity_id>` lets other surfaces deep-link into the
 * activities list and surface a specific row. Used by the audit page's
 * ActivityRebindCard so clicking "#01HXX9YY" actually shows the user
 * which row that ULID belongs to, rather than dropping them on a flat
 * list of identical-looking entries.
 */
type ActivitiesSearch = { highlight?: string };

export const Route = createFileRoute('/activities')({
  component: ActivitiesRoute,
  // tsconfig has `exactOptionalPropertyTypes`, so we can't assign
  // `undefined` to an optional `highlight?: string` field — build the
  // object conditionally.
  validateSearch: (search: Record<string, unknown>): ActivitiesSearch => {
    const out: ActivitiesSearch = {};
    if (typeof search.highlight === 'string' && search.highlight.length > 0) {
      out.highlight = search.highlight;
    }
    return out;
  },
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

type ActivitySort = 'recent' | 'oldest' | 'co2e_desc' | 'co2e_asc' | 'source';
type ActivityScopeFilter = 'all' | 1 | 2 | 3;

function ActivitiesList({ organizationId }: { organizationId: string }) {
  const [formOpen, setFormOpen] = useState(false);
  const [rebindActivityId, setRebindActivityId] = useState<string | null>(null);

  // Filter + sort UI state. Persists for the life of the page (no URL
  // sync — these filters are exploratory, not bookmarkable).
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ActivityScopeFilter>('all');
  const [sort, setSort] = useState<ActivitySort>('recent');

  // Deep-link target from `?highlight=<activity_id>`. When set, we scroll
  // the matching row into view + draw a ring around it. The audit
  // page's ActivityRebindCard uses this to drop users on the exact
  // activity whose EF they just rebound.
  const { highlight } = Route.useSearch();
  const highlightRowRef = useRef<HTMLLIElement | null>(null);

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

  // ---- Filter pipeline (search → scope → sort) ----
  // Activities don't carry scope directly; we derive it from the joined
  // emission_source. Rows for sources the user deleted (or for fixtures
  // where the source row is absent) fall through to scope `null` and
  // get included in the "all" view only.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) => {
      const src = sourceById.get(a.emission_source_id);
      const name = (src?.name ?? a.emission_source_id).toLowerCase();
      const unit = a.unit.toLowerCase();
      const ef = a.ef_factor_code.toLowerCase();
      return name.includes(q) || unit.includes(q) || ef.includes(q);
    });
  }, [activities, search, sourceById]);

  const scopeCounts = useMemo(() => {
    const counts = { all: searched.length, 1: 0, 2: 0, 3: 0 };
    for (const a of searched) {
      const s = sourceById.get(a.emission_source_id)?.scope;
      if (s === 1 || s === 2 || s === 3) counts[s] += 1;
    }
    return counts;
  }, [searched, sourceById]);

  const scopeFiltered = useMemo(() => {
    if (scopeFilter === 'all') return searched;
    return searched.filter((a) => sourceById.get(a.emission_source_id)?.scope === scopeFilter);
  }, [searched, scopeFilter, sourceById]);

  // Sort is the last step. We never mutate; the comparator returns a
  // new array (sort defaults to mutating in place, hence the spread).
  const visible = useMemo(() => {
    const arr = [...scopeFiltered];
    switch (sort) {
      case 'recent':
        arr.sort((a, b) => b.occurred_at_end.localeCompare(a.occurred_at_end));
        break;
      case 'oldest':
        arr.sort((a, b) => a.occurred_at_start.localeCompare(b.occurred_at_start));
        break;
      case 'co2e_desc':
        arr.sort((a, b) => b.computed_co2e_kg - a.computed_co2e_kg);
        break;
      case 'co2e_asc':
        arr.sort((a, b) => a.computed_co2e_kg - b.computed_co2e_kg);
        break;
      case 'source':
        arr.sort((a, b) => {
          const na = sourceById.get(a.emission_source_id)?.name ?? '';
          const nb = sourceById.get(b.emission_source_id)?.name ?? '';
          return na.localeCompare(nb, 'zh-CN');
        });
        break;
    }
    return arr;
  }, [scopeFiltered, sort, sourceById]);

  const sortOptions = useMemo<SortMenuOption<ActivitySort>[]>(
    () => [
      { value: 'recent', label: m.activities_sort_recent() },
      { value: 'oldest', label: m.activities_sort_oldest() },
      { value: 'co2e_desc', label: m.activities_sort_co2e_desc() },
      { value: 'co2e_asc', label: m.activities_sort_co2e_asc() },
      { value: 'source', label: m.activities_sort_source() },
    ],
    [],
  );

  const resetFilters = () => {
    setSearch('');
    setScopeFilter('all');
  };
  const filtersActive = search !== '' || scopeFilter !== 'all';

  // Scroll the deep-link target into view once the list has actually
  // landed. `activities.length` in the deps gates the effect on the
  // first non-empty render — before that the ref is null. We don't
  // depend on the ref itself; refs aren't reactive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref reads are intentionally NOT reactive — we want this effect to fire when the highlight target or the underlying list changes, not when the ref object identity does.
  useEffect(() => {
    if (!highlight) return;
    const el = highlightRowRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, activities.length]);

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

        {/* Filter + sort. Hidden when the org has no activities yet (the
         * empty-state CTA below is the only thing the user needs). */}
        {activities.length > 0 && (
          <div className="space-y-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={m.activities_search_placeholder()}
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {(['all', 1, 2, 3] as const).map((s) => {
                  const active = scopeFilter === s;
                  const label =
                    s === 'all'
                      ? m.sources_catalog_scope_all()
                      : s === 1
                        ? m.sources_catalog_scope1_short()
                        : s === 2
                          ? m.sources_catalog_scope2_short()
                          : m.sources_catalog_scope3_short();
                  return (
                    <button
                      key={String(s)}
                      type="button"
                      onClick={() => setScopeFilter(s)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'bg-foreground/12 text-foreground'
                          : 'bg-transparent text-muted-foreground hover:bg-foreground/5',
                      )}
                    >
                      <span>{label}</span>
                      <ChipCountBadge count={scopeCounts[s]} active={active} />
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto">
                <SortMenu value={sort} onChange={setSort} options={sortOptions} />
              </div>
            </div>
          </div>
        )}
      </div>

      {activities.length === 0 ? (
        <p className="shrink-0 text-sm text-muted-foreground">{m.activities_empty()}</p>
      ) : visible.length === 0 ? (
        <div className="flex-1 flex min-h-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/40 p-8 text-sm text-muted-foreground">
          <p>{m.activities_filter_empty()}</p>
          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded px-2 py-1 text-xs font-medium text-foreground/70 hover:bg-foreground/5"
            >
              {m.activities_filter_clear()}
            </button>
          )}
        </div>
      ) : (
        // List container claims the remaining height and owns the scroll.
        // Each row stacks three lines vertically so wide EF descriptors and
        // long source names breathe instead of pushing the table off-screen
        // horizontally. The Rebind action sits top-right as a ghost button.
        // occurred_at_start may be ISO datetime or bare date; first 10 chars
        // are always YYYY-MM-DD for scannability.
        <ul className="flex-1 min-h-0 divide-y divide-border overflow-auto rounded-md border border-border bg-card">
          {visible.map((a) => {
            const src = sourceById.get(a.emission_source_id);
            const isHighlighted = a.id === highlight;
            return (
              <li
                key={a.id}
                ref={isHighlighted ? highlightRowRef : null}
                className={cn(
                  'flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30',
                  // Highlighted from `?highlight=<id>` (audit deep link).
                  // Subtle yellow tint + ring; persistent until the user
                  // navigates away. Not a pulse — pulsing rows are
                  // hard to read.
                  isHighlighted && 'bg-amber-500/10 ring-2 ring-amber-500/40 ring-inset',
                )}
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
