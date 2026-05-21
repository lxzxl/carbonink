import { ExtractionReview } from '@renderer/components/ExtractionReview';
import { ManualStagePicker } from '@renderer/components/ManualStagePicker';
import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useParams } from '@tanstack/react-router';
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
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{document.filename}</h1>
        <p className="text-xs text-muted-foreground">
          {m.documents_review_uploaded_on({ date: document.uploaded_at.slice(0, 10) })} ·{' '}
          {m.documents_review_sha_label()}:{' '}
          <span className="font-mono">{document.sha256.slice(0, 8)}</span>
        </p>
      </header>

      {/* Round 4 #10: shifted PDF/extraction split from 55/45 to 65/35.
       * The detail panel didn't need ~45% of an already-narrow column —
       * the PDF benefited more from extra room (especially for documents
       * with dense Chinese text). */}
      <div className="grid h-[calc(100vh-200px)] grid-cols-1 gap-4 lg:grid-cols-[65fr_35fr]">
        <PdfPreview documentId={document.id} />
        <div className="overflow-y-auto">
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
      </div>
    </div>
  );
}

function PdfPreview({ documentId }: { documentId: string }) {
  const bytesQuery = useQuery({
    queryKey: ['document:read-bytes', documentId],
    queryFn: () => documentApi.readBytes({ id: documentId }),
    staleTime: Infinity,
  });

  const pdfUrl = useMemo(() => {
    if (!bytesQuery.data) return null;
    const copy = new Uint8Array(bytesQuery.data);
    return URL.createObjectURL(new Blob([copy.buffer], { type: 'application/pdf' }));
  }, [bytesQuery.data]);

  useEffect(() => {
    if (!pdfUrl) return;
    return () => {
      URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  if (bytesQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-border bg-muted/30 text-sm text-muted-foreground">
        {m.documents_review_pdf_loading()}
      </div>
    );
  }
  if (bytesQuery.isError || !pdfUrl) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-border bg-muted/30 text-sm text-destructive">
        {m.documents_review_pdf_unavailable()}
      </div>
    );
  }
  // #toolbar=0 hides Chromium's PDF chrome — see Round 2 polish.
  return (
    <iframe
      title={`PDF preview ${documentId}`}
      src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
      className="h-full w-full rounded-md border border-border/60 bg-card/30"
    />
  );
}
