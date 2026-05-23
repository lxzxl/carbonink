import { Main } from '@renderer/components/layout/main';
import { SourceAddDrawer } from '@renderer/components/SourceAddDrawer';
import { SourceCatalogDrawer } from '@renderer/components/SourceCatalogDrawer';
import { SourceEditDrawer } from '@renderer/components/SourceEditDrawer';
import {
  type SourceFilterExtractors,
  SourceFilterHeader,
  useSourceFilters,
} from '@renderer/components/source-filters';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import {
  categoryLabel,
  isPathRedundantWithCategory,
  pathLabel,
} from '@renderer/lib/category-labels';
import { formatCo2e, formatInteger } from '@renderer/lib/format';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSourceWithStats, PresetSource } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { Library } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/**
 * /sources — list + create form for EmissionSource rows.
 *
 * Phase 1a scope (per docs/plans/2026-05-11): list-by-org + inline create.
 * is_active toggle / delete are deferred to Phase 1b — the table renders
 * `is_active` read-only here. The orgId is resolved via `org:get-current`
 * (singleton accessor); if onboarding hasn't run, redirect to the wizard.
 */
export const Route = createFileRoute('/sources')({
  component: SourcesRoute,
});

function SourcesRoute() {
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
  return <SourcesList organizationId={orgQuery.data.id} />;
}

/**
 * Format a kg-CO₂e total for display on the source row. Cards are dense,
 * so we shed precision instead of digits: 1234 kg → "1.2 tCO₂e", 42 kg →
 * "42 kg CO₂e". Zero is handled by the caller (shows "尚未使用" instead).
 */
function formatCo2eWithUnit(kg: number): string {
  if (kg >= 1000) {
    return `${formatCo2e(kg / 1000)} t`;
  }
  return `${formatCo2e(kg)} kg`;
}

/** YYYY-MM-DD prefix of an ISO date or date-time. Safe for null/empty. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function scopeShortLabel(scope: 1 | 2 | 3): string {
  if (scope === 1) return m.sources_catalog_scope1_short();
  if (scope === 2) return m.sources_catalog_scope2_short();
  return m.sources_catalog_scope3_short();
}

// Static — referencing the module-scope object lets the filter hook's
// memos see a stable reference across re-renders.
const SOURCE_EXTRACTORS: SourceFilterExtractors<EmissionSourceWithStats> = {
  getName: (s) => s.name,
  getScope: (s) => s.scope,
  getCategory: (s) => s.category ?? '',
  // Power users can paste a ghg_protocol_path or the preset id stamped
  // into template_origin and find their source. We also fold in the
  // localized category label so Chinese searches like "燃料" / "差旅"
  // hit Climatiq-tagged rows whose stored category is the English
  // original.
  getSearchExtras: (s) =>
    `${s.ghg_protocol_path ?? ''} ${s.template_origin ?? ''} ${categoryLabel(s.category)}`,
};

function SourcesList({ organizationId }: { organizationId: string }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<EmissionSourceWithStats | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);

  // Enriched per-source rows with stats (count / total CO₂e / last activity).
  // Older surfaces still call `source:list-by-org` (no stats); this route
  // pays for the LEFT JOIN aggregation because cards display the stats.
  const sourcesQuery = useQuery<EmissionSourceWithStats[]>({
    queryKey: ['source:list-by-org-with-stats', organizationId],
    queryFn: () => sourceApi.listByOrgWithStats({ organization_id: organizationId }),
  });

  // Preset catalog fetch — used to look up template_origin → provenance
  // (BEIS · GB · 2025). Cached forever (catalog ships in the binary; no
  // staleness possible without an app update). Same cache key the
  // catalog drawer uses, so opening the drawer is also free after this.
  const presetsQuery = useQuery<PresetSource[]>({
    queryKey: ['source:list-presets'],
    queryFn: () => sourceApi.listPresets(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const presetsById = useMemo(() => {
    const map = new Map<string, PresetSource>();
    for (const p of presetsQuery.data ?? []) {
      map.set(p.id, p);
    }
    return map;
  }, [presetsQuery.data]);

  // Surface load errors via toast (per UI baseline pattern — no inline error
  // box). Effect depends ONLY on the boolean `isError` so React Query's
  // default 3-retry loop (which mints a fresh error object per attempt) won't
  // refire the toast three times. We read the error message at call time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately excluding sourcesQuery.error from deps — including it would refire the toast on every retry attempt (each retry mints a new error object), defeating the purpose of the fix.
  useEffect(() => {
    if (!sourcesQuery.isError) return;
    const err = sourcesQuery.error;
    const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    toast.error(m.sources_load_failed(), { description: msg });
  }, [sourcesQuery.isError]);

  const sources = sourcesQuery.data ?? [];
  const filters = useSourceFilters(sources, SOURCE_EXTRACTORS);
  const visible = filters.visible;

  return (
    // Sticky top + scrolling list (see CLAUDE.md → Scroll containment).
    // Heading + Add button + open form stay pinned; only the source rows
    // scroll inside the list container.
    <Main className="flex h-full flex-col gap-4">
      <div className="shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{m.nav_sources()}</h1>
          {/* Create now opens a right-side drawer (SourceAddDrawer) so
           * the list stays visible behind the overlay — users can scan
           * existing names for duplicates while filling out a new
           * source. Same vaul shell as SourceEditDrawer for symmetry
           * (add and edit feel like one family). */}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCatalogOpen(true)}>
              <Library className="mr-1 h-4 w-4" aria-hidden="true" />
              {m.sources_catalog_button()}
            </Button>
            <Button onClick={() => setFormOpen(true)}>{m.sources_add_button()}</Button>
          </div>
        </div>

        {/* Search · scope tabs · category chips. Hidden only when the
            org has no sources at all — the drawer doesn't replace the
            list so filters remain useful while create is in flight. */}
        {sources.length > 0 && (
          <SourceFilterHeader
            search={filters.search}
            onSearchChange={filters.setSearch}
            scopeFilter={filters.scopeFilter}
            onScopeChange={filters.setScopeFilter}
            scopeCounts={filters.scopeCounts}
            categoryFilter={filters.categoryFilter}
            onCategoryChange={filters.setCategoryFilter}
            categories={filters.categories}
            scopeFilteredCount={filters.scopeFilteredCount}
            searchPlaceholder={m.sources_search_placeholder()}
          />
        )}
      </div>

      {sources.length === 0 ? (
        <p className="shrink-0 text-sm text-muted-foreground">{m.sources_empty()}</p>
      ) : visible.length === 0 ? (
        // The org has sources but the filter pipeline trimmed everything
        // out — show a quieter empty state with a "clear filters" hint.
        <div className="flex-1 flex min-h-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/40 p-8 text-sm text-muted-foreground">
          <p>{m.sources_filter_empty()}</p>
          <button
            type="button"
            onClick={filters.reset}
            className="rounded px-2 py-1 text-xs font-medium text-foreground/70 hover:bg-foreground/5"
          >
            {m.sources_filter_clear()}
          </button>
        </div>
      ) : (
        // List container claims the remaining height and owns the scroll.
        // Card content (top → bottom):
        //   row 1: name + "已停用" chip (only when is_active=false)
        //   row 2: scope pill · category · ghg_protocol_path (if set)
        //   row 3: stats line — count + last + total, OR "尚未使用" if 0
        //   row 4: provenance — "来自 BEIS · GB · 2025" (only when from catalog)
        // We removed the bare "是 / 否" indicator — it confused users
        // (it just meant is_active, but read as "is what?"). Default state
        // (active) gets no chip; inactive gets a clear "已停用" badge.
        <ul className="flex-1 min-h-0 divide-y divide-border overflow-auto rounded-md border border-border bg-card">
          {visible.map((src) => {
            const provenance = src.template_origin ? presetsById.get(src.template_origin) : null;
            const provenanceParts = provenance
              ? [provenance.source, provenance.region, provenance.year]
                  .filter((v) => v !== undefined && v !== null && v !== '')
                  .join(' · ')
              : null;
            return (
              <li key={src.id}>
                <button
                  type="button"
                  onClick={() => setEditingSource(src)}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none',
                    !src.is_active && 'opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {/* Row 1 — primary identifier + status chip */}
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium text-foreground" title={src.name}>
                        {src.name}
                      </div>
                      {!src.is_active && (
                        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {m.sources_inactive_chip()}
                        </span>
                      )}
                    </div>

                    {/* Row 2 — scope · category · ghg_protocol_path */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 font-medium text-foreground/80">
                        {scopeShortLabel(src.scope)}
                      </span>
                      {src.category && (
                        <>
                          <span>·</span>
                          <span title={src.category}>{categoryLabel(src.category)}</span>
                        </>
                      )}
                      {src.ghg_protocol_path &&
                        !isPathRedundantWithCategory(src.ghg_protocol_path, src.category) && (
                          <>
                            <span>·</span>
                            <span title={src.ghg_protocol_path}>
                              {pathLabel(src.ghg_protocol_path)}
                            </span>
                          </>
                        )}
                    </div>

                    {/* Row 3 — usage stats. "尚未使用" replaces the trio of
                        zeros for un-touched sources — quieter and more
                        honest. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                      {src.activity_count === 0 ? (
                        <span className="italic">{m.sources_stats_unused()}</span>
                      ) : (
                        <>
                          <span>
                            {m.sources_stats_activity_count({
                              count: formatInteger(src.activity_count),
                            })}
                          </span>
                          <span>·</span>
                          <span title={`${src.total_co2e_kg} kg`}>
                            {m.sources_stats_total({
                              value: formatCo2eWithUnit(src.total_co2e_kg),
                            })}
                          </span>
                          {src.last_activity_at && (
                            <>
                              <span>·</span>
                              <span>
                                {m.sources_stats_last({ date: shortDate(src.last_activity_at) })}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Row 4 — preset provenance (only when applicable) */}
                    {provenanceParts && (
                      <div className="truncate text-[11px] text-muted-foreground/80">
                        {m.sources_from_catalog({ origin: provenanceParts })}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SourceAddDrawer
        organizationId={organizationId}
        open={formOpen}
        onClose={() => setFormOpen(false)}
      />
      <SourceEditDrawer
        source={editingSource}
        open={editingSource != null}
        onClose={() => setEditingSource(null)}
      />
      <SourceCatalogDrawer
        organizationId={organizationId}
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
      />
    </Main>
  );
}
