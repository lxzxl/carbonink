import { sourceApi } from '@renderer/lib/api/emission-source';
import { currentLocale } from '@renderer/lib/i18n';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSource, PresetSource } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { Drawer } from 'vaul';
import { toast } from './toast';

/**
 * Right-side catalog drawer for adding emission sources from the
 * built-in seed (see `src/main/data/preset-sources.json`).
 *
 * Shell mirrors RebindEfDrawer / SourceEditDrawer for consistency
 * (vaul direction="right", overlay z-40, fixed right z-50, border-l),
 * but uses a wider w-[520px] body because rows show two name lines
 * (zh + en) + a category badge + an "Add" button.
 *
 * "Already added" detection: match by name against the org's current
 * source list (zh name from the preset = name the handler writes via
 * `add-from-preset`). This is a soft signal — renaming a source via
 * the edit drawer will make a preset reappear addable; that's
 * acceptable in v1 (the eventual AERA-backed catalog will use
 * `template_origin` as a stronger key).
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface SourceCatalogDrawerProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}

function scopeHeading(scope: 1 | 2 | 3): string {
  if (scope === 1) return m.sources_catalog_scope1();
  if (scope === 2) return m.sources_catalog_scope2();
  return m.sources_catalog_scope3();
}

export function SourceCatalogDrawer({ organizationId, open, onClose }: SourceCatalogDrawerProps) {
  const queryClient = useQueryClient();
  const locale = currentLocale();

  const presetsQuery = useQuery<PresetSource[]>({
    queryKey: ['source:list-presets'],
    queryFn: () => sourceApi.listPresets(),
    enabled: open,
  });

  // Org's existing sources — used to disable "Add" for presets whose
  // canonical (zh) name already exists in the user's catalog. Kept in
  // sync with the same key the /sources route uses, so an add here
  // immediately flips the badge.
  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', organizationId],
    queryFn: () => sourceApi.listByOrg({ organization_id: organizationId }),
    enabled: open,
  });

  const existingNames = useMemo(() => {
    return new Set((sourcesQuery.data ?? []).map((s) => s.name));
  }, [sourcesQuery.data]);

  const groups = useMemo(() => {
    const all = presetsQuery.data ?? [];
    return {
      1: all.filter((p) => p.scope === 1),
      2: all.filter((p) => p.scope === 2),
      3: all.filter((p) => p.scope === 3),
    } as const;
  }, [presetsQuery.data]);

  const addMutation = useMutation({
    mutationFn: (preset_id: string) =>
      sourceApi.addFromPreset({ organization_id: organizationId, preset_id }),
    onSuccess: () => {
      toast.success(m.sources_catalog_add_success());
      // Refresh both the org list AND the catalog "already added" badges.
      queryClient.invalidateQueries({ queryKey: ['source:list-by-org', organizationId] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.sources_catalog_add_failed(), { description: msg });
    },
  });

  if (!open) return null;

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[520px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
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

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-6">
            {presetsQuery.isPending && (
              <p className="text-sm text-muted-foreground">{m.loading()}</p>
            )}

            {presetsQuery.data && presetsQuery.data.length === 0 && (
              <p className="text-sm text-muted-foreground">{m.sources_catalog_empty()}</p>
            )}

            {presetsQuery.data &&
              ([1, 2, 3] as const).map((scope) =>
                groups[scope].length === 0 ? null : (
                  <section key={scope} className="space-y-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {scopeHeading(scope)}
                    </h2>
                    <ul className="divide-y divide-border rounded-md border border-border bg-card">
                      {groups[scope].map((preset) => {
                        const already = existingNames.has(preset.name_zh);
                        const primaryName = locale === 'zh-CN' ? preset.name_zh : preset.name_en;
                        const secondaryName = locale === 'zh-CN' ? preset.name_en : preset.name_zh;
                        return (
                          <li key={preset.id} className="flex items-center gap-3 px-3 py-2.5">
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
                            </div>
                            {already ? (
                              <span
                                className={cn(
                                  'inline-flex shrink-0 items-center gap-1 rounded-md',
                                  'bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600',
                                )}
                              >
                                <Check className="h-3 w-3" aria-hidden="true" />
                                {m.sources_catalog_added()}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addMutation.mutate(preset.id)}
                                disabled={
                                  addMutation.isPending && addMutation.variables === preset.id
                                }
                                className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {m.sources_catalog_add()}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ),
              )}
          </div>

          <div className="flex gap-2 border-t border-border bg-popover px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              {m.source_edit_cancel()}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
