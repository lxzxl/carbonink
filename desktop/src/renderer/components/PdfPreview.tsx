import { documentApi } from '@renderer/lib/api/document';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

/**
 * Inline PDF preview rendered via an object-URL'd <iframe>. Reused
 * by `/documents/$id` (the main detail view) and DocumentPreviewDrawer
 * (the `/activities` row "来自文档" peek). Both surfaces need the same
 * lifecycle — fetch bytes once, mint a blob URL, revoke on unmount —
 * so it lives as a shared primitive.
 *
 * `#toolbar=0&navpanes=0&scrollbar=0` strips Chromium's PDF chrome
 * (toolbar, side panel, scrollbar) so the embed reads as native
 * content rather than a "viewer inside a viewer".
 *
 * The query is keyed by `document:read-bytes` + id and cached with
 * `staleTime: Infinity` — documents are content-addressed (sha256
 * primary key) so the bytes never change for a given id.
 */
export interface PdfPreviewProps {
  documentId: string;
  /** Optional className passed through to the <iframe>. */
  className?: string;
}

export function PdfPreview({ documentId, className }: PdfPreviewProps) {
  const bytesQuery = useQuery({
    queryKey: ['document:read-bytes', documentId],
    queryFn: () => documentApi.readBytes({ id: documentId }),
    staleTime: Number.POSITIVE_INFINITY,
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
  return (
    <iframe
      title={`PDF preview ${documentId}`}
      src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
      className={className ?? 'h-full w-full rounded-md border border-border/60 bg-card/30'}
    />
  );
}
