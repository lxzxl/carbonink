import { PdfPreview } from '@renderer/components/PdfPreview';
import { documentApi } from '@renderer/lib/api/document';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

/**
 * Mime-dispatching inline preview for a stored document. PDFs reuse the
 * existing `PdfPreview` (object-URL'd iframe); images get the same
 * fetch-bytes → blob-URL lifecycle with an `<img>`; anything else renders
 * a quiet "no preview" note. Built for the lineage panel's evidence
 * section, where attachments can be PDFs, spreadsheets, or photos.
 */
export interface FilePreviewProps {
  documentId: string;
  mimeType: string;
  className?: string;
}

export function FilePreview({ documentId, mimeType, className }: FilePreviewProps) {
  if (mimeType === 'application/pdf') {
    return <PdfPreview documentId={documentId} {...(className ? { className } : {})} />;
  }
  if (mimeType.startsWith('image/')) {
    return <ImagePreview documentId={documentId} mimeType={mimeType} className={className} />;
  }
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
      {m.evidence_preview_unsupported()}
    </div>
  );
}

function ImagePreview({
  documentId,
  mimeType,
  className,
}: {
  documentId: string;
  mimeType: string;
  className?: string | undefined;
}) {
  const bytesQuery = useQuery({
    queryKey: ['document:read-bytes', documentId],
    queryFn: () => documentApi.readBytes({ id: documentId }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const imgUrl = useMemo(() => {
    if (!bytesQuery.data) return null;
    const copy = new Uint8Array(bytesQuery.data);
    return URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
  }, [bytesQuery.data, mimeType]);

  useEffect(() => {
    if (!imgUrl) return;
    return () => {
      URL.revokeObjectURL(imgUrl);
    };
  }, [imgUrl]);

  if (bytesQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-border bg-muted/30 text-sm text-muted-foreground">
        {m.documents_review_pdf_loading()}
      </div>
    );
  }
  if (bytesQuery.isError || !imgUrl) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-border bg-muted/30 text-sm text-destructive">
        {m.documents_review_pdf_unavailable()}
      </div>
    );
  }
  return (
    <img
      src={imgUrl}
      alt={m.evidence_preview_image_alt()}
      className={className ?? 'max-h-full w-full rounded-md border border-border/60 object-contain'}
    />
  );
}
