import { DocumentsUpload } from '@renderer/components/DocumentsUpload';
import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
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
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{m.nav_documents()}</h1>
      <DocumentsUpload />
      <DocumentsList />
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
