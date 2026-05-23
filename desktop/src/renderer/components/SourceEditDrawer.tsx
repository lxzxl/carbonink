import { sourceApi } from '@renderer/lib/api/emission-source';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSource } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { toast } from './toast';

/**
 * Right-side edit drawer for an EmissionSource row. Mirrors the
 * RebindEfDrawer shell (vaul direction="right", overlay z-40, content z-50
 * fixed right, border-l, w-[420px]) so the two drawers feel like a
 * coherent family.
 *
 * Optimistic field diffing: we only send fields the user actually changed.
 * The IPC update schema accepts every field as optional, so the patch can
 * legally be empty (the service short-circuits) — but sending a literal
 * `{}` would still spin the mutation; we just always include `id` and let
 * the user-facing button reflect "no changes" when needed (currently the
 * button is always active for simplicity — a no-op save is harmless).
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface SourceEditDrawerProps {
  source: EmissionSource | null;
  open: boolean;
  onClose: () => void;
}

type FormState = {
  name: string;
  scope: 1 | 2 | 3;
  category: string;
  is_active: boolean;
};

function fromSource(src: EmissionSource): FormState {
  return {
    name: src.name,
    scope: src.scope,
    category: src.category ?? '',
    is_active: src.is_active,
  };
}

export function SourceEditDrawer({ source, open, onClose }: SourceEditDrawerProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(source ? fromSource(source) : null);

  // Reset form when the drawer is opened on a new row. We key on the
  // source id (string) rather than the object reference so re-fetches of
  // the same row (which mint a new object) don't clobber unsaved edits.
  useEffect(() => {
    if (open && source) {
      setForm(fromSource(source));
    }
    if (!open) {
      setForm(null);
    }
  }, [open, source]);

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof sourceApi.update>[0]) => sourceApi.update(input),
    onSuccess: () => {
      toast.success(m.source_edit_success());
      queryClient.invalidateQueries({ queryKey: ['source:list-by-org'] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.source_edit_failed(), { description: msg });
    },
  });

  if (!open || !source || !form) return null;

  function buildPatch() {
    if (!source || !form) return { id: '' };
    const patch: Parameters<typeof sourceApi.update>[0] = { id: source.id };
    if (form.name !== source.name) patch.name = form.name;
    if (form.scope !== source.scope) patch.scope = form.scope;
    if ((form.category || null) !== (source.category ?? null)) {
      patch.category = form.category || undefined;
    }
    if (form.is_active !== source.is_active) patch.is_active = form.is_active;
    return patch;
  }

  function handleSave() {
    if (!form || !source) return;
    if (form.name.trim().length === 0) return;
    updateMutation.mutate(buildPatch());
  }

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[420px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.source_edit_title()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close edit drawer"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            <div className="space-y-1">
              <label
                htmlFor="source-edit-name"
                className="text-sm font-medium leading-none text-foreground"
              >
                {m.sources_form_name()}
              </label>
              <input
                id="source-edit-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none text-foreground">
                {m.sources_form_scope()}
              </legend>
              <div className="space-y-1">
                {([1, 2, 3] as const).map((s) => (
                  <label
                    key={s}
                    className="flex items-center gap-2 text-sm text-foreground"
                    htmlFor={`source-edit-scope-${s}`}
                  >
                    <input
                      id={`source-edit-scope-${s}`}
                      type="radio"
                      name="source-edit-scope"
                      value={s}
                      checked={form.scope === s}
                      onChange={() => setForm({ ...form, scope: s })}
                    />
                    <span>
                      {s === 1
                        ? m.sources_form_scope_1()
                        : s === 2
                          ? m.sources_form_scope_2()
                          : m.sources_form_scope_3()}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1">
              <label
                htmlFor="source-edit-category"
                className="text-sm font-medium leading-none text-foreground"
              >
                {m.sources_form_category()}
              </label>
              <input
                id="source-edit-category"
                type="text"
                value={form.category}
                placeholder={m.sources_form_category_placeholder()}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/*
              No shadcn <Switch> primitive in this project (only Button,
              Input, etc. — see src/renderer/components/ui/). Roll a small
              button-toggle so we don't drag in a new dependency for one
              field. role="switch" + aria-checked keeps a11y intact.
            */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium leading-none text-foreground">
                {m.source_edit_active_label()}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.is_active}
                aria-label={m.source_edit_active_label()}
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors',
                  form.is_active ? 'bg-primary' : 'bg-muted',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition-transform',
                    form.is_active ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                />
              </button>
            </div>
          </div>

          <div className="flex gap-2 border-t border-border bg-popover px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={updateMutation.isPending}
              className="flex-1 rounded px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {m.source_edit_cancel()}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={updateMutation.isPending || form.name.trim().length === 0}
              className="flex-1 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {m.source_edit_save()}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
