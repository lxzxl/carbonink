import { SourceForm } from '@renderer/components/SourceForm';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSource } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
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

  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', organizationId],
    queryFn: () => sourceApi.listByOrg({ organization_id: organizationId }),
  });

  // Surface load errors via toast (per UI baseline pattern — no inline error
  // box). Effect-gated so the toast fires once per error transition rather
  // than every render.
  useEffect(() => {
    if (sourcesQuery.error) {
      const msg =
        sourcesQuery.error instanceof Error ? sourcesQuery.error.message : 'Unknown error';
      toast.error(m.sources_load_failed(), { description: msg });
    }
  }, [sourcesQuery.error]);

  const sources = sourcesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.nav_sources()}</h1>
        <Button onClick={() => setFormOpen((v) => !v)}>
          {formOpen ? m.sources_cancel_button() : m.sources_add_button()}
        </Button>
      </div>

      {formOpen && (
        <SourceForm
          organizationId={organizationId}
          onCancel={() => setFormOpen(false)}
          onSuccess={() => setFormOpen(false)}
        />
      )}

      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.sources_empty()}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{m.sources_table_name()}</th>
                <th className="px-3 py-2 font-medium">{m.sources_table_scope()}</th>
                <th className="px-3 py-2 font-medium">{m.sources_table_category()}</th>
                <th className="px-3 py-2 font-medium">{m.sources_table_active()}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr key={src.id} className="border-t border-border">
                  <td className="px-3 py-2">{src.name}</td>
                  <td className="px-3 py-2">{src.scope}</td>
                  <td className="px-3 py-2 text-muted-foreground">{src.category ?? '—'}</td>
                  <td className="px-3 py-2">
                    {src.is_active ? m.sources_active_yes() : m.sources_active_no()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
