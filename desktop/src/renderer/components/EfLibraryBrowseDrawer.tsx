import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { userEfLibraryApi } from '@renderer/lib/api/user-ef-library';
import * as m from '@renderer/paraglide/messages';
import type { EmissionFactor, UserEfLibrary } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** Rows fetched per request — matches the service's default page size. */
const PAGE_SIZE = 50;

/**
 * Settings → EF libraries → browse one library's factors (ROADMAP §8.1-④
 * v2). Read-only by design: editing a factor means re-importing the library
 * (the existing same-name replace path), so there is exactly one write path
 * into the `user:<name>` namespace.
 *
 * Paging is cumulative — "load more" grows `limit` rather than walking an
 * offset, so the query cache holds one entry per (library, query, size)
 * and re-renders never flash a shorter list. A 50k-row library is never
 * fully materialized: the user searches instead.
 */
export interface EfLibraryBrowseDrawerProps {
  library: UserEfLibrary | null;
  onClose: () => void;
}

export function EfLibraryBrowseDrawer({ library, onClose }: EfLibraryBrowseDrawerProps) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Reopening on a different library must not inherit the previous one's
  // search text or page depth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on library identity, not the row object
  useEffect(() => {
    setSearch('');
    setLimit(PAGE_SIZE);
  }, [library?.id]);

  const libraryId = library?.id ?? '';
  const browse = useQuery({
    queryKey: ['ef-library:browse', libraryId, search, limit],
    queryFn: () =>
      userEfLibraryApi.browse({
        library_id: libraryId,
        ...(search.trim() !== '' ? { query: search.trim() } : {}),
        limit,
      }),
    enabled: libraryId !== '',
    // Keep the previous page visible while the next one loads — otherwise
    // "load more" blanks the list mid-scroll.
    placeholderData: (prev) => prev,
  });

  const rows = browse.data?.rows ?? [];
  const total = browse.data?.total ?? 0;
  const hasMore = rows.length < total;

  return (
    <Drawer.Root
      open={library !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      direction="right"
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[640px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="shrink-0 space-y-3 border-b border-border px-5 py-4">
            <div className="space-y-1">
              <Drawer.Title className="text-base font-semibold text-foreground">
                {library?.name ?? ''}
              </Drawer.Title>
              <Drawer.Description className="text-xs text-muted-foreground">
                {library
                  ? m.ef_library_row_meta({
                      version: library.version,
                      count: String(library.factor_count),
                      date: library.imported_at.slice(0, 10),
                    })
                  : ''}
              </Drawer.Description>
            </div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(PAGE_SIZE);
                }}
                placeholder={m.ef_library_browse_search_placeholder()}
                className="pl-7"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
            {browse.isLoading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {m.ef_library_browse_loading()}
              </p>
            ) : rows.length === 0 ? (
              <p className="rounded-md border border-border bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
                {search.trim() === ''
                  ? m.ef_library_browse_empty_library()
                  : m.ef_library_browse_empty_search()}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-border rounded-md border border-border bg-card">
                  {rows.map((ef) => (
                    <FactorRow key={efKey(ef)} ef={ef} />
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-3 pt-3">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {m.ef_library_browse_count({
                      shown: String(rows.length),
                      total: String(total),
                    })}
                  </span>
                  {hasMore && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={browse.isFetching}
                      onClick={() => setLimit((n) => n + PAGE_SIZE)}
                    >
                      {m.ef_library_browse_load_more()}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function FactorRow({ ef }: { ef: EmissionFactor }) {
  const name = ef.name_zh ?? ef.name_en ?? ef.factor_code;
  return (
    <li className="space-y-1 px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {ef.co2e_kg_per_unit === null
            ? '—'
            : m.ef_library_browse_per_unit({
                value: String(ef.co2e_kg_per_unit),
                unit: ef.input_unit ?? '?',
              })}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <code className="font-mono">{ef.factor_code}</code>
        <span>·</span>
        <span>{m.ef_library_browse_scope({ scope: String(ef.scope) })}</span>
        {ef.category && (
          <>
            <span>·</span>
            <span className="truncate">{ef.category}</span>
          </>
        )}
        <span>·</span>
        <span>{ef.geography}</span>
        <span>·</span>
        <span className="tabular-nums">{ef.year}</span>
      </div>
    </li>
  );
}

function efKey(ef: EmissionFactor): string {
  return `${ef.factor_code}|${ef.year}|${ef.source}|${ef.geography}|${ef.dataset_version}`;
}
