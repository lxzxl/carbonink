import { Main } from '@renderer/components/layout/main';
import { SourceCatalogDrawer } from '@renderer/components/SourceCatalogDrawer';
import { SourceEditDrawer } from '@renderer/components/SourceEditDrawer';
import { SourceForm } from '@renderer/components/SourceForm';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSource } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { Library } from 'lucide-react';
import { useEffect, useState } from 'react';

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

function SourcesList({ organizationId }: { organizationId: string }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<EmissionSource | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', organizationId],
    queryFn: () => sourceApi.listByOrg({ organization_id: organizationId }),
  });

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

  return (
    // Sticky top + scrolling list (see CLAUDE.md → Scroll containment).
    // Heading + Add button + open form stay pinned; only the source rows
    // scroll inside the list container.
    <Main className="flex h-full flex-col gap-4">
      <div className="shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{m.nav_sources()}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCatalogOpen(true)}>
              <Library className="mr-1 h-4 w-4" aria-hidden="true" />
              {m.sources_catalog_button()}
            </Button>
            <Button onClick={() => setFormOpen((v) => !v)}>
              {formOpen ? m.sources_cancel_button() : m.sources_add_button()}
            </Button>
          </div>
        </div>

        {formOpen && (
          <SourceForm
            organizationId={organizationId}
            onCancel={() => setFormOpen(false)}
            onSuccess={() => setFormOpen(false)}
          />
        )}
      </div>

      {sources.length === 0 ? (
        <p className="shrink-0 text-sm text-muted-foreground">{m.sources_empty()}</p>
      ) : (
        // List container claims the remaining height and owns the scroll.
        // Layout per row: name (title) on row 1; scope chip + category meta
        // on row 2; active-state dot pinned right.
        <ul className="flex-1 min-h-0 divide-y divide-border overflow-auto rounded-md border border-border bg-card">
          {sources.map((src) => (
            <li key={src.id}>
              <button
                type="button"
                onClick={() => setEditingSource(src)}
                className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground" title={src.name}>
                    {src.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 font-medium uppercase tracking-wide text-foreground/80">
                      {src.scope}
                    </span>
                    <span>·</span>
                    <span>{src.category ?? '—'}</span>
                  </div>
                </div>
                <span
                  role="status"
                  aria-label={src.is_active ? m.sources_active_yes() : m.sources_active_no()}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 text-xs',
                    src.is_active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-2 w-2 rounded-full',
                      src.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                    )}
                  />
                  {src.is_active ? m.sources_active_yes() : m.sources_active_no()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

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
