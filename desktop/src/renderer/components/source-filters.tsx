import { categoryLabel } from '@renderer/lib/category-labels';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

/**
 * Shared filter primitives used by /sources (list of org's own sources)
 * and SourceCatalogDrawer (browseable preset catalog). Both surfaces
 * filter the same conceptual shape — a list of scope/category-tagged
 * emission sources — so search, scope tabs and category chips behave
 * identically.
 *
 * Split into:
 * - `useSourceFilters<T>(items, extractors)` — state + derived filter
 *   pipeline (search → scope → category) and counts for the header.
 * - `<SourceFilterHeader>` — purely presentational; takes the bag of
 *   state/setters/counts from the hook (or wherever) and renders the
 *   3-row sticky header (search input → scope tabs → category chips).
 *
 * The component is decoupled from `T`: it only cares about counts and
 * filter state, never the items themselves. Consumers compute the
 * `visible` list off the hook's return value and render it however
 * they like (catalog uses checkboxes + batch bar; /sources uses card
 * rows).
 */

export type ScopeFilter = 'all' | 1 | 2 | 3;

export interface SourceFilterExtractors<T> {
  /** Primary searchable text — usually the row's display name. */
  getName: (item: T) => string;
  getScope: (item: T) => 1 | 2 | 3;
  /** Empty string is allowed (treated as "uncategorized"). */
  getCategory: (item: T) => string;
  /**
   * Optional extra searchable text — e.g. en-name for bilingual rows,
   * ghg_protocol_path, source publisher. Each consumer concatenates
   * whatever fields they want users to be able to search by.
   */
  getSearchExtras?: (item: T) => string;
}

export interface UseSourceFiltersResult<T> {
  search: string;
  setSearch: (s: string) => void;
  scopeFilter: ScopeFilter;
  setScopeFilter: (s: ScopeFilter) => void;
  categoryFilter: string | null;
  setCategoryFilter: (c: string | null) => void;
  /** Convenience for unmount / drawer-close — clears all filter state. */
  reset: () => void;
  /** Final filtered list = items after search + scope + category. */
  visible: T[];
  /** Item count under the current scope tab (before category narrows). */
  scopeFilteredCount: number;
  /** Per-scope counts after search (drives the scope tab badges). */
  scopeCounts: { all: number; 1: number; 2: number; 3: number };
  /** [category, count] pairs available under the current scope tab. */
  categories: Array<[string, number]>;
}

export function useSourceFilters<T>(
  items: T[],
  extractors: SourceFilterExtractors<T>,
): UseSourceFiltersResult<T> {
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilterRaw] = useState<ScopeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Categories don't carry across scopes (no preset is both Fuel and
  // Air Travel), so flipping the scope tab also resets the chip. We
  // wrap the setter rather than running a useEffect — biome and React
  // both prefer this shape because the side-effect is tied to a user
  // action, not a derived value.
  const setScopeFilter = useCallback((s: ScopeFilter) => {
    setScopeFilterRaw(s);
    setCategoryFilter(null);
  }, []);

  const reset = useCallback(() => {
    setSearch('');
    setScopeFilterRaw('all');
    setCategoryFilter(null);
  }, []);

  // After search, before scope/category. Drives the scope tab counts —
  // those should reflect "how many results match the user's query in
  // each scope", so users can tell where their match landed.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    const { getName, getCategory, getSearchExtras } = extractors;
    return items.filter((it) => {
      if (getName(it).toLowerCase().includes(q)) return true;
      if (getCategory(it).toLowerCase().includes(q)) return true;
      if (getSearchExtras?.(it).toLowerCase().includes(q)) return true;
      return false;
    });
  }, [items, search, extractors]);

  const scopeCounts = useMemo(() => {
    const counts = { all: searched.length, 1: 0, 2: 0, 3: 0 };
    for (const it of searched) {
      const s = extractors.getScope(it);
      counts[s] += 1;
    }
    return counts;
  }, [searched, extractors]);

  // After search + scope. Drives category chip generation + counts.
  const scopeFiltered = useMemo(() => {
    if (scopeFilter === 'all') return searched;
    return searched.filter((it) => extractors.getScope(it) === scopeFilter);
  }, [searched, scopeFilter, extractors]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of scopeFiltered) {
      const cat = extractors.getCategory(it);
      // Skip empty categories from the chip row (they'd render as a
      // ghost chip with no label). Items with no category still appear
      // in the list — just not as a chip you can click.
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scopeFiltered, extractors]);

  const visible = useMemo(() => {
    if (!categoryFilter) return scopeFiltered;
    return scopeFiltered.filter((it) => extractors.getCategory(it) === categoryFilter);
  }, [scopeFiltered, categoryFilter, extractors]);

  return {
    search,
    setSearch,
    scopeFilter,
    setScopeFilter,
    categoryFilter,
    setCategoryFilter,
    reset,
    visible,
    scopeFilteredCount: scopeFiltered.length,
    scopeCounts,
    categories,
  };
}

function scopeLabel(scope: ScopeFilter): string {
  if (scope === 'all') return m.sources_catalog_scope_all();
  if (scope === 1) return m.sources_catalog_scope1_short();
  if (scope === 2) return m.sources_catalog_scope2_short();
  return m.sources_catalog_scope3_short();
}

export interface SourceFilterHeaderProps {
  search: string;
  onSearchChange: (s: string) => void;
  scopeFilter: ScopeFilter;
  onScopeChange: (s: ScopeFilter) => void;
  scopeCounts: { all: number; 1: number; 2: number; 3: number };
  categoryFilter: string | null;
  onCategoryChange: (c: string | null) => void;
  categories: Array<[string, number]>;
  scopeFilteredCount: number;
  searchPlaceholder?: string;
  className?: string;
}

/**
 * Three-row header: search input · scope tab row · category chip row.
 * The chip row is hidden when the active scope has no categories (the
 * "uncategorized only" edge case — common for hand-typed sources).
 */
export function SourceFilterHeader({
  search,
  onSearchChange,
  scopeFilter,
  onScopeChange,
  scopeCounts,
  categoryFilter,
  onCategoryChange,
  categories,
  scopeFilteredCount,
  searchPlaceholder,
  className,
}: SourceFilterHeaderProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder ?? m.sources_catalog_search_placeholder()}
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
              onClick={() => onScopeChange(scope)}
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
            onClick={() => onCategoryChange(null)}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              categoryFilter === null
                ? 'border-foreground/30 bg-foreground/10 text-foreground'
                : 'border-border bg-transparent text-muted-foreground hover:bg-foreground/5',
            )}
          >
            {m.sources_catalog_category_all()}{' '}
            <span className="tabular-nums opacity-60">{scopeFilteredCount}</span>
          </button>
          {categories.map(([cat, count]) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onCategoryChange(active ? null : cat)}
                title={cat}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  active
                    ? 'border-foreground/30 bg-foreground/10 text-foreground'
                    : 'border-border bg-transparent text-muted-foreground hover:bg-foreground/5',
                )}
              >
                {categoryLabel(cat)} <span className="tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
