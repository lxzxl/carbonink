import { sourceApi } from '@renderer/lib/api/emission-source';
import { currentLocale } from '@renderer/lib/i18n';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSource, PresetSource } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import { toast } from './toast';

/**
 * Right-side catalog drawer for adding emission sources from the bundled
 * preset seed (`src/main/data/preset-sources.json`, 300 entries).
 *
 * Layout (top → bottom):
 *   ┌── 排放源目录 ────────────────────────── ✕ ─┐
 *   │ [🔍 搜索：名称 / 类别 / 来源              ] │
 *   │ [ 全部 300 ] [ 范围1 12 ] [ 范围2 12 ] [ 3 ] │ ← scope tabs
 *   │ [Fuel 12] [Air Travel 12] [Vehicles 12] …  │ ← category chips (h-scroll)
 *   ├──────────────────────────────────────────────┤
 *   │ ☐ 全选当前 N 项                              │
 *   │ ☐ 汽油 燃烧（私家车）       BEIS · GB · 2025 │
 *   │ ☑ 柴油 燃烧（重型车）       BEIS · GB · 2025 │
 *   │ ✓ 电网供电                  已添加           │
 *   ├──────────────────────────────────────────────┤
 *   │ [ 取消 ]   已选 12   [ 添加 12 项 ]           │
 *   └──────────────────────────────────────────────┘
 *
 * Design choices:
 * - Search is plain `.includes()` over name_zh + name_en + category;
 *   300 items is comfortably under the threshold where Fuse.js helps.
 * - Scope tabs are 4-way (全部 / 1 / 2 / 3) because users often think
 *   about a single scope at a time; "全部" is the default for first
 *   visit, so the breadth of the catalog is immediately visible.
 * - Category chips refresh as the scope tab changes — we never show
 *   chips for a scope that has zero presets, and the chip count reflects
 *   matches *after* search but *before* category filter (so flipping
 *   chips feels like narrowing, not jumping).
 * - Already-added rows lose the checkbox and show the green ✓ "已添加"
 *   badge instead. They still count toward "X of Y in this category"
 *   so users can tell at a glance whether they've covered a section.
 * - "全选当前筛选" toggles all VISIBLE addable rows on/off in one click.
 *   No cap on selection size — the button label updates with the count,
 *   and the batch IPC handler runs the inserts in one transaction.
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface SourceCatalogDrawerProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}

type ScopeFilter = 'all' | 1 | 2 | 3;

function scopeLabel(scope: ScopeFilter): string {
  if (scope === 'all') return m.sources_catalog_scope_all();
  if (scope === 1) return m.sources_catalog_scope1_short();
  if (scope === 2) return m.sources_catalog_scope2_short();
  return m.sources_catalog_scope3_short();
}

export function SourceCatalogDrawer({ organizationId, open, onClose }: SourceCatalogDrawerProps) {
  const queryClient = useQueryClient();
  const locale = currentLocale();

  const presetsQuery = useQuery<PresetSource[]>({
    queryKey: ['source:list-presets'],
    queryFn: () => sourceApi.listPresets(),
    enabled: open,
  });

  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', organizationId],
    queryFn: () => sourceApi.listByOrg({ organization_id: organizationId }),
    enabled: open,
  });

  /** Lowercased trimmed search input — empty = no filter. */
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset all interaction state every time the drawer closes — opening it
  // fresh shouldn't show last session's search + selection ghosts.
  useEffect(() => {
    if (!open) {
      setSearch('');
      setScopeFilter('all');
      setCategoryFilter(null);
      setSelectedIds(new Set());
    }
  }, [open]);

  // Switching scope tabs also resets the category chip — categories don't
  // overlap across scopes, so keeping the old chip selected would yield
  // an empty list. We don't clear selection on scope change: batch-add
  // across mixed scopes is intentional (one click can flip both fuel +
  // electricity in one tx).
  const handleScopeChange = (scope: ScopeFilter) => {
    setScopeFilter(scope);
    setCategoryFilter(null);
  };

  const existingNames = useMemo(() => {
    return new Set((sourcesQuery.data ?? []).map((s) => s.name));
  }, [sourcesQuery.data]);

  const all = presetsQuery.data ?? [];

  // After search, before scope/category filter. Used for scope tab counts.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (p) =>
        p.name_zh.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.source ?? '').toLowerCase().includes(q),
    );
  }, [all, search]);

  const scopeCounts = useMemo(() => {
    return {
      all: searched.length,
      1: searched.filter((p) => p.scope === 1).length,
      2: searched.filter((p) => p.scope === 2).length,
      3: searched.filter((p) => p.scope === 3).length,
    };
  }, [searched]);

  // After search + scope. Used for category chip generation and counts.
  const scopeFiltered = useMemo(() => {
    if (scopeFilter === 'all') return searched;
    return searched.filter((p) => p.scope === scopeFilter);
  }, [searched, scopeFilter]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of scopeFiltered) {
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scopeFiltered]);

  // Final visible list = search + scope + category.
  const visible = useMemo(() => {
    if (!categoryFilter) return scopeFiltered;
    return scopeFiltered.filter((p) => p.category === categoryFilter);
  }, [scopeFiltered, categoryFilter]);

  // The subset of `visible` that is selectable (i.e. not already in the
  // org). "全选当前" toggles this whole set on/off; the addable count
  // drives the link's label.
  const addableInVisible = useMemo(
    () => visible.filter((p) => !existingNames.has(p.name_zh)),
    [visible, existingNames],
  );

  const allVisibleSelected =
    addableInVisible.length > 0 && addableInVisible.every((p) => selectedIds.has(p.id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of addableInVisible) next.delete(p.id);
      } else {
        for (const p of addableInVisible) next.add(p.id);
      }
      return next;
    });
  };

  const batchAddMutation = useMutation({
    mutationFn: (presetIds: string[]) =>
      sourceApi.addFromPresets({ organization_id: organizationId, preset_ids: presetIds }),
    onSuccess: (rows) => {
      toast.success(m.sources_catalog_batch_add_success({ count: String(rows.length) }));
      queryClient.invalidateQueries({ queryKey: ['source:list-by-org', organizationId] });
      setSelectedIds(new Set());
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.sources_catalog_batch_add_failed(), { description: msg });
    },
  });

  const handleConfirm = () => {
    if (selectedIds.size === 0) return;
    batchAddMutation.mutate([...selectedIds]);
  };

  if (!open) return null;

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[640px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.sources_catalog_title()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close catalog drawer"
            >
              ✕
            </button>
          </div>

          {/* Search + scope tabs + category chips — all sticky to the top. */}
          <div className="shrink-0 space-y-3 border-b border-border px-4 py-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={m.sources_catalog_search_placeholder()}
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
              />
            </div>

            <div className="flex gap-1">
              {(['all', 1, 2, 3] as const).map((scope) => {
                const count = scopeCounts[scope];
                const active = scopeFilter === scope;
                return (
                  <button
                    key={String(scope)}
                    type="button"
                    onClick={() => handleScopeChange(scope)}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-foreground/12 text-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-foreground/5',
                    )}
                  >
                    {scopeLabel(scope)} <span className="tabular-nums opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>

            {categories.length > 0 && (
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
                <button
                  type="button"
                  onClick={() => setCategoryFilter(null)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    categoryFilter === null
                      ? 'border-foreground/30 bg-foreground/10 text-foreground'
                      : 'border-border bg-transparent text-muted-foreground hover:bg-foreground/5',
                  )}
                >
                  {m.sources_catalog_category_all()}{' '}
                  <span className="tabular-nums opacity-60">{scopeFiltered.length}</span>
                </button>
                {categories.map(([cat, count]) => {
                  const active = categoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(active ? null : cat)}
                      className={cn(
                        'shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                        active
                          ? 'border-foreground/30 bg-foreground/10 text-foreground'
                          : 'border-border bg-transparent text-muted-foreground hover:bg-foreground/5',
                      )}
                    >
                      {cat} <span className="tabular-nums opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {presetsQuery.isPending && (
              <p className="text-sm text-muted-foreground">{m.loading()}</p>
            )}

            {presetsQuery.data && presetsQuery.data.length === 0 && (
              <p className="text-sm text-muted-foreground">{m.sources_catalog_empty()}</p>
            )}

            {presetsQuery.data && presetsQuery.data.length > 0 && visible.length === 0 && (
              <p className="text-sm text-muted-foreground">{m.sources_catalog_no_results()}</p>
            )}

            {visible.length > 0 && (
              <>
                {addableInVisible.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllVisible}
                    className="mb-2 inline-flex items-center gap-2 rounded px-1 py-0.5 text-xs font-medium text-foreground/70 hover:bg-foreground/5"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-flex h-4 w-4 items-center justify-center rounded border',
                        allVisibleSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background',
                      )}
                    >
                      {allVisibleSelected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    {allVisibleSelected
                      ? m.sources_catalog_deselect_all()
                      : m.sources_catalog_select_all({ count: String(addableInVisible.length) })}
                  </button>
                )}

                <ul className="divide-y divide-border rounded-md border border-border bg-card">
                  {visible.map((preset) => {
                    const already = existingNames.has(preset.name_zh);
                    const selected = selectedIds.has(preset.id);
                    const primaryName = locale === 'zh-CN' ? preset.name_zh : preset.name_en;
                    const secondaryName = locale === 'zh-CN' ? preset.name_en : preset.name_zh;
                    return (
                      <li key={preset.id} className="flex items-start gap-3 px-3 py-2.5">
                        {already ? (
                          // Already in the org — locked in, no checkbox.
                          <span
                            aria-hidden="true"
                            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                          >
                            <Check className="h-3 w-3" />
                          </span>
                        ) : (
                          <label className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleOne(preset.id)}
                              className="peer absolute h-4 w-4 cursor-pointer opacity-0"
                              aria-label={`Select ${primaryName}`}
                            />
                            <span
                              aria-hidden="true"
                              className={cn(
                                'inline-flex h-4 w-4 items-center justify-center rounded border transition-colors',
                                selected
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-background peer-hover:border-foreground/40',
                              )}
                            >
                              {selected ? <Check className="h-3 w-3" /> : null}
                            </span>
                          </label>
                        )}

                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-sm font-medium text-foreground"
                            title={preset.name_zh}
                          >
                            {primaryName}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="truncate" title={secondaryName}>
                              {secondaryName}
                            </span>
                            <span>·</span>
                            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-medium text-foreground/80">
                              {preset.category}
                            </span>
                            <span>·</span>
                            <span>{preset.hint_unit}</span>
                          </div>
                          {(preset.source || preset.region || preset.year) && (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                              {[preset.source, preset.region, preset.year]
                                .filter((v) => v !== undefined && v !== null && v !== '')
                                .join(' · ')}
                            </div>
                          )}
                        </div>

                        {already && (
                          <span className="shrink-0 self-center rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600">
                            {m.sources_catalog_added()}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {/* Footer batch bar */}
          <div className="flex items-center gap-2 border-t border-border bg-popover px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              {m.source_edit_cancel()}
            </button>
            <span className="flex-1 text-xs tabular-nums text-muted-foreground">
              {m.sources_catalog_selected_count({ count: String(selectedIds.size) })}
            </span>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || batchAddMutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchAddMutation.isPending
                ? m.sources_catalog_batch_add_pending()
                : m.sources_catalog_batch_add({ count: String(selectedIds.size) })}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
