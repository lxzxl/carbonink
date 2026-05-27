import { ListItem } from '@renderer/components/app-shell/ListItem';
import { SortMenu, type SortMenuOption } from '@renderer/components/sort-menu';
import { ChipCountBadge } from '@renderer/components/source-filters';
import { Button } from '@renderer/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { Questionnaire } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * /questionnaires — two-pane layout (Phase D of the UI redesign).
 * Mirrors the documents two-pane pattern: list on left, detail in Outlet
 * on right. The previous flat `/questionnaires_/$id` route is now
 * nested under this layout as `/questionnaires/$id`.
 */
export const Route = createFileRoute('/questionnaires')({
  component: QuestionnairesLayout,
});

function QuestionnairesLayout() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      {/* v4 breaking: sizes are strings with "%" suffix (numbers = px). */}
      <ResizablePanel
        defaultSize="32%"
        minSize="22%"
        maxSize="50%"
        className="border-r border-border/60"
      >
        <QuestionnairesListColumn />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="68%">
        {/* Right pane is overflow-hidden — each Outlet child owns its
         * own padding + scroll container. This lets the questionnaire
         * detail use the sticky-top / scroll-middle / sticky-bottom
         * pattern (h1 + action bar stay pinned; only the answer cards
         * scroll). Centralizing scroll here would force every detail
         * page through one rigid wrapper. See CLAUDE.md → Scroll
         * containment. */}
        <div className="h-full overflow-hidden">
          <Outlet />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'parsing':
      return m.questionnaires_status_parsing();
    case 'mapping':
      return m.questionnaires_status_mapping();
    case 'answering':
      return m.questionnaires_status_answering();
    case 'exported':
      return m.questionnaires_status_exported();
    // Inbound statuses (T10b — Phase 2.3). Bilingual labels not yet in
    // paraglide; keeping inline strings until T11 lands the i18n keys.
    case 'draft':
      return '草稿';
    case 'sent':
      return '已发送';
    case 'received':
      return '已回收';
    case 'ingested':
      return '已入库';
    default:
      return status;
  }
}

type QStatus =
  | 'parsing'
  | 'mapping'
  | 'answering'
  | 'exported'
  | 'draft'
  | 'sent'
  | 'received'
  | 'ingested';
type QStatusFilter = 'all' | QStatus;
type QDirectionFilter = 'all' | 'outbound' | 'inbound';
type QSort = 'recent' | 'oldest' | 'customer' | 'due' | 'questions';

const Q_STATUSES: QStatus[] = [
  'parsing',
  'mapping',
  'answering',
  'exported',
  'draft',
  'sent',
  'received',
  'ingested',
];

function QuestionnairesListColumn() {
  const params = useParams({ strict: false }) as { id?: string };
  const selectedId = params.id;
  const q = useQuery({
    queryKey: ['questionnaire:list'],
    queryFn: questionnaireApi.list,
  });

  const list = (q.data ?? []) as Array<
    Questionnaire & { customer_name: string; question_count: number }
  >;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QStatusFilter>('all');
  const [directionFilter, setDirectionFilter] = useState<QDirectionFilter>('all');
  const [sort, setSort] = useState<QSort>('recent');

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((r) => r.customer_name.toLowerCase().includes(query));
  }, [list, search]);

  const directionFiltered = useMemo(() => {
    if (directionFilter === 'all') return searched;
    return searched.filter((r) => r.direction === directionFilter);
  }, [searched, directionFilter]);

  const directionCounts = useMemo(() => {
    const counts: Record<QDirectionFilter, number> = {
      all: searched.length,
      outbound: 0,
      inbound: 0,
    };
    for (const r of searched) {
      if (r.direction === 'outbound' || r.direction === 'inbound') {
        counts[r.direction] += 1;
      }
    }
    return counts;
  }, [searched]);

  const statusCounts = useMemo(() => {
    const counts: Record<QStatusFilter, number> = {
      all: directionFiltered.length,
      parsing: 0,
      mapping: 0,
      answering: 0,
      exported: 0,
      draft: 0,
      sent: 0,
      received: 0,
      ingested: 0,
    };
    for (const r of directionFiltered) {
      if ((Q_STATUSES as readonly string[]).includes(r.status)) {
        counts[r.status as QStatus] += 1;
      }
    }
    return counts;
  }, [directionFiltered]);

  const statusFiltered = useMemo(() => {
    if (statusFilter === 'all') return directionFiltered;
    return directionFiltered.filter((r) => r.status === statusFilter);
  }, [directionFiltered, statusFilter]);

  const visible = useMemo(() => {
    const arr = [...statusFiltered];
    switch (sort) {
      case 'recent':
        arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case 'oldest':
        arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case 'customer':
        arr.sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'zh-CN'));
        break;
      case 'due':
        // Soonest due first; nulls sink to the bottom so the user sees
        // actionable items at the top.
        arr.sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        });
        break;
      case 'questions':
        arr.sort((a, b) => b.question_count - a.question_count);
        break;
    }
    return arr;
  }, [statusFiltered, sort]);

  const sortOptions = useMemo<SortMenuOption<QSort>[]>(
    () => [
      { value: 'recent', label: m.questionnaires_sort_recent() },
      { value: 'oldest', label: m.questionnaires_sort_oldest() },
      { value: 'customer', label: m.questionnaires_sort_customer() },
      { value: 'due', label: m.questionnaires_sort_due() },
      { value: 'questions', label: m.questionnaires_sort_questions() },
    ],
    [],
  );

  // Direction-aware status filter list: when the user has filtered to
  // outbound or inbound only, show that direction's statuses (avoids
  // showing irrelevant inbound 'draft' chips when looking at outbound).
  const STATUS_FILTERS: { value: QStatusFilter; label: string }[] = (() => {
    const base: { value: QStatusFilter; label: string }[] = [
      { value: 'all', label: m.questionnaires_filter_status_all() },
    ];
    const outboundStatuses: { value: QStatusFilter; label: string }[] = [
      { value: 'parsing', label: m.questionnaires_status_parsing() },
      { value: 'mapping', label: m.questionnaires_status_mapping() },
      { value: 'answering', label: m.questionnaires_status_answering() },
      { value: 'exported', label: m.questionnaires_status_exported() },
    ];
    const inboundStatuses: { value: QStatusFilter; label: string }[] = [
      { value: 'draft', label: '草稿' },
      { value: 'sent', label: '已发送' },
      { value: 'received', label: '已回收' },
      { value: 'ingested', label: '已入库' },
    ];
    if (directionFilter === 'outbound') return [...base, ...outboundStatuses];
    if (directionFilter === 'inbound') return [...base, ...inboundStatuses];
    return [...base, ...outboundStatuses, ...inboundStatuses];
  })();

  const DIRECTION_FILTERS: { value: QDirectionFilter; label: string }[] = [
    { value: 'all', label: '全部方向' },
    { value: 'outbound', label: 'Outbound' },
    { value: 'inbound', label: 'Inbound' },
  ];

  const filtersActive = search !== '' || statusFilter !== 'all' || directionFilter !== 'all';
  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setDirectionFilter('all');
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background/85 backdrop-blur-sm px-4 py-3 border-b border-border/60">
        <h1 className="text-sm font-semibold">{m.nav_questionnaires()}</h1>
        {/* New-questionnaire CTA promoted to a compact icon-text button in
         * the list-column header. The previous list-page used a heavier
         * `bg-primary` filled button at the top — too loud for native chrome. */}
        <Button asChild variant="outline" size="sm">
          <Link to="/questionnaires/new" className="gap-1">
            <Plus className="size-3.5" aria-hidden="true" />
            {m.questionnaires_new_button()}
          </Link>
        </Button>
      </header>

      {q.isLoading ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{m.loading()}</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{m.questionnaires_empty()}</p>
      ) : (
        <>
          {/* Filter bar — compact: search + status chips + sort menu. */}
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
                placeholder={m.questionnaires_search_placeholder()}
                className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
              />
            </div>
            {/* Direction filter (row 1) — primary axis, before status. */}
            <div className="flex flex-wrap items-center gap-1">
              {DIRECTION_FILTERS.map(({ value, label }) => {
                const active = directionFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setDirectionFilter(value);
                      // Reset status filter when direction changes — the
                      // status chip list itself is different per direction,
                      // so the prior selection might be invalid.
                      setStatusFilter('all');
                    }}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-foreground/12 text-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-foreground/5',
                    )}
                  >
                    <span>{label}</span>
                    <ChipCountBadge count={directionCounts[value]} active={active} />
                  </button>
                );
              })}
            </div>
            {/* Status filter (row 2) — adapts to selected direction. */}
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
              <p>{m.questionnaires_filter_empty()}</p>
              {filtersActive && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded px-2 py-1 text-xs font-medium text-foreground/70 hover:bg-foreground/5"
                >
                  {m.questionnaires_filter_clear()}
                </button>
              )}
            </div>
          ) : (
            <ul className="py-1">
              {visible.map((r) => (
                <ListItem
                  key={r.id}
                  to="/questionnaires/$id"
                  params={{ id: r.id }}
                  isSelected={r.id === selectedId}
                  title={r.customer_name}
                  titleAttr={r.customer_name}
                  meta={
                    <>
                      <span
                        className={cn(
                          'inline-flex items-center rounded border px-1 py-0 text-[10px] font-medium',
                          r.direction === 'inbound'
                            ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                        )}
                      >
                        {r.direction === 'inbound' ? 'IN' : 'OUT'}
                      </span>
                      <span>{r.reporting_year}</span>
                      <span>·</span>
                      <span>{statusLabel(r.status)}</span>
                      <span>·</span>
                      <span>
                        {r.question_count} {m.questionnaires_table_questions()}
                      </span>
                      {r.due_date && (
                        <>
                          <span>·</span>
                          <span>
                            {m.questionnaires_table_due()} {r.due_date}
                          </span>
                        </>
                      )}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
