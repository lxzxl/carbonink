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
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';

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

  const extractionsQuery = useQuery<Extraction[]>({
    queryKey: ['extraction:list-by-document', document.id],
    queryFn: () => extractionApi.listByDocument({ document_id: document.id }),
  });

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
              <ManualStagePicker
                documentId={document.id}
                defaultStageId={extractions[0]?.prompt_version}
                discardExtractionId={extractions[0]?.id}
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
