import { sourceApi } from '@renderer/lib/api/emission-source';
import { categoryLabel } from '@renderer/lib/category-labels';
import { currentLocale } from '@renderer/lib/i18n';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSource, PresetSource } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import {
  type SourceFilterExtractors,
  SourceFilterHeader,
  useSourceFilters,
} from './source-filters';
import { toast } from './toast';

/**
 * Right-side catalog drawer for adding emission sources from the bundled
 * preset seed (`src/main/data/preset-sources.json`, 300 entries).
 *
 * Layout:
 *   header (title + ✕)
 *   filter header (search · scope tabs · category chips)  ← shared with /sources
 *   body (list with checkboxes, "全选当前 N 项" affordance)
 *   footer (cancel · selection count · batch add button)
 *
 * Search / scope / category state lives in the `useSourceFilters` hook
 * shared with `/sources`, so the two surfaces filter identically. Local
 * state here only covers what's catalog-specific: `selectedIds` for
 * batch-add.
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface SourceCatalogDrawerProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}

// Static extractor object — keeping it module-scope means the hook's
// memos don't see a new reference on every render.
const PRESET_EXTRACTORS: SourceFilterExtractors<PresetSource> = {
  getName: (p) => `${p.name_zh} ${p.name_en}`,
  getScope: (p) => p.scope,
  getCategory: (p) => p.category,
  // Include the Chinese label in the search corpus so a user typing
  // "燃料" / "电力" / "差旅" finds Climatiq rows whose stored category
  // is "Fuel" / "Electricity" / "Air Travel".
  getSearchExtras: (p) => `${p.source ?? ''} ${categoryLabel(p.category)}`,
};

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

  const presets = presetsQuery.data ?? [];
  const filters = useSourceFilters(presets, PRESET_EXTRACTORS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset filter + selection state every time the drawer closes — a
  // fresh open shouldn't show last session's ghosts.
  useEffect(() => {
    if (!open) {
      filters.reset();
      setSelectedIds(new Set());
    }
  }, [open, filters.reset]);

  const existingNames = useMemo(() => {
    return new Set((sourcesQuery.data ?? []).map((s) => s.name));
  }, [sourcesQuery.data]);

  const { visible } = filters;

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
      // Invalidate every org-scoped source list — both the plain
      // `source:list-by-org` (used by the catalog's own "already added"
      // detection + dashboard + extraction review + activities picker)
      // and `source:list-by-org-with-stats` (used by /sources cards).
      // The predicate keeps us honest if a third variant ever shows up.
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('source:list-by-org'),
      });
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

          <SourceFilterHeader
            className="shrink-0 border-b border-border px-4 py-3"
            search={filters.search}
            onSearchChange={filters.setSearch}
            scopeFilter={filters.scopeFilter}
            onScopeChange={filters.setScopeFilter}
            scopeCounts={filters.scopeCounts}
            categoryFilter={filters.categoryFilter}
            onCategoryChange={filters.setCategoryFilter}
            categories={filters.categories}
            scopeFilteredCount={filters.scopeFilteredCount}
          />

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
                            <span
                              className="rounded-md bg-secondary px-1.5 py-0.5 font-medium text-foreground/80"
                              title={preset.category}
                            >
                              {categoryLabel(preset.category)}
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
