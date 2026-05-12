import { DocumentsUpload } from '@renderer/components/DocumentsUpload';
import { useSettingsDrawer } from '@renderer/components/settings-drawer-context';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { documentApi } from '@renderer/lib/api/document';
import { settingsApi } from '@renderer/lib/api/settings';
import * as m from '@renderer/paraglide/messages';
import type { Document } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * /documents — drag-drop upload zone + list of uploaded source files.
 *
 * Phase 1b scope (Task 14): list the user's documents and let them upload
 * new ones. We deliberately skip a per-row "extraction count" badge — the
 * Phase 1b plan calls that an optimization for Phase 1c (fetching N
 * extraction-list queries on render scales poorly once the user has more
 * than a handful of docs). The row click navigates to the detail page,
 * which loads the extraction state on demand.
 *
 * Date column shows just the YYYY-MM-DD slice — full ISO timestamps clutter
 * a scan-readable column. Sha column shows the first 8 hex chars (matches
 * what `git log --oneline` does; enough to disambiguate uploads at a glance
 * but doesn't dominate the row width).
 */
export const Route = createFileRoute('/documents')({
  component: DocumentsRoute,
});

function DocumentsRoute() {
  // Provider gate — extraction needs an AI provider configured.
  // If none, replace upload zone with a banner that opens Settings.
  // Re-renders automatically when the user saves settings (queryKey shared
  // with SettingsDrawerContent's `getProvider` query → mutation invalidates).
  const providerQuery = useQuery({
    queryKey: ['settings:get-provider'],
    queryFn: settingsApi.getProvider,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{m.nav_documents()}</h1>
      {providerQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{m.loading()}</p>
      ) : providerQuery.data == null ? (
        <ProviderNotConfiguredBanner />
      ) : (
        <DocumentsUpload />
      )}
      <DocumentsList />
    </div>
  );
}

function ProviderNotConfiguredBanner() {
  const { setOpen } = useSettingsDrawer();
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <p className="text-sm font-medium">{m.documents_ai_required_title()}</p>
      <p className="mt-1 text-sm text-muted-foreground">{m.documents_ai_required_body()}</p>
      <Button type="button" className="mt-3" onClick={() => setOpen(true)}>
        {m.documents_ai_required_cta()}
      </Button>
    </div>
  );
}

function DocumentsList() {
  const navigate = useNavigate();
  const docsQuery = useQuery<Document[]>({
    queryKey: ['document:list'],
    queryFn: () => documentApi.list(),
  });

  // Surface load errors via toast (matches /sources + /activities pattern).
  // Effect depends only on `isError` so React Query's retry loop doesn't
  // refire the toast on each retry attempt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately excluding docsQuery.error from deps — including it would refire the toast on every retry attempt (each retry mints a new error object), defeating the purpose of the fix.
  useEffect(() => {
    if (!docsQuery.isError) return;
    const err = docsQuery.error;
    const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    toast.error(m.documents_load_failed(), { description: msg });
  }, [docsQuery.isError]);

  const docs = docsQuery.data ?? [];

  if (docsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{m.loading()}</p>;
  }
  if (docs.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.documents_empty()}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">{m.documents_table_uploaded()}</th>
            <th className="px-3 py-2 font-medium">{m.documents_table_filename()}</th>
            <th className="px-3 py-2 font-medium">{m.documents_table_sha()}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the link inside the last cell handles keyboard activation; the row-level onClick is a convenience surface for mouse users only.
            <tr
              key={d.id}
              className="cursor-pointer border-t border-border hover:bg-muted/40"
              onClick={() => navigate({ to: '/documents/$id', params: { id: d.id } })}
            >
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {d.uploaded_at.slice(0, 10)}
              </td>
              <td className="px-3 py-2">{d.filename}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {d.sha256.slice(0, 8)}
              </td>
              <td className="px-3 py-2 text-right text-xs">
                {/* Real focusable link for keyboard users + screen readers.
                 * The row-level onClick is a mouse convenience; this link is
                 * the canonical activation path. Stop propagation so a click
                 * on the link itself doesn't fire the row handler too. */}
                <Link
                  to="/documents/$id"
                  params={{ id: d.id }}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`${m.documents_open_row()} ${d.filename}`}
                >
                  {m.documents_open_row()} →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
