import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import type { Site } from '@shared/types';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Inline create form for an EmissionSource. Mounted by /sources.
 *
 * Follows the StepCompanyInfo TanStack Form pattern (children-prop render
 * style — we calibrated Biome's `noChildrenProp` off for that hook).
 *
 * Site picker: Phase 1a always has exactly 1 site (created during onboarding),
 * so the dominant path renders a read-only label. The dropdown branch is
 * intentionally kept so future "add a second site" flows don't need a UI
 * rewrite — only adoption of the new Site management surface.
 *
 * On success: invalidates the per-org source list query so the table above
 * refetches, then calls `onSuccess` to close the form.
 */
export interface SourceFormProps {
  organizationId: string;
  onCancel: () => void;
  onSuccess: () => void;
}

export function SourceForm({ organizationId, onCancel, onSuccess }: SourceFormProps) {
  const queryClient = useQueryClient();

  const sitesQuery = useQuery<Site[]>({
    queryKey: ['org:list-sites', organizationId],
    queryFn: () => orgApi.listSites({ organization_id: organizationId }),
  });

  const createSource = useMutation({
    mutationFn: sourceApi.create,
    onSuccess: async () => {
      // Both the plain `source:list-by-org` and the stats variant feed
      // different surfaces — invalidate by prefix so a newly created
      // source shows up everywhere without remembering which queries
      // exist where.
      await queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('source:list-by-org'),
      });
      onSuccess();
    },
    onError: (err) => {
      toast.error(m.sources_create_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const sites = sitesQuery.data ?? [];
  const defaultSiteId = sites[0]?.id ?? '';

  const form = useForm({
    defaultValues: {
      name: '',
      scope: 1 as 1 | 2 | 3,
      category: '',
      site_id: defaultSiteId,
    },
    onSubmit: async ({ value }) => {
      await createSource.mutateAsync({
        site_id: value.site_id,
        name: value.name,
        scope: value.scope,
        category: value.category || undefined,
      });
    },
  });

  // Sites load asynchronously; once they arrive (single-site onboarding case
  // is the dominant path) pre-fill the form field so submit doesn't blow up
  // on an empty site_id. We can't do this during render — that's a React
  // anti-pattern (setState during render doubles work in strict mode and is
  // discardable in concurrent mode) and reading `form.state.values` outside
  // a <form.Field>/useStore subscription doesn't fire when the sites query
  // resolves after mount (the dominant production path). Effect-keyed on
  // defaultSiteId fixes both: it runs exactly once when sites resolve and
  // never clobbers user-edited input (we check the field is still empty).
  useEffect(() => {
    if (defaultSiteId && form.state.values.site_id === '') {
      form.setFieldValue('site_id', defaultSiteId);
    }
  }, [defaultSiteId, form]);

  // Subscribe to site_id so the submit button's disabled state reactively
  // tracks user dropdown picks. Reading `form.state.values.site_id` here
  // (without useStore) would only refresh on parent re-renders, not on
  // form-field changes — fine for single-site (defaultSiteId is enough),
  // but Phase 1b+ needs the live picked value.
  const siteId = useStore(form.store, (s) => s.values.site_id);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      // Chrome-less: the parent (currently SourceAddDrawer) provides the
      // surface — title bar, border, scroll container. The form just
      // contributes fields + its own action bar at the bottom.
      className="space-y-4"
    >
      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => (value.trim().length > 0 ? undefined : m.required_field()),
        }}
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="source-name">{m.sources_form_name()}</Label>
            <Input
              id="source-name"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.meta.errors[0] && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      />

      <form.Field
        name="scope"
        children={(field) => (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none">{m.sources_form_scope()}</legend>
            <div className="space-y-1">
              {([1, 2, 3] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value={s}
                    checked={field.state.value === s}
                    onChange={() => field.handleChange(s)}
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
        )}
      />

      <form.Field
        name="category"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="source-category">{m.sources_form_category()}</Label>
            <Input
              id="source-category"
              value={field.state.value}
              placeholder={m.sources_form_category_placeholder()}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </div>
        )}
      />

      <form.Field
        name="site_id"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="source-site">{m.sources_form_site()}</Label>
            {sites.length <= 1 ? (
              // Single-site case (Phase 1a default). Read-only label keeps
              // the field present (and form value populated) without
              // cluttering the UI with a one-option dropdown.
              <p id="source-site" className="text-sm text-muted-foreground">
                {sites[0]?.name_zh ?? sites[0]?.name_en ?? '—'}
              </p>
            ) : (
              <select
                id="source-site"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_zh ?? s.name_en ?? s.id}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={createSource.isPending}
        >
          {m.sources_cancel_button()}
        </Button>
        <Button type="submit" disabled={createSource.isPending || !siteId}>
          {createSource.isPending ? m.sources_form_submitting() : m.sources_form_submit()}
        </Button>
      </div>
    </form>
  );
}
