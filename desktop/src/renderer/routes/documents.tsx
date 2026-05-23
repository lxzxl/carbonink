import { ListItem, StatusDot } from '@renderer/components/app-shell/ListItem';
import { DocumentsUpload } from '@renderer/components/DocumentsUpload';
import { SortMenu, type SortMenuOption } from '@renderer/components/sort-menu';
import { ChipCountBadge } from '@renderer/components/source-filters';
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
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { Document, ExtractionStatus } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router';
import { ChevronDown, Plus, Search } from 'lucide-react';
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
  // Detect detail mode (we're on /documents/$id). When a document is
  // selected, the docs list panel gives way entirely — PDF + extraction
  // form fill the canvas. The detail view provides a "← back" link
  // plus prev/next arrows so users don't need the list visible to walk
  // through their review queue. strict:false because this layout
  // matches both `/documents` (no params) and `/documents/$id`.
  const params = useParams({ strict: false }) as { id?: string };
  const onDetailView = !!params.id;

  // Provider gate hoisted to layout so the upload zone (rendered inside
  // DocumentsListColumn below) can branch on it without re-fetching.
  const providerQuery = useQuery({
    queryKey: ['settings:get-provider'],
    queryFn: settingsApi.getProvider,
  });

  if (onDetailView) {
    // Full-width detail: PDF + form get the entire pane. No docs list,
    // no resizable split at this level — the detail component owns its
    // own PDF | form ResizablePanelGroup (see documents.$id.tsx).
    return (
      <div className="h-full overflow-hidden">
        <Outlet />
      </div>
    );
  }

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

type DocumentSort = 'recent' | 'oldest' | 'filename';
type DocumentStatusFilter = 'all' | DocumentStatusChip;

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

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DocumentStatusFilter>('all');
  const [sort, setSort] = useState<DocumentSort>('recent');

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

  /** Decorated docs carrying the resolved status chip — saves recomputing
   *  it per render in the filter/sort pipeline below. */
  const decoratedDocs = useMemo(() => {
    return docs.map((d) => ({
      doc: d,
      chip: resolveStatusChip(
        statusByDocId.get(d.id)?.active ?? null,
        statusByDocId.get(d.id)?.hasRejected ?? false,
      ),
    }));
  }, [docs, statusByDocId]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return decoratedDocs;
    return decoratedDocs.filter(({ doc }) => doc.filename.toLowerCase().includes(q));
  }, [decoratedDocs, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<DocumentStatusFilter, number> = {
      all: searched.length,
      review_needed: 0,
      parsed: 0,
      rejected: 0,
      none: 0,
    };
    for (const { chip } of searched) counts[chip] += 1;
    return counts;
  }, [searched]);

  const statusFiltered = useMemo(() => {
    if (statusFilter === 'all') return searched;
    return searched.filter(({ chip }) => chip === statusFilter);
  }, [searched, statusFilter]);

  const visible = useMemo(() => {
    const arr = [...statusFiltered];
    switch (sort) {
      case 'recent':
        arr.sort((a, b) => b.doc.uploaded_at.localeCompare(a.doc.uploaded_at));
        break;
      case 'oldest':
        arr.sort((a, b) => a.doc.uploaded_at.localeCompare(b.doc.uploaded_at));
        break;
      case 'filename':
        arr.sort((a, b) => a.doc.filename.localeCompare(b.doc.filename, 'zh-CN'));
        break;
    }
    return arr;
  }, [statusFiltered, sort]);

  const sortOptions = useMemo<SortMenuOption<DocumentSort>[]>(
    () => [
      { value: 'recent', label: m.documents_sort_recent() },
      { value: 'oldest', label: m.documents_sort_oldest() },
      { value: 'filename', label: m.documents_sort_filename() },
    ],
    [],
  );

  const STATUS_FILTERS: { value: DocumentStatusFilter; label: string }[] = [
    { value: 'all', label: m.documents_filter_status_all() },
    { value: 'parsed', label: STATUS_CHIP_LABELS.parsed() },
    { value: 'review_needed', label: STATUS_CHIP_LABELS.review_needed() },
    { value: 'rejected', label: STATUS_CHIP_LABELS.rejected() },
    { value: 'none', label: STATUS_CHIP_LABELS.none() },
  ];

  const filtersActive = search !== '' || statusFilter !== 'all';
  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
  };

  if (docsQuery.isLoading) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">{m.loading()}</p>;
  }
  if (docs.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{m.documents_empty()}</p>;
  }

  return (
    <div>
      {/* Filter bar — sits under the upload panel inside the list column.
       *  Compact: search box on row 1; status chip row + sort dropdown
       *  on row 2 (chip row scrolls horizontally if many statuses, but
       *  there are only 4 so it never does). */}
      <div className="space-y-2 px-4 py-3 border-b border-border/40">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={m.documents_search_placeholder()}
            className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map(({ value, label }) => {
            const active = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-foreground/12 text-foreground'
                    : 'bg-transparent text-muted-foreground hover:bg-foreground/5',
                )}
              >
                <span>{label}</span>
                <ChipCountBadge count={statusCounts[value]} active={active} />
              </button>
            );
          })}
          <div className="ml-auto">
            <SortMenu value={sort} onChange={setSort} options={sortOptions} />
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
          <p>{m.documents_filter_empty()}</p>
          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded px-2 py-1 text-xs font-medium text-foreground/70 hover:bg-foreground/5"
            >
              {m.documents_filter_clear()}
            </button>
          )}
        </div>
      ) : (
        <ul className="py-1">
          {visible.map(({ doc: d, chip }) => (
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
          ))}
        </ul>
      )}
    </div>
  );
}
