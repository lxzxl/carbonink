import { ExtractionReview } from '@renderer/components/ExtractionReview';
import { ManualStagePicker } from '@renderer/components/ManualStagePicker';
import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo } from 'react';

/**
 * /documents/$id — document review detail.
 *
 * Two-column layout: PDF preview (left ~55%) + ExtractionReview (right ~45%).
 * The PDF is rendered via an `<iframe>` pointed at a `Blob` URL we build
 * from bytes fetched over IPC (see `documentApi.readBytes`). This avoids:
 *   - file:// URLs (Electron's renderer default CSP blocks them with our
 *     contextIsolation setup),
 *   - a custom protocol handler (Phase 1c can add one if memory cost
 *     matters; for now PDFs are <1MB and the cost is negligible).
 *
 * The Blob URL lifecycle is tied to the document id — when the user
 * navigates away or to a different doc, the URL is `URL.revokeObjectURL`'d
 * in the effect's cleanup. Forgetting this leaks ~filesize bytes per
 * navigation; the cleanup keeps the renderer flat over long sessions.
 */
export const Route = createFileRoute('/documents_/$id')({
  component: DocumentReviewRoute,
});

function DocumentReviewRoute() {
  // strict:false lets useParams resolve from whichever route the component
  // is mounted under — production routes it as `/documents_/$id` (per the
  // flat-route id), but tests rebuild routes manually with `/documents/$id`.
  // Either way, `id` is the single dynamic segment.
  const { id } = useParams({ strict: false }) as { id: string };

  const docQuery = useQuery<Document | null>({
    queryKey: ['document:get-by-id', id],
    queryFn: () => documentApi.getById({ id }),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: same pattern as the rest of the app — surface load errors via toast once per `isError` flip, don't refire on every retry.
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
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-destructive">{m.documents_review_load_failed()}</p>
      </div>
    );
  }

  return <DocumentReview document={docQuery.data} />;
}

function DocumentReview({ document }: { document: Document }) {
  const queryClient = useQueryClient();

  const extractionsQuery = useQuery<Extraction[]>({
    queryKey: ['extraction:list-by-document', document.id],
    queryFn: () => extractionApi.listByDocument({ document_id: document.id }),
  });

  // Rejected rows are soft-deletes (kept in `extraction` for forensics until
  // the user explicitly re-extracts — see ExtractionService.run). The review
  // pane treats them as "no extraction yet", so we pick the most-recent
  // NON-rejected row as the active one.
  const extractions = extractionsQuery.data ?? [];
  const activeExtraction = extractions.find((e) => e.status !== 'rejected');

  // Auto-classify pipeline: fires once when we observe an empty extraction
  // list (no active extraction, no rejected history). This replaces the old
  // manual "Run extraction" button for brand-new documents.
  const classifyMutation = useMutation({
    mutationFn: () => extractionApi.classifyAndRun({ document_id: document.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', document.id],
      });
    },
  });

  useEffect(() => {
    // Only fire once on first observation of a truly empty extraction list
    // (no rows at all — not just no active extraction). If there's rejected
    // history, fall through to the ManualStagePicker via the hasDiscarded path.
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
      <BackLink />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{document.filename}</h1>
        <p className="text-xs text-muted-foreground">
          {m.documents_review_uploaded_on({ date: document.uploaded_at.slice(0, 10) })} ·{' '}
          {m.documents_review_sha_label()}:{' '}
          <span className="font-mono">{document.sha256.slice(0, 8)}</span>
        </p>
      </header>

      <div className="grid h-[calc(100vh-220px)] grid-cols-1 gap-4 lg:grid-cols-[55fr_45fr]">
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

function BackLink() {
  return (
    <Link
      to="/documents"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {m.documents_review_back()}
    </Link>
  );
}

function PdfPreview({ documentId }: { documentId: string }) {
  // Pulling bytes through IPC keeps the renderer from needing direct
  // filesystem access. The Blob URL is constructed from the returned
  // Uint8Array inside `useMemo` so it's stable for as long as the bytes
  // are; effect below revokes the previous URL when bytes change or the
  // component unmounts. This is the option-(C) approach from the Phase 1b
  // task 15 plan — simpler than wiring a custom protocol handler.
  const bytesQuery = useQuery({
    queryKey: ['document:read-bytes', documentId],
    queryFn: () => documentApi.readBytes({ id: documentId }),
    // Refetching here is expensive (re-reads entire PDF) and pointless —
    // bytes are immutable for a given doc id (content-addressed sha256).
    staleTime: Infinity,
  });

  const pdfUrl = useMemo(() => {
    if (!bytesQuery.data) return null;
    // `Blob` constructor declares its parts as `BlobPart[]` where ArrayBuffer
    // (not `ArrayBufferLike`) is the only buffer variant accepted under
    // strict TS lib defs. A fresh `Uint8Array(...)` allocates an
    // `ArrayBuffer`-backed view, so we copy the IPC-returned bytes into one
    // — paying one O(n) copy to satisfy the type checker without disabling
    // strict mode for this one call site.
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

  return (
    <iframe
      title={`PDF preview ${documentId}`}
      src={pdfUrl}
      className="h-full w-full rounded-md border border-border bg-muted/30"
    />
  );
}
