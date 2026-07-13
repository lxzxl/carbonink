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
import { isOverdue, localToday, overdueDays } from '@renderer/lib/inbound-overdue';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { Questionnaire } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * `/supplier-disclosures` — inbound (supplier-disclosure) flow.
 *
 * Mirror of the questionnaires (outbound) layout, restricted to
 * direction='inbound' rows. Lives at a distinct top-level URL because
 * the cognitive intent is completely different from outbound — see the
 * 2026-05-27 spec for the "inbound is a data source" pivot.
 *
 * Backend stays unified: same `questionnaire` table, same IPC, same
 * service. Direction filtering happens client-side on the list.
 */
export const Route = createFileRoute('/supplier-disclosures')({
  component: SupplierDisclosuresLayout,
});

function SupplierDisclosuresLayout(): JSX.Element {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel
        defaultSize="32%"
        minSize="22%"
        maxSize="50%"
        className="border-r border-border/60"
      >
        <SupplierDisclosuresListColumn />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="68%">
        <div className="h-full overflow-hidden">
          <Outlet />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function statusLabel(status: string): string {
  switch (status) {
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

type IStatus = 'draft' | 'sent' | 'received' | 'ingested';
type IStatusFilter = 'all' | IStatus | 'overdue';
type ISort = 'recent' | 'oldest' | 'supplier' | 'due' | 'questions';

const I_STATUSES: IStatus[] = ['draft', 'sent', 'received', 'ingested'];

function SupplierDisclosuresListColumn(): JSX.Element {
  const params = useParams({ strict: false }) as { id?: string };
  const selectedId = params.id;
  const q = useQuery({
    queryKey: ['questionnaire:list'],
    queryFn: questionnaireApi.list,
  });

  // Inbound-only view: filter by direction at the renderer layer.
  // The backend list returns both directions in one shot — splitting
  // them across two HTTP requests would gain nothing and lose the
  // shared cache key.
  const list = (
    (q.data ?? []) as Array<Questionnaire & { customer_name: string; question_count: number }>
  ).filter((r) => r.direction === 'inbound');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<IStatusFilter>('all');
  const [sort, setSort] = useState<ISort>('recent');

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((r) => r.customer_name.toLowerCase().includes(query));
  }, [list, search]);

  const today = localToday();

  const statusCounts = useMemo(() => {
    const counts: Record<IStatusFilter, number> = {
      all: searched.length,
      draft: 0,
      sent: 0,
      received: 0,
      ingested: 0,
      overdue: 0,
    };
    for (const r of searched) {
      if ((I_STATUSES as readonly string[]).includes(r.status)) {
        counts[r.status as IStatus] += 1;
      }
      if (isOverdue(r, today)) counts.overdue += 1;
    }
    return counts;
  }, [searched, today]);

  const statusFiltered = useMemo(() => {
    if (statusFilter === 'all') return searched;
    if (statusFilter === 'overdue') return searched.filter((r) => isOverdue(r, today));
    return searched.filter((r) => r.status === statusFilter);
  }, [searched, statusFilter, today]);

  const visible = useMemo(() => {
    const arr = [...statusFiltered];
    switch (sort) {
      case 'recent':
        arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case 'oldest':
        arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case 'supplier':
        arr.sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'zh-CN'));
        break;
      case 'due':
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

  const sortOptions = useMemo<SortMenuOption<ISort>[]>(
    () => [
      { value: 'recent', label: '最近创建' },
      { value: 'oldest', label: '最早创建' },
      { value: 'supplier', label: '按供应商名' },
      { value: 'due', label: '按截止日期' },
      { value: 'questions', label: '按题目数' },
    ],
    [],
  );

  const STATUS_FILTERS: { value: IStatusFilter; label: string }[] = [
    { value: 'all', label: '全部状态' },
    { value: 'draft', label: '草稿' },
    { value: 'sent', label: '已发送' },
    { value: 'received', label: '已回收' },
    { value: 'ingested', label: '已入库' },
    { value: 'overdue', label: m.inbound_filter_overdue() },
  ];

  const filtersActive = search !== '' || statusFilter !== 'all';
  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background/85 backdrop-blur-sm px-4 py-3 border-b border-border/60">
        <h1 className="text-sm font-semibold">供应商披露</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/supplier-disclosures/new" className="gap-1">
            <Plus className="size-3.5" aria-hidden="true" />
            新建披露
          </Link>
        </Button>
      </header>

      {q.isLoading ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">加载中…</p>
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          尚无供应商披露。点击右上「+ 新建披露」开始向上游供应商收集 Scope 3 Cat 1 数据。
        </p>
      ) : (
        <>
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
                placeholder="搜索供应商名称…"
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
              <p>没有符合筛选条件的披露。</p>
              {filtersActive && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded px-2 py-1 text-xs font-medium text-foreground/70 hover:bg-foreground/5"
                >
                  清除筛选
                </button>
              )}
            </div>
          ) : (
            <ul className="py-1">
              {visible.map((r) => (
                <ListItem
                  key={r.id}
                  to="/supplier-disclosures/$id"
                  params={{ id: r.id }}
                  isSelected={r.id === selectedId}
                  title={r.customer_name}
                  titleAttr={r.customer_name}
                  meta={
                    <>
                      <span>{r.reporting_year}</span>
                      <span>·</span>
                      <span>{statusLabel(r.status)}</span>
                      <span>·</span>
                      <span>{r.question_count} 题</span>
                      {r.due_date && (
                        <>
                          <span>·</span>
                          {isOverdue(r, today) ? (
                            <span className="font-medium text-destructive">
                              {m.inbound_overdue_days({
                                days: String(overdueDays(r.due_date, today)),
                              })}
                            </span>
                          ) : (
                            <span>{m.inbound_due_on({ date: r.due_date })}</span>
                          )}
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
