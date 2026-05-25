import { ExtractionReview } from '@renderer/components/ExtractionReview';
import { ManualStagePicker } from '@renderer/components/ManualStagePicker';
import { PdfPreview } from '@renderer/components/PdfPreview';
import { toast } from '@renderer/components/toast';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, List } from 'lucide-react';
import { useEffect, useMemo } from 'react';

/**
 * /documents/$id — document review detail (Phase C nested route).
 *
 * This file is the right-pane content; the left-pane list is rendered by
 * the parent `documents.tsx` layout via `<Outlet />`. The previous
 * `/documents_/$id` (underscore = flat) route used a top-level <BackLink>
 * because the list disappeared on detail-load — gone now since the
 * list is always visible alongside.
 *
 * Two-column body within this pane:
 *   - PDF preview (~55% width)
 *   - ExtractionReview (~45% width) — chrome-hidden via the #toolbar=0
 *     URL fragment (Round 2 polish).
 */
export const Route = createFileRoute('/documents/$id')({
  component: DocumentReviewRoute,
});

function DocumentReviewRoute() {
  // strict:false lets useParams resolve without a hard route-id check —
  // tests sometimes mount this component under a manually-built router.
  const { id } = useParams({ strict: false }) as { id: string };

  const docQuery = useQuery<Document | null>({
    queryKey: ['document:get-by-id', id],
    queryFn: () => documentApi.getById({ id }),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: surface load errors via toast once per isError flip; refiring on each retry would dupe the toast.
  useEffect(() => {
    if (!docQuery.isError) return;
    const err = docQuery.error;
    const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    toast.error(m.documents_review_load_failed(), { description: msg });
  }, [docQuery.isError]);

  if (docQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{m.loading()}</p>;
  }
  if (!docQuery.data) {
    return <p className="text-sm text-destructive">{m.documents_review_load_failed()}</p>;
  }

  return <DocumentReview document={docQuery.data} />;
}

function DocumentReview({ document }: { document: Document }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const extractionsQuery = useQuery<Extraction[]>({
    queryKey: ['extraction:list-by-document', document.id],
    queryFn: () => extractionApi.listByDocument({ document_id: document.id }),
  });

  // Fetch the docs list so prev/next arrows can walk the queue without
  // the user having to back out to the list view. Same query key the
  // /documents (index) list uses — cached, so this is free if the user
  // came from the list, and a single round-trip if they deep-linked.
  const docsListQuery = useQuery<Document[]>({
    queryKey: ['document:list'],
    queryFn: () => documentApi.list(),
  });

  // Index of the current doc in the list, plus its neighbors. Memoized
  // so prev/next don't recompute on every extraction-query tick.
  const { prevDocId, nextDocId, position } = useMemo(() => {
    const list = docsListQuery.data ?? [];
    const idx = list.findIndex((d) => d.id === document.id);
    if (idx < 0) {
      return { prevDocId: null, nextDocId: null, position: null };
    }
    return {
      prevDocId: idx > 0 ? (list[idx - 1]?.id ?? null) : null,
      nextDocId: idx < list.length - 1 ? (list[idx + 1]?.id ?? null) : null,
      position: { current: idx + 1, total: list.length },
    } as const;
  }, [docsListQuery.data, document.id]);

  const goPrev = () => {
    if (prevDocId) navigate({ to: '/documents/$id', params: { id: prevDocId } });
  };
  const goNext = () => {
    if (nextDocId) navigate({ to: '/documents/$id', params: { id: nextDocId } });
  };

  const extractions = extractionsQuery.data ?? [];
  const activeExtraction = extractions.find((e) => e.status !== 'rejected');

  const classifyMutation = useMutation({
    mutationFn: () => extractionApi.classifyAndRun({ document_id: document.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', document.id],
      });
    },
  });

  useEffect(() => {
    if (
      extractionsQuery.data &&
      extractionsQuery.data.length === 0 &&
      !classifyMutation.isPending &&
      !classifyMutation.isError &&
      !classifyMutation.data
    ) {
      classifyMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractionsQuery.data, classifyMutation]);

  const hasDiscarded = !activeExtraction && extractions.some((e) => e.status === 'rejected');

  return (
    // Sticky header + scrolling body (see CLAUDE.md → Scroll containment).
    // Parent right-pane is overflow-hidden — see documents.tsx. The PDF
    // takes the left 65%; the extraction panel scrolls inside the right
    // 35%. Header (filename + upload date) stays pinned at the top so
    // long extraction reviews don't push it offscreen.
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Navigation header — replaces the always-visible docs list in
       * the parent layout (hidden when this route is active). Gives
       * users (a) a back link to the list, (b) prev/next arrows to
       * walk the review queue without round-tripping, (c) position
       * indicator (current / total) so they know how much is left.
       *
       * Filename + meta sit below as before. */}
      <div className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
        <Link
          to="/documents"
          className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-foreground/5 hover:text-foreground"
        >
          <List className="h-3.5 w-3.5" aria-hidden="true" />
          {m.documents_back_to_list()}
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            disabled={!prevDocId}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 transition-colors',
              prevDocId
                ? 'hover:bg-foreground/5 hover:text-foreground'
                : 'opacity-40 cursor-not-allowed',
            )}
            aria-label={m.documents_prev()}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{m.documents_prev()}</span>
          </button>
          {position && (
            <span className="px-2 tabular-nums">
              {position.current} / {position.total}
            </span>
          )}
          <button
            type="button"
            onClick={goNext}
            disabled={!nextDocId}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 transition-colors',
              nextDocId
                ? 'hover:bg-foreground/5 hover:text-foreground'
                : 'opacity-40 cursor-not-allowed',
            )}
            aria-label={m.documents_next()}
          >
            <span className="hidden sm:inline">{m.documents_next()}</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <header className="shrink-0 space-y-1">
        <h1 className="text-xl font-semibold">{document.filename}</h1>
        <p className="text-xs text-muted-foreground">
          {m.documents_review_uploaded_on({ date: document.uploaded_at.slice(0, 10) })} ·{' '}
          {m.documents_review_sha_label()}:{' '}
          <span className="font-mono">{document.sha256.slice(0, 8)}</span>
        </p>
      </header>

      {/* Resizable PDF | ExtractionReview split. Previously a fixed
       * `lg:grid-cols-[65fr_35fr]` — at typical desktop widths that left
       * the review panel ~235px wide, narrow enough that select inputs
       * truncated their saved value and focus rings got clipped by the
       * overflow boundary. ResizablePanelGroup lets the user pull the
       * divider; default 55/45 gives the form a usable starting width
       * and the PDF still reads fine.
       *
       * NOTE: v4 of react-resizable-panels needs sizes as "%" strings —
       * bare numbers are treated as px. Same gotcha documented in
       * documents.tsx for the parent splitter. */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize="55%" minSize="35%">
          <PdfPreview documentId={document.id} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="45%" minSize="30%">
          <div className="h-full overflow-y-auto pl-4">
            {extractionsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{m.loading()}</p>
            ) : classifyMutation.isPending ? (
              <div className="rounded-md border bg-muted/30 p-4">
                <p className="text-sm">{m.documents_review_classifying()}</p>
              </div>
            ) : (classifyMutation.data as Awaited<typeof classifyMutation.data>)?.status ===
              'classify_failed' ? (
              <ManualStagePicker documentId={document.id} />
            ) : !activeExtraction && hasDiscarded ? (
              // The previously-shown extraction was already discarded
              // (status='rejected'), so we deliberately do NOT pass
              // `discardExtractionId` here — the row is already in its
              // terminal state and a second discard would throw. We do
              // pass `defaultStageId` so the dropdown remembers the
              // stage the user just tried, letting them either try the
              // same stage again (run() will clean up the rejected row
              // on cache-key match) or pick a different one.
              <ManualStagePicker
                documentId={document.id}
                defaultStageId={extractions[0]?.prompt_version}
              />
            ) : activeExtraction ? (
              <ExtractionReview extraction={activeExtraction} document={document} />
            ) : null}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// PdfPreview now lives in @renderer/components/PdfPreview — shared with
// DocumentPreviewDrawer so the same lifecycle (fetch bytes once, mint a
// blob URL, revoke on unmount) backs both the route detail view and the
// /activities row peek.
