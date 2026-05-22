import { ListItem, StatusDot } from '@renderer/components/app-shell/ListItem';
import { DocumentsUpload } from '@renderer/components/DocumentsUpload';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { settingsApi } from '@renderer/lib/api/settings';
import { stageLabel } from '@renderer/lib/stage-labels';
import * as m from '@renderer/paraglide/messages';
import type { Document, ExtractionStatus } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/**
 * /documents — two-pane layout (Phase C of the UI redesign).
 *
 *   ┌──────────────┬───────────────────────────────────┐
 *   │   List       │   Detail (Outlet)                 │
 *   │   - upload   │     /documents      → index       │
 *   │   - row      │     /documents/$id  → detail      │
 *   │   - row      │                                   │
 *   │   - row      │                                   │
 *   └──────────────┴───────────────────────────────────┘
 *
 * The list is always visible on the left so the user can switch docs
 * without an explicit "back to list" navigation. The previous flat
 * `/documents_/$id` (underscore) route used a `<BackLink>` because the
 * list disappeared on detail-load; nested `documents.$id` keeps the
 * list in view via the Outlet pattern.
 *
 * Left-pane width is user-resizable via shadcn ResizablePanelGroup
 * (built on react-resizable-panels). Default split 30/70; min/max
 * keeps either pane usable.
 */
export const Route = createFileRoute('/documents')({
  component: DocumentsLayout,
});

function DocumentsLayout() {
  // Provider gate hoisted to layout so the upload zone (rendered inside
  // DocumentsListColumn below) can branch on it without re-fetching.
  const providerQuery = useQuery({
    queryKey: ['settings:get-provider'],
    queryFn: settingsApi.getProvider,
  });

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      {/* react-resizable-panels v4: bare numbers are interpreted as `px`
       * (v3 was `%`). Always pass strings with "%" suffix. Without this
       * the list column collapsed to ~32 px and content wrapped one
       * Chinese character per line. */}
      <ResizablePanel
        defaultSize="32%"
        minSize="22%"
        maxSize="50%"
        className="border-r border-border/60"
      >
        <DocumentsListColumn providerConfigured={providerQuery.data != null} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="68%">
        {/* Right pane is overflow-hidden — each Outlet child owns its
         * own padding + scroll container. See CLAUDE.md → Scroll
         * containment. */}
        <div className="h-full overflow-hidden">
          <Outlet />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function DocumentsListColumn({ providerConfigured }: { providerConfigured: boolean }) {
  // Round 4 #6: upload zone used to permanently occupy ~120px at the top
  // of the list (3-line dropzone). With 10+ documents you'd see only 4
  // rows + the giant dropzone. Collapsed by default to a single
  // "+ 上传文档" button; expands to the full dropzone on click. State is
  // local to the column — no need to persist across navigations.
  const [uploadOpen, setUploadOpen] = useState(false);
  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background/85 backdrop-blur-sm px-4 py-3 border-b border-border/60">
        <h1 className="text-sm font-semibold">{m.nav_documents()}</h1>
        {providerConfigured && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setUploadOpen((v) => !v)}
            aria-expanded={uploadOpen}
            className="gap-1"
          >
            {uploadOpen ? (
              <>
                <ChevronDown className="size-3.5" aria-hidden="true" />
                {m.documents_upload_collapse()}
              </>
            ) : (
              <>
                <Plus className="size-3.5" aria-hidden="true" />
                {m.documents_upload_button()}
              </>
            )}
          </Button>
        )}
      </header>
      {providerConfigured && uploadOpen && (
        <div className="px-4 py-3 border-b border-border/40">
          <DocumentsUpload />
        </div>
      )}
      <DocumentsList />
    </div>
  );
}

export function ProviderNotConfiguredBanner() {
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

type DocumentStatusChip = 'review_needed' | 'parsed' | 'rejected' | 'none';

const STATUS_DOT_CLASSES: Record<DocumentStatusChip, string> = {
  review_needed: 'bg-amber-500',
  parsed: 'bg-primary',
  rejected: 'bg-destructive',
  none: 'bg-muted-foreground/30',
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
  return hasRejected ? 'rejected' : 'none';
}

function DocumentsList() {
  // Detect the currently-selected doc id from the URL so the row gets a
  // selected highlight. strict:false because this component renders inside
  // the layout (not a route that itself has $id), so TanStack can't infer
  // a single match — fall back to a runtime read.
  const params = useParams({ strict: false }) as { id?: string };
  const selectedId = params.id;

  const docsQuery = useQuery<Document[]>({
    queryKey: ['document:list'],
    queryFn: () => documentApi.list(),
  });
  const statusesQuery = useQuery({
    queryKey: ['extraction:list-statuses'],
    queryFn: extractionApi.listStatuses,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately excluding docsQuery.error from deps — refiring on each retry would dupe the toast.
  useEffect(() => {
    if (!docsQuery.isError) return;
    const err = docsQuery.error;
    const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    toast.error(m.documents_load_failed(), { description: msg });
  }, [docsQuery.isError]);

  const docs = docsQuery.data ?? [];

  const statusByDocId = useMemo(() => {
    const map = new Map<string, { active: ExtractionStatus | null; hasRejected: boolean }>();
    for (const row of statusesQuery.data ?? []) {
      map.set(row.document_id, { active: row.active_status, hasRejected: row.has_rejected });
    }
    return map;
  }, [statusesQuery.data]);

  if (docsQuery.isLoading) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">{m.loading()}</p>;
  }
  if (docs.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{m.documents_empty()}</p>;
  }

  return (
    <ul className="py-1">
      {docs.map((d) => {
        const chip = resolveStatusChip(
          statusByDocId.get(d.id)?.active ?? null,
          statusByDocId.get(d.id)?.hasRejected ?? false,
        );
        return (
          <ListItem
            key={d.id}
            to="/documents/$id"
            params={{ id: d.id }}
            ariaLabel={`${m.documents_open_row()} ${d.filename}`}
            isSelected={d.id === selectedId}
            leading={<StatusDot className={STATUS_DOT_CLASSES[chip]} />}
            title={d.filename}
            titleAttr={d.filename}
            meta={
              <>
                <span>{d.uploaded_at.slice(0, 10)}</span>
                <span>·</span>
                <span>{stageLabel(d.doc_type)}</span>
              </>
            }
          />
        );
      })}
    </ul>
  );
}
