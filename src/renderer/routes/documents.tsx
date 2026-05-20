import { DocumentsUpload } from '@renderer/components/DocumentsUpload';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { settingsApi } from '@renderer/lib/api/settings';
import { stageLabel } from '@renderer/lib/stage-labels';
import * as m from '@renderer/paraglide/messages';
import type { Document, ExtractionStatus } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';

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
  // If none, replace upload zone with a banner linking to the Settings page.
  // Re-renders automatically when the user saves settings (queryKey shared
  // with SettingsPage's `getProvider` query → mutation invalidates).
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
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <p className="text-sm font-medium">{m.documents_ai_required_title()}</p>
      <p className="mt-1 text-sm text-muted-foreground">{m.documents_ai_required_body()}</p>
      <Button asChild type="button" className="mt-3">
        <Link to="/settings">{m.documents_ai_required_cta()}</Link>
      </Button>
    </div>
  );
}

/**
 * Per-document status displayed in the table's "Status" column. The state
 * machine condenses the (active extraction status, has-rejected history)
 * pair from `extraction:list-statuses` into one of four visual states:
 *
 *  - 'review_needed' → AI extracted something, user hasn't acted on it yet
 *  - 'parsed'        → user confirmed; the extraction is now activity_data
 *  - 'rejected'      → ONLY rejected rows in history, no fresh attempt
 *  - 'none'          → no extraction has ever been attempted (or rare
 *                       'pending' rows; same UX surface — "ready to run")
 *
 * 'pending' is treated as 'review_needed' since the only producer is
 * `extraction:run` and we transition to 'review_needed' immediately;
 * 'pending' rows shouldn't normally exist at rest.
 */
type DocumentStatusChip = 'review_needed' | 'parsed' | 'rejected' | 'none';

const STATUS_CHIP_CLASSES: Record<DocumentStatusChip, string> = {
  review_needed: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  parsed:
    'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
  none: 'border-border bg-muted/30 text-muted-foreground',
};

const STATUS_CHIP_LABELS: Record<DocumentStatusChip, () => string> = {
  review_needed: m.documents_status_review_needed,
  parsed: m.documents_status_parsed,
  rejected: m.documents_status_rejected,
  none: m.documents_status_none,
};

function resolveStatusChip(
  active: ExtractionStatus | null | undefined,
  hasRejected: boolean,
): DocumentStatusChip {
  if (active === 'parsed') return 'parsed';
  if (active === 'review_needed' || active === 'pending') return 'review_needed';
  // No active extraction. If history has rejected rows, surface "discarded"
  // so the user knows they need to re-run; otherwise it's a fresh upload
  // waiting for its first extraction.
  return hasRejected ? 'rejected' : 'none';
}

/**
 * Single row in the documents table. Hoisted out of `DocumentsList` so the
 * `biome-ignore lint/a11y/useKeyWithClickEvents` suppression can sit on the
 * exact JSX attribute line that triggers the rule — biome doesn't
 * thread suppressions across `return (` boundaries inside `.map()`
 * callbacks. The keyboard-activation path lives in the cell's `<Link>`;
 * the row-level onClick is a mouse-only convenience.
 */
function DocumentRow({
  document: d,
  statusChip,
  onOpen,
}: {
  document: Document;
  statusChip: DocumentStatusChip;
  onOpen: () => void;
}) {
  return (
    <tr className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={onOpen}>
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
        {d.uploaded_at.slice(0, 10)}
      </td>
      <td className="px-3 py-2">{d.filename}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <div className="flex gap-2">
          <span
            className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STATUS_CHIP_CLASSES[statusChip]}`}
          >
            {STATUS_CHIP_LABELS[statusChip]()}
          </span>
          <span className="inline-flex items-center rounded border border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {stageLabel(d.doc_type)}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.sha256.slice(0, 8)}</td>
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
  );
}

function DocumentsList() {
  const navigate = useNavigate();
  const docsQuery = useQuery<Document[]>({
    queryKey: ['document:list'],
    queryFn: () => documentApi.list(),
  });
  // Single batched query for all per-row chips. The handler executes one
  // GROUP-BY-per-document query against `extraction`; cheaper than the N+1
  // per-row `list-by-document` calls we deliberately avoided in Phase 1b.
  const statusesQuery = useQuery({
    queryKey: ['extraction:list-statuses'],
    queryFn: extractionApi.listStatuses,
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

  // Hoist the document_id → chip lookup once per render so the row-level
  // resolveStatusChip call is O(1). Statuses for docs with zero extraction
  // rows simply don't appear in the response — the lookup returns undefined
  // and resolveStatusChip falls through to 'none'.
  const statusByDocId = useMemo(() => {
    const map = new Map<string, { active: ExtractionStatus | null; hasRejected: boolean }>();
    for (const row of statusesQuery.data ?? []) {
      map.set(row.document_id, {
        active: row.active_status,
        hasRejected: row.has_rejected,
      });
    }
    return map;
  }, [statusesQuery.data]);

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
            <th className="px-3 py-2 font-medium">{m.documents_table_status()}</th>
            <th className="px-3 py-2 font-medium">{m.documents_table_sha()}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <DocumentRow
              key={d.id}
              document={d}
              statusChip={resolveStatusChip(
                statusByDocId.get(d.id)?.active ?? null,
                statusByDocId.get(d.id)?.hasRejected ?? false,
              )}
              onOpen={() => navigate({ to: '/documents/$id', params: { id: d.id } })}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
