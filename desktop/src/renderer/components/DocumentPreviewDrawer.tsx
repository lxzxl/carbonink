import { PdfPreview } from '@renderer/components/PdfPreview';
import { documentApi } from '@renderer/lib/api/document';
import * as m from '@renderer/paraglide/messages';
import type { Document } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Drawer } from 'vaul';

/**
 * Right-side drawer that previews a document by id without leaving
 * the current page. Used by the `/activities` row "来自文档" link so
 * users can verify which scan an activity came from without
 * navigating to `/documents/$id` and losing their place in the list.
 *
 * Width: 640px — wide enough that the PDF renders without horizontal
 * overflow on a typical A4 / Letter scan, matching the catalog
 * drawer's width for visual consistency.
 *
 * The drawer fetches the Document metadata (filename + uploaded_at)
 * on open via the existing `document:list` query (cached); the bytes
 * for the PDF iframe are fetched by the embedded `<PdfPreview>`. A
 * secondary "在文档页打开" link in the footer escape-hatches to the
 * full detail view for users who need to do extraction work.
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface DocumentPreviewDrawerProps {
  documentId: string | null;
  /** Fallback filename to render in the title before the doc list loads. */
  fallbackFilename?: string | null;
  onClose: () => void;
}

export function DocumentPreviewDrawer({
  documentId,
  fallbackFilename,
  onClose,
}: DocumentPreviewDrawerProps) {
  // Use the shared document list query so we don't fire a per-id GET —
  // /documents has the same data cached. If a user clicks the row
  // BEFORE the doc list has loaded once, we render the fallback name
  // from the activity row.
  const docsQuery = useQuery({
    queryKey: ['document:list'],
    queryFn: () => documentApi.list(),
    enabled: documentId !== null,
  });

  const doc: Document | undefined =
    documentId !== null ? docsQuery.data?.find((d) => d.id === documentId) : undefined;
  const filename = doc?.filename ?? fallbackFilename ?? '';

  if (documentId === null) return null;

  return (
    <Drawer.Root open={true} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[640px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <Drawer.Title
              className="truncate text-base font-semibold text-foreground"
              title={filename}
            >
              {filename || m.documents_preview_drawer_title()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close document preview"
            >
              ✕
            </button>
          </div>

          {/* Meta line — upload date + size when we have the doc. Stays
              hidden if metadata hasn't landed (still loading); the PDF
              body below renders independently. */}
          {doc && (
            <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
              <span>{doc.uploaded_at.slice(0, 10)}</span>
              <span className="mx-1.5">·</span>
              <span className="tabular-nums">{(doc.size_bytes / 1024).toFixed(1)} KB</span>
            </div>
          )}

          <div className="flex-1 overflow-hidden p-3">
            <PdfPreview documentId={documentId} />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-popover px-4 py-3">
            <Link
              to="/documents/$id"
              params={{ id: documentId }}
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {m.documents_preview_open_detail()}
            </Link>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
